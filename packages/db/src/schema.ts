import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const quorumUnitEnum = pgEnum("quorum_unit", ["absolute", "percent"]);
export const roomStatusEnum = pgEnum("room_status", ["draft", "open", "test", "closed"]);
export const rulesPresetEnum = pgEnum("rules_preset", [
  "ipb_local_officers",
  "ipb_society_board",
  "custom",
]);
export const roundStatusEnum = pgEnum("round_status", [
  "pending",
  "open",
  "closed",
  "restarted",
]);
export const userRoleEnum = pgEnum("user_role", ["admin", "member"]);

export const churches = pgTable(
  "churches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("churches_name_uidx").on(table.name)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    churchId: uuid("church_id")
      .notNull()
      .references(() => churches.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    photoUrl: text("photo_url"),
    role: userRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("users_email_uidx").on(table.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("sessions_token_hash_uidx").on(table.tokenHash)],
);

export const members = pgTable("members", {
  id: uuid("id").defaultRandom().primaryKey(),
  churchId: uuid("church_id")
    .notNull()
    .references(() => churches.id),
  fullName: text("full_name").notNull(),
  isCommunicant: boolean("is_communicant").notNull().default(true),
  isMale: boolean("is_male"),
  birthDate: timestamp("birth_date", { mode: "date" }),
  photoUrl: text("photo_url"),
  societyFlags: jsonb("society_flags").$type<Record<string, unknown>>().default({}),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    churchId: uuid("church_id")
      .notNull()
      .references(() => churches.id),
    title: text("title").notNull(),
    roomType: text("room_type").notNull(),
    rulesPreset: rulesPresetEnum("rules_preset").notNull().default("custom"),
    quorumValue: integer("quorum_value").notNull(),
    quorumUnit: quorumUnitEnum("quorum_unit").notNull().default("absolute"),
    /** Denominator for percent quorum. Zero cannot meet a percent rule. */
    eligibleCount: integer("eligible_count").notNull().default(0),
    officeBanners: jsonb("office_banners").$type<Record<string, string>>().notNull().default({}),
    inviteToken: text("invite_token").notNull(),
    shortCode: varchar("short_code", { length: 12 }).notNull(),
    status: roomStatusEnum("status").notNull().default("draft"),
    reactionsEnabled: boolean("reactions_enabled").notNull().default(true),
    chatMuted: boolean("chat_muted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("rooms_invite_token_uidx").on(table.inviteToken),
    uniqueIndex("rooms_short_code_uidx").on(table.shortCode),
  ],
);

export const roomRoster = pgTable(
  "room_roster",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    fullName: text("full_name").notNull(),
    photoUrl: text("photo_url"),
    birthDate: timestamp("birth_date", { mode: "date" }),
    isCommunicant: boolean("is_communicant").notNull().default(true),
    isMale: boolean("is_male"),
    societyFlags: jsonb("society_flags").$type<Record<string, unknown>>().default({}),
    isEligibleVoter: boolean("is_eligible_voter").notNull().default(true),
    votesOnPaper: boolean("votes_on_paper").notNull().default(false),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("room_roster_active_member_uidx")
      .on(table.roomId, table.memberId)
      .where(sql`removed_at IS NULL AND member_id IS NOT NULL`),
  ],
);

export const roomMemberCodes = pgTable(
  "room_member_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    rosterEntryId: uuid("roster_entry_id").references(() => roomRoster.id, { onDelete: "set null" }),
    memberId: uuid("member_id").references(() => members.id),
    displayName: text("display_name").notNull(),
    code: text("code").notNull(),
    isSimulated: boolean("is_simulated").notNull().default(false),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("room_member_codes_room_code_uidx").on(table.roomId, table.code),
    uniqueIndex("room_member_codes_active_member_uidx")
      .on(table.roomId, table.memberId)
      .where(sql`revoked_at IS NULL AND member_id IS NOT NULL`),
  ],
);

export const participants = pgTable(
  "participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    memberId: uuid("member_id").references(() => members.id),
    accessCodeId: uuid("access_code_id").references(() => roomMemberCodes.id),
    rosterEntryId: uuid("roster_entry_id").references(() => roomRoster.id, { onDelete: "set null" }),
    displayName: text("display_name").notNull(),
    /** SHA-256 of the client join key, or null when released by an admin. */
    joinKeyHash: text("join_key_hash"),
    isPresent: boolean("is_present").notNull().default(true),
    chatMuted: boolean("chat_muted").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("participants_room_member_uidx").on(table.roomId, table.memberId),
    uniqueIndex("participants_room_access_code_uidx")
      .on(table.roomId, table.accessCodeId)
      .where(sql`access_code_id IS NOT NULL`),
    uniqueIndex("participants_room_join_key_uidx").on(table.roomId, table.joinKeyHash),
  ],
);

export const rounds = pgTable(
  "rounds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    number: integer("number").notNull(),
    officeLabel: text("office_label"),
    status: roundStatusEnum("status").notNull().default("pending"),
    /** null while open or waiting for the tally; otherwise a round result. */
    outcome: text("outcome"),
    declinedCandidateId: uuid("declined_candidate_id"),
    winnerCandidateId: uuid("winner_candidate_id"),
    tieBreakReason: text("tie_break_reason"),
    didNotVoteCount: integer("did_not_vote_count"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("rounds_room_number_uidx").on(table.roomId, table.number),
    uniqueIndex("rounds_one_open_uidx")
      .on(table.roomId)
      .where(sql`status = 'open'`),
    check(
      "rounds_outcome_check",
      sql`outcome IS NULL OR outcome IN ('failed_quorum', 'no_majority', 'elected', 'declined', 'annulled')`,
    ),
  ],
);

export const candidates = pgTable("candidates", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id),
  memberId: uuid("member_id").references(() => members.id),
  displayName: text("display_name").notNull(),
  photoUrl: text("photo_url"),
  birthDate: timestamp("birth_date", { mode: "date" }),
  isEligible: boolean("is_eligible").notNull().default(true),
});

/**
 * Anonymous ballot: stores the choice for a round without participant_id or timestamp.
 * Anonymity invariant: never add a participant foreign key, token, or cast timestamp here.
 */
export const ballots = pgTable("ballots", {
  id: uuid("id").defaultRandom().primaryKey(),
  roundId: uuid("round_id")
    .notNull()
    .references(() => rounds.id),
  /** Null represents a blank/null vote. */
  candidateId: uuid("candidate_id").references(() => candidates.id),
});

/** Proves a participant voted in a round without revealing the choice. */
export const voteReceipts = pgTable(
  "vote_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    castAt: timestamp("cast_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("vote_receipts_round_participant_uidx").on(
      table.roundId,
      table.participantId,
    ),
  ],
);

export const roundPaperTallies = pgTable(
  "round_paper_tallies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    ballotCount: integer("ballot_count").notNull().default(0),
    blankVotes: integer("blank_votes").notNull().default(0),
    nullVotes: integer("null_votes").notNull().default(0),
    candidateVotes: jsonb("candidate_votes").$type<Record<string, number>>().notNull().default({}),
    recordedByAdminId: uuid("recorded_by_admin_id").references(() => users.id, {
      onDelete: "set null",
    }),
    recordedByName: text("recorded_by_name"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("round_paper_tallies_round_uidx").on(table.roundId)],
);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  churchId: uuid("church_id").references(() => churches.id),
  roomId: uuid("room_id").notNull(),
  roomTitle: text("room_title"),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  prevHash: text("prev_hash"),
  integrityHash: text("integrity_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const roomChatMessages = pgTable(
  "room_chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    participantId: uuid("participant_id").references(() => participants.id),
    senderName: text("sender_name").notNull(),
    senderRole: text("sender_role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("room_chat_messages_room_created_idx").on(table.roomId, table.createdAt),
    index("room_chat_messages_room_participant_created_idx").on(
      table.roomId,
      table.participantId,
      table.createdAt,
    ),
  ],
);
