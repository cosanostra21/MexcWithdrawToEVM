## 🇬🇧 English 

### MEXC Withdrawal Automation Script

This is a Node.js/TypeScript script designed for **automated and randomized** withdrawal of ETH from the MEXC exchange to a list of target EVM addresses. It utilizes the `ccxt` library for secure interaction with the exchange's API.

---

### Key Features

* **Randomization:** Random selection of the network (**Optimism / Arbitrum**) and withdrawal amount within a configurable range.
* **Balance Safety Check:** Skips wallets whose total balance across both networks (OP + ARB) exceeds a set threshold, preventing "over-funding."
* **Time Control:** Introduces **random delays** between withdrawals to mimic human behavior and reduce suspicion.
* **Monitoring & Validation:** Verifies the successful arrival of funds on the blockchain (using `ethers.js`) with a timeout mechanism and sends notifications via **Telegram**.
* **Dry Run Mode:** A safety feature allowing for thorough testing and logging without executing real withdrawal transactions.

---

### Contact & Channel

For inquiries and updates, please connect with us:

* **Telegram Contact:** **@kildarecoot**
* **Telegram Channel:** **@scriptweb3**

***

## 🇷🇺 Русский

### Скрипт автоматизации вывода с MEXC

Скрипт на Node.js/TypeScript, предназначенный для **автоматизированного и рандомизированного** вывода ETH с биржи MEXC на список целевых EVM-адресов. Использует библиотеку `ccxt` для безопасного взаимодействия с API биржи.

---

### Ключевые особенности

* **Рандомизация:** Случайный выбор сети (**Optimism / Arbitrum**) и суммы вывода в заданном диапазоне.
* **Защита от перезаливания:** Пропуск кошельков, чей суммарный баланс в обеих сетях (OP + ARB) превышает установленный порог, что предотвращает "переполнение" адресов.
* **Контроль времени:** Внедрена **рандомная задержка** между выводами для имитации человеческого поведения и снижения рисков.
* **Мониторинг:** Проверка успешного поступления средств в блокчейн (с использованием `ethers.js`) с механизмом таймаута и отправка уведомлений в **Telegram**.
* **Dry Run Mode:** Защитный режим, позволяющий провести детальное тестирование и логирование без выполнения реальных транзакций вывода.

---

### Контакты и Канал

Для вопросов и обновлений, пожалуйста, свяжитесь с нами:

* **Контакт в Telegram:** **@kildarecoot**
* **Telegram Канал:** **@@scriptweb3**
