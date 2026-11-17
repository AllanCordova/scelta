DO $$ BEGIN
  CREATE TYPE quorum_unit AS ENUM ('absolute', 'percent');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE room_status AS ENUM ('draft', 'open', 'test', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TYPE room_status ADD VALUE IF NOT EXISTS 'test';
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE rules_preset AS ENUM ('ipb_local_officers', 'ipb_society_board', 'custom');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE round_status AS ENUM ('pending', 'open', 'closed', 'restarted');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'member');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS churches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS churches_name_uidx ON churches (name);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches (id),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  photo_url text,
  role user_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx ON users (email);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_uidx ON sessions (token_hash);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches (id),
  full_name text NOT NULL,
  is_communicant boolean NOT NULL DEFAULT true,
  is_male boolean,
  birth_date timestamp,
  photo_url text,
  society_flags jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE members ADD COLUMN IF NOT EXISTS photo_url text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches (id),
  title text NOT NULL,
  room_type text NOT NULL,
  rules_preset rules_preset NOT NULL DEFAULT 'custom',
  quorum_value integer NOT NULL,
  quorum_unit quorum_unit NOT NULL DEFAULT 'absolute',
  eligible_count integer NOT NULL DEFAULT 0,
  office_banners jsonb NOT NULL DEFAULT '{}'::jsonb,
  invite_token text NOT NULL,
  status room_status NOT NULL DEFAULT 'draft',
  reactions_enabled boolean NOT NULL DEFAULT true,
  chat_muted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS rooms_invite_token_uidx ON rooms (invite_token);
--> statement-breakpoint
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS eligible_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS office_banners jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS reactions_enabled boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS chat_muted boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS room_member_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms (id),
  member_id uuid REFERENCES members (id),
  display_name text NOT NULL,
  code text NOT NULL,
  is_simulated boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS room_member_codes_room_code_uidx
  ON room_member_codes (room_id, code);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS room_member_codes_active_member_uidx
  ON room_member_codes (room_id, member_id)
  WHERE revoked_at IS NULL AND member_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms (id),
  member_id uuid REFERENCES members (id),
  access_code_id uuid REFERENCES room_member_codes (id),
  display_name text NOT NULL,
  join_key_hash text NOT NULL,
  is_present boolean NOT NULL DEFAULT true,
  chat_muted boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE participants ADD COLUMN IF NOT EXISTS access_code_id uuid REFERENCES room_member_codes (id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS participants_room_member_uidx ON participants (room_id, member_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS participants_room_access_code_uidx
  ON participants (room_id, access_code_id)
  WHERE access_code_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE participants ADD COLUMN IF NOT EXISTS join_key_hash text;
--> statement-breakpoint
ALTER TABLE participants ADD COLUMN IF NOT EXISTS chat_muted boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE participants SET join_key_hash = id::text WHERE join_key_hash IS NULL;
--> statement-breakpoint
ALTER TABLE participants ALTER COLUMN join_key_hash SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS participants_room_join_key_uidx ON participants (room_id, join_key_hash);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms (id),
  number integer NOT NULL,
  office_label text,
  status round_status NOT NULL DEFAULT 'pending',
  outcome text,
  declined_candidate_id uuid,
  winner_candidate_id uuid,
  tie_break_reason text,
  did_not_vote_count integer,
  opened_at timestamptz,
  closed_at timestamptz
);
--> statement-breakpoint
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS outcome text;
--> statement-breakpoint
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS declined_candidate_id uuid;
--> statement-breakpoint
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS winner_candidate_id uuid;
--> statement-breakpoint
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS tie_break_reason text;
--> statement-breakpoint
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS did_not_vote_count integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS rounds_room_number_uidx ON rounds (room_id, number);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS rounds_one_open_uidx ON rounds (room_id) WHERE status = 'open';
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_outcome_check;
  ALTER TABLE rounds ADD CONSTRAINT rounds_outcome_check
    CHECK (outcome IS NULL OR outcome IN ('failed_quorum', 'no_majority', 'elected', 'declined', 'annulled'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms (id),
  member_id uuid REFERENCES members (id),
  display_name text NOT NULL,
  photo_url text,
  is_eligible boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS photo_url text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ballots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES rounds (id),
  candidate_id uuid REFERENCES candidates (id)
);
--> statement-breakpoint
ALTER TABLE ballots ALTER COLUMN candidate_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE ballots DROP COLUMN IF EXISTS ballot_token;
--> statement-breakpoint
ALTER TABLE ballots DROP COLUMN IF EXISTS created_at;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS vote_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES rounds (id),
  participant_id uuid NOT NULL REFERENCES participants (id),
  cast_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS vote_receipts_round_participant_uidx
  ON vote_receipts (round_id, participant_id);
--> statement-breakpoint
DROP TABLE IF EXISTS reactions CASCADE;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid REFERENCES churches (id),
  room_id uuid NOT NULL,
  room_title text,
  actor_role text NOT NULL,
  action text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  prev_hash text,
  integrity_hash text NOT NULL DEFAULT 'GENESIS',
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES churches (id);
--> statement-breakpoint
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS room_title text;
--> statement-breakpoint
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS prev_hash text;
--> statement-breakpoint
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS integrity_hash text;
--> statement-breakpoint
UPDATE audit_events SET prev_hash = 'GENESIS' WHERE prev_hash IS NULL;
--> statement-breakpoint
UPDATE audit_events SET integrity_hash = 'GENESIS' WHERE integrity_hash IS NULL;
--> statement-breakpoint
ALTER TABLE audit_events ALTER COLUMN integrity_hash SET NOT NULL;
--> statement-breakpoint
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_room_id_fkey;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_audit_events_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only and immutable';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_events_immutable_trg ON audit_events;
--> statement-breakpoint
CREATE TRIGGER audit_events_immutable_trg
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_events_mutation();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS room_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms (id),
  participant_id uuid REFERENCES participants (id),
  sender_name text NOT NULL,
  sender_role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS room_chat_messages_room_created_idx
  ON room_chat_messages (room_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS room_chat_messages_room_participant_created_idx
  ON room_chat_messages (room_id, participant_id, created_at);
