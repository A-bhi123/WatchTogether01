-- Upload ke waqt dekha gaya codec yaad rakhte hain (aur ye ki convert hua ya nahi)
ALTER TABLE videos ADD COLUMN IF NOT EXISTS video_codec VARCHAR(30);
ALTER TABLE videos ADD COLUMN IF NOT EXISTS audio_codec VARCHAR(30);
ALTER TABLE videos ADD COLUMN IF NOT EXISTS converted BOOLEAN NOT NULL DEFAULT false;