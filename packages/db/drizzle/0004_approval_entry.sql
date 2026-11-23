CREATE TYPE "public"."entry_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."room_entry_mode" AS ENUM('codigo', 'aprovacao');--> statement-breakpoint
CREATE TABLE "room_entry_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"roster_entry_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"join_key_hash" text NOT NULL,
	"status" "entry_request_status" DEFAULT 'pending' NOT NULL,
	"disputed_attempt_count" integer DEFAULT 0 NOT NULL,
	"last_disputed_at" timestamp with time zone,
	"decided_by_admin_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "entry_mode" "room_entry_mode" DEFAULT 'codigo' NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "entry_open" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "max_participants" integer;--> statement-breakpoint
ALTER TABLE "room_entry_requests" ADD CONSTRAINT "room_entry_requests_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_entry_requests" ADD CONSTRAINT "room_entry_requests_roster_entry_id_room_roster_id_fk" FOREIGN KEY ("roster_entry_id") REFERENCES "public"."room_roster"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_entry_requests" ADD CONSTRAINT "room_entry_requests_decided_by_admin_id_users_id_fk" FOREIGN KEY ("decided_by_admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "room_entry_requests_pending_roster_uidx" ON "room_entry_requests" USING btree ("room_id","roster_entry_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "room_entry_requests_room_status_idx" ON "room_entry_requests" USING btree ("room_id","status");--> statement-breakpoint
CREATE INDEX "room_entry_requests_room_join_key_idx" ON "room_entry_requests" USING btree ("room_id","join_key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_room_roster_entry_uidx" ON "participants" USING btree ("room_id","roster_entry_id") WHERE roster_entry_id IS NOT NULL;