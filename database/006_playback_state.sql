-- current_time SQL ka built-in naam hai, isliye column ka naam badal rahe hain
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'watch_sessions' AND column_name = 'current_time'
  ) THEN
    ALTER TABLE watch_sessions RENAME COLUMN "current_time" TO position_seconds;
  END IF;
END $$;

ALTER TABLE watch_sessions ADD COLUMN IF NOT EXISTS position_seconds NUMERIC NOT NULL DEFAULT 0;

-- Jin rooms mein movie pehle se upload hai unki playback row bana do
INSERT INTO watch_sessions (room_id, video_id)
SELECT DISTINCT ON (room_id) room_id, id
FROM videos
ORDER BY room_id, created_at DESC
ON CONFLICT (room_id) DO NOTHING;