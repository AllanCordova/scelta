ALTER TABLE "participants" ALTER COLUMN "join_key_hash" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "short_code" varchar(12);
--> statement-breakpoint
DO $$
DECLARE
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  rec RECORD;
  attempt integer;
  digest bytea;
  candidate text;
  i integer;
  idx integer;
BEGIN
  FOR rec IN SELECT id FROM rooms WHERE short_code IS NULL ORDER BY created_at, id LOOP
    attempt := 0;
    LOOP
      digest := decode(md5(rec.id::text || ':' || attempt::text), 'hex');
      candidate := '';
      FOR i IN 0..5 LOOP
        idx := (get_byte(digest, i) % 32) + 1;
        candidate := candidate || substr(alphabet, idx, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM rooms WHERE short_code = candidate);
      attempt := attempt + 1;
    END LOOP;
    UPDATE rooms SET short_code = candidate WHERE id = rec.id;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "short_code" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rooms_short_code_uidx" ON "rooms" USING btree ("short_code");
