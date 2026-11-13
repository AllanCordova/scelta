export type QuorumUnit = "absolute" | "percent";

export type QuorumInput = {
  presentCount: number;
  eligibleCount: number;
  quorumValue: number;
  quorumUnit: QuorumUnit;
};

export type QuorumStatus = {
  presentCount: number;
  eligibleCount: number;
  requiredCount: number;
  quorumMet: boolean;
};

export const ROUND_RESULTS = ["failed_quorum", "no_majority", "elected"] as const;
export type RoundResult = (typeof ROUND_RESULTS)[number];

export function resolveQuorumRequired(input: {
  eligibleCount: number;
  quorumValue: number;
  quorumUnit: QuorumUnit;
}): number {
  if (input.quorumValue < 0) {
    throw new Error("quorumValue must be >= 0");
  }

  if (input.eligibleCount < 0) {
    throw new Error("eligibleCount must be >= 0");
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
  return evaluateQuorum(input).quorumMet;
}

export function evaluateQuorum(input: QuorumInput): QuorumStatus {
  if (input.presentCount < 0) {
    throw new Error("presentCount must be >= 0");
  }
  const requiredCount = resolveQuorumRequired(input);
  return {
    presentCount: input.presentCount,
    eligibleCount: input.eligibleCount,
    requiredCount,
    // A non-positive requirement is not a quorum. Percent of an empty eligible
    // list is 0, and that must not count as everyone being present.
    quorumMet: requiredCount > 0 && input.presentCount >= requiredCount,
  };
}

/** Closing below quorum fails the round. Meeting quorum leaves the tally pending. */
export function closeRoundOutcome(quorumMet: boolean): "failed_quorum" | null {
  return quorumMet ? null : "failed_quorum";
}

/** A winner can be published only after a closed round was elected. */
export function canPublishWinner(outcome: RoundResult | null): boolean {
  return outcome === "elected";
}
