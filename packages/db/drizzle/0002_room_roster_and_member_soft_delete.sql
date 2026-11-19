CREATE TABLE "room_roster" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"member_id" uuid,
	"full_name" text NOT NULL,
	"photo_url" text,
	"birth_date" timestamp,
	"is_communicant" boolean DEFAULT true NOT NULL,
	"is_male" boolean,
	"society_flags" jsonb DEFAULT '{}'::jsonb,
	"is_eligible_voter" boolean DEFAULT true NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "birth_date" timestamp;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "roster_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "room_member_codes" ADD COLUMN "roster_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "room_roster" ADD CONSTRAINT "room_roster_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_roster" ADD CONSTRAINT "room_roster_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "room_roster_active_member_uidx" ON "room_roster" USING btree ("room_id","member_id") WHERE removed_at IS NULL AND member_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_roster_entry_id_room_roster_id_fk" FOREIGN KEY ("roster_entry_id") REFERENCES "public"."room_roster"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_member_codes" ADD CONSTRAINT "room_member_codes_roster_entry_id_room_roster_id_fk" FOREIGN KEY ("roster_entry_id") REFERENCES "public"."room_roster"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
UPDATE "candidates" AS c
SET "birth_date" = m."birth_date"
FROM "members" AS m
WHERE c."member_id" = m."id"
  AND c."birth_date" IS NULL
  AND m."birth_date" IS NOT NULL;
--> statement-breakpoint
DO $$
DECLARE
  rec RECORD;
  v_roster_id uuid;
BEGIN
  FOR rec IN
    SELECT DISTINCT ON (c."room_id", c."member_id")
      c."room_id",
      c."member_id",
      COALESCE(m."full_name", c."display_name") AS full_name,
      m."photo_url",
      m."birth_date",
      COALESCE(m."is_communicant", true) AS is_communicant,
      m."is_male",
      COALESCE(m."society_flags", '{}'::jsonb) AS society_flags,
      EXISTS (
        SELECT 1
        FROM "room_member_codes" c2
        WHERE c2."room_id" = c."room_id"
          AND c2."member_id" = c."member_id"
          AND c2."is_simulated" = false
          AND c2."revoked_at" IS NULL
      ) AS has_active,
      (
        SELECT MAX(c2."revoked_at")
        FROM "room_member_codes" c2
        WHERE c2."room_id" = c."room_id"
          AND c2."member_id" = c."member_id"
          AND c2."is_simulated" = false
      ) AS max_revoked_at,
      c."created_at"
    FROM "room_member_codes" c
    LEFT JOIN "members" m ON m."id" = c."member_id"
    WHERE c."is_simulated" = false
      AND c."member_id" IS NOT NULL
    ORDER BY c."room_id", c."member_id", (c."revoked_at" IS NULL) DESC, c."created_at" ASC
  LOOP
    INSERT INTO "room_roster" (
      "room_id",
      "member_id",
      "full_name",
      "photo_url",
      "birth_date",
      "is_communicant",
      "is_male",
      "society_flags",
      "is_eligible_voter",
      "removed_at",
      "created_at"
    )
    VALUES (
      rec."room_id",
      rec."member_id",
      rec.full_name,
      rec.photo_url,
      rec.birth_date,
      rec.is_communicant,
      rec.is_male,
      rec.society_flags,
      true,
      CASE WHEN rec.has_active THEN NULL ELSE rec.max_revoked_at END,
      rec.created_at
    )
    RETURNING "id" INTO v_roster_id;

    UPDATE "room_member_codes"
    SET "roster_entry_id" = v_roster_id
    WHERE "room_id" = rec."room_id"
      AND "member_id" = rec."member_id"
      AND "is_simulated" = false
      AND "roster_entry_id" IS NULL;
  END LOOP;

  FOR rec IN
    SELECT "id", "room_id", "display_name", "revoked_at", "created_at"
    FROM "room_member_codes"
    WHERE "is_simulated" = false
      AND "member_id" IS NULL
      AND "roster_entry_id" IS NULL
    ORDER BY "created_at" ASC, "id" ASC
  LOOP
    INSERT INTO "room_roster" (
      "room_id",
      "member_id",
      "full_name",
      "is_communicant",
      "society_flags",
      "is_eligible_voter",
      "removed_at",
      "created_at"
    )
    VALUES (
      rec."room_id",
      NULL,
      rec."display_name",
      true,
      '{}'::jsonb,
      true,
      rec."revoked_at",
      rec."created_at"
    )
    RETURNING "id" INTO v_roster_id;

    UPDATE "room_member_codes"
    SET "roster_entry_id" = v_roster_id
    WHERE "id" = rec."id";
  END LOOP;

  UPDATE "participants" AS p
  SET "roster_entry_id" = c."roster_entry_id"
  FROM "room_member_codes" AS c
  WHERE p."access_code_id" = c."id"
    AND c."roster_entry_id" IS NOT NULL
    AND p."roster_entry_id" IS NULL;

  FOR rec IN
    SELECT p."id",
           p."room_id",
           p."member_id",
           p."display_name",
           p."joined_at",
           m."full_name" AS m_full_name,
           m."photo_url",
           m."birth_date",
           m."is_communicant",
           m."is_male",
           m."society_flags"
    FROM "participants" p
    LEFT JOIN "members" m ON m."id" = p."member_id"
    WHERE p."access_code_id" IS NULL
      AND p."roster_entry_id" IS NULL
    ORDER BY p."joined_at" ASC, p."id" ASC
  LOOP
    v_roster_id := NULL;
    IF rec."member_id" IS NOT NULL THEN
      SELECT "id" INTO v_roster_id
      FROM "room_roster"
      WHERE "room_id" = rec."room_id"
        AND "member_id" = rec."member_id"
        AND "removed_at" IS NULL
      LIMIT 1;
    END IF;

    IF v_roster_id IS NULL THEN
      INSERT INTO "room_roster" (
        "room_id",
        "member_id",
        "full_name",
        "photo_url",
        "birth_date",
        "is_communicant",
        "is_male",
        "society_flags",
        "is_eligible_voter",
        "created_at"
      )
      VALUES (
        rec."room_id",
        rec."member_id",
        COALESCE(rec.m_full_name, rec."display_name"),
        rec.photo_url,
        rec.birth_date,
        COALESCE(rec.is_communicant, true),
        rec.is_male,
        COALESCE(rec.society_flags, '{}'::jsonb),
        true,
        rec."joined_at"
      )
      RETURNING "id" INTO v_roster_id;
    END IF;

    UPDATE "participants"
    SET "roster_entry_id" = v_roster_id
    WHERE "id" = rec."id";
  END LOOP;
END $$;