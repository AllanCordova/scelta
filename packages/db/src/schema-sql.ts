/**
 * Idempotent bootstrap for an empty database.
 * Drizzle Kit migrations are not the runtime path yet; the API applies this on startup.
 */
export const SCHEMA_SQL = `
DO $$ BEGIN
  CREATE TYPE quorum_unit AS ENUM ('absolute', 'percent');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE room_status AS ENUM ('draft', 'open', 'voting', 'closed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE rules_preset AS ENUM ('ipb_local_officers', 'ipb_society_board', 'custom');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE round_status AS ENUM ('pending', 'open', 'closed', 'restarted');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'member');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS churches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS churches_name_uidx ON churches (name);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches (id),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx ON users (email);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_uidx ON sessions (token_hash);

CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches (id),
  full_name text NOT NULL,
  is_communicant boolean NOT NULL DEFAULT true,
  is_male boolean,
  birth_date timestamp,
  society_flags jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches (id),
  title text NOT NULL,
  room_type text NOT NULL,
  rules_preset rules_preset NOT NULL DEFAULT 'custom',
  quorum_value integer NOT NULL,
  quorum_unit quorum_unit NOT NULL DEFAULT 'absolute',
  invite_token text NOT NULL,
  status room_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rooms_invite_token_uidx ON rooms (invite_token);

CREATE TABLE IF NOT EXISTS participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms (id),
  member_id uuid REFERENCES members (id),
  display_name text NOT NULL,
  join_key_hash text NOT NULL,
  is_present boolean NOT NULL DEFAULT true,
  joined_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS participants_room_member_uidx ON participants (room_id, member_id);

-- Rooms created before join keys already have the table. Backfill those rows, then enforce the column.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS join_key_hash text;
UPDATE participants SET join_key_hash = id::text WHERE join_key_hash IS NULL;
ALTER TABLE participants ALTER COLUMN join_key_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS participants_room_join_key_uidx ON participants (room_id, join_key_hash);

CREATE TABLE IF NOT EXISTS rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms (id),
  number integer NOT NULL,
  office_label text,
  status round_status NOT NULL DEFAULT 'pending',
  opened_at timestamptz,
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms (id),
  member_id uuid REFERENCES members (id),
  display_name text NOT NULL,
  is_eligible boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS ballots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES rounds (id),
  candidate_id uuid NOT NULL REFERENCES candidates (id),
  ballot_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vote_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES rounds (id),
  participant_id uuid NOT NULL REFERENCES participants (id),
  cast_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vote_receipts_round_participant_uidx
  ON vote_receipts (round_id, participant_id);

CREATE TABLE IF NOT EXISTS reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms (id),
  participant_id uuid NOT NULL REFERENCES participants (id),
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms (id),
  actor_role text NOT NULL,
  action text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
