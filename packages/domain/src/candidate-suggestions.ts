import { parseIsoDate, type MemberSocietyFlags } from "./member-import.js";
import type { RoomType } from "./room.js";

export type CandidateMemberRecord = {
  id: string;
  fullName: string;
  isCommunicant: boolean;
  isMale: boolean | null;
  birthDate: string | null;
  societyFlags: MemberSocietyFlags;
};

export type CandidateFilterOptions = {
  roomType: RoomType;
  referenceDate?: string;
  minAgeYears?: number;
  minSocietyMonths?: number;
  requireMaleForOfficers?: boolean;
};

export type SuggestedCandidate = {
  memberId: string;
  fullName: string;
};

const DEFAULT_MIN_AGE_YEARS = 18;
const DEFAULT_MIN_SOCIETY_MONTHS = 6;

export function isMemberEligibleForRoomType(
  member: CandidateMemberRecord,
  options: CandidateFilterOptions,
): boolean {
  const reference = resolveReferenceDate(options.referenceDate);
  const minAgeYears = options.minAgeYears ?? DEFAULT_MIN_AGE_YEARS;
  const minSocietyMonths = options.minSocietyMonths ?? DEFAULT_MIN_SOCIETY_MONTHS;
  const requireMaleForOfficers = options.requireMaleForOfficers ?? true;

  if (
    options.roomType === "pastor" ||
    options.roomType === "elder" ||
    options.roomType === "deacon"
  ) {
    if (!member.isCommunicant) {
      return false;
    }
    if (requireMaleForOfficers && member.isMale !== true) {
      return false;
    }
    if (minAgeYears > 0) {
      if (!member.birthDate) {
        return false;
      }
      const birth = parseCalendarParts(member.birthDate);
      if (!birth) {
        return false;
      }
      if (completedYearsBetween(birth, reference) < minAgeYears) {
        return false;
      }
    }
    return true;
  }

  if (options.roomType === "upa_board") {
    if (member.societyFlags.upaActive !== true) {
      return false;
    }
    if (minSocietyMonths > 0) {
      const enrolledAt = member.societyFlags.upaEnrolledAt;
      if (!enrolledAt) {
        return false;
      }
      const enrolled = parseCalendarParts(enrolledAt);
      if (!enrolled) {
        return false;
      }
      if (completedMonthsBetween(enrolled, reference) < minSocietyMonths) {
        return false;
      }
    }
    return true;
  }

  // custom room type: requires communicant member
  return member.isCommunicant;
}

export function suggestCandidates(
  members: readonly CandidateMemberRecord[],
  options: CandidateFilterOptions,
): SuggestedCandidate[] {
  const eligible: SuggestedCandidate[] = [];
  for (const member of members) {
    if (isMemberEligibleForRoomType(member, options)) {
      eligible.push({
        memberId: member.id,
        fullName: member.fullName,
      });
    }
  }
  return eligible;
}

type CalendarParts = {
  year: number;
  month: number;
  day: number;
};

function resolveReferenceDate(referenceDate?: string): CalendarParts {
  if (referenceDate !== undefined) {
    const parsed = parseCalendarParts(referenceDate);
    if (parsed) {
      return parsed;
    }
  }
  const now = new Date();
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
  };
}

function parseCalendarParts(value: string): CalendarParts | null {
  const normalized = parseIsoDate(value);
  if (!normalized) {
    return null;
  }
  const parts = normalized.split("-");
  return {
    year: Number(parts[0]),
    month: Number(parts[1]),
    day: Number(parts[2]),
  };
}

function completedYearsBetween(start: CalendarParts, end: CalendarParts): number {
  let years = end.year - start.year;
  if (end.month < start.month || (end.month === start.month && end.day < start.day)) {
    years -= 1;
  }
  return years;
}

function completedMonthsBetween(start: CalendarParts, end: CalendarParts): number {
  let months = (end.year - start.year) * 12 + (end.month - start.month);
  if (end.day < start.day) {
    months -= 1;
  }
  return months;
}
