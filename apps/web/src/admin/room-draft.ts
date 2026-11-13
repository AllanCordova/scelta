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
  const base = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  return `${base}${invitePath}`;
}
