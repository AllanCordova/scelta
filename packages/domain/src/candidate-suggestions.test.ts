import { describe, expect, it } from "vitest";
import {
  isMemberEligibleForRoomType,
  isMemberEligibleVoter,
  suggestCandidates,
  type CandidateMemberRecord,
} from "./candidate-suggestions.js";

const referenceDate = "2026-11-13";

const sampleMembers: CandidateMemberRecord[] = [
  {
    id: "m-paulo",
    fullName: "Paulo Apóstolo",
    isCommunicant: true,
    isMale: true,
    birthDate: "1985-04-12",
    societyFlags: { upaActive: false },
  },
  {
    id: "m-silas",
    fullName: "Silas Companheiro",
    isCommunicant: true,
    isMale: true,
    birthDate: "2008-11-13", // turns 18 on referenceDate
    societyFlags: { upaActive: true, upaEnrolledAt: "2026-05-13" }, // 6 months on referenceDate
  },
  {
    id: "m-timoteo-minor",
    fullName: "Timóteo Menor",
    isCommunicant: true,
    isMale: true,
    birthDate: "2008-11-14", // 17 years old on referenceDate
    societyFlags: { upaActive: true, upaEnrolledAt: "2026-05-14" }, // 5 months on referenceDate
  },
  {
    id: "m-lidia",
    fullName: "Lídia de Tiatira",
    isCommunicant: true,
    isMale: false,
    birthDate: "1995-02-20",
    societyFlags: { upaActive: true, upaEnrolledAt: "2025-01-10" },
  },
  {
    id: "m-feb",
    fullName: "Febe de Cencreia",
    isCommunicant: false,
    isMale: false,
    birthDate: "1998-07-01",
    societyFlags: { upaActive: false },
  },
  {
    id: "m-no-birthdate",
    fullName: "Barnabé Sem Data",
    isCommunicant: true,
    isMale: true,
    birthDate: null,
    societyFlags: {},
  },
];

describe("suggestCandidates", () => {
  it("filters elder, deacon, and pastor rooms to communicant men aged >= 18 by default", () => {
    for (const roomType of ["elder", "deacon", "pastor"] as const) {
      const suggestions = suggestCandidates(sampleMembers, {
        roomType,
        referenceDate,
      });
      expect(suggestions).toEqual([
        { memberId: "m-paulo", fullName: "Paulo Apóstolo" },
        { memberId: "m-silas", fullName: "Silas Companheiro" },
      ]);
    }
  });

  it("allows configuring minAgeYears and requireMaleForOfficers on officer rooms", () => {
    const customAgeAndGender = suggestCandidates(sampleMembers, {
      roomType: "deacon",
      referenceDate,
      minAgeYears: 25,
      requireMaleForOfficers: false,
    });
    expect(customAgeAndGender).toEqual([
      { memberId: "m-paulo", fullName: "Paulo Apóstolo" },
      { memberId: "m-lidia", fullName: "Lídia de Tiatira" },
    ]);

    const withoutAgeRequirement = suggestCandidates(sampleMembers, {
      roomType: "elder",
      referenceDate,
      minAgeYears: 0,
    });
    expect(withoutAgeRequirement).toEqual([
      { memberId: "m-paulo", fullName: "Paulo Apóstolo" },
      { memberId: "m-silas", fullName: "Silas Companheiro" },
      { memberId: "m-timoteo-minor", fullName: "Timóteo Menor" },
      { memberId: "m-no-birthdate", fullName: "Barnabé Sem Data" },
    ]);
  });

  it("filters upa_board rooms by active UPA membership and minimum seniority months", () => {
    const defaultUpa = suggestCandidates(sampleMembers, {
      roomType: "upa_board",
      referenceDate,
    });
    expect(defaultUpa).toEqual([
      { memberId: "m-silas", fullName: "Silas Companheiro" },
      { memberId: "m-lidia", fullName: "Lídia de Tiatira" },
    ]);

    const stricterSeniority = suggestCandidates(sampleMembers, {
      roomType: "upa_board",
      referenceDate,
      minSocietyMonths: 12,
    });
    expect(stricterSeniority).toEqual([
      { memberId: "m-lidia", fullName: "Lídia de Tiatira" },
    ]);
  });

  it("filters custom rooms to communicant members", () => {
    const customRoom = suggestCandidates(sampleMembers, {
      roomType: "custom",
      referenceDate,
    });
    expect(customRoom).toEqual([
      { memberId: "m-paulo", fullName: "Paulo Apóstolo" },
      { memberId: "m-silas", fullName: "Silas Companheiro" },
      { memberId: "m-timoteo-minor", fullName: "Timóteo Menor" },
      { memberId: "m-lidia", fullName: "Lídia de Tiatira" },
      { memberId: "m-no-birthdate", fullName: "Barnabé Sem Data" },
    ]);
    expect(isMemberEligibleForRoomType(sampleMembers[4]!, { roomType: "custom", referenceDate })).toBe(
      false,
    );
  });

  it("filters ump_board rooms by active UMP membership and seniority, and checks voter eligibility", () => {
    const umpMembers: CandidateMemberRecord[] = [
      {
        id: "m-ump-ok",
        fullName: "Davi Jovem",
        isCommunicant: true,
        isMale: true,
        birthDate: "2002-01-10",
        societyFlags: { umpActive: true, umpEnrolledAt: "2024-01-01" },
      },
      {
        id: "m-ump-recent",
        fullName: "Ester Recente",
        isCommunicant: true,
        isMale: false,
        birthDate: "2004-03-15",
        societyFlags: { umpActive: true, umpEnrolledAt: "2026-08-01" },
      },
      {
        id: "m-ump-inactive",
        fullName: "Lucas Inativo",
        isCommunicant: true,
        isMale: true,
        birthDate: "2001-09-01",
        societyFlags: { umpActive: false, umpEnrolledAt: "2023-01-01" },
      },
    ];

    expect(
      suggestCandidates(umpMembers, { roomType: "ump_board", referenceDate }),
    ).toEqual([{ memberId: "m-ump-ok", fullName: "Davi Jovem" }]);

    expect(isMemberEligibleVoter(umpMembers[0]!, "ump_board")).toBe(true);
    expect(isMemberEligibleVoter(umpMembers[1]!, "ump_board")).toBe(true);
    expect(isMemberEligibleVoter(umpMembers[2]!, "ump_board")).toBe(false);
    expect(isMemberEligibleVoter(sampleMembers[1]!, "upa_board")).toBe(true);
    expect(isMemberEligibleVoter(sampleMembers[0]!, "upa_board")).toBe(false);
  });
});
