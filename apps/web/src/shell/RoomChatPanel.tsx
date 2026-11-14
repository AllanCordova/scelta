import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiUrl } from "../api-url";
import { connectPresenceSocket } from "../admin/presence-socket";
import { updateRoom } from "../admin/rooms-api";
import {
  ChatRequestError,
  fetchAdminChat,
  fetchVoterChat,
  sendAdminChat,
  sendVoterChat,
  setParticipantMute,
  type ChatMessageItem,
  type ChatParticipantItem,
} from "./chat-api";

const apiBase = apiUrl("");
const DEFAULT_EMOTES = ["👏", "🙏", "❤️", "👍", "🎉"];

type RoomChatPanelProps =
  | {
      mode: "voter";
      roomId: string;
      token: string;
      joinKey: string;
      initialChatMuted?: boolean;
    }
  | {
      mode: "admin";
      roomId: string;
      initialChatMuted?: boolean;
      onRoomUpdated?: () => void;
    };

function chatErrorMessage(code: string): string {
  switch (code) {
    case "chat_rate_limited":
      return "Limite de 2 mensagens a cada 5 segundos. Aguarde um instante.";
    case "room_chat_muted":
      return "O chat desta sala foi silenciado pelo administrador.";
    case "participant_muted":
      return "Você foi silenciado pelo administrador.";
    case "chat_message_too_long":
      return "Mensagem muito longa (máximo de 280 caracteres).";
    case "invalid_chat_message":
      return "Digite uma mensagem antes de enviar.";
    default:
      return "Não foi possível enviar a mensagem.";
  }
}

export function RoomChatPanel(props: RoomChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [allowedEmotes, setAllowedEmotes] = useState<string[]>(DEFAULT_EMOTES);
  const [chatMuted, setChatMuted] = useState<boolean>(props.initialChatMuted ?? false);
  const [participantMuted, setParticipantMuted] = useState(false);
  const [participants, setParticipants] = useState<ChatParticipantItem[]>([]);
  const [isModerationOpen, setIsModerationOpen] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const isMobileOpenRef = useRef(isMobileOpen);

  useEffect(() => {
    isMobileOpenRef.current = isMobileOpen;
  }, [isMobileOpen]);

  const mode = props.mode;
  const roomId = props.roomId;
  const voterToken = mode === "voter" ? props.token : null;
  const voterJoinKey = mode === "voter" ? props.joinKey : null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (mode === "admin") {
          const data = await fetchAdminChat(apiBase, roomId);
          if (!cancelled) {
            setMessages(data.messages);
            setChatMuted(data.chatMuted);
            setAllowedEmotes(data.allowedEmotes);
            setParticipants(data.participants);
          }
        } else if (voterToken) {
          const data = await fetchVoterChat(apiBase, voterToken, voterJoinKey ?? undefined);
          if (!cancelled) {
            setMessages(data.messages);
            setChatMuted(data.chatMuted);
            setParticipantMuted(data.participantMuted);
            setAllowedEmotes(data.allowedEmotes);
          }
        }
      } catch {
        // Keep panel usable even if initial chat fetch fails in isolated tests
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [mode, roomId, voterToken, voterJoinKey]);

  useEffect(() => {
    if (!roomId) {
      return;
    }
    const socket = connectPresenceSocket();
    const joinChannel = () => {
      socket.emit("room:join", roomId);
    };
    socket.on("connect", joinChannel);
    if (socket.connected) {
      joinChannel();
    }

    const onChatMessage = (payload: ChatMessageItem & { roomId?: string }) => {
      if (payload.roomId && payload.roomId !== roomId) {
        return;
      }
      setMessages((current) => {
        if (current.some((item) => item.id === payload.id)) {
          return current;
        }
        return [...current.slice(-99), payload];
      });
      if (!isMobileOpenRef.current) {
        setUnreadCount((count) => count + 1);
      }
    };

    const onChatConfig = (payload: {
      roomId?: string;
      chatMuted?: boolean;
      mutedParticipantId?: string;
      participantChatMuted?: boolean;
    }) => {
      if (payload.roomId && payload.roomId !== roomId) {
        return;
      }
      if (typeof payload.chatMuted === "boolean") {
        setChatMuted(payload.chatMuted);
      }
      if (payload.mutedParticipantId && typeof payload.participantChatMuted === "boolean") {
        setParticipants((current) =>
          current.map((p) =>
            p.id === payload.mutedParticipantId
              ? { ...p, chatMuted: payload.participantChatMuted! }
              : p,
          ),
        );
        if (mode === "voter" && voterToken && voterJoinKey) {
          void fetchVoterChat(apiBase, voterToken, voterJoinKey)
            .then((data) => setParticipantMuted(data.participantMuted))
            .catch(() => undefined);
        }
      }
    };

    socket.on("chat:message", onChatMessage);
    socket.on("chat:config", onChatConfig);

    return () => {
      socket.off("connect", joinChannel);
      socket.off("chat:message", onChatMessage);
      socket.off("chat:config", onChatConfig);
      socket.disconnect();
    };
  }, [roomId, mode, voterToken, voterJoinKey]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages.length, isMobileOpen]);

  async function sendContent(content: string) {
    if (isSending) {
      return;
    }
    setErrorMessage(null);
    setIsSending(true);
    try {
      const sent =
        props.mode === "admin"
          ? await sendAdminChat(apiBase, props.roomId, content)
          : await sendVoterChat(apiBase, props.token, { joinKey: props.joinKey, content });
      setMessages((current) => {
        if (current.some((item) => item.id === sent.id)) {
          return current;
        }
        return [...current.slice(-99), sent];
      });
      setDraft("");
    } catch (error) {
      if (error instanceof ChatRequestError) {
        if (error.code === "room_chat_muted") {
          setChatMuted(true);
        }
        if (error.code === "participant_muted") {
          setParticipantMuted(true);
        }
        setErrorMessage(chatErrorMessage(error.code));
      } else {
        setErrorMessage("Não foi possível enviar a mensagem.");
      }
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) {
      return;
    }
    void sendContent(draft);
  }

  async function handleToggleRoomMute() {
    if (props.mode !== "admin") {
      return;
    }
    setErrorMessage(null);
    const nextMuted = !chatMuted;
    try {
      await updateRoom(apiBase, props.roomId, { chatMuted: nextMuted });
      setChatMuted(nextMuted);
      props.onRoomUpdated?.();
    } catch {
      setErrorMessage("Não foi possível atualizar o silenciamento da sala.");
    }
  }

  async function handleToggleParticipantMute(participant: ChatParticipantItem) {
    if (props.mode !== "admin") {
      return;
    }
    setErrorMessage(null);
    try {
      const updated = await setParticipantMute(
        apiBase,
        props.roomId,
        participant.id,
        !participant.chatMuted,
      );
      setParticipants((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch {
      setErrorMessage("Não foi possível silenciar este participante.");
    }
  }

  async function handleOpenModeration() {
    const next = !isModerationOpen;
    setIsModerationOpen(next);
    if (next && props.mode === "admin") {
      try {
        const data = await fetchAdminChat(apiBase, props.roomId);
        setParticipants(data.participants);
      } catch {
        // ignore
      }
    }
  }

  const isVoterBlocked = props.mode === "voter" && (chatMuted || participantMuted);

  return (
    <>
      <button
        type="button"
        className="room-chat-fab"
        aria-label={isMobileOpen ? "Fechar chat ao vivo" : "Abrir chat ao vivo"}
        onClick={() => {
          setIsMobileOpen((open) => {
            const next = !open;
            if (next) {
              setUnreadCount(0);
            }
            return next;
          });
        }}
      >
        <span>💬 Chat</span>
        {unreadCount > 0 && !isMobileOpen ? (
          <span className="room-chat-fab-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
        ) : null}
      </button>

      <aside
        className={`panel room-chat-sidebar ${isMobileOpen ? "is-open" : ""}`}
        aria-label="Chat ao vivo da sala"
      >
        <div className="room-chat-header">
          <div>
            <h2>Chat ao vivo</h2>
            <p className="room-chat-subtitle">
              {chatMuted
                ? "Sala silenciada pelo admin"
                : participantMuted
                  ? "Você está silenciado"
                  : "Mensagens e emotes (máx. 2 a cada 5s)"}
            </p>
          </div>
          <div className="room-chat-header-actions">
            {props.mode === "admin" ? (
              <>
                <button
                  type="button"
                  className="ghost room-chat-mod-btn"
                  onClick={() => void handleToggleRoomMute()}
                >
                  {chatMuted ? "Liberar sala" : "Silenciar sala"}
                </button>
                <button
                  type="button"
                  className="ghost room-chat-mod-btn"
                  aria-expanded={isModerationOpen}
                  onClick={() => void handleOpenModeration()}
                >
                  Pessoas ({participants.length})
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="ghost room-chat-close-mobile"
              aria-label="Fechar chat"
              onClick={() => setIsMobileOpen(false)}
            >
              ×
            </button>
          </div>
        </div>

        {props.mode === "admin" && isModerationOpen ? (
          <div className="room-chat-moderation-list" aria-label="Moderação por participante">
            {participants.length === 0 ? (
              <p className="muted">Nenhum participante conectado no chat.</p>
            ) : (
              participants.map((participant) => (
                <div key={participant.id} className="room-chat-moderation-row">
                  <span className="room-chat-moderation-name">{participant.displayName}</span>
                  <button
                    type="button"
                    className="ghost room-chat-mod-btn"
                    onClick={() => void handleToggleParticipantMute(participant)}
                  >
                    {participant.chatMuted ? "Liberar" : "Silenciar"}
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}

        <div ref={feedRef} className="room-chat-feed" aria-live="polite">
          {messages.length === 0 ? (
            <p className="muted room-chat-empty">Nenhuma mensagem ainda. Diga olá!</p>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`room-chat-message ${message.senderRole === "admin" ? "is-admin" : ""}`}
              >
                <div className="room-chat-message-meta">
                  <strong>{message.senderName}</strong>
                  {message.senderRole === "admin" ? (
                    <span className="room-chat-admin-tag">Admin</span>
                  ) : null}
                </div>
                <p className="room-chat-message-text">{message.content}</p>
              </div>
            ))
          )}
        </div>

        {errorMessage ? (
          <p className="field-error room-chat-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="room-chat-emotes" role="group" aria-label="Emotes rápidos">
          {allowedEmotes.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="ghost room-chat-emote-btn"
              aria-label={`Enviar emote ${emoji}`}
              disabled={isSending || isVoterBlocked}
              onClick={() => void sendContent(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>

        <form className="room-chat-form" onSubmit={handleSubmit}>
          <input
            type="text"
            value={draft}
            maxLength={280}
            aria-label="Mensagem no chat"
            placeholder={
              isVoterBlocked
                ? chatMuted
                  ? "Chat da sala silenciado"
                  : "Você está silenciado"
                : "Escreva uma mensagem..."
            }
            disabled={isSending || isVoterBlocked}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" disabled={isSending || isVoterBlocked || !draft.trim()}>
            Enviar
          </button>
        </form>
      </aside>
    </>
  );
}
