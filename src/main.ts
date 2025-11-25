import { ethers } from "ethers";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import _ from "lodash";
import ccxt from 'ccxt';
import {
  sendTelegramNotification,
  formatSuccessMessage,
  formatTimeoutErrorMessage,
  formatCriticalErrorMessage,
} from "./telegram"; 
import {
  getProcessedAddresses,
  markAsProcessed,
  isProcessed,
  getProcessedCount,
} from "./processedWallets"; 

dotenv.config();

type Network = "optimism" | "arbitrum";

// *** КОНФИГУРАЦИЯ ПУТЕЙ К ФАЙЛАМ ***
// ВСТАВЬТЕ СЮДА ПУТЬ К ФАЙЛУ СО СПИСОКОМ АДРЕСОВ (например: "data/evm.txt")
const WALLET_FILE_PATH = ""; 
// **********************************

// Amount configuration - как в Python
const MIN_AMOUNT = 0.001; // ETH - минимум суммы вывода
const MAX_AMOUNT = 0.01; // ETH - максимум суммы вывода
const DEST_BALANCE_THRESHOLD = 0.005; // ETH - если баланс >= этого, пропускаем адрес

// Delay configuration
const MIN_DELAY_HOURS = 3; // часов - минимальная задержка между выводами
const MAX_DELAY_HOURS = 5; // часов - максимальная задержка между выводами

// Network configuration - как в Python (50/50)
const NETWORK_WEIGHTS = {
  "OP": 0.5,   // Optimism
  "ARB": 0.5,  // Arbitrum
};

const FEE_CAPS: Record<string, number> = {
  "OP": 0.00001,
  "ARB": 0.00008,
};

// Other configuration
const MEXC_DRY_RUN = (process.env.MEXC_DRY_RUN ?? "true") === "true";
const CHECK_TIMEOUT_MIN = 20; // минут - таймаут проверки поступления денег
const CHECK_INTERVAL_SEC = 10; // сек - интервал проверки баланса
const RPC_RETRY_MAX = 5; // максимум попыток при ошибке RPC
const RPC_RETRY_DELAY_MIN_SEC = 3; // сек - минимальная задержка между retry
const RPC_RETRY_DELAY_MAX_SEC = 8; // сек - максимальная задержка между retry

const MEXC_API_KEY = process.env.MEXC_API_KEY || "";
const MEXC_API_SECRET = process.env.MEXC_API_SECRET || "";

/* Генерировать рандомное время задержки в часах (от MIN_DELAY_HOURS до MAX_DELAY_HOURS) */
function getRandomDelayHours(): number {
  return _.random(MIN_DELAY_HOURS, MAX_DELAY_HOURS, true);
}

/* Выбрать сеть на основе весов (взвешенный выбор) — используется при назначении в loadWalletsFromFile */
function getRandomNetwork(): Network {
  const nets = Object.keys(NETWORK_WEIGHTS);
  const weights = nets.map(n => NETWORK_WEIGHTS[n as keyof typeof NETWORK_WEIGHTS]);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = _.random(totalWeight, true);
  
  for (let i = 0; i < nets.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return (nets[i] === "OP" ? "optimism" : "arbitrum") as Network;
    }
  }
  
  return "optimism"; // fallback
}

/* --- Новая функция: случайный выбор цепочки именно перед withdraw --- */
function getRandomChain(): "OP" | "ARB" {
  return _.random(1) === 0 ? "OP" : "ARB";
}



/* RPC провайдеры с timeout и retry */
function getProviderForNetwork(net: Network): ethers.JsonRpcProvider {
  let rpcUrl: string;

  if (net === "optimism") {
    rpcUrl =
      process.env.OPTIMISM_RPC_URL ||
      "https://optimism.drpc.org";
  } else {
    rpcUrl =
      process.env.ARBITRUM_RPC_URL ||
      "https://arbitrum.drpc.org";
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  // Уменьшаем pollingInterval для RPC запросов
  provider.pollingInterval = 5000; // 5 секунд для проверки блоков
  return provider;
}

/**
 * Случайная задержка между retry (для избежания rate limits)
 */
function getRandomRetryDelay(): number {
  return Math.random() * (RPC_RETRY_DELAY_MAX_SEC - RPC_RETRY_DELAY_MIN_SEC) + RPC_RETRY_DELAY_MIN_SEC;
}

async function getEthBalance(address: string, net: Network): Promise<number> {
  const provider = getProviderForNetwork(net);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= RPC_RETRY_MAX; attempt++) {
    try {
      // Добавляем timeout для RPC запроса (30 секунд)
      const balancePromise = provider.getBalance(address);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`RPC timeout for ${net} network`)), 30000)
      );
      const balanceBn = await Promise.race([balancePromise, timeoutPromise]);
      return Number(ethers.formatEther(balanceBn));
    } catch (err) {
      lastError = err as Error;
      
      if (attempt === RPC_RETRY_MAX) {
        console.error(`❌ Failed after ${RPC_RETRY_MAX} attempts:`, lastError.message);
        throw lastError;
      }

      // Случайная задержка перед следующей попыткой
      const delayMs = getRandomRetryDelay() * 1000;
      console.warn(`⚠️ RPC error (attempt ${attempt}/${RPC_RETRY_MAX}), retrying in ${(delayMs / 1000).toFixed(1)}s...`);
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }

  throw lastError || new Error("Failed to get balance after retries");
}

function randomAmount(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/**
 * Функция для расчета минимальной суммы с учетом сетевых ограничений
 * Если сумма меньше минимума сети, поднимаем её на 5%
 */
function ensureMinAmount(amount: number, networkFee: number): number {
  const minWithFee = networkFee * 1.05;
  if (amount < minWithFee) {
    console.log(`⚠️ Amount ${amount.toFixed(8)} is less than min with fee ${minWithFee.toFixed(8)}, lifting...`);
    return minWithFee;
  }
  return amount;
}

/**
 * Проверить, может ли сеть быть использована:
 * - Вывод включен (withdrawEnable)
 * - Комиссия ниже установленного лимита
 */
function isNetworkEligible(networkLabel: string, networkFee: number): boolean {
  const cap = FEE_CAPS[networkLabel];
  if (!cap) {
    console.log(`⚠️ Network ${networkLabel} not in FEE_CAPS, skipping...`);
    return false;
  }
  if (networkFee > cap) {
    console.log(`⚠️ Network ${networkLabel} fee ${networkFee} > cap ${cap}, skipping...`);
    return false;
  }
  return true;
}

/**
 * Проверить баланс в обеих сетях
 */
async function checkBalanceInBothNetworks(address: string): Promise<{
  optimism: number;
  arbitrum: number;
}> {
  try {
    const [optimismBalance, arbitrumBalance] = await Promise.all([
      getEthBalance(address, "optimism"),
      getEthBalance(address, "arbitrum"),
    ]);

    return {
      optimism: optimismBalance,
      arbitrum: arbitrumBalance,
    };
  } catch (err) {
    console.error(`Error checking balance in both networks for ${address}:`, err);
    throw err;
  }
}

/**
 * Проверить, произошло ли изменение баланса в блокчейне
 */
async function waitForBalanceIncrease(
  address: string,
  net: Network,
  expectedAmount: number,
  timeoutMin: number = CHECK_TIMEOUT_MIN
): Promise<boolean> {
  const initialBalance = await getEthBalance(address, net);
  const startTime = Date.now();
  const timeoutMs = timeoutMin * 60 * 1000;
  const intervalMs = CHECK_INTERVAL_SEC * 1000;

  // Допуск на комиссии (10%)
  const minAcceptableAmount = expectedAmount * 0.90;

  console.log(`⏳ Waiting for balance increase at ${address} on ${net} (expected: ${expectedAmount} ETH)...`);

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((res) => setTimeout(res, intervalMs));

    try {
      const currentBalance = await getEthBalance(address, net);
      const balanceChange = currentBalance - initialBalance;

      

      if (balanceChange >= minAcceptableAmount) {
        console.log(`✅ Balance increased by ${balanceChange.toFixed(6)} ETH`);
        return true;
      }
    } catch (err) {
      console.error(`Error checking balance during polling:`, err);
      // Продолжаем опрашивать несмотря на ошибку
    }
  }

  console.log(`✗ Balance did not increase within ${timeoutMin} minutes.`);
  return false;
}


/**
 * Исправленная функция вывода для MEXC — использует CCXT как в Python
 */
async function mexcWithdraw(params: {
  currency: string;
  amount: string;
  address: string;
  chain: string; // ожидаем "OP" или "ARB"
}) {
  if (MEXC_DRY_RUN) {
    console.log("🧪 DRY_RUN mode - not executing real withdrawal");
    console.log("   Would send:", params);
    return { success: true, dryRun: true, payload: params };
  }

  if (!MEXC_API_KEY || !MEXC_API_SECRET) {
    throw new Error("MEXC API credentials not set in .env");
  }

  try {
    // Используем CCXT как в Python - это решит все проблемы с API
    const ex = new ccxt.mexc({
      apiKey: MEXC_API_KEY,
      secret: MEXC_API_SECRET,
      enableRateLimit: true,
      options: { adjustForTimeDifference: true },
    });

    // Загружаем markets (обязательно для CCXT)
    await ex.loadMarkets();

    // Маппим chain в network name для CCXT (используем правильные названия из API)
    const networkName = params.chain === "OP" ? "OPTIMISM" : "ARBITRUM";
    
    console.log(`📤 Withdrawal: ${params.amount} ${params.currency} to ${params.address} (${networkName})`);

    // CCXT автоматически формирует правильные параметры и подпись
    const currencies = await ex.fetchCurrencies();
    const availableCoins = Object.keys(currencies || {});
    
    // Ищем правильное название для ETH
    const ethVariants = ["ETH", "eth", "Ethereum", "ethereum"];
    const foundEth = ethVariants.find(variant => availableCoins.includes(variant));
    
    if (!foundEth) {
      throw new Error(`ETH not found in available currencies`);
    }
    
    const resp = await ex.withdraw(
      foundEth,
      parseFloat(params.amount),
      params.address,
      undefined, // tag
      {
        network: networkName,
        netWork: networkName,
      }
    );

    

    // CCXT возвращает стандартизированный ответ
    if (resp && resp.id) {
      return {
        success: true,
        withdrawId: resp.id,
        txid: resp.txid,
        raw: resp
      };
    }

    throw new Error(`MEXC error: ${JSON.stringify(resp)}`);
  } catch (err: any) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    
    console.error(`❌ MEXC withdrawal error: ${errorMsg}`);

    throw err;
  }
}

/**
 * Читать адреса из файла
 */
function loadWalletsFromFile(): { address: string; network: Network }[] {
  if (WALLET_FILE_PATH === "") {
    console.error(`❌ WALLET_FILE_PATH не установлен в main.ts! Пожалуйста, укажите путь к файлу адресов.`);
    return [];
  }
  
  const filePath = path.resolve(WALLET_FILE_PATH);

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const allLines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.startsWith("0x"));

  // Получаем список обработанных адресов
  const processedSet = getProcessedAddresses();

  // Фильтруем только необработанные адреса
  const unprocessedLines = allLines.filter((addr) => !isProcessed(addr));

  console.log(`Total addresses: ${allLines.length}`);
  console.log(`Already processed: ${processedSet.size}`);
  console.log(`To process: ${unprocessedLines.length}\n`);

  // Перемешиваем адреса
  const shuffled = _.shuffle(unprocessedLines);

  // Каждому адресу назначаем рандомную сеть (используется только для initial hint, реальный withdraw chain будет выбран случайно перед withdraw)
  return shuffled.map((address) => ({
    address,
    network: getRandomNetwork(),
  }));
}

/**
 * Основная логика для одного кошелька
 */
async function checkAndProcess(wallet: { address: string; network: Network }) {
  try {
    // Проверяем баланс сразу в обеих сетях
    const balances = await checkBalanceInBothNetworks(wallet.address);
    const totalBalance = balances.optimism + balances.arbitrum;
    console.log(`📊 ${wallet.address}: OP=${balances.optimism.toFixed(6)} ARB=${balances.arbitrum.toFixed(6)} Total=${totalBalance.toFixed(6)} ETH`);

    if (totalBalance >= DEST_BALANCE_THRESHOLD) {
      console.log(`⚠️ Total balance >= threshold (${DEST_BALANCE_THRESHOLD}) — skipping this address.`);
      markAsProcessed(wallet.address);
      return;
    }

    if (balances.optimism > 0 && balances.arbitrum > 0) {
      console.log("✓ Balance > 0 in both networks — no withdrawal needed.");
      markAsProcessed(wallet.address);
      return;
    }

    // выбираем сеть, где 0 баланс, если есть; иначе оставляем назначенную
    const selectedNetwork = balances[wallet.network] === 0 ? wallet.network : 
                           (balances.optimism === 0 ? "optimism" : "arbitrum");

    const amount = randomAmount(MIN_AMOUNT, MAX_AMOUNT);
    let adjustedAmount = ensureMinAmount(amount, 0.00001); // Approximate fee (will be adjusted later if needed)
    const amountStr = adjustedAmount.toFixed(8);

    

    // --- теперь случайно выбираем реальную цепочку OP / ARB для отправки ---
    const chainCode = getRandomChain(); // "OP" or "ARB"

    // минимальная проверка eligibility — используем FEE_CAPS estimate (best-effort)
    const feeEstimate = FEE_CAPS[chainCode] ?? 0.00001;
    if (!isNetworkEligible(chainCode, feeEstimate)) {
      console.log(`❌ Network ${chainCode} is not eligible for withdrawal (fee/cap check).`);
      markAsProcessed(wallet.address);
      return;
    }

    // Выполняем withdraw через CCXT (как в Python)
    const withdrawResult = await mexcWithdraw({
      currency: "ETH",
      amount: amountStr,
      address: wallet.address,
      chain: chainCode,
    });

    console.log(`✅ Withdrawal submitted: ${withdrawResult.withdrawId || 'unknown'}`);

    // Ожидаем прихода в блокчейн — привязанного к сети: если выбрана OP => проверяем optimism, если ARB => arbitrum
    const waitNet: Network = chainCode === "OP" ? "optimism" : "arbitrum";

    const success = await waitForBalanceIncrease(wallet.address, waitNet, adjustedAmount);

    if (success) {
      const finalBalance = await getEthBalance(wallet.address, waitNet);
      const message = formatSuccessMessage(wallet.address, chainCode, amountStr, finalBalance);
      await sendTelegramNotification(message);
      markAsProcessed(wallet.address);
    } else {
      const message = formatTimeoutErrorMessage(wallet.address, chainCode, amountStr, CHECK_TIMEOUT_MIN);
      await sendTelegramNotification(message);
      markAsProcessed(wallet.address);
    }
  } catch (err) {
    console.error("Error processing wallet", wallet.address, err);
    const message = formatCriticalErrorMessage(wallet.address, String(err));
    await sendTelegramNotification(message);
    markAsProcessed(wallet.address);
  }
}

/**
 * Последовательная обработка кошельков с задержкой рандомная от MIN_DELAY_HOURS до MAX_DELAY_HOURS между вызовами.
 */
async function main() {
  const wallets = loadWalletsFromFile();

  if (wallets.length === 0) {
    console.error("No wallets found to process or WALLET_FILE_PATH not configured!");
    return;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log("MEXC TO WALLET WITHDRAWAL SCRIPT");
  console.log(`${'='.repeat(60)}`);
  console.log(`\nLoaded ${wallets.length} wallets to process.`);
  console.log("Configuration:");
  console.log(`  DELAY_HOURS: ${MIN_DELAY_HOURS}-${MAX_DELAY_HOURS} (random)`);
  console.log(`  CHECK_TIMEOUT: ${CHECK_TIMEOUT_MIN} minutes`);
  console.log(`  MEXC_DRY_RUN: ${MEXC_DRY_RUN}`);
  console.log(`  Already processed: ${getProcessedCount()} wallets\n`);

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    console.log(`\n[${i + 1}/${wallets.length}] Processing wallet...`);
    
    await checkAndProcess(wallet);

    if (i < wallets.length - 1) {
      const delayHours = getRandomDelayHours();
      const delayMs = delayHours * 60 * 60 * 1000;
      console.log(`\n⏳ Waiting ${delayHours.toFixed(2)} hour(s) before next withdraw...`);
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log("=== All wallets processed ===");
  console.log(`Total processed: ${getProcessedCount()}`);
  console.log(`${'='.repeat(60)}\n`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
