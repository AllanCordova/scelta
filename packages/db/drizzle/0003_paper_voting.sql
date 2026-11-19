CREATE TABLE "round_paper_tallies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"ballot_count" integer DEFAULT 0 NOT NULL,
	"blank_votes" integer DEFAULT 0 NOT NULL,
	"null_votes" integer DEFAULT 0 NOT NULL,
	"candidate_votes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recorded_by_admin_id" uuid,
	"recorded_by_name" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "room_roster" ADD COLUMN "votes_on_paper" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "round_paper_tallies" ADD CONSTRAINT "round_paper_tallies_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_paper_tallies" ADD CONSTRAINT "round_paper_tallies_recorded_by_admin_id_users_id_fk" FOREIGN KEY ("recorded_by_admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "round_paper_tallies_round_uidx" ON "round_paper_tallies" USING btree ("round_id");