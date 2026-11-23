import { describe, expect, it } from "vitest";
import {
  canConfigureRoomVacancies,
  canManageRoomCandidates,
  canOpenRound,
  canSimulateInRoom,
  canTransitionRoomStatus,
  canUpdateRoomQuorum,
  findPreset,
  isMultiVacancyRoomType,
  resolveInitialRoomDetailTab,
  validateCreateRoom,
} from "./room.js";

describe("validateCreateRoom", () => {
  it("pre-fills quorum, majority, and round behavior from the local officers preset", () => {
    const result = validateCreateRoom({
      title: "  Eleição de presbíteros  ",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        title: "Eleição de presbíteros",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 34,
        quorumUnit: "percent",
        eligibleCount: 0,
        status: "draft",
        entryMode: "codigo",
        entryOpen: true,
        maxParticipants: null,
        vacancies: 1,
        majorityRule: "absolute_majority",
        roundBehavior: findPreset("ipb_local_officers").roundBehavior,
      },
    });
  });

  it("pre-fills society board quorum above half of the eligible list", () => {
    const result = validateCreateRoom({
      title: "Diretoria UPA",
      roomType: "upa_board",
      rulesPreset: "ipb_society_board",
      status: "open",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.quorumValue).toBe(51);
      expect(result.value.quorumUnit).toBe("percent");
      expect(result.value.status).toBe("open");
      expect(result.value.roundBehavior).toContain("top two");
    }
  });

  it("keeps an explicit absolute quorum when the admin overrides the preset", () => {
    const result = validateCreateRoom({
      title: "Assembleia",
      roomType: "custom",
      rulesPreset: "ipb_local_officers",
      quorumValue: 12,
      quorumUnit: "absolute",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.quorumValue).toBe(12);
      expect(result.value.quorumUnit).toBe("absolute");
      expect(result.value.majorityRule).toBe("absolute_majority");
    }
  });

  it("rejects a percent quorum outside 1–100", () => {
    const result = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "custom",
      quorumValue: 101,
      quorumUnit: "percent",
    });

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "quorumValue", code: "out_of_range" }],
    });
  });

  it("rejects a zero or negative absolute quorum", () => {
    const result = validateCreateRoom({
      title: "Assembleia",
      roomType: "deacon",
      rulesPreset: "custom",
      quorumValue: 0,
      quorumUnit: "absolute",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([{ field: "quorumValue", code: "out_of_range" }]);
    }
  });

  it("requires quorum when the custom preset has no default", () => {
    const result = validateCreateRoom({
      title: "Assembleia",
      roomType: "custom",
      rulesPreset: "custom",
    });

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "quorumValue", code: "required" }],
    });
  });

  it("accepts an explicit percent quorum and a custom preset with an absolute quorum", () => {
    const percent = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      quorumValue: 60,
      quorumUnit: "percent",
    });
    expect(percent.ok).toBe(true);
    if (percent.ok) {
      expect(percent.value.quorumValue).toBe(60);
      expect(percent.value.quorumUnit).toBe("percent");
    }

    const custom = validateCreateRoom({
      title: "Assembleia",
      roomType: "custom",
      rulesPreset: "custom",
      quorumValue: 10,
      quorumUnit: "absolute",
    });
    expect(custom.ok).toBe(true);
    if (custom.ok) {
      expect(custom.value.majorityRule).toBe("absolute_majority");
      expect(custom.value.roundBehavior).toContain("not opened automatically");
    }
  });

  it("rejects a negative absolute quorum and an oversized title", () => {
    const negative = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "custom",
      quorumValue: -1,
      quorumUnit: "absolute",
    });
    expect(negative.ok).toBe(false);

    const longTitle = validateCreateRoom({
      title: "a".repeat(201),
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
    });
    expect(longTitle.ok).toBe(false);
  });

  it("stores an eligible count only when the admin sends one", () => {
    const omitted = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
    });
    expect(omitted.ok && omitted.value.eligibleCount).toBe(0);

    const set = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_society_board",
      eligibleCount: 80,
    });
    expect(set.ok && set.value.eligibleCount).toBe(80);
    if (set.ok) {
      expect(set.value.quorumUnit).toBe("percent");
    }
  });

  it("rejects an eligible count outside 0–100000", () => {
    const negative = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      eligibleCount: -1,
    });
    expect(negative.ok).toBe(false);
    if (!negative.ok) {
      expect(negative.errors).toEqual([{ field: "eligibleCount", code: "out_of_range" }]);
    }

    const fractional = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      eligibleCount: 1.5,
    });
    expect(fractional.ok).toBe(false);

    const maxAllowed = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      eligibleCount: 100_000,
    });
    expect(maxAllowed.ok && maxAllowed.value.eligibleCount).toBe(100_000);

    const aboveMax = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      eligibleCount: 100_001,
    });
    expect(aboveMax).toEqual({
      ok: false,
      errors: [{ field: "eligibleCount", code: "out_of_range" }],
    });
  });

  it("allows a round only in an open or test room and restricts simulation to test rooms", () => {
    expect(canOpenRound("open")).toBe(true);
    expect(canOpenRound("test")).toBe(true);
    expect(canOpenRound("draft")).toBe(false);
    expect(canOpenRound("closed")).toBe(false);

    expect(canSimulateInRoom("test")).toBe(true);
    expect(canSimulateInRoom("open")).toBe(false);
    expect(canSimulateInRoom("draft")).toBe(false);
    expect(canSimulateInRoom("closed")).toBe(false);
  });

  it("enforces room status transition state machine and blocks changes while a round is open", () => {
    expect(canTransitionRoomStatus("draft", "open")).toEqual({ ok: true });
    expect(canTransitionRoomStatus("draft", "test")).toEqual({ ok: true });
    expect(canTransitionRoomStatus("draft", "closed")).toEqual({ ok: true });
    expect(canTransitionRoomStatus("open", "draft")).toEqual({ ok: true });
    expect(canTransitionRoomStatus("open", "test")).toEqual({ ok: true });
    expect(canTransitionRoomStatus("open", "closed")).toEqual({ ok: true });
    expect(canTransitionRoomStatus("test", "open")).toEqual({ ok: true });
    expect(canTransitionRoomStatus("test", "closed")).toEqual({ ok: true });
    expect(canTransitionRoomStatus("closed", "closed")).toEqual({ ok: true });

    // Closed rooms cannot be reopened
    expect(canTransitionRoomStatus("closed", "open")).toEqual({
      ok: false,
      reason: "room_already_closed",
    });
    expect(canTransitionRoomStatus("closed", "draft")).toEqual({
      ok: false,
      reason: "room_already_closed",
    });
    expect(canTransitionRoomStatus("closed", "test")).toEqual({
      ok: false,
      reason: "room_already_closed",
    });

    // Status transitions are blocked while a round is open
    expect(canTransitionRoomStatus("open", "closed", { hasOpenRound: true })).toEqual({
      ok: false,
      reason: "round_currently_open",
    });
    expect(canTransitionRoomStatus("open", "draft", { hasOpenRound: true })).toEqual({
      ok: false,
      reason: "round_currently_open",
    });
    expect(canTransitionRoomStatus("test", "open", { hasOpenRound: true })).toEqual({
      ok: false,
      reason: "round_currently_open",
    });
    expect(canTransitionRoomStatus("open", "open", { hasOpenRound: true })).toEqual({
      ok: true,
    });
  });

  it("blocks quorum updates when a round is open or the room is closed", () => {
    expect(canUpdateRoomQuorum({ roomStatus: "draft", hasOpenRound: false })).toEqual({
      ok: true,
    });
    expect(canUpdateRoomQuorum({ roomStatus: "open", hasOpenRound: false })).toEqual({
      ok: true,
    });
    expect(canUpdateRoomQuorum({ roomStatus: "test", hasOpenRound: false })).toEqual({
      ok: true,
    });
    expect(canUpdateRoomQuorum({ roomStatus: "open", hasOpenRound: true })).toEqual({
      ok: false,
      reason: "round_currently_open",
    });
    expect(canUpdateRoomQuorum({ roomStatus: "closed", hasOpenRound: false })).toEqual({
      ok: false,
      reason: "room_closed",
    });
  });

  it("accepts creating a room with status test", () => {
    const result = validateCreateRoom({
      title: "Assembleia de Teste",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      status: "test",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("test");
    }
  });

  it("rejects a blank title", () => {
    const result = validateCreateRoom({
      title: "   ",
      roomType: "pastor",
      rulesPreset: "ipb_local_officers",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: "title", code: "required" });
    }
  });

  it("allows candidate management only when room is not closed and no round exists for scope", () => {
    expect(canManageRoomCandidates("draft", false)).toEqual({ allowed: true });
    expect(canManageRoomCandidates("open", false)).toEqual({ allowed: true });
    expect(canManageRoomCandidates("test", false)).toEqual({ allowed: true });

    expect(canManageRoomCandidates("closed", false)).toEqual({
      allowed: false,
      reason: "room_closed",
    });
    expect(canManageRoomCandidates("closed", true)).toEqual({
      allowed: false,
      reason: "room_closed",
    });
    expect(canManageRoomCandidates("open", true)).toEqual({
      allowed: false,
      reason: "candidates_locked_after_round",
    });
    expect(canManageRoomCandidates("test", true)).toEqual({
      allowed: false,
      reason: "candidates_locked_after_round",
    });
  });

  it("validates entryMode, entryOpen, and maxParticipants on room creation", () => {
    const validApproval = validateCreateRoom({
      title: "Assembleia Extraordinária",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      entryMode: "aprovacao",
      entryOpen: false,
      maxParticipants: 45,
    });

    expect(validApproval.ok).toBe(true);
    if (validApproval.ok) {
      expect(validApproval.value.entryMode).toBe("aprovacao");
      expect(validApproval.value.entryOpen).toBe(false);
      expect(validApproval.value.maxParticipants).toBe(45);
    }

    const explicitNullMax = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      maxParticipants: null,
    });
    expect(explicitNullMax.ok).toBe(true);
    if (explicitNullMax.ok) {
      expect(explicitNullMax.value.maxParticipants).toBeNull();
    }

    const invalidEntry = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      entryMode: "invalid_mode",
      entryOpen: "yes" as unknown as boolean,
      maxParticipants: 0,
    });

    expect(invalidEntry).toEqual({
      ok: false,
      errors: [
        { field: "entryMode", code: "invalid" },
        { field: "entryOpen", code: "invalid" },
        { field: "maxParticipants", code: "out_of_range" },
      ],
    });

    const outOfRangeMax = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      maxParticipants: 100_001,
    });
    expect(outOfRangeMax).toEqual({
      ok: false,
      errors: [{ field: "maxParticipants", code: "out_of_range" }],
    });

    const fractionalMax = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      maxParticipants: 12.5,
    });
    expect(fractionalMax).toEqual({
      ok: false,
      errors: [{ field: "maxParticipants", code: "out_of_range" }],
    });
  });

  it("validates vacancies for officer/custom rooms and restricts single-office rooms to 1 vacancy", () => {
    expect(isMultiVacancyRoomType("elder")).toBe(true);
    expect(isMultiVacancyRoomType("deacon")).toBe(true);
    expect(isMultiVacancyRoomType("custom")).toBe(false);
    expect(isMultiVacancyRoomType("upa_board")).toBe(false);

    expect(canConfigureRoomVacancies("elder")).toBe(true);
    expect(canConfigureRoomVacancies("deacon")).toBe(true);
    expect(canConfigureRoomVacancies("custom")).toBe(true);
    expect(canConfigureRoomVacancies("upa_board")).toBe(false);
    expect(canConfigureRoomVacancies("ump_board")).toBe(false);
    expect(canConfigureRoomVacancies("session_board")).toBe(false);
    expect(canConfigureRoomVacancies("pastor")).toBe(false);

    const deaconFive = validateCreateRoom({
      title: "Eleição de Diáconos",
      roomType: "deacon",
      rulesPreset: "ipb_local_officers",
      vacancies: 5,
    });
    expect(deaconFive.ok).toBe(true);
    if (deaconFive.ok) {
      expect(deaconFive.value.vacancies).toBe(5);
    }

    const upaSingle = validateCreateRoom({
      title: "Diretoria UPA",
      roomType: "upa_board",
      rulesPreset: "ipb_society_board",
      vacancies: 1,
    });
    expect(upaSingle.ok).toBe(true);

    const upaMultiple = validateCreateRoom({
      title: "Diretoria UPA",
      roomType: "upa_board",
      rulesPreset: "ipb_society_board",
      vacancies: 3,
    });
    expect(upaMultiple).toEqual({
      ok: false,
      errors: [{ field: "vacancies", code: "invalid" }],
    });

    const outOfRangeVacancies = validateCreateRoom({
      title: "Eleição de Presbíteros",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      vacancies: 51,
    });
    expect(outOfRangeVacancies).toEqual({
      ok: false,
      errors: [{ field: "vacancies", code: "out_of_range" }],
    });

    const zeroVacancies = validateCreateRoom({
      title: "Eleição de Presbíteros",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      vacancies: 0,
    });
    expect(zeroVacancies).toEqual({
      ok: false,
      errors: [{ field: "vacancies", code: "out_of_range" }],
    });
  });

  it("resolves the initial room detail tab from room and round state", () => {
    expect(resolveInitialRoomDetailTab({ roomStatus: "draft" })).toBe("preparar");
    expect(resolveInitialRoomDetailTab({ roomStatus: "draft", roundStatus: null })).toBe("preparar");

    expect(resolveInitialRoomDetailTab({ roomStatus: "open" })).toBe("conduzir");
    expect(resolveInitialRoomDetailTab({ roomStatus: "open", roundStatus: "open" })).toBe("conduzir");
    expect(resolveInitialRoomDetailTab({ roomStatus: "open", roundStatus: "restarted" })).toBe("conduzir");
    expect(resolveInitialRoomDetailTab({ roomStatus: "test", roundStatus: "open" })).toBe("conduzir");

    expect(
      resolveInitialRoomDetailTab({
        roomStatus: "open",
        roundStatus: "closed",
        roundOutcome: "elected",
      }),
    ).toBe("resultado");
    expect(
      resolveInitialRoomDetailTab({
        roomStatus: "test",
        roundStatus: "closed",
        roundOutcome: "no_majority",
      }),
    ).toBe("resultado");
    expect(resolveInitialRoomDetailTab({ roomStatus: "closed" })).toBe("resultado");
    expect(resolveInitialRoomDetailTab({ roomStatus: "closed", roundStatus: null })).toBe("resultado");
  });
});
