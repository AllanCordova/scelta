import {
  auditEvents,
  ballots,
  candidates,
  createPgliteDatabase,
  members,
  participants,
  roomMemberCodes,
  rooms,
  rounds,
  voteReceipts,
  type Db,
} from "@scelta/db";
import { IPB_SOCIETY_BOARD_OFFICES } from "@scelta/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import { buildApp } from "../app.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const adminEmail = "ada-offices@feature.test";
const adminPassword = "feature-admin-password";

describe("multi-office IPB board elections", () => {
  let db: Db;
  let repository: RoomRepository;
  let userRepository: UserRepository;
  let closeDatabase: () => Promise<void>;
  let adminCookie: string;

  beforeAll(async () => {
    const database = await createPgliteDatabase();
    db = database.db;
    closeDatabase = database.close;
    repository = createDrizzleRoomRepository(db, "Offices feature church");
    userRepository = createDrizzleUserRepository(db, "Offices feature church");
    await userRepository.insertUser({
      name: "Ada",
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      role: "admin",
    });

    const app = await buildApp({ roomRepository: repository, userRepository });
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: adminEmail, password: adminPassword },
    });
    const setCookie = login.headers["set-cookie"];
    adminCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";")[0]!;
    await app.close();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    resetAuthAttempts();
    await db.delete(auditEvents);
    await db.delete(ballots);
    await db.delete(voteReceipts);
    await db.delete(candidates);
    await db.delete(rounds);
    await db.delete(participants);
    await db.delete(roomMemberCodes);
    await db.delete(rooms);
    await db.delete(members);
  });

  it("advances through IPB board offices in mandatory order and restores candidates after runoff", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Eleição Diretoria UPA 2026",
        roomType: "upa_board",
        rulesPreset: "ipb_society_board",
        quorumValue: 3,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Ana", "Bia", "Caio", "Davi"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as {
      id: string;
      inviteToken: string;
      candidates: { id: string; displayName: string }[];
    };
    const ana = room.candidates.find((c) => c.displayName === "Ana")!;
    const bia = room.candidates.find((c) => c.displayName === "Bia")!;
    const caio = room.candidates.find((c) => c.displayName === "Caio")!;

    await joinSimulated(app, room.id, room.inviteToken, adminCookie, 3);
    const keys = [
      "join-key-office-0001",
      "join-key-office-0002",
      "join-key-office-0003",
    ];

    // 1st office: Presidente — 1st round split 1-1-1 (no_majority)
    const r1 = await openRound(app, room.id, adminCookie);
    expect(r1.statusCode).toBe(201);
    expect(r1.json().round.officeLabel).toBe("Presidente");
    expect(r1.json().round.officeRoundNumber).toBe(1);
    await castAll(app, room.inviteToken, [
      [keys[0]!, ana.id],
      [keys[1]!, bia.id],
      [keys[2]!, caio.id],
    ]);
    await closeRound(app, room.id, r1.json().round.id, adminCookie);

    // 2nd round of Presidente — still no majority (Ana 1, Bia 1, Caio 1)
    const r2 = await openRound(app, room.id, adminCookie);
    expect(r2.statusCode).toBe(201);
    expect(r2.json().round.officeLabel).toBe("Presidente");
    expect(r2.json().round.officeRoundNumber).toBe(2);
    await castAll(app, room.inviteToken, [
      [keys[0]!, ana.id],
      [keys[1]!, bia.id],
      [keys[2]!, caio.id],
    ]);
    await closeRound(app, room.id, r2.json().round.id, adminCookie);

    // 3rd round of Presidente — top-2 runoff eliminates one candidate, Ana wins
    const r3 = await openRound(app, room.id, adminCookie);
    expect(r3.statusCode).toBe(201);
    expect(r3.json().round.officeLabel).toBe("Presidente");
    expect(r3.json().round.officeRoundNumber).toBe(3);
    const runoffCandidates = r3.json().candidates as { id: string }[];
    expect(runoffCandidates).toHaveLength(2);
    const winnerCandidateId = runoffCandidates[0]!.id;
    await castAll(app, room.inviteToken, [
      [keys[0]!, winnerCandidateId],
      [keys[1]!, winnerCandidateId],
      [keys[2]!, runoffCandidates[1]!.id],
    ]);
    const c3 = await closeRound(app, room.id, r3.json().round.id, adminCookie);
    expect(c3.json().round.outcome).toBe("elected");

    // Voter ballot view & admin room detail must not crash when runoff eliminated a prior vote recipient
    const ballotAfterRunoff = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}/ballot`,
    });
    expect(ballotAfterRunoff.statusCode).toBe(200);
    expect(ballotAfterRunoff.json().round.officeLabel).toBe("Presidente");

    // Next round automatically advances to Vice-Presidente, round 1, excluding the Presidente winner
    const r4 = await openRound(app, room.id, adminCookie);
    expect(r4.statusCode).toBe(201);
    expect(r4.json().round.officeLabel).toBe("Vice-Presidente");
    expect(r4.json().round.officeRoundNumber).toBe(1);
    const viceCandidates = r4.json().candidates as { id: string }[];
    expect(viceCandidates).toHaveLength(3);
    expect(viceCandidates.some((c) => c.id === winnerCandidateId)).toBe(false);

    // Close Vice-Presidente round 1 with no majority, open round 2, then restart -> resets to round 1 of Vice-Presidente without wiping Presidente
    await castAll(app, room.inviteToken, [
      [keys[0]!, viceCandidates[0]!.id],
      [keys[1]!, viceCandidates[1]!.id],
      [keys[2]!, viceCandidates[2]!.id],
    ]);
    const closeR4 = await closeRound(app, room.id, r4.json().round.id, adminCookie);
    expect(closeR4.statusCode).toBe(200);
    expect(closeR4.json().round.outcome).toBe("no_majority");

    const r5 = await openRound(app, room.id, adminCookie);
    expect(r5.statusCode).toBe(201);
    expect(r5.json().round.officeLabel).toBe("Vice-Presidente");
    expect(r5.json().round.officeRoundNumber).toBe(2);

    const restart = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${r5.json().round.id}/restart`,
      headers: { cookie: adminCookie },
    });
    expect(restart.statusCode).toBe(200);
    expect(restart.json().round.officeLabel).toBe("Vice-Presidente");
    expect(restart.json().round.officeRoundNumber).toBe(1);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().room.offices[0].status).toBe("elected");
    expect(detail.json().room.offices[1].status).toBe("open");

    await app.close();
  });

  it("supports UMP board, admin-chosen office order, and rejects reopening elected or finished offices", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    // Import UMP members and check suggestions
    const importRes = await app.inject({
      method: "POST",
      url: "/v1/admin/members/import",
      headers: { cookie: adminCookie },
      payload: {
        csv: [
          "nome,comungante,sexo,data_nascimento,ump_ativo,ump_ingresso",
          "Davi Jovem,sim,M,2002-01-10,sim,2024-01-01",
          "Ester Jovem,sim,F,2003-05-15,sim,2024-02-01",
        ].join("\n"),
      },
    });
    expect(importRes.statusCode).toBe(200);

    const suggestions = await app.inject({
      method: "GET",
      url: "/v1/admin/members/suggestions?roomType=ump_board&referenceDate=2026-11-13",
      headers: { cookie: adminCookie },
    });
    expect(suggestions.statusCode).toBe(200);
    expect(suggestions.json().suggestions).toHaveLength(2);

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Eleição Diretoria UMP",
        roomType: "ump_board",
        rulesPreset: "ipb_society_board",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Davi Jovem", "Ester Jovem", "Filipe", "Gideão", "Hannah", "Isaque"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as {
      id: string;
      inviteToken: string;
      candidates: { id: string; displayName: string }[];
    };

    const generatedCodes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/generate`,
      headers: { cookie: adminCookie },
    });
    expect(generatedCodes.statusCode).toBe(200);
    expect(generatedCodes.json().accessCodes).toHaveLength(2);

    const davi = room.candidates.find((c) => c.displayName === "Davi Jovem")!;
    await joinSimulated(app, room.id, room.inviteToken, adminCookie, 1);

    // Invalid office rejected (unknown name and empty string)
    const badOffice = await openRound(app, room.id, adminCookie, "Diácono");
    expect(badOffice.statusCode).toBe(400);
    expect(badOffice.json()).toEqual({ error: "invalid_office" });

    const emptyOffice = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
      payload: { officeLabel: "   " },
    });
    expect(emptyOffice.statusCode).toBe(400);
    expect(emptyOffice.json()).toEqual({ error: "invalid_office" });

    // Admin chooses Tesoureiro first
    const rTes = await openRound(app, room.id, adminCookie, "Tesoureiro");
    expect(rTes.statusCode).toBe(201);
    expect(rTes.json().round.officeLabel).toBe("Tesoureiro");
    await castAll(app, room.inviteToken, [["join-key-office-0001", davi.id]]);
    await closeRound(app, room.id, rTes.json().round.id, adminCookie);

    // Reopening Tesoureiro is rejected
    const reopenTes = await openRound(app, room.id, adminCookie, "Tesoureiro");
    expect(reopenTes.statusCode).toBe(409);
    expect(reopenTes.json()).toEqual({ error: "winner_already_elected" });

    // Remaining 4 offices are elected in IPB order automatically with distinct candidates
    const remainingOffices = IPB_SOCIETY_BOARD_OFFICES.filter((o) => o !== "Tesoureiro");
    for (const expectedOffice of remainingOffices) {
      const opened = await openRound(app, room.id, adminCookie);
      expect(opened.statusCode).toBe(201);
      expect(opened.json().round.officeLabel).toBe(expectedOffice);
      expect(opened.json().round.officeRoundNumber).toBe(1);
      const nextCandidate = (opened.json().candidates as { id: string }[])[0]!;
      expect(nextCandidate.id).not.toBe(davi.id);
      await castAll(app, room.inviteToken, [["join-key-office-0001", nextCandidate.id]]);
      await closeRound(app, room.id, opened.json().round.id, adminCookie);
    }

    // Voter ballot view exposes elected offices
    const ballotRes = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}/ballot`,
    });
    expect(ballotRes.statusCode).toBe(200);
    expect(ballotRes.json().offices).toHaveLength(5);
    expect(ballotRes.json().offices.every((o: { status: string }) => o.status === "elected")).toBe(
      true,
    );

    // All offices elected -> cannot open another round
    const extra = await openRound(app, room.id, adminCookie);
    expect(extra.statusCode).toBe(409);
    expect(extra.json()).toEqual({ error: "all_offices_elected" });

    await app.close();
  });

  it("restarts the current office from 0 without the declining winner while keeping them eligible for other offices", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const createRes = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Diretoria UPA — Recusa",
        roomType: "upa_board",
        rulesPreset: "ipb_society_board",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Kamila", "Ana", "Bia"],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const room = createRes.json().room as {
      id: string;
      inviteToken: string;
      candidates: { id: string; displayName: string }[];
    };
    const kamila = room.candidates.find((c) => c.displayName === "Kamila")!;
    const ana = room.candidates.find((c) => c.displayName === "Ana")!;

    await joinSimulated(app, room.id, room.inviteToken, adminCookie, 1);

    // 1. Presidente -> Kamila wins, then declines
    const rPres1 = await openRound(app, room.id, adminCookie);
    expect(rPres1.statusCode).toBe(201);
    expect(rPres1.json().round.officeLabel).toBe("Presidente");
    await castAll(app, room.inviteToken, [["join-key-office-0001", kamila.id]]);
    await closeRound(app, room.id, rPres1.json().round.id, adminCookie);

    const declineRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${rPres1.json().round.id}/decline`,
      headers: { cookie: adminCookie },
    });
    expect(declineRes.statusCode).toBe(200);
    expect(declineRes.json().round.outcome).toBe("declined");
    expect(declineRes.json().declinedCandidateId).toBe(kamila.id);

    // 2. Presidente restarts from 0 (officeRoundNumber === 1) without Kamila
    const rPres2 = await openRound(app, room.id, adminCookie);
    expect(rPres2.statusCode).toBe(201);
    expect(rPres2.json().round.officeLabel).toBe("Presidente");
    expect(rPres2.json().round.officeRoundNumber).toBe(1);
    const rPres2Ids = (rPres2.json().candidates as { id: string }[]).map((c) => c.id);
    expect(rPres2Ids).not.toContain(kamila.id);
    expect(rPres2Ids).toContain(ana.id);

    // Ana wins Presidente
    await castAll(app, room.inviteToken, [["join-key-office-0001", ana.id]]);
    await closeRound(app, room.id, rPres2.json().round.id, adminCookie);

    // 3. Vice-Presidente includes Kamila again, excludes Ana
    const rVp = await openRound(app, room.id, adminCookie);
    expect(rVp.statusCode).toBe(201);
    expect(rVp.json().round.officeLabel).toBe("Vice-Presidente");
    const rVpIds = (rVp.json().candidates as { id: string }[]).map((c) => c.id);
    expect(rVpIds).toContain(kamila.id);
    expect(rVpIds).not.toContain(ana.id);

    await app.close();
  });
});

async function joinSimulated(
  app: Awaited<ReturnType<typeof buildApp>>,
  roomId: string,
  inviteToken: string,
  adminCookie: string,
  count: number,
) {
  const sim = await app.inject({
    method: "POST",
    url: `/v1/admin/rooms/${roomId}/access-codes/simulate`,
    headers: { cookie: adminCookie },
    payload: { count },
  });
  const codes = sim.json().accessCodes as { code: string }[];
  for (let i = 0; i < codes.length; i += 1) {
    await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}`,
      payload: { code: codes[i]!.code, joinKey: `join-key-office-000${i + 1}` },
    });
  }
}

async function openRound(
  app: Awaited<ReturnType<typeof buildApp>>,
  roomId: string,
  adminCookie: string,
  officeLabel?: string,
) {
  return app.inject({
    method: "POST",
    url: `/v1/admin/rooms/${roomId}/rounds`,
    headers: { cookie: adminCookie },
    ...(officeLabel ? { payload: { officeLabel } } : {}),
  });
}

async function closeRound(
  app: Awaited<ReturnType<typeof buildApp>>,
  roomId: string,
  roundId: string,
  adminCookie: string,
) {
  return app.inject({
    method: "POST",
    url: `/v1/admin/rooms/${roomId}/rounds/${roundId}/close`,
    headers: { cookie: adminCookie },
  });
}

async function castAll(
  app: Awaited<ReturnType<typeof buildApp>>,
  inviteToken: string,
  votes: [string, string][],
) {
  for (const [joinKey, candidateId] of votes) {
    await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/ballot`,
      payload: { joinKey, candidateId },
    });
  }
}
