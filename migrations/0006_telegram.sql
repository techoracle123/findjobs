-- Telegram account linking.
--
-- A person links their account by following a deep link that carries a
-- signed token. The bot echoes it back in a /start message, and the chat id
-- is then bound to the account.

ALTER TABLE users ADD COLUMN telegram_chat_id TEXT;
ALTER TABLE users ADD COLUMN telegram_linked_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_chat ON users (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;
