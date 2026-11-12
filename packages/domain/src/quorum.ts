export type QuorumUnit = "absolute" | "percent";

export type QuorumInput = {
  presentCount: number;
  eligibleCount: number;
  quorumValue: number;
  quorumUnit: QuorumUnit;
};

export function resolveQuorumRequired(input: {
  eligibleCount: number;
  quorumValue: number;
  quorumUnit: QuorumUnit;
}): number {
  if (input.quorumValue < 0) {
    throw new Error("quorumValue must be >= 0");
  }

  if (input.quorumUnit === "absolute") {
    return Math.ceil(input.quorumValue);
  }

  if (input.quorumValue > 100) {
    throw new Error("percent quorumValue must be <= 100");
  }

  return Math.ceil((input.eligibleCount * input.quorumValue) / 100);
}

export function hasReachedQuorum(input: QuorumInput): boolean {
  const required = resolveQuorumRequired(input);
  return input.presentCount >= required;
}
