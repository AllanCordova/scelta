import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ballots,
  candidates,
  churches,
  createPgliteDatabase,
  members,
  MIGRATIONS_FOLDER,
  participants,
  roomMemberCodes,
  roomRoster,
  rooms,
  rounds,
  voteReceipts,
  type Db,
} from "@scelta/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { clearAuditEvents } from "../testing/database.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const adminEmail = "ada-roster@feature.test";
const adminPassword = "feature-admin-password";

describe("Etapa 2: room roster, immutability, and candidate management", () => {
  let db: Db;
  let repository: RoomRepository;
  let userRepository: UserRepository;
  let closeDatabase: () => Promise<void>;
  let adminCookie: string;

  beforeAll(async () => {
    const database = await createPgliteDatabase();
    db = database.db;
    closeDatabase = database.close;
    repository = createDrizzleRoomRepository(db, "Roster feature church");
    userRepository = createDrizzleUserRepository(db, "Roster feature church");
    await userRepository.insertUser({
      name: "Ada",
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      role: "admin",
    });

    const app = await buildApp({ roomRepository: repository, userRepository });
    adminCookie = await loginCookie(app, adminEmail, adminPassword);
    await app.close();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    resetAuthAttempts();
    await clearAuditEvents(db);
    await db.delete(ballots);
    await db.delete(voteReceipts);
    await db.delete(rounds);
    await db.delete(candidates);
    await db.delete(participants);
    await db.delete(roomMemberCodes);
    await db.delete(roomRoster);
    await db.delete(members);
    await db.delete(rooms);
  });

  it("T2.1: migration 0002 backfills candidates.birth_date, room_roster, codes, and participants on legacy data", async () => {
    const legacy = await createPgliteDatabase();

    try {
      for (const stmt of [
        `ALTER TABLE "room_member_codes" DROP COLUMN IF EXISTS "roster_entry_id"`,
        `ALTER TABLE "participants" DROP COLUMN IF EXISTS "roster_entry_id"`,
        `ALTER TABLE "candidates" DROP COLUMN IF EXISTS "birth_date"`,
        `ALTER TABLE "members" DROP COLUMN IF EXISTS "deleted_at"`,
        `DROP TABLE IF EXISTS "room_entry_requests"`,
        `DROP TABLE IF EXISTS "room_roster"`,
      ]) {
        await legacy.db.execute(sql.raw(stmt));
      }

      const churchId = "10000000-0000-4000-8000-000000000001";
      const memberId = "20000000-0000-4000-8000-000000000001";
      const legacyMemberId = "20000000-0000-4000-8000-000000000002";
      const roomId = "30000000-0000-4000-8000-000000000001";
      const candidateId = "40000000-0000-4000-8000-000000000001";
      const codeId = "50000000-0000-4000-8000-000000000001";
      const adhocCodeId = "50000000-0000-4000-8000-000000000002";
      const participantWithCodeId = "60000000-0000-4000-8000-000000000001";
      const legacyParticipantId = "60000000-0000-4000-8000-000000000002";

      for (const stmt of [
        `INSERT INTO churches (id, name) VALUES ('${churchId}', 'Legacy Church')`,
        `INSERT INTO members (id, church_id, full_name, is_communicant, is_male, birth_date, photo_url)
         VALUES
           ('${memberId}', '${churchId}', 'Paulo Legado', true, true, '1980-05-15T00:00:00.000Z', 'https://example.com/paulo.png'),
           ('${legacyMemberId}', '${churchId}', 'Silas Legado', true, true, '1975-02-20T00:00:00.000Z', null)`,
        `INSERT INTO rooms (id, church_id, title, room_type, rules_preset, quorum_value, quorum_unit, eligible_count, invite_token, short_code, status)
         VALUES ('${roomId}', '${churchId}', 'Sala Legada', 'elder', 'ipb_local_officers', 34, 'percent', 2, 'legacy-token-123', 'LEG123', 'open')`,
        `INSERT INTO candidates (id, room_id, member_id, display_name, photo_url)
         VALUES ('${candidateId}', '${roomId}', '${memberId}', 'Paulo Legado', 'https://example.com/paulo.png')`,
        `INSERT INTO room_member_codes (id, room_id, member_id, display_name, code, is_simulated)
         VALUES
           ('${codeId}', '${roomId}', '${memberId}', 'Paulo Legado', 'ABC123', false),
           ('${adhocCodeId}', '${roomId}', null, 'Visitante Legado', 'XYZ789', false)`,
        `INSERT INTO participants (id, room_id, member_id, access_code_id, display_name, join_key_hash)
         VALUES
           ('${participantWithCodeId}', '${roomId}', '${memberId}', '${codeId}', 'Paulo Legado', 'hash-paulo'),
           ('${legacyParticipantId}', '${roomId}', '${legacyMemberId}', null, 'Silas Legado', 'hash-silas')`,
      ]) {
        await legacy.db.execute(sql.raw(stmt));
      }

      const sql0002 = await readFile(
        join(MIGRATIONS_FOLDER, "0002_room_roster_and_member_soft_delete.sql"),
        "utf8",
      );
      for (const stmt of splitBreakpoints(sql0002)) {
        await legacy.db.execute(sql.raw(stmt));
      }

      const [migratedCandidate] = await legacy.db
        .select()
        .from(candidates)
        .where(eq(candidates.id, candidateId));
      expect(migratedCandidate?.birthDate?.toISOString().slice(0, 10)).toBe("1980-05-15");

      const rosterRows = await legacy.db
        .select({
          id: roomRoster.id,
          roomId: roomRoster.roomId,
          memberId: roomRoster.memberId,
          fullName: roomRoster.fullName,
        })
        .from(roomRoster)
        .where(eq(roomRoster.roomId, roomId));
      expect(rosterRows).toHaveLength(3);

      const [migratedCode] = await legacy.db
        .select()
        .from(roomMemberCodes)
        .where(eq(roomMemberCodes.id, codeId));
      const [migratedAdhocCode] = await legacy.db
        .select()
        .from(roomMemberCodes)
        .where(eq(roomMemberCodes.id, adhocCodeId));
      expect(migratedCode?.rosterEntryId).toBeTruthy();
      expect(migratedAdhocCode?.rosterEntryId).toBeTruthy();

      const [p1] = await legacy.db
        .select()
        .from(participants)
        .where(eq(participants.id, participantWithCodeId));
      const [p2] = await legacy.db
        .select()
        .from(participants)
        .where(eq(participants.id, legacyParticipantId));
      expect(p1?.rosterEntryId).toBe(migratedCode?.rosterEntryId);
      expect(p2?.rosterEntryId).toBeTruthy();
      expect(
        rosterRows.some((r) => r.id === p2?.rosterEntryId && r.memberId === legacyMemberId),
      ).toBe(true);

      const [legacyChurch] = await legacy.db
        .select()
        .from(churches)
        .where(eq(churches.id, churchId));
      expect(legacyChurch?.name).toBe("Legacy Church");
    } finally {
      await legacy.close();
    }
  });

  it("T2.1: snapshots eligible members into room_roster on createRoom and uses roster count for percent quorum", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    for (const name of ["Ana", "Bia", "Caio", "Davi"]) {
      await repository.createMember({
        fullName: name,
        isCommunicant: true,
        isMale: true,
        birthDate: "1990-01-01",
      });
    }
    await repository.createMember({
      fullName: "Não Comungante",
      isCommunicant: false,
      isMale: false,
      birthDate: "2010-01-01",
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Eleição com Rol Próprio",
        roomType: "elder",
        rulesPreset: "ipb_society_board",
        quorumValue: 50,
        quorumUnit: "percent",
        status: "open",
        candidates: ["Ana", "Caio"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as { id: string; inviteToken: string; eligibleCount: number };
    expect(room.eligibleCount).toBe(4);

    const rosterRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/roster`,
      headers: { cookie: adminCookie },
    });
    expect(rosterRes.statusCode).toBe(200);
    expect(rosterRes.json().eligibleCount).toBe(4);
    expect(rosterRes.json().entries).toHaveLength(4);

    const codesRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/generate`,
      headers: { cookie: adminCookie },
    });
    expect(codesRes.statusCode).toBe(200);
    const codes = codesRes.json().accessCodes as Array<{ code: string; displayName: string }>;
    expect(codes).toHaveLength(4);

    // 2 out of 4 = 50% -> meets 50% quorum
    const j1 = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: codes[0]!.code, joinKey: "roster-voter-key-0001" },
    });
    expect(j1.statusCode).toBe(200);
    const j2 = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: codes[1]!.code, joinKey: "roster-voter-key-0002" },
    });
    expect(j2.statusCode).toBe(200);

    const openRound = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(openRound.statusCode).toBe(201);

    await app.close();
  });

  it("T2.2: adds directory & ad-hoc roster entries, removes an entry revoking code & presence while keeping already-cast vote", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const alice = await repository.createMember({
      fullName: "Alice Membro",
      isCommunicant: true,
      isMale: false,
      birthDate: "1991-03-10",
    });
    const bob = await repository.createMember({
      fullName: "Bob Diretor",
      isCommunicant: true,
      isMale: true,
      birthDate: "1985-07-22",
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Sala Rol Dinâmico",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Bob Diretor", "Outro Candidato"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as {
      id: string;
      inviteToken: string;
      candidates: Array<{ id: string; displayName: string }>;
    };
    const bobCandidate = room.candidates.find((c) => c.displayName === "Bob Diretor")!;

    // Duplicate directory add fails with 409 roster_member_exists
    const duplicateAdd = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/roster`,
      headers: { cookie: adminCookie },
      payload: { memberId: alice.id },
    });
    expect(duplicateAdd.statusCode).toBe(409);
    expect(duplicateAdd.json()).toMatchObject({ error: "roster_member_exists" });

    // Create a 3rd global member after room creation and add to roster
    const carlos = await repository.createMember({
      fullName: "Carlos Novo",
      isCommunicant: true,
      isMale: true,
      birthDate: "1993-11-05",
    });
    const addCarlos = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/roster`,
      headers: { cookie: adminCookie },
      payload: { memberId: carlos.id },
    });
    expect(addCarlos.statusCode).toBe(201);
    expect(addCarlos.json().eligibleCount).toBe(3);
    expect(addCarlos.json().accessCode.code).toBeTruthy();

    // Add ad-hoc voter
    const addAdhoc = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/roster`,
      headers: { cookie: adminCookie },
      payload: { fullName: "Visitante Avulso", birthDate: "1988-09-01" },
    });
    expect(addAdhoc.statusCode).toBe(201);
    expect(addAdhoc.json().eligibleCount).toBe(4);
    const adhocEntryId = addAdhoc.json().entry.id as string;
    const adhocCode = addAdhoc.json().accessCode.code as string;
    expect(addAdhoc.json().entry.memberId).toBeNull();

    // Ad-hoc voter joins and casts ballot for Bob
    const joinAdhoc = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: adhocCode, joinKey: "adhoc-voter-key-1" },
    });
    expect(joinAdhoc.statusCode).toBe(200);

    const openRound = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(openRound.statusCode).toBe(201);
    const roundId = openRound.json().round.id as string;

    const castBallot = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: "adhoc-voter-key-1", candidateId: bobCandidate.id },
    });
    expect(castBallot.statusCode).toBe(201);

    // Also join Bob so quorum remains met after removing ad-hoc voter
    const carlosCode = addCarlos.json().accessCode.code as string;
    const joinCarlos = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: carlosCode, joinKey: "carlos-voter-key-1" },
    });
    expect(joinCarlos.statusCode).toBe(200);

    // Remove ad-hoc voter from open room
    const removeRes = await app.inject({
      method: "DELETE",
      url: `/v1/admin/rooms/${room.id}/roster/${adhocEntryId}`,
      headers: { cookie: adminCookie },
    });
    expect(removeRes.statusCode).toBe(200);
    expect(removeRes.json()).toMatchObject({
      removed: true,
      eligibleCount: 3,
      presence: { presentCount: 1, eligibleCount: 3 },
    });

    // Old code is revoked and cannot rejoin
    const rejoinOldCode = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: adhocCode, joinKey: "adhoc-voter-key-2" },
    });
    expect(rejoinOldCode.statusCode).toBe(403);
    expect(rejoinOldCode.json()).toMatchObject({ error: "invalid_access_code" });

    // Carlos votes for Bob too, and close round: ad-hoc voter's already-cast vote is preserved in tally (2 votes)!
    const castCarlos = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: "carlos-voter-key-1", candidateId: bobCandidate.id },
    });
    expect(castCarlos.statusCode).toBe(201);

    const closeRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/close`,
      headers: { cookie: adminCookie },
    });
    expect(closeRes.statusCode).toBe(200);
    expect(closeRes.json().round.tally).toMatchObject({
      totalVotes: 2,
      winnerId: bobCandidate.id,
      outcome: "elected",
    });

    // Audit chain has roster_member_added & roster_member_removed and stays valid
    const auditRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit`,
      headers: { cookie: adminCookie },
    });
    expect(auditRes.statusCode).toBe(200);
    expect(auditRes.json().chainValid).toBe(true);
    const actions = (auditRes.json().events as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain("roster_member_added");
    expect(actions).toContain("roster_member_removed");

    // Closing the room blocks further roster add/remove with 409 room_closed
    await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { status: "closed" },
    });
    const addClosed = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/roster`,
      headers: { cookie: adminCookie },
      payload: { fullName: "Bloqueado" },
    });
    expect(addClosed.statusCode).toBe(409);
    expect(addClosed.json()).toMatchObject({ error: "room_closed" });

    const rosterBefore = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/roster`,
      headers: { cookie: adminCookie },
    });
    const bobEntryId = (rosterBefore.json().entries as Array<{ id: string; memberId: string | null }>).find(
      (e) => e.memberId === bob.id,
    )!.id;
    const removeClosed = await app.inject({
      method: "DELETE",
      url: `/v1/admin/rooms/${room.id}/roster/${bobEntryId}`,
      headers: { cookie: adminCookie },
    });
    expect(removeClosed.statusCode).toBe(409);
    expect(removeClosed.json()).toMatchObject({ error: "room_closed" });

    await app.close();
  });

  it("T2.3: directory edits propagate only to untouched open rooms; soft-delete revokes open rooms without altering closed or started rooms", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const lucas = await repository.createMember({
      fullName: "Lucas Tiebreak",
      isCommunicant: true,
      isMale: true,
      birthDate: "2011-06-15",
      photoUrl: "https://example.com/lucas-v1.png",
      societyFlags: { upaActive: true, upaEnrolledAt: "2024-01-01" },
    });
    const mateus = await repository.createMember({
      fullName: "Mateus Tiebreak",
      isCommunicant: true,
      isMale: true,
      birthDate: "2009-01-10",
      photoUrl: "https://example.com/mateus-v1.png",
      societyFlags: { upaActive: true, upaEnrolledAt: "2024-01-01" },
    });

    // 1. Untouched draft room (0 rounds)
    const untouchedRes = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Sala Intacta",
        roomType: "upa_board",
        rulesPreset: "ipb_society_board",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "draft",
        candidates: ["Lucas Tiebreak", "Mateus Tiebreak"],
      },
    });
    expect(untouchedRes.statusCode).toBe(201);
    const untouchedRoomId = untouchedRes.json().room.id as string;

    // 2. Started room (has 1 round opened & closed in a tie, ready for 3rd-round age tiebreak)
    const startedRes = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Sala Com Escrutínio",
        roomType: "upa_board",
        rulesPreset: "ipb_society_board",
        quorumValue: 2,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Lucas Tiebreak", "Mateus Tiebreak"],
      },
    });
    expect(startedRes.statusCode).toBe(201);
    const startedRoom = startedRes.json().room as {
      id: string;
      inviteToken: string;
      candidates: Array<{ id: string; displayName: string }>;
    };
    const startedLucas = startedRoom.candidates.find((c) => c.displayName === "Lucas Tiebreak")!;
    const startedMateus = startedRoom.candidates.find((c) => c.displayName === "Mateus Tiebreak")!;

    const startedCodesRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${startedRoom.id}/access-codes/generate`,
      headers: { cookie: adminCookie },
    });
    const startedCodes = startedCodesRes.json().accessCodes as Array<{
      memberId: string;
      code: string;
    }>;
    const lucasStartedCode = startedCodes.find((c) => c.memberId === lucas.id)!.code;
    const mateusStartedCode = startedCodes.find((c) => c.memberId === mateus.id)!.code;
    await app.inject({
      method: "POST",
      url: `/v1/join/${startedRoom.inviteToken}`,
      payload: { code: lucasStartedCode, joinKey: "started-lucas-key" },
    });
    await app.inject({
      method: "POST",
      url: `/v1/join/${startedRoom.inviteToken}`,
      payload: { code: mateusStartedCode, joinKey: "started-mateus-key" },
    });

    // Run rounds 1 and 2 tied 1-1
    for (let i = 0; i < 2; i += 1) {
      const r = await app.inject({
        method: "POST",
        url: `/v1/admin/rooms/${startedRoom.id}/rounds`,
        headers: { cookie: adminCookie },
      });
      const rId = r.json().round.id as string;
      await app.inject({
        method: "POST",
        url: `/v1/join/${startedRoom.inviteToken}/ballot`,
        payload: { joinKey: "started-lucas-key", candidateId: startedLucas.id },
      });
      await app.inject({
        method: "POST",
        url: `/v1/join/${startedRoom.inviteToken}/ballot`,
        payload: { joinKey: "started-mateus-key", candidateId: startedMateus.id },
      });
      await app.inject({
        method: "POST",
        url: `/v1/admin/rooms/${startedRoom.id}/rounds/${rId}/close`,
        headers: { cookie: adminCookie },
      });
    }

    // 3. Closed room
    const closedRes = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Sala Encerrada",
        roomType: "upa_board",
        rulesPreset: "ipb_society_board",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Lucas Tiebreak", "Mateus Tiebreak"],
      },
    });
    const closedRoomId = closedRes.json().room.id as string;
    await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${closedRoomId}/access-codes/generate`,
      headers: { cookie: adminCookie },
    });
    await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${closedRoomId}`,
      headers: { cookie: adminCookie },
      payload: { status: "closed" },
    });

    // Edit Lucas in global directory: change name, photo, and make birthDate OLDER (1980-01-01) than Mateus (2009-01-10)
    const patchLucas = await app.inject({
      method: "PATCH",
      url: `/v1/admin/members/${lucas.id}`,
      headers: { cookie: adminCookie },
      payload: {
        fullName: "Lucas Editado",
        isCommunicant: true,
        isMale: true,
        birthDate: "1980-01-01",
        photoUrl: "https://example.com/lucas-v2.png",
        societyFlags: { upaActive: true, upaEnrolledAt: "2024-01-01" },
      },
    });
    expect(patchLucas.statusCode).toBe(200);

    // Untouched room received the update
    const untouchedDetail = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${untouchedRoomId}`,
      headers: { cookie: adminCookie },
    });
    const untouchedCandidateNames = (
      untouchedDetail.json().room.candidates as Array<{ displayName: string; photoUrl: string | null }>
    ).map((c) => c.displayName);
    expect(untouchedCandidateNames).toContain("Lucas Editado");
    const untouchedRoster = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${untouchedRoomId}/roster`,
      headers: { cookie: adminCookie },
    });
    expect(
      (untouchedRoster.json().entries as Array<{ fullName: string; birthDate: string | null }>).find(
        (e) => e.fullName === "Lucas Editado",
      )?.birthDate,
    ).toBe("1980-01-01");

    // Closed room was NOT altered
    const closedDetail = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${closedRoomId}`,
      headers: { cookie: adminCookie },
    });
    const closedLucas = (
      closedDetail.json().room.candidates as Array<{ displayName: string; photoUrl: string | null }>
    ).find((c) => c.displayName === "Lucas Tiebreak");
    expect(closedLucas).toBeDefined();
    expect(closedLucas?.photoUrl).toBe("https://example.com/lucas-v1.png");

    // Started room kept original birthDate (2011-06-15), so in 3rd-round tie Mateus (2009-01-10) STILL wins by age!
    const round3 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${startedRoom.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    const round3Id = round3.json().round.id as string;
    await app.inject({
      method: "POST",
      url: `/v1/join/${startedRoom.inviteToken}/ballot`,
      payload: { joinKey: "started-lucas-key", candidateId: startedLucas.id },
    });
    await app.inject({
      method: "POST",
      url: `/v1/join/${startedRoom.inviteToken}/ballot`,
      payload: { joinKey: "started-mateus-key", candidateId: startedMateus.id },
    });
    const close3 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${startedRoom.id}/rounds/${round3Id}/close`,
      headers: { cookie: adminCookie },
    });
    expect(close3.statusCode).toBe(200);
    expect(close3.json().round.tally).toMatchObject({
      outcome: "elected",
      winnerId: startedMateus.id,
      tieBreakReason: "age",
    });

    // Delete Lucas from global directory -> soft delete + revokes open rooms, does NOT touch closed room
    const deleteLucas = await app.inject({
      method: "DELETE",
      url: `/v1/admin/members/${lucas.id}`,
      headers: { cookie: adminCookie },
    });
    expect(deleteLucas.statusCode).toBe(200);

    // Not listed in active members, but row still exists with deletedAt set
    const listMembersRes = await app.inject({
      method: "GET",
      url: "/v1/admin/members",
      headers: { cookie: adminCookie },
    });
    expect((listMembersRes.json().members as Array<{ id: string }>).some((m) => m.id === lucas.id)).toBe(
      false,
    );
    const [dbLucas] = await db.select().from(members).where(eq(members.id, lucas.id));
    expect(dbLucas?.deletedAt).toBeTruthy();

    // Open room revoked Lucas's code and removed him from roster
    const startedRosterAfterDelete = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${startedRoom.id}/roster`,
      headers: { cookie: adminCookie },
    });
    expect(
      (startedRosterAfterDelete.json().entries as Array<{ memberId: string | null }>).some(
        (e) => e.memberId === lucas.id,
      ),
    ).toBe(false);
    const rejoinDeleted = await app.inject({
      method: "POST",
      url: `/v1/join/${startedRoom.inviteToken}`,
      payload: { code: lucasStartedCode, joinKey: "new-key-after-delete" },
    });
    expect(rejoinDeleted.statusCode).toBe(403);
    expect(rejoinDeleted.json()).toMatchObject({ error: "invalid_access_code" });

    // Closed room still has Lucas in its roster & active codes untouched
    const closedRosterAfterDelete = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${closedRoomId}/roster`,
      headers: { cookie: adminCookie },
    });
    const closedLucasEntry = (
      closedRosterAfterDelete.json().entries as Array<{
        memberId: string | null;
        accessCode: { revokedAt: string | null } | null;
      }>
    ).find((e) => e.memberId === lucas.id);
    expect(closedLucasEntry).toBeDefined();
    expect(closedLucasEntry?.accessCode?.revokedAt).toBeNull();

    await app.close();
  });

  it("T2.4: manages candidates before 1st scrutiny and blocks changes once scrutiny opens (respecting office scope)", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const voter = await repository.createMember({
      fullName: "Eleitor Padrão",
      isCommunicant: true,
      isMale: true,
      birthDate: "1990-01-01",
      societyFlags: { upaActive: true, upaEnrolledAt: "2024-01-01" },
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Gestão de Candidatos UPA",
        roomType: "upa_board",
        rulesPreset: "ipb_society_board",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Candidato Inicial"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as { id: string; inviteToken: string };

    const detailBefore = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detailBefore.json().room.hasRounds).toBe(false);
    expect(detailBefore.json().room.lockedOffices).toEqual([]);

    // Add candidate before 1st scrutiny
    const added = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/candidates`,
      headers: { cookie: adminCookie },
      payload: { displayName: "Candidato Novo", birthDate: "2000-02-02" },
    });
    expect(added.statusCode).toBe(201);
    const addedId = added.json().candidate.id as string;
    expect(added.json().candidates).toHaveLength(2);

    // Remove candidate before 1st scrutiny
    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/admin/rooms/${room.id}/candidates/${addedId}`,
      headers: { cookie: adminCookie },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().candidates).toHaveLength(1);

    // Add again so we have 2 candidates, then join voter and open 1st scrutiny for Presidente
    const addedAgain = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/candidates`,
      headers: { cookie: adminCookie },
      payload: { displayName: "Candidato Segundo" },
    });
    expect(addedAgain.statusCode).toBe(201);
    const secondId = addedAgain.json().candidate.id as string;

    const codesRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/generate`,
      headers: { cookie: adminCookie },
    });
    const voterCode = (
      codesRes.json().accessCodes as Array<{ memberId: string; code: string }>
    ).find((c) => c.memberId === voter.id)!.code;
    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: voterCode, joinKey: "cand-voter-key-0001" },
    });
    expect(joinRes.statusCode).toBe(200);

    const openPres = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
      payload: { officeLabel: "Presidente" },
    });
    expect(openPres.statusCode).toBe(201);

    const detailAfter = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detailAfter.json().room.hasRounds).toBe(true);
    expect(detailAfter.json().room.lockedOffices).toEqual(["Presidente"]);

    // Adding/removing for locked room/office fails with 409 candidates_locked_after_round
    const blockedAdd = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/candidates`,
      headers: { cookie: adminCookie },
      payload: { displayName: "Tardio", officeLabel: "Presidente" },
    });
    expect(blockedAdd.statusCode).toBe(409);
    expect(blockedAdd.json()).toMatchObject({ error: "candidates_locked_after_round" });

    const blockedRemove = await app.inject({
      method: "DELETE",
      url: `/v1/admin/rooms/${room.id}/candidates/${secondId}?officeLabel=Presidente`,
      headers: { cookie: adminCookie },
    });
    expect(blockedRemove.statusCode).toBe(409);
    expect(blockedRemove.json()).toMatchObject({ error: "candidates_locked_after_round" });

    // Unscoped add/remove also blocked once room has rounds
    const blockedUnscoped = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/candidates`,
      headers: { cookie: adminCookie },
      payload: { displayName: "Sem Cargo" },
    });
    expect(blockedUnscoped.statusCode).toBe(409);

    // Next office ("Vice-Presidente") has 0 rounds so far and can still add a candidate!
    const addVice = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/candidates`,
      headers: { cookie: adminCookie },
      payload: { displayName: "Candidato Vice", officeLabel: "Vice-Presidente" },
    });
    expect(addVice.statusCode).toBe(201);

    await app.close();
  });
});

function splitBreakpoints(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}

async function loginCookie(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
  password: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  const setCookie = response.headers["set-cookie"];
  const header = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
  const match = /scelta_session=([^;]+)/.exec(header);
  const value = match?.[1];
  if (!value) {
    throw new Error("Missing session cookie");
  }
  return `scelta_session=${value}`;
}
