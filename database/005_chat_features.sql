ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE room_members ADD COLUMN IF NOT EXISTS chat_cleared_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS message_hidden (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  hidden_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages (room_id, created_at);