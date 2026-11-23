CREATE TABLE "ballot_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ballot_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "vacancies" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "vacancies" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "winner_candidate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ballot_marks" ADD CONSTRAINT "ballot_marks_ballot_id_ballots_id_fk" FOREIGN KEY ("ballot_id") REFERENCES "public"."ballots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballot_marks" ADD CONSTRAINT "ballot_marks_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ballot_marks_ballot_candidate_uidx" ON "ballot_marks" USING btree ("ballot_id","candidate_id");--> statement-breakpoint
CREATE INDEX "ballot_marks_ballot_idx" ON "ballot_marks" USING btree ("ballot_id");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_vacancies_check" CHECK (vacancies >= 1);--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_vacancies_check" CHECK (vacancies >= 1);--> statement-breakpoint
INSERT INTO "ballot_marks" ("ballot_id", "candidate_id")
SELECT "id", "candidate_id" FROM "ballots"
WHERE "candidate_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "rounds"
SET "winner_candidate_ids" = jsonb_build_array("winner_candidate_id"::text)
WHERE "winner_candidate_id" IS NOT NULL
  AND jsonb_array_length("winner_candidate_ids") = 0;