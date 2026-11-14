export type ChatMessageItem = {
  id: string;
  senderName: string;
  senderRole: "voter" | "admin";
  senderParticipantId?: string | null;
  content: string;
  createdAt: string;
};

export type ChatParticipantItem = {
  id: string;
  displayName: string;
  isPresent: boolean;
  chatMuted: boolean;
  joinedAt: string;
};

export type VoterChatState = {
  roomId: string;
  chatMuted: boolean;
  participantMuted: boolean;
  currentParticipantId: string | null;
  allowedEmotes: string[];
  messages: ChatMessageItem[];
};

export type AdminChatState = {
  roomId: string;
  chatMuted: boolean;
  allowedEmotes: string[];
  messages: ChatMessageItem[];
  participants: ChatParticipantItem[];
};

export class ChatRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export async function fetchVoterChat(
  apiBase: string,
  token: string,
  joinKey?: string,
): Promise<VoterChatState> {
  const qs = joinKey ? `?joinKey=${encodeURIComponent(joinKey)}` : "";
  const response = await fetch(`${apiBase}/v1/join/${encodeURIComponent(token)}/chat${qs}`);
  const body = (await response.json().catch(() => ({}))) as Partial<VoterChatState> & {
    error?: string;
  };
  if (!response.ok || !Array.isArray(body.messages)) {
    throw new ChatRequestError(response.status, body.error ?? "unknown");
  }
  return {
    roomId: typeof body.roomId === "string" ? body.roomId : "",
    chatMuted: body.chatMuted === true,
    participantMuted: body.participantMuted === true,
    currentParticipantId:
      typeof body.currentParticipantId === "string" ? body.currentParticipantId : null,
    allowedEmotes: Array.isArray(body.allowedEmotes) ? body.allowedEmotes : ["👏", "🙏", "❤️", "👍", "🎉"],
    messages: body.messages,
  };
}

export async function sendVoterChat(
  apiBase: string,
  token: string,
  payload: { joinKey: string; content: string },
): Promise<ChatMessageItem> {
  const response = await fetch(`${apiBase}/v1/join/${encodeURIComponent(token)}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as {
    message?: ChatMessageItem;
    error?: string;
  };
  if (!response.ok || !body.message) {
    throw new ChatRequestError(response.status, body.error ?? "unknown");
  }
  return body.message;
}

export async function fetchAdminChat(apiBase: string, roomId: string): Promise<AdminChatState> {
  const response = await fetch(`${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/chat`, {
    credentials: "include",
  });
  const body = (await response.json().catch(() => ({}))) as Partial<AdminChatState> & {
    error?: string;
  };
  if (!response.ok || !Array.isArray(body.messages)) {
    throw new ChatRequestError(response.status, body.error ?? "unknown");
  }
  return {
    roomId: typeof body.roomId === "string" ? body.roomId : roomId,
    chatMuted: body.chatMuted === true,
    allowedEmotes: Array.isArray(body.allowedEmotes) ? body.allowedEmotes : ["👏", "🙏", "❤️", "👍", "🎉"],
    messages: body.messages,
    participants: Array.isArray(body.participants) ? body.participants : [],
  };
}

export async function sendAdminChat(
  apiBase: string,
  roomId: string,
  content: string,
): Promise<ChatMessageItem> {
  const response = await fetch(`${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/chat`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    message?: ChatMessageItem;
    error?: string;
  };
  if (!response.ok || !body.message) {
    throw new ChatRequestError(response.status, body.error ?? "unknown");
  }
  return body.message;
}

export async function setParticipantMute(
  apiBase: string,
  roomId: string,
  participantId: string,
  chatMuted: boolean,
): Promise<ChatParticipantItem> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(participantId)}/mute`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatMuted }),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    participant?: ChatParticipantItem;
    error?: string;
  };
  if (!response.ok || !body.participant) {
    throw new ChatRequestError(response.status, body.error ?? "unknown");
  }
  return body.participant;
}

export async function deleteAdminChatMessage(
  apiBase: string,
  roomId: string,
  messageId: string,
): Promise<void> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/chat/${encodeURIComponent(messageId)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ChatRequestError(response.status, body.error ?? "unknown");
  }
}
