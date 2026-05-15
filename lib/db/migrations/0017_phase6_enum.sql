-- ALTER TYPE ADD VALUE cannot run inside a transaction; isolating to its own
-- migration file per the project convention.
ALTER TYPE email_digest_cadence ADD VALUE IF NOT EXISTS 'monthly';
