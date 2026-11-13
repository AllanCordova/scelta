export type MemberSocietyFlags = {
  upaActive?: boolean;
  upaEnrolledAt?: string;
  umpActive?: boolean;
  umpEnrolledAt?: string;
};

export type ValidMemberImportRow = {
  line: number;
  fullName: string;
  isCommunicant: boolean;
  isMale: boolean | null;
  birthDate: string | null;
  photoUrl: string | null;
  societyFlags: MemberSocietyFlags;
};

export type MemberImportRejectionReason =
  | "missing_name"
  | "name_too_long"
  | "invalid_communicant"
  | "invalid_gender"
  | "invalid_birth_date"
  | "invalid_photo_url"
  | "invalid_society_flag"
  | "invalid_society_date"
  | "conflicting_societies";

export type RejectedMemberImportRow = {
  line: number;
  name?: string;
  reason: MemberImportRejectionReason;
};

export type ParsedMemberImport = {
  validRows: ValidMemberImportRow[];
  rejectedRows: RejectedMemberImportRow[];
};

export type MemberImportReport = {
  createdCount: number;
  updatedCount: number;
  rejectedCount: number;
  rejectedRows: RejectedMemberImportRow[];
};

const MAX_NAME_LENGTH = 120;

type ColumnKey =
  | "fullName"
  | "isCommunicant"
  | "isMale"
  | "birthDate"
  | "upaActive"
  | "upaEnrolledAt"
  | "umpActive"
  | "umpEnrolledAt"
  | "photoUrl";

const POSITIONAL_COLUMNS: readonly ColumnKey[] = [
  "fullName",
  "isCommunicant",
  "isMale",
  "birthDate",
  "upaActive",
  "upaEnrolledAt",
  "umpActive",
  "umpEnrolledAt",
  "photoUrl",
];

const HEADER_ALIASES: Record<string, ColumnKey> = {
  fullname: "fullName",
  name: "fullName",
  nome: "fullName",
  nomecompleto: "fullName",
  iscommunicant: "isCommunicant",
  communicant: "isCommunicant",
  comungante: "isCommunicant",
  gender: "isMale",
  sex: "isMale",
  sexo: "isMale",
  ismale: "isMale",
  birthdate: "birthDate",
  nascimento: "birthDate",
  datanascimento: "birthDate",
  upaactive: "upaActive",
  upaativo: "upaActive",
  upaenrolledat: "upaEnrolledAt",
  upaingresso: "upaEnrolledAt",
  upadesde: "upaEnrolledAt",
  umpactive: "umpActive",
  umpativo: "umpActive",
  umpenrolledat: "umpEnrolledAt",
  umpingresso: "umpEnrolledAt",
  umpdesde: "umpEnrolledAt",
  photo: "photoUrl",
  photourl: "photoUrl",
  foto: "photoUrl",
  fotourl: "photoUrl",
  urlfoto: "photoUrl",
  linkfoto: "photoUrl",
  image: "photoUrl",
  imageurl: "photoUrl",
  imagem: "photoUrl",
  linkimagem: "photoUrl",
};

export function parseMemberImportCsv(csvText: string): ParsedMemberImport {
  const rawLines = csvText.split(/\r?\n/);
  const validRows: ValidMemberImportRow[] = [];
  const rejectedRows: RejectedMemberImportRow[] = [];

  let columns: readonly (ColumnKey | null)[] | null = null;

  for (let index = 0; index < rawLines.length; index += 1) {
    const lineText = rawLines[index]?.trim() ?? "";
    if (lineText.length === 0) {
      continue;
    }

    const lineNumber = index + 1;
    const cells = splitCsvLine(lineText);

    if (columns === null) {
      const detected = detectHeaderColumns(cells);
      if (detected) {
        columns = detected;
        continue;
      }
      columns = POSITIONAL_COLUMNS;
    }

    const parsed = parseRow(lineNumber, cells, columns);
    if (parsed.ok) {
      validRows.push(parsed.row);
    } else {
      rejectedRows.push({
        line: lineNumber,
        ...(parsed.name ? { name: parsed.name } : {}),
        reason: parsed.reason,
      });
    }
  }

  return { validRows, rejectedRows };
}

function detectHeaderColumns(cells: readonly string[]): readonly (ColumnKey | null)[] | null {
  const mapped = cells.map((cell) => {
    const key = cell.replace(/[\s_-]+/g, "").toLocaleLowerCase();
    return HEADER_ALIASES[key] ?? null;
  });

  if (mapped.includes("fullName")) {
    return mapped;
  }
  return null;
}

function splitCsvLine(line: string): string[] {
  const delimiter = line.includes(";") && !line.includes(",") ? ";" : ",";
  return line.split(delimiter).map((part) => part.trim());
}

function parseRow(
  line: number,
  cells: readonly string[],
  columns: readonly (ColumnKey | null)[],
):
  | { ok: true; row: ValidMemberImportRow }
  | { ok: false; name?: string; reason: MemberImportRejectionReason } {
  const byKey = new Map<ColumnKey, string>();
  for (let i = 0; i < columns.length; i += 1) {
    const col = columns[i];
    if (col) {
      byKey.set(col, cells[i]?.trim() ?? "");
    }
  }

  const fullName = (byKey.get("fullName") ?? "").replace(/\s+/g, " ").trim();
  if (fullName.length === 0) {
    return { ok: false, reason: "missing_name" };
  }
  if (fullName.length > MAX_NAME_LENGTH) {
    return { ok: false, name: fullName, reason: "name_too_long" };
  }

  const communicantRaw = byKey.get("isCommunicant") ?? "";
  const isCommunicant = communicantRaw.length === 0 ? true : parseBooleanFlag(communicantRaw);
  if (isCommunicant === null) {
    return { ok: false, name: fullName, reason: "invalid_communicant" };
  }

  const genderRaw = byKey.get("isMale") ?? "";
  const isMale = genderRaw.length === 0 ? null : parseGenderFlag(genderRaw);
  if (genderRaw.length > 0 && isMale === null) {
    return { ok: false, name: fullName, reason: "invalid_gender" };
  }

  const birthDateRaw = byKey.get("birthDate") ?? "";
  const birthDate = birthDateRaw.length === 0 ? null : parseIsoDate(birthDateRaw);
  if (birthDateRaw.length > 0 && birthDate === null) {
    return { ok: false, name: fullName, reason: "invalid_birth_date" };
  }

  const upa = parseSocietyPair(byKey, "upaActive", "upaEnrolledAt");
  if (!upa.ok) {
    return { ok: false, name: fullName, reason: upa.reason };
  }

  const ump = parseSocietyPair(byKey, "umpActive", "umpEnrolledAt");
  if (!ump.ok) {
    return { ok: false, name: fullName, reason: ump.reason };
  }

  if (hasConflictingSocietyFlags({ upaActive: upa.active, umpActive: ump.active })) {
    return { ok: false, name: fullName, reason: "conflicting_societies" };
  }

  const photoParsed = parsePhotoUrl(byKey.get("photoUrl") ?? "");
  if (!photoParsed.ok) {
    return { ok: false, name: fullName, reason: "invalid_photo_url" };
  }

  const societyFlags: MemberSocietyFlags = {
    ...(upa.active === undefined ? {} : { upaActive: upa.active }),
    ...(upa.enrolledAt === undefined ? {} : { upaEnrolledAt: upa.enrolledAt }),
    ...(ump.active === undefined ? {} : { umpActive: ump.active }),
    ...(ump.enrolledAt === undefined ? {} : { umpEnrolledAt: ump.enrolledAt }),
  };

  return {
    ok: true,
    row: {
      line,
      fullName,
      isCommunicant,
      isMale,
      birthDate,
      photoUrl: photoParsed.value,
      societyFlags,
    },
  };
}

function parseSocietyPair(
  byKey: ReadonlyMap<ColumnKey, string>,
  activeKey: ColumnKey,
  enrolledKey: ColumnKey,
):
  | { ok: true; active?: boolean; enrolledAt?: string }
  | { ok: false; reason: "invalid_society_flag" | "invalid_society_date" } {
  const activeRaw = byKey.get(activeKey) ?? "";
  const active = activeRaw.length === 0 ? undefined : parseBooleanFlag(activeRaw);
  if (activeRaw.length > 0 && active === null) {
    return { ok: false, reason: "invalid_society_flag" };
  }

  const enrolledRaw = byKey.get(enrolledKey) ?? "";
  const enrolledAt = enrolledRaw.length === 0 ? undefined : parseIsoDate(enrolledRaw);
  if (enrolledRaw.length > 0 && enrolledAt === null) {
    return { ok: false, reason: "invalid_society_date" };
  }

  return {
    ok: true,
    ...(active === undefined || active === null ? {} : { active }),
    ...(enrolledAt === undefined || enrolledAt === null ? {} : { enrolledAt }),
  };
}

function parseBooleanFlag(value: string): boolean | null {
  const normalized = value.trim().toLocaleLowerCase();
  if (["true", "1", "yes", "y", "sim", "s"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "nao", "não"].includes(normalized)) {
    return false;
  }
  return null;
}

function parseGenderFlag(value: string): boolean | null {
  const normalized = value.trim().toLocaleLowerCase();
  if (["m", "male", "masculino", "homem", "true", "1"].includes(normalized)) {
    return true;
  }
  if (["f", "female", "feminino", "mulher", "false", "0"].includes(normalized)) {
    return false;
  }
  return null;
}

const MAX_HTTP_PHOTO_URL_LENGTH = 2048;
const MAX_DATA_PHOTO_URL_LENGTH = 12_000_000;
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i;

export function hasConflictingSocietyFlags(flags: {
  upaActive?: boolean;
  umpActive?: boolean;
}): boolean {
  return flags.upaActive === true && flags.umpActive === true;
}

export function parsePhotoUrl(
  value: string | null | undefined,
): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined) {
    return { ok: true, value: null };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  if (trimmed.startsWith("data:")) {
    if (trimmed.length > MAX_DATA_PHOTO_URL_LENGTH || !IMAGE_DATA_URL_PATTERN.test(trimmed)) {
      return { ok: false };
    }
    return { ok: true, value: trimmed };
  }
  if (trimmed.length > MAX_HTTP_PHOTO_URL_LENGTH) {
    return { ok: false };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false };
    }
    return { ok: true, value: trimmed };
  } catch {
    return { ok: false };
  }
}

export function parseIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  const parts = trimmed.split("-").map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  const day = parts[2]!;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return trimmed;
}
