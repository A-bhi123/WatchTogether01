ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false;

-- Jo accounts pehle se hain (tumhare test accounts) unhe verified maan lo
UPDATE users SET email_verified = true;