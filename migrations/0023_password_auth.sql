-- Email and password accounts.
--
-- Passwords are stored only as salted PBKDF2 hashes (password_hash). People
-- who first signed in with an email code have no password yet; they can set
-- one through the forgot-password flow, which proves they own the inbox.
-- Reset tokens are stored hashed, expire in one hour and work once.

ALTER TABLE users ADD COLUMN password_hash TEXT;

CREATE TABLE IF NOT EXISTS auth_password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_password_resets_user ON auth_password_resets(user_id, expires_at);
