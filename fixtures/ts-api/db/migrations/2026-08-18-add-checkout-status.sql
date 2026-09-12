ALTER TABLE checkout_sessions
  ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
