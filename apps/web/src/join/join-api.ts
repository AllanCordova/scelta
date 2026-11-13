import { JoinRequestError } from "./join-error";

export type JoinPreview = {
  title: string;
  status: string;
  canJoin: boolean;
};

export type JoinResult = {
  title: string;
  status: string;
  displayName: string;
  presentCount: number;
  alreadyJoined: boolean;
};

export type BallotCandidate = {
  id: string;
  displayName: string;
};

export type BallotTally = {
  totalVotes: number;
  nullVotes?: number;
  threshold: number;
  outcome: "elected" | "no_majority";
  winnerId: string | null;
  winnerName: string | null;
  standings: {
    candidateId: string;
    displayName: string;
    votes: number;
  }[];
};

export type BallotRoundState = {
  id: string;
  number: number;
  officeLabel?: string | null;
  officeRoundNumber?: number;
  status: string;
  outcome: string | null;
  restartCount?: number;
  tally?: BallotTally;
};

export type BallotOfficeSummary = {
  officeLabel: string;
  order: number;
  status: string;
  winnerName: string | null;
};

export type BallotState = {
  roomStatus: string;
  candidates: BallotCandidate[];
  offices?: BallotOfficeSummary[];
  round: BallotRoundState | null;
};

export type BallotReceipt = {
  roundId: string;
  roundNumber: number;
  voted: true;
};

export async function fetchJoinPreview(apiBase: string, token: string): Promise<JoinPreview> {
  const response = await fetch(`${apiBase}/v1/join/${encodeURIComponent(token)}`);
  if (!response.ok) {
    throw await readError(response);
  }

  const body = (await response.json()) as Partial<JoinPreview>;
  if (typeof body.title !== "string" || typeof body.status !== "string" || typeof body.canJoin !== "boolean") {
    throw new JoinRequestError(response.status, "invalid_preview");
  }

  return { title: body.title, status: body.status, canJoin: body.canJoin };
}

export async function submitJoin(
  apiBase: string,
  token: string,
  identity: { code: string; joinKey: string },
): Promise<JoinResult> {
  const response = await fetch(`${apiBase}/v1/join/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(identity),
  });
  if (!response.ok) {
    throw await readError(response);
  }

  const body = (await response.json()) as Partial<JoinResult>;
  if (typeof body.title !== "string" || typeof body.displayName !== "string") {
    throw new JoinRequestError(response.status, "invalid_join");
  }

  return {
    title: body.title,
    status: typeof body.status === "string" ? body.status : "",
    displayName: body.displayName,
    presentCount: typeof body.presentCount === "number" ? body.presentCount : 0,
    alreadyJoined: body.alreadyJoined === true,
  };
}

export async function fetchBallotState(
  apiBase: string,
  token: string,
): Promise<BallotState | null> {
  const response = await fetch(`${apiBase}/v1/join/${encodeURIComponent(token)}/ballot`);
  if (!response.ok) {
    return null;
  }

  const body = (await response.json().catch(() => null)) as Partial<BallotState> | null;
  if (!body || !Array.isArray(body.candidates)) {
    return null;
  }

  return {
    roomStatus: typeof body.roomStatus === "string" ? body.roomStatus : "open",
    candidates: body.candidates,
    round: body.round ?? null,
  };
}

export async function fetchVoteReceipt(
  apiBase: string,
  token: string,
  joinKey: string,
): Promise<{ roundId: string | null; hasVoted: boolean } | null> {
  const response = await fetch(
    `${apiBase}/v1/join/${encodeURIComponent(token)}/ballot/receipt`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ joinKey }),
    },
  );
  if (!response.ok) {
    return null;
  }

  const body = (await response.json().catch(() => null)) as {
    roundId?: string | null;
    hasVoted?: boolean;
  } | null;
  if (!body || typeof body.hasVoted !== "boolean") {
    return null;
  }

  return {
    roundId: typeof body.roundId === "string" ? body.roundId : null,
    hasVoted: body.hasVoted,
  };
}

export async function submitBallot(
  apiBase: string,
  token: string,
  payload: { joinKey: string; candidateId: string | null },
): Promise<BallotReceipt> {
  const response = await fetch(`${apiBase}/v1/join/${encodeURIComponent(token)}/ballot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw await readError(response);
  }

  const body = (await response.json()) as { receipt?: BallotReceipt };
  if (!body.receipt || body.receipt.voted !== true) {
    throw new JoinRequestError(response.status, "invalid_receipt");
  }

  return body.receipt;
}

async function readError(response: Response): Promise<JoinRequestError> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; status?: string };
  return new JoinRequestError(response.status, body.error ?? "unknown", body.status);
}
