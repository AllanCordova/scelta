import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const quorumUnitEnum = pgEnum("quorum_unit", ["absolute", "percent"]);
export const roomStatusEnum = pgEnum("room_status", [
  "draft",
  "open",
  "voting",
  "closed",
  "cancelled",
]);
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
    status: roomStatusEnum("status").notNull().default("draft"),
    reactionsEnabled: boolean("reactions_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("rooms_invite_token_uidx").on(table.inviteToken)],
);

export const roomMemberCodes = pgTable(
  "room_member_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    memberId: uuid("member_id").references(() => members.id),
    displayName: text("display_name").notNull(),
    code: text("code").notNull(),
    isSimulated: boolean("is_simulated").notNull().default(false),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("room_member_codes_room_code_uidx").on(table.roomId, table.code)],
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
    displayName: text("display_name").notNull(),
    /** SHA-256 of the client join key. One presence row per room and key. */
    joinKeyHash: text("join_key_hash").notNull(),
    isPresent: boolean("is_present").notNull().default(true),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("participants_room_member_uidx").on(table.roomId, table.memberId),
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
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("rounds_room_number_uidx").on(table.roomId, table.number)],
);

export const candidates = pgTable("candidates", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id),
  memberId: uuid("member_id").references(() => members.id),
  displayName: text("display_name").notNull(),
  photoUrl: text("photo_url"),
  isEligible: boolean("is_eligible").notNull().default(true),
});

/**
 * Anonymous ballot: stores the choice for a round without participant_id.
 * Anonymity invariant: never add a participant foreign key here.
 */
export const ballots = pgTable("ballots", {
  id: uuid("id").defaultRandom().primaryKey(),
  roundId: uuid("round_id")
    .notNull()
    .references(() => rounds.id),
  /** Null represents a blank/null vote. */
  candidateId: uuid("candidate_id").references(() => candidates.id),
  ballotToken: text("ballot_token").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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

export const reactions = pgTable(
  "reactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("reactions_room_participant_created_idx").on(
      table.roomId,
      table.participantId,
      table.createdAt,
    ),
  ],
);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
