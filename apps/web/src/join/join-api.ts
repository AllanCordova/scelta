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
  identity: { displayName: string; joinKey: string },
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

async function readError(response: Response): Promise<JoinRequestError> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; status?: string };
  return new JoinRequestError(response.status, body.error ?? "unknown", body.status);
}
