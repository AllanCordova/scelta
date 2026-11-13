import { describe, expect, it } from "vitest";
import {
  IPB_SOCIETY_BOARD_OFFICES,
  buildOfficeProgress,
  countOfficeRoundNumber,
  getElectedCandidateIds,
  isMultiOfficeRoomType,
  isValidOfficeForRoomType,
  officesForRoomType,
  resolveTargetOffice,
} from "./offices.js";

describe("IPB offices per room type", () => {
  it("returns the mandatory IPB board offices in order for UPA and UMP", () => {
    expect(officesForRoomType("upa_board")).toEqual([
      "Presidente",
      "Vice-Presidente",
      "1º Secretário",
      "2º Secretário",
      "Tesoureiro",
    ]);
    expect(officesForRoomType("ump_board")).toEqual(IPB_SOCIETY_BOARD_OFFICES);
    expect(isMultiOfficeRoomType("upa_board")).toBe(true);
    expect(isMultiOfficeRoomType("ump_board")).toBe(true);
  });

  it("returns the CI/IPB art. 84 offices in order for session_board", () => {
    expect(officesForRoomType("session_board")).toEqual([
      "Vice-Presidente",
      "Secretário",
      "Tesoureiro",
    ]);
    expect(isMultiOfficeRoomType("session_board")).toBe(true);
    expect(isValidOfficeForRoomType("session_board", "Vice-Presidente")).toBe(true);
    expect(isValidOfficeForRoomType("session_board", "Presidente")).toBe(false);
  });

  it("keeps single-office / non-office room types without sub-offices", () => {
    for (const roomType of ["pastor", "elder", "deacon", "custom"] as const) {
      expect(officesForRoomType(roomType)).toEqual([]);
      expect(isMultiOfficeRoomType(roomType)).toBe(false);
    }
  });

  it("validates office labels per room type", () => {
    expect(isValidOfficeForRoomType("upa_board", "Presidente")).toBe(true);
    expect(isValidOfficeForRoomType("ump_board", "Tesoureiro")).toBe(true);
    expect(isValidOfficeForRoomType("upa_board", "Diácono")).toBe(false);
    expect(isValidOfficeForRoomType("elder", "Presidente")).toBe(false);
  });

  it("advances in IPB order once each office elects a winner", () => {
    expect(resolveTargetOffice("upa_board", [])).toEqual({
      ok: true,
      officeLabel: "Presidente",
    });

    // Continues Presidente when round 1 had no majority
    expect(
      resolveTargetOffice("upa_board", [
        {
          id: "r1",
          number: 1,
          officeLabel: "Presidente",
          status: "closed",
          outcome: "no_majority",
        },
      ]),
    ).toEqual({ ok: true, officeLabel: "Presidente" });

    // Advances to Vice-Presidente once Presidente is elected
    expect(
      resolveTargetOffice("upa_board", [
        {
          id: "r1",
          number: 1,
          officeLabel: "Presidente",
          status: "closed",
          outcome: "no_majority",
        },
        {
          id: "r2",
          number: 2,
          officeLabel: "Presidente",
          status: "closed",
          outcome: "elected",
          winnerName: "Ana",
        },
      ]),
    ).toEqual({ ok: true, officeLabel: "Vice-Presidente" });
  });

  it("allows admin to choose any unelected office and rejects already-elected or invalid ones", () => {
    const rounds = [
      {
        id: "r1",
        number: 1,
        officeLabel: "Presidente",
        status: "closed",
        outcome: "elected" as const,
        winnerName: "Ana",
      },
    ];

    expect(resolveTargetOffice("ump_board", rounds, "Tesoureiro")).toEqual({
      ok: true,
      officeLabel: "Tesoureiro",
    });
    expect(resolveTargetOffice("ump_board", rounds, "Presidente")).toEqual({
      ok: false,
      reason: "winner_already_elected",
    });
    expect(resolveTargetOffice("ump_board", rounds, "Outro")).toEqual({
      ok: false,
      reason: "invalid_office",
    });
    expect(resolveTargetOffice("elder", [], "Presidente")).toEqual({
      ok: false,
      reason: "invalid_office",
    });
  });

  it("reports all_offices_elected when every IPB office has a winner", () => {
    const rounds = IPB_SOCIETY_BOARD_OFFICES.map((officeLabel, index) => ({
      id: `r${index + 1}`,
      number: index + 1,
      officeLabel,
      status: "closed",
      outcome: "elected" as const,
      winnerName: `Vencedor ${index + 1}`,
    }));

    expect(resolveTargetOffice("upa_board", rounds)).toEqual({
      ok: false,
      reason: "all_offices_elected",
    });
  });

  it("builds office progress and counts per-office round numbers", () => {
    const rounds = [
      {
        id: "r1",
        number: 1,
        officeLabel: "Presidente",
        status: "closed",
        outcome: "no_majority" as const,
      },
      {
        id: "r2",
        number: 2,
        officeLabel: "Presidente",
        status: "closed",
        outcome: "elected" as const,
        winnerCandidateId: "c1",
        winnerName: "Ana",
      },
      {
        id: "r3",
        number: 3,
        officeLabel: "Vice-Presidente",
        status: "open",
        outcome: null,
      },
    ];

    const progress = buildOfficeProgress("ump_board", rounds);
    expect(progress).toHaveLength(5);
    expect(progress[0]).toEqual({
      officeLabel: "Presidente",
      order: 1,
      status: "elected",
      roundCount: 2,
      winnerCandidateId: "c1",
      winnerName: "Ana",
    });
    expect(progress[1]).toEqual({
      officeLabel: "Vice-Presidente",
      order: 2,
      status: "open",
      roundCount: 1,
      winnerCandidateId: null,
      winnerName: null,
    });
    expect(progress[2]?.status).toBe("pending");
    expect(progress[3]?.status).toBe("pending");
    expect(progress[4]?.status).toBe("pending");
    expect(progress[1]?.winnerCandidateId).toBeNull();
    expect(progress[1]?.winnerName).toBeNull();

    expect(buildOfficeProgress("elder", rounds)).toEqual([]);
    expect(getElectedCandidateIds("ump_board", rounds)).toEqual(["c1"]);
    expect(countOfficeRoundNumber(rounds, { number: 3, officeLabel: "Vice-Presidente" })).toBe(1);
    expect(countOfficeRoundNumber(rounds, { number: 2, officeLabel: "Presidente" })).toBe(2);
    expect(countOfficeRoundNumber([], { number: 4, officeLabel: null })).toBe(4);
    expect(countOfficeRoundNumber([], { number: 2, officeLabel: "Tesoureiro" })).toBe(1);
  });

  it("handles in_progress status, out-of-order continuation, trimming, and single-office resolution", () => {
    const inProgressRounds = [
      {
        id: "r1",
        number: 1,
        officeLabel: "Tesoureiro",
        status: "closed",
        outcome: "no_majority" as const,
      },
    ];
    const progress = buildOfficeProgress("upa_board", inProgressRounds);
    expect(progress[4]?.status).toBe("in_progress");
    expect(progress[4]?.roundCount).toBe(1);

    // Continues out-of-order Tesoureiro when latest closed round was not elected
    expect(resolveTargetOffice("upa_board", inProgressRounds)).toEqual({
      ok: true,
      officeLabel: "Tesoureiro",
    });

    // Returns to first unelected IPB office after out-of-order office is elected
    expect(
      resolveTargetOffice("upa_board", [
        {
          id: "r1",
          number: 1,
          officeLabel: "Tesoureiro",
          status: "closed",
          outcome: "elected",
          winnerCandidateId: "c1",
          winnerName: "Ana",
        },
      ]),
    ).toEqual({ ok: true, officeLabel: "Presidente" });

    expect(resolveTargetOffice("upa_board", [], "  Tesoureiro  ")).toEqual({
      ok: true,
      officeLabel: "Tesoureiro",
    });
    expect(resolveTargetOffice("upa_board", [], "")).toEqual({
      ok: false,
      reason: "invalid_office",
    });
    expect(resolveTargetOffice("elder", [])).toEqual({ ok: true, officeLabel: null });
    expect(resolveTargetOffice("elder", [], "")).toEqual({ ok: true, officeLabel: null });
  });
});
