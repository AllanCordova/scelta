import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ballotMarks,
  ballots,
  candidates,
  createPgliteDatabase,
  members,
  participants,
  roomEntryRequests,
  roomMemberCodes,
  roomRoster,
  rooms,
  roundPaperTallies,
  rounds,
  voteReceipts,
  type Db,
} from "@scelta/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { resetAuthAttempts } from "./auth/auth-attempts.js";
import { hashPassword } from "./auth/password.js";
import { createDrizzleRoomRepository } from "./rooms/drizzle-room-repository.js";
import type { RoomRepository } from "./rooms/room-repository.js";
import { resetRateLimits } from "./security/rate-limiter.js";
import { clearAuditEvents } from "./testing/database.js";
import { createDrizzleUserRepository } from "./users/drizzle-user-repository.js";
import type { UserRepository } from "./users/user-repository.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const FAKE_CHURCH_CSV = readFileSync(
  resolve(currentDir, "fixtures", "fake-church-members.csv"),
  "utf8",
);

const adminEmail = "ada-rehearsal@feature.test";
const adminPassword = "feature-admin-password";

describe("T7.1 — Full assembly rehearsal across UPA, UMP, and 5-vacancy Officers from fake CSV", () => {
  let db: Db;
  let repository: RoomRepository;
  let userRepository: UserRepository;
  let closeDatabase: () => Promise<void>;
  let adminCookie: string;

  beforeAll(async () => {
    const database = await createPgliteDatabase();
    db = database.db;
    closeDatabase = database.close;
    repository = createDrizzleRoomRepository(db, "Igreja Ensaio Geral");
    userRepository = createDrizzleUserRepository(db, "Igreja Ensaio Geral");

    await userRepository.insertUser({
      name: "Ada Mesa",
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
    resetRateLimits();
    await db.delete(ballotMarks);
    await db.delete(roundPaperTallies);
    await db.delete(ballots);
    await db.delete(voteReceipts);
    await db.delete(rounds);
    await db.delete(candidates);
    await db.delete(roomEntryRequests);
    await db.delete(participants);
    await db.delete(roomMemberCodes);
    await db.delete(roomRoster);
    await clearAuditEvents(db);
    await db.delete(rooms);
    await db.delete(members);
  });

  it("enforces UPA/UMP active-member vs Officers communicant-only voter & candidate eligibility from the fake CSV", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    await importFakeMembers(app, adminCookie);

    // 1. UPA room -> ONLY the 6 active UPA members (including 3 non-communicant active socios!)
    const upaRoom = await createRoom(app, adminCookie, {
      title: "Assembleia UPA Elegibilidade",
      roomType: "upa_board",
      rulesPreset: "ipb_society_board",
      status: "open",
      candidates: ["Lucas Jovem UPA", "Sara Jovem UPA"],
    });
    const upaRoster = await getRoster(app, adminCookie, upaRoom.id);
    expect(upaRoster.eligibleCount).toBe(6);
    const upaNames = upaRoster.entries.map((e) => e.fullName);
    expect(upaNames).toEqual(
      expect.arrayContaining([
        "Davi Teen UPA",
        "Rebeca Teen UPA",
        "Samuel Teen UPA",
        "Lucas Jovem UPA",
        "Sara Jovem UPA",
        "Gabriel Jovem UPA",
      ]),
    );
    expect(upaNames).not.toContain("Mateus Socio UMP");
    expect(upaNames).not.toContain("Abraao Silva");
    expect(upaNames).not.toContain("Visitante Pedro");

    // Verify re-adding a non-communicant active UPA member via addRosterEntry preserves isEligibleVoter = true
    const daviEntry = upaRoster.entries.find((e) => e.fullName === "Davi Teen UPA")!;
    await app.inject({
      method: "DELETE",
      url: `/v1/admin/rooms/${upaRoom.id}/roster/${daviEntry.id}`,
      headers: { cookie: adminCookie },
    });
    const reAdded = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${upaRoom.id}/roster`,
      headers: { cookie: adminCookie },
      payload: { memberId: daviEntry.memberId },
    });
    expect(reAdded.statusCode).toBe(201);
    expect(reAdded.json().entry.isEligibleVoter).toBe(true);
    expect(reAdded.json().eligibleCount).toBe(6);

    // 2. UMP room -> ONLY the 5 active UMP members (including 2 non-communicant active socios!)
    const umpRoom = await createRoom(app, adminCookie, {
      title: "Assembleia UMP Elegibilidade",
      roomType: "ump_board",
      rulesPreset: "ipb_society_board",
      status: "open",
      candidates: ["Tiago Lider UMP", "Debora Lider UMP"],
    });
    const umpRoster = await getRoster(app, adminCookie, umpRoom.id);
    expect(umpRoster.eligibleCount).toBe(5);
    const umpNames = umpRoster.entries.map((e) => e.fullName);
    expect(umpNames).toEqual(
      expect.arrayContaining([
        "Mateus Socio UMP",
        "Ester Socia UMP",
        "Tiago Lider UMP",
        "Debora Lider UMP",
        "Felipe Socio UMP",
      ]),
    );
    expect(umpNames).not.toContain("Davi Teen UPA");
    expect(umpNames).not.toContain("Abraao Silva");

    // 3. Officers room (deacon / elder) -> ONLY the 13 communicant members across UPA, UMP, and general church
    const deaconRoom = await createRoom(app, adminCookie, {
      title: "Assembleia Diaconos Elegibilidade",
      roomType: "deacon",
      rulesPreset: "ipb_local_officers",
      status: "open",
      vacancies: 5,
      candidates: [
        "Abraao Silva",
        "Barnabe Souza",
        "Calebe Oliveira",
        "Daniel Santos",
        "Estevao Pereira",
        "Filipe Costa",
      ],
    });
    const deaconRoster = await getRoster(app, adminCookie, deaconRoom.id);
    expect(deaconRoster.eligibleCount).toBe(13);
    const deaconNames = deaconRoster.entries.map((e) => e.fullName);
    // Communicants from UPA, UMP, and general church ARE included:
    expect(deaconNames).toContain("Lucas Jovem UPA");
    expect(deaconNames).toContain("Tiago Lider UMP");
    expect(deaconNames).toContain("Abraao Silva");
    expect(deaconNames).toContain("Noemi Almeida");
    // Non-communicants from UPA, UMP, and general church are STRICTLY excluded:
    expect(deaconNames).not.toContain("Davi Teen UPA");
    expect(deaconNames).not.toContain("Rebeca Teen UPA");
    expect(deaconNames).not.toContain("Samuel Teen UPA");
    expect(deaconNames).not.toContain("Mateus Socio UMP");
    expect(deaconNames).not.toContain("Ester Socia UMP");
    expect(deaconNames).not.toContain("Visitante Pedro");
    expect(deaconNames).not.toContain("Crianca Ana");

    // Candidate suggestions for Elders return ONLY communicant men >= 18
    const suggestions = await app.inject({
      method: "GET",
      url: "/v1/admin/members/suggestions?roomType=elder&referenceDate=2026-11-23",
      headers: { cookie: adminCookie },
    });
    expect(suggestions.statusCode).toBe(200);
    const suggestedNames = (suggestions.json().suggestions as Array<{ fullName: string }>).map(
      (s) => s.fullName,
    );
    expect(suggestedNames).toContain("Abraao Silva");
    expect(suggestedNames).toContain("Tiago Lider UMP");
    expect(suggestedNames).toContain("Lucas Jovem UPA"); // born 2008-02-15 -> 18yo
    expect(suggestedNames).not.toContain("Noemi Almeida"); // female
    expect(suggestedNames).not.toContain("Gabriel Jovem UPA"); // 16yo
    expect(suggestedNames).not.toContain("Davi Teen UPA"); // non-communicant
    expect(suggestedNames).not.toContain("Mateus Socio UMP"); // non-communicant

    await app.close();
  });

  it("Scenario 1 (UPA): access codes, non-communicant paper voter, live roster removal, 3-round tie-break by age, and telão reveal", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    await importFakeMembers(app, adminCookie);

    const room = await createRoom(app, adminCookie, {
      title: "Assembleia Completa UPA",
      roomType: "upa_board",
      rulesPreset: "ipb_society_board",
      status: "open",
      quorumValue: 51,
      quorumUnit: "percent",
      candidates: ["Lucas Jovem UPA", "Sara Jovem UPA", "Gabriel Jovem UPA"],
    });
    const lucas = room.candidates.find((c) => c.displayName === "Lucas Jovem UPA")!;
    const sara = room.candidates.find((c) => c.displayName === "Sara Jovem UPA")!;

    const roster = await getRoster(app, adminCookie, room.id);
    const davi = roster.entries.find((e) => e.fullName === "Davi Teen UPA")!;
    const gabriel = roster.entries.find((e) => e.fullName === "Gabriel Jovem UPA")!;

    // Mark Davi Teen UPA (non-communicant active UPA socio) as paper voter
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/admin/rooms/${room.id}/roster/${davi.id}/paper-mode`,
          headers: { cookie: adminCookie },
          payload: { votesOnPaper: true },
        })
      ).statusCode,
    ).toBe(200);

    // Remove Gabriel from roster while room is open -> eligibleCount drops 6 -> 5 (quorum 51% = 3)
    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/admin/rooms/${room.id}/roster/${gabriel.id}`,
      headers: { cookie: adminCookie },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().eligibleCount).toBe(5);

    // Generate codes and join 3 online UPA voters (including non-communicant Rebeca & Samuel + communicant Lucas)
    const genRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/generate`,
      headers: { cookie: adminCookie },
    });
    const activeCodes = (
      genRes.json().accessCodes as Array<{ displayName: string; code: string; revokedAt: string | null }>
    ).filter((c) => c.revokedAt === null);

    const onlineVoters = [
      { code: activeCodes.find((c) => c.displayName === "Rebeca Teen UPA")!.code, key: "join-upa-rebeca-0001" },
      { code: activeCodes.find((c) => c.displayName === "Samuel Teen UPA")!.code, key: "join-upa-samuel-0002" },
      { code: activeCodes.find((c) => c.displayName === "Lucas Jovem UPA")!.code, key: "join-upa-lucas-0003" },
    ];
    for (const v of onlineVoters) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/join/s/${room.shortCode}`,
            payload: { code: v.code, joinKey: v.key },
          })
        ).statusCode,
      ).toBe(200);
    }

    // Run 3 scrutinies for Presidente: every round ties 2 x 2 (Lucas: 2 online, Sara: 1 online + 1 paper)
    let lastRoundId = "";
    for (let roundNum = 1; roundNum <= 3; roundNum += 1) {
      const opened = await app.inject({
        method: "POST",
        url: `/v1/admin/rooms/${room.id}/rounds`,
        headers: { cookie: adminCookie },
        payload: { officeLabel: "Presidente" },
      });
      expect(opened.statusCode).toBe(201);
      const roundId = opened.json().round.id as string;
      lastRoundId = roundId;

      // Online: 2 for Lucas, 1 for Sara
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/join/${room.inviteToken}/ballot`,
            payload: { joinKey: onlineVoters[0]!.key, candidateId: lucas.id },
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/join/${room.inviteToken}/ballot`,
            payload: { joinKey: onlineVoters[1]!.key, candidateId: lucas.id },
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/join/${room.inviteToken}/ballot`,
            payload: { joinKey: onlineVoters[2]!.key, candidateId: sara.id },
          })
        ).statusCode,
      ).toBe(201);

      // Paper: 1 vote for Sara (Davi Teen UPA)
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/paper-tally`,
            headers: { cookie: adminCookie },
            payload: {
              ballotCount: 1,
              blankVotes: 0,
              nullVotes: 0,
              candidateVotes: { [sara.id]: 1 },
            },
          })
        ).statusCode,
      ).toBe(200);

      const closed = await app.inject({
        method: "POST",
        url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/close`,
        headers: { cookie: adminCookie },
      });
      expect(closed.statusCode).toBe(200);

      if (roundNum < 3) {
        expect(closed.json().round.outcome).toBe("no_majority");
      } else {
        // 3rd scrutiny tie-break by age: Lucas (2008-02-15) beats Sara (2009-06-22)!
        expect(closed.json().round.outcome).toBe("elected");
        expect(closed.json().round.tally.winnerId).toBe(lucas.id);
        expect(closed.json().round.tally.tieBreakReason).toBe("age");
        expect(closed.json().round.resultRevealed).toBe(false);
      }
    }

    // Reveal 3rd round result on Telão and verify audit chain
    const revealed = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${lastRoundId}/reveal`,
      headers: { cookie: adminCookie },
    });
    expect(revealed.statusCode).toBe(200);
    expect(revealed.json().round.resultRevealed).toBe(true);

    const verify = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit/verify`,
      headers: { cookie: adminCookie },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().chainValid).toBe(true);

    await app.close();
  });

  it("Scenario 2 (UMP): active UMP socios (including non-communicants), pending voters close, and 2nd-round election", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    await importFakeMembers(app, adminCookie);

    const room = await createRoom(app, adminCookie, {
      title: "Assembleia Completa UMP",
      roomType: "ump_board",
      rulesPreset: "ipb_society_board",
      status: "open",
      candidates: ["Tiago Lider UMP", "Debora Lider UMP"],
    });
    const tiago = room.candidates.find((c) => c.displayName === "Tiago Lider UMP")!;
    const debora = room.candidates.find((c) => c.displayName === "Debora Lider UMP")!;

    const genRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/generate`,
      headers: { cookie: adminCookie },
    });
    const codes = (
      genRes.json().accessCodes as Array<{ displayName: string; code: string; revokedAt: string | null }>
    ).filter((c) => c.revokedAt === null);

    // 3 UMP socios join (including non-communicants Mateus Socio UMP & Ester Socia UMP!)
    const voters = [
      { code: codes.find((c) => c.displayName === "Mateus Socio UMP")!.code, key: "join-ump-mateus-0001" },
      { code: codes.find((c) => c.displayName === "Ester Socia UMP")!.code, key: "join-ump-ester-0002" },
      { code: codes.find((c) => c.displayName === "Tiago Lider UMP")!.code, key: "join-ump-tiago-0003" },
    ];
    for (const v of voters) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/join/s/${room.shortCode}`,
            payload: { code: v.code, joinKey: v.key },
          })
        ).statusCode,
      ).toBe(200);
    }

    // Round 1: 2 of 3 vote (1 Tiago, 1 Debora), 1 pending -> close with confirmPending=true
    const r1 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
      payload: { officeLabel: "Presidente" },
    });
    const r1Id = r1.json().round.id as string;

    await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: voters[0]!.key, candidateId: tiago.id },
    });
    await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: voters[1]!.key, candidateId: debora.id },
    });

    const close1 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${r1Id}/close`,
      headers: { cookie: adminCookie },
      payload: { confirmPending: true },
    });
    expect(close1.statusCode).toBe(200);
    expect(close1.json().round.outcome).toBe("no_majority");
    expect(close1.json().round.tally.didNotVoteCount).toBe(1);

    // Round 2: all 3 vote -> Tiago gets 2/3 and wins
    const r2 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
      payload: { officeLabel: "Presidente" },
    });
    const r2Id = r2.json().round.id as string;

    await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: voters[0]!.key, candidateId: tiago.id },
    });
    await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: voters[1]!.key, candidateId: tiago.id },
    });
    await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: voters[2]!.key, candidateId: debora.id },
    });

    const close2 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${r2Id}/close`,
      headers: { cookie: adminCookie },
    });
    expect(close2.statusCode).toBe(200);
    expect(close2.json().round.outcome).toBe("elected");
    expect(close2.json().round.tally.winnerId).toBe(tiago.id);

    await app.close();
  });

  it("Scenario 3 (Officers — 5 vacancies, approval mode): communicant-only search, dispute + release, online + paper N-vacancy ballots, 2nd scrutiny, and audit chain", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    await importFakeMembers(app, adminCookie);

    const candidateNames = [
      "Abraao Silva",
      "Barnabe Souza",
      "Calebe Oliveira",
      "Daniel Santos",
      "Estevao Pereira",
      "Filipe Costa",
    ];
    const room = await createRoom(app, adminCookie, {
      title: "Assembleia Diaconos 5 Vagas",
      roomType: "deacon",
      rulesPreset: "ipb_local_officers",
      status: "open",
      vacancies: 5,
      entryMode: "aprovacao",
      quorumValue: 34,
      quorumUnit: "percent", // 34% of 13 = 5 present needed
      candidates: candidateNames,
    });
    const byName = new Map(room.candidates.map((c) => [c.displayName, c.id]));
    const [abraao, barnabe, calebe, daniel, estevao, filipe] = candidateNames.map(
      (n) => byName.get(n)!,
    );

    // Non-communicant UPA/UMP members do NOT appear in Officers roster search!
    const nonCommUpa = await app.inject({
      method: "GET",
      url: `/v1/join/s/${room.shortCode}/roster-search?q=Davi%20Teen`,
    });
    expect(nonCommUpa.statusCode).toBe(200);
    expect(nonCommUpa.json().entries).toEqual([]);

    const nonCommUmp = await app.inject({
      method: "GET",
      url: `/v1/join/s/${room.shortCode}/roster-search?q=Mateus%20Socio`,
    });
    expect(nonCommUmp.statusCode).toBe(200);
    expect(nonCommUmp.json().entries).toEqual([]);

    // Mark 2 communicants (Calebe, Daniel) as paper voters -> counts as 2 present
    const roster = await getRoster(app, adminCookie, room.id);
    for (const paperName of ["Calebe Oliveira", "Daniel Santos"]) {
      const entry = roster.entries.find((e) => e.fullName === paperName)!;
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: `/v1/admin/rooms/${room.id}/roster/${entry.id}/paper-mode`,
            headers: { cookie: adminCookie },
            payload: { votesOnPaper: true },
          })
        ).statusCode,
      ).toBe(200);
    }

    // Impostor claims Abraao Silva (born 1975-01-20), gets approved, real Abraao triggers dispute, desk releases name!
    const abraaoRoster = roster.entries.find((e) => e.fullName === "Abraao Silva")!;
    const impostorKey = "join-off-impostor-0000";
    const realAbraaoKey = "join-off-abraao-0001";
    const impostorReq = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}/entry-requests`,
      payload: { rosterEntryId: abraaoRoster.id, joinKey: impostorKey, birthDay: 20, birthMonth: 1 },
    });
    expect(impostorReq.statusCode).toBe(201);
    await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/entry-requests/${impostorReq.json().requestId}/approve`,
      headers: { cookie: adminCookie },
    });

    const disputeAttempt = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}/entry-requests`,
      payload: { rosterEntryId: abraaoRoster.id, joinKey: realAbraaoKey, birthDay: 20, birthMonth: 1 },
    });
    expect(disputeAttempt.statusCode).toBe(409);
    expect(disputeAttempt.json().error).toBe("roster_name_already_claimed");

    const released = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/entry-requests/release-name`,
      headers: { cookie: adminCookie },
      payload: { rosterEntryId: abraaoRoster.id },
    });
    expect(released.statusCode).toBe(200);

    // Now 4 real communicants request entry with birthDay/birthMonth and desk approves all
    const onlineApprovalVoters = [
      { name: "Abraao Silva", day: 20, month: 1, key: realAbraaoKey },
      { name: "Barnabe Souza", day: 12, month: 5, key: "join-off-barnabe-0002" },
      { name: "Noemi Almeida", day: 18, month: 9, key: "join-off-noemi-0003" },
      { name: "Tiago Lider UMP", day: 11, month: 3, key: "join-off-tiago-0004" },
    ];
    for (const voter of onlineApprovalVoters) {
      const entry = roster.entries.find((e) => e.fullName === voter.name)!;
      const reqRes = await app.inject({
        method: "POST",
        url: `/v1/join/s/${room.shortCode}/entry-requests`,
        payload: {
          rosterEntryId: entry.id,
          joinKey: voter.key,
          birthDay: voter.day,
          birthMonth: voter.month,
        },
      });
      expect(reqRes.statusCode).toBe(201);
    }

    const approveAll = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/entry-requests/approve-all`,
      headers: { cookie: adminCookie },
    });
    expect(approveAll.statusCode).toBe(200);
    expect(approveAll.json().approvedCount).toBe(4);
    expect(approveAll.json().presence.presentCount).toBe(6); // 4 online + 2 paper >= 5 quorum!

    // Scrutiny 1 (5 vacancies): 4 online ballots + 2 paper ballots = 6 total ballots (threshold = 4)
    const r1 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(r1.statusCode).toBe(201);
    expect(r1.json().round.vacancies).toBe(5);
    const r1Id = r1.json().round.id as string;

    // Online votes: 3 voters mark candidates, 1 votes blank []
    // Online totals: abraao=3, barnabe=3, calebe=2, daniel=2, estevao=1, filipe=1, blank=1
    for (const [idx, marks] of [
      [0, [abraao!, barnabe!, calebe!, daniel!, estevao!]],
      [1, [abraao!, barnabe!, calebe!, daniel!]],
      [2, [abraao!, barnabe!, filipe!]],
      [3, []],
    ] as Array<[number, string[]]>) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/join/${room.inviteToken}/ballot`,
            payload: { joinKey: onlineApprovalVoters[idx]!.key, candidateIds: marks },
          })
        ).statusCode,
      ).toBe(201);
    }

    // Paper tally (2 valid paper ballots * 5 vacancies = max 10 marks):
    // abraao=2, barnabe=1, calebe=2, daniel=1, estevao=1, filipe=1 (total 8 marks <= 10!)
    // Combined (threshold = 4):
    // abraao=5 (elected), barnabe=4 (elected), calebe=4 (elected), daniel=3, estevao=2, filipe=2
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/v1/admin/rooms/${room.id}/rounds/${r1Id}/paper-tally`,
          headers: { cookie: adminCookie },
          payload: {
            ballotCount: 2,
            blankVotes: 0,
            nullVotes: 0,
            candidateVotes: {
              [abraao!]: 2,
              [barnabe!]: 1,
              [calebe!]: 2,
              [daniel!]: 1,
              [estevao!]: 1,
              [filipe!]: 1,
            },
          },
        })
      ).statusCode,
    ).toBe(200);

    const close1 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${r1Id}/close`,
      headers: { cookie: adminCookie },
    });
    expect(close1.statusCode).toBe(200);
    expect(close1.json().round.tally.winnerIds.sort()).toEqual([abraao!, barnabe!, calebe!].sort());
    expect(close1.json().round.tally.remainingVacancies).toBe(2);
    expect(close1.json().round.tally.partialElection).toBe(true);

    // Scrutiny 2 (automatically 2 remaining vacancies, excluding abraao/barnabe/calebe!)
    const r2 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(r2.statusCode).toBe(201);
    expect(r2.json().round.vacancies).toBe(2);
    const r2CandIds = (r2.json().candidates as Array<{ id: string }>).map((c) => c.id);
    expect(r2CandIds.sort()).toEqual([daniel!, estevao!, filipe!].sort());
    const r2Id = r2.json().round.id as string;

    // 4 online + 2 paper = 6 ballots (threshold = 4): daniel & estevao elected!
    for (const v of onlineApprovalVoters) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/join/${room.inviteToken}/ballot`,
            payload: { joinKey: v.key, candidateIds: [daniel!, estevao!] },
          })
        ).statusCode,
      ).toBe(201);
    }
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/v1/admin/rooms/${room.id}/rounds/${r2Id}/paper-tally`,
          headers: { cookie: adminCookie },
          payload: {
            ballotCount: 2,
            blankVotes: 0,
            nullVotes: 0,
            candidateVotes: { [daniel!]: 1, [estevao!]: 1, [filipe!]: 2 },
          },
        })
      ).statusCode,
    ).toBe(200);

    const close2 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${r2Id}/close`,
      headers: { cookie: adminCookie },
    });
    expect(close2.statusCode).toBe(200);
    expect(close2.json().round.tally.winnerIds.sort()).toEqual([daniel!, estevao!].sort());
    expect(close2.json().round.tally.remainingVacancies).toBe(0);

    // Reveal on telão & verify all 5 cumulative electedCandidates + audit chain integrity
    const reveal2 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${r2Id}/reveal`,
      headers: { cookie: adminCookie },
    });
    expect(reveal2.statusCode).toBe(200);
    expect(reveal2.json().round.resultRevealed).toBe(true);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.json().room.remainingVacancies).toBe(0);
    expect(detail.json().room.electedCandidates).toHaveLength(5);

    const verify = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit/verify`,
      headers: { cookie: adminCookie },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().chainValid).toBe(true);

    await app.close();
  });
});

async function importFakeMembers(
  app: Awaited<ReturnType<typeof buildApp>>,
  adminCookie: string,
) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/admin/members/import",
    headers: { cookie: adminCookie },
    payload: { csv: FAKE_CHURCH_CSV },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as {
    report: { createdCount: number; rejectedCount: number };
  };
  expect(body.report.createdCount).toBe(20);
  expect(body.report.rejectedCount).toBe(0);
}

async function createRoom(
  app: Awaited<ReturnType<typeof buildApp>>,
  adminCookie: string,
  payload: Record<string, unknown>,
) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/admin/rooms",
    headers: { cookie: adminCookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json().room as {
    id: string;
    inviteToken: string;
    shortCode: string;
    candidates: Array<{ id: string; displayName: string }>;
  };
}

async function getRoster(
  app: Awaited<ReturnType<typeof buildApp>>,
  adminCookie: string,
  roomId: string,
) {
  const res = await app.inject({
    method: "GET",
    url: `/v1/admin/rooms/${roomId}/roster`,
    headers: { cookie: adminCookie },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    eligibleCount: number;
    entries: Array<{ id: string; memberId: string | null; fullName: string; isEligibleVoter: boolean }>;
  };
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
  const raw = response.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  expect(first).toBeDefined();
  return first!.split(";")[0]!;
}
