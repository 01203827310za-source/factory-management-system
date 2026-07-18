-- Migration: add_partners
-- Add partners table to track is_active / exit_date for حاتم and ميدو

CREATE TABLE IF NOT EXISTS partners (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  exit_date  VARCHAR(10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the two known partners
INSERT INTO partners (name) VALUES ('حاتم'), ('ميدو') ON CONFLICT (name) DO NOTHING;
