-- Chat on/off ka setting room ke saath save hota hai (refresh ke baad bhi yaad rahe)
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS chat_enabled BOOLEAN NOT NULL DEFAULT true;

-- Host ne jise nikala wo dobara join na kar sake
CREATE TABLE IF NOT EXISTS room_bans (
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);