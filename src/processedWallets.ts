import fs from "fs";
import path from "path";

// *** КОНФИГУРАЦИЯ ПУТИ К ФАЙЛУ ОБРАБОТАННЫХ АДРЕСОВ ***
const PROCESSED_FILE_PATH = ""; // <-- ВСТАВЬТЕ СЮДА ПУТЬ К ФАЙЛУ ОБРАБОТАННЫХ АДРЕСОВ (например: "data/evmProcessed.txt")
// *******************************************************

/**
 * Получить список уже обработанных адресов
 */
export function getProcessedAddresses(): Set<string> {
  if (PROCESSED_FILE_PATH === "") {
    console.error(`❌ PROCESSED_FILE_PATH не установлен в processedWallets.ts!`);
    return new Set();
  }
  
  const PROCESSED_FILE = path.resolve(PROCESSED_FILE_PATH);

  try {
    if (!fs.existsSync(PROCESSED_FILE)) {
      return new Set();
    }

    // ... (остальная логика функции без изменений)
  } catch (err) {
    console.error(`Error reading processed addresses from ${PROCESSED_FILE_PATH}:`, err);
    return new Set();
  }
}

/**
 * Добавить адрес в список обработанных
 */
export function markAsProcessed(address: string): void {
  if (PROCESSED_FILE_PATH === "") {
    console.error(`❌ PROCESSED_FILE_PATH не установлен в processedWallets.ts!`);
    return;
  }
  
  const PROCESSED_FILE = path.resolve(PROCESSED_FILE_PATH);
  
  try {
    const normalizedAddress = address.toLowerCase();

    // Проверяем, уже ли в файле
    const processed = getProcessedAddresses();
    if (processed.has(normalizedAddress)) {
      return; // Уже добавлен
    }

    // Добавляем новый адрес
    fs.appendFileSync(PROCESSED_FILE, `${address}\n`);
    console.log(`✓ Added ${address} to processed list`);
  } catch (err) {
    console.error(`Error marking address as processed:`, err);
  }
}

/**
 * Проверить, обработан ли адрес
 */
export function isProcessed(address: string): boolean {
  // Вызов getProcessedAddresses() уже включает проверку пути
  const processed = getProcessedAddresses();
  return processed.has(address.toLowerCase());
}

/**
 * Получить количество обработанных адресов
 */
export function getProcessedCount(): number {
  // Вызов getProcessedAddresses() уже включает проверку пути
  return getProcessedAddresses().size;
}

/**
 * Очистить список обработанных адресов (для отладки)
 */
export function clearProcessed(): void {
  if (PROCESSED_FILE_PATH === "") {
    console.error(`❌ PROCESSED_FILE_PATH не установлен в processedWallets.ts!`);
    return;
  }
  
  const PROCESSED_FILE = path.resolve(PROCESSED_FILE_PATH);
  
  try {
    if (fs.existsSync(PROCESSED_FILE)) {
      fs.unlinkSync(PROCESSED_FILE);
      console.log("Processed list cleared");
    }
  } catch (err) {
    console.error(`Error clearing processed list:`, err);
  }
}
