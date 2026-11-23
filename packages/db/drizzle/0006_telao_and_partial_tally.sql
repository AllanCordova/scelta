ALTER TABLE "rooms" ADD COLUMN "show_live_candidate_tally" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "result_revealed" boolean DEFAULT false NOT NULL;