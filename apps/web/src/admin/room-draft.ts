import type { PresetDefinition, QuorumUnit } from "./types";

export function quorumDraftFromPreset(preset: PresetDefinition): {
  quorumValue: string;
  quorumUnit: QuorumUnit;
} {
  if (preset.quorumValue === null || preset.quorumUnit === null) {
    return { quorumValue: "", quorumUnit: "percent" };
  }

  return {
    quorumValue: String(preset.quorumValue),
    quorumUnit: preset.quorumUnit,
  };
}

export function inviteUrl(origin: string, invitePath: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}${invitePath}`;
}

export function shortRoomUrl(origin: string, shortCode: string, accessCode?: string): string {
  const base = origin.replace(/\/+$/, "");
  const encodedShortCode = encodeURIComponent(shortCode.trim());
  const normalizedAccessCode = accessCode?.trim();
  if (normalizedAccessCode) {
    return `${base}/s/${encodedShortCode}?c=${encodeURIComponent(normalizedAccessCode)}`;
  }
  return `${base}/s/${encodedShortCode}`;
}

export function displayShortRoomUrl(origin: string, shortCode: string, accessCode?: string): string {
  return shortRoomUrl(origin, shortCode, accessCode).replace(/^https?:\/\//i, "");
}
