import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

/**
 * Санитизировать текст для Telegram HTML (экранировать спецсимволы)
 */
function sanitizeForTelegram(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Отправить уведомление в Telegram
 */
export async function sendTelegramNotification(message: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("Telegram credentials not set, skipping notification.");
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const sanitizedMessage = sanitizeForTelegram(message);
    
    await axios.post(
      url,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: sanitizedMessage,
        parse_mode: "HTML",
      },
      {
        timeout: 10000, // 10 секунд timeout
      }
    );
    console.log("✓ Telegram notification sent successfully.");
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(`Telegram error (${err.response?.status}):`, err.response?.data || err.message);
    } else {
      console.error("Error sending Telegram notification:", err);
    }
  }
}

/**
 * Отправить сообщение об успешном выводе
 */
export function formatSuccessMessage(
  address: string,
  chainName: string,
  amount: string,
  finalBalance: number
): string {
  const networkIcon = chainName === "OP" ? "🔷" : "🔴";
  const networkName = chainName === "OP" ? "Optimism" : "Arbitrum";

  return `
${networkIcon} УСПЕШНЫЙ ВЫВОД ${networkIcon}

📍 Адрес: \`${address.substring(0, 8)}...${address.substring(address.length - 6)}\`
🌐 Сеть: ${networkName}
💰 Сумма вывода: \`${amount}\` ETH
📊 Текущий баланс: \`${finalBalance.toFixed(6)}\` ETH

✨ Транзакция успешно завершена!
  `.trim();
}


/**
 * Отправить сообщение об ошибке вывода (timeout)
 */
export function formatTimeoutErrorMessage(
  address: string,
  chainName: string,
  amount: string,
  timeoutMin: number
): string {
  const networkIcon = chainName === "OP" ? "🔷" : "🔴";
  const networkName = chainName === "OP" ? "Optimism" : "Arbitrum";

  return `
⏰ ТАЙМАУТ ОЖИДАНИЯ ${networkIcon}

📍 Адрес: \`${address.substring(0, 8)}...${address.substring(address.length - 6)}\`
🌐 Сеть: ${networkName}
💰 Сумма вывода: \`${amount}\` ETH
⚠️ Проблема: Баланс не изменился за ${timeoutMin} минут

Транзакция отправлена, но ожидание затянулось.
  `.trim();
}

/**
 * Отправить сообщение о критической ошибке
 */
export function formatCriticalErrorMessage(address: string, error: string): string {
  // Извлекаем только первую строку ошибки (без полного stack trace)
  const errorLine = error.split("\n")[0].substring(0, 100);

  return `
🚨 КРИТИЧЕСКАЯ ОШИБКА

📍 Адрес: \`${address.substring(0, 8)}...${address.substring(address.length - 6)}\`
❌ Ошибка: \`${errorLine}\`

Требуется внимание!
  `.trim();
}
