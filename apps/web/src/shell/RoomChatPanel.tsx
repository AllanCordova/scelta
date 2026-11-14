import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { apiUrl } from "../api-url";
import { connectPresenceSocket } from "../admin/presence-socket";
import { updateRoom } from "../admin/rooms-api";
import {
  ChatRequestError,
  deleteAdminChatMessage,
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

const chatDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatChatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return chatDateFormatter.format(date).replace(",", "");
}

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
      return "O chat foi silenciado pelo administrador.";
    case "participant_muted":
      return "Você foi silenciado pelo administrador.";
    case "chat_message_too_long":
      return "Mensagem muito longa (máximo de 280 caracteres).";
    case "room_not_joinable":
      return "A sala não está aberta para mensagens.";
    default:
      return "Não foi possível enviar a mensagem.";
  }
}

function MuteIcon({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M11 5 6 9H2v6h4l5 4V5Z" />
        <line x1="22" y1="9" x2="16" y2="15" />
        <line x1="16" y1="9" x2="22" y2="15" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function FullscreenIcon({ active }: { active: boolean }) {
  if (active) {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M8 3v3a2 2 0 0 1-2 2H3" />
        <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
        <path d="M3 16h3a2 2 0 0 1 2 2v3" />
        <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </svg>
  );
}

export function RoomChatPanel(props: RoomChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [allowedEmotes, setAllowedEmotes] = useState<string[]>(DEFAULT_EMOTES);
  const [chatMuted, setChatMuted] = useState<boolean>(Boolean(props.initialChatMuted));
  const [participantMuted, setParticipantMuted] = useState(false);
  const [currentParticipantId, setCurrentParticipantId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ChatParticipantItem[]>([]);
  const [isModerationOpen, setIsModerationOpen] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const isMobileOpenRef = useRef(isMobileOpen);
  const chatMutedRef = useRef(chatMuted);
  const participantMutedRef = useRef(participantMuted);

  useEffect(() => {
    isMobileOpenRef.current = isMobileOpen;
  }, [isMobileOpen]);

  useEffect(() => {
    chatMutedRef.current = chatMuted;
  }, [chatMuted]);

  useEffect(() => {
    participantMutedRef.current = participantMuted;
  }, [participantMuted]);

  useEffect(() => {
    if (!isFullscreen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen]);

  const mode = props.mode;
  const roomId = props.roomId;
  const voterToken = mode === "voter" ? props.token : null;
  const voterJoinKey = mode === "voter" ? props.joinKey : null;

  const refreshParticipants = useCallback(async () => {
    if (mode !== "admin" || !roomId) {
      return;
    }
    try {
      const data = await fetchAdminChat(apiBase, roomId);
      setParticipants(data.participants);
    } catch {
      // ignore transient refresh failures
    }
  }, [mode, roomId]);

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
            setCurrentParticipantId(data.currentParticipantId);
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
      if (mode === "admin" && payload.senderParticipantId) {
        void refreshParticipants();
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
        if (mode === "voter" && chatMutedRef.current !== payload.chatMuted) {
          if (payload.chatMuted) {
            toast.warning("Sala silenciada pelo administrador.");
          } else {
            toast.success("Chat da sala liberado.");
          }
        }
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
            .then((data) => {
              if (participantMutedRef.current !== data.participantMuted) {
                if (data.participantMuted) {
                  toast.warning("Você foi silenciado pelo administrador.");
                } else {
                  toast.success("Você foi liberado para enviar mensagens.");
                }
              }
              setParticipantMuted(data.participantMuted);
            })
            .catch(() => undefined);
        }
      }
    };

    const onChatDeleted = (payload: { roomId?: string; messageId?: string }) => {
      if (payload.roomId && payload.roomId !== roomId) {
        return;
      }
      if (payload.messageId) {
        setMessages((current) => current.filter((item) => item.id !== payload.messageId));
      }
    };

    const onPresence = (payload: { roomId?: string }) => {
      if (payload.roomId && payload.roomId !== roomId) {
        return;
      }
      if (mode === "admin") {
        void refreshParticipants();
      }
    };

    socket.on("chat:message", onChatMessage);
    socket.on("chat:config", onChatConfig);
    socket.on("chat:deleted", onChatDeleted);
    socket.on("presence", onPresence);

    return () => {
      socket.off("connect", joinChannel);
      socket.off("chat:message", onChatMessage);
      socket.off("chat:config", onChatConfig);
      socket.off("chat:deleted", onChatDeleted);
      socket.off("presence", onPresence);
      socket.disconnect();
    };
  }, [roomId, mode, voterToken, voterJoinKey, refreshParticipants]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages.length, isMobileOpen, isFullscreen]);

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
    const nextMuted = !chatMuted;
    try {
      await updateRoom(apiBase, props.roomId, { chatMuted: nextMuted });
      setChatMuted(nextMuted);
      if (nextMuted) {
        toast.warning("Sala silenciada. Votantes não podem enviar mensagens.");
      } else {
        toast.success("Sala liberada para mensagens.");
      }
      props.onRoomUpdated?.();
    } catch {
      toast.error("Não foi possível atualizar o silenciamento da sala.");
    }
  }

  async function handleToggleParticipantMute(participant: ChatParticipantItem) {
    if (props.mode !== "admin") {
      return;
    }
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
      if (updated.chatMuted) {
        toast.warning(`${updated.displayName} silenciado(a) no chat.`);
      } else {
        toast.success(`${updated.displayName} liberado(a) no chat.`);
      }
    } catch {
      toast.error("Não foi possível atualizar o participante.");
    }
  }

  async function handleDeleteMessage(messageId: string) {
    if (props.mode !== "admin") {
      return;
    }
    try {
      await deleteAdminChatMessage(apiBase, props.roomId, messageId);
      setMessages((current) => current.filter((item) => item.id !== messageId));
      toast.success("Mensagem removida.");
    } catch {
      toast.error("Não foi possível remover a mensagem.");
    }
  }

  async function handleOpenModeration() {
    const next = !isModerationOpen;
    setIsModerationOpen(next);
    if (next && props.mode === "admin") {
      await refreshParticipants();
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

      {isFullscreen ? (
        <div
          className="room-chat-fullscreen-backdrop"
          aria-hidden="true"
          onClick={() => setIsFullscreen(false)}
        />
      ) : null}

      <aside
        className={`panel room-chat-sidebar ${isMobileOpen ? "is-open" : ""} ${isFullscreen ? "is-fullscreen" : ""}`}
        aria-label="Chat ao vivo da sala"
      >
        <div className="room-chat-header">
          <div>
            <h2>Chat ao vivo</h2>
            <p className="room-chat-subtitle">Ao vivo • máx. 2 msgs a cada 5s</p>
          </div>
          <div className="room-chat-header-actions">
            {props.mode === "admin" ? (
              <>
                <button
                  type="button"
                  className={`ghost room-chat-icon-btn room-chat-mute-btn ${chatMuted ? "is-muted" : ""}`}
                  aria-label={chatMuted ? "Liberar sala" : "Silenciar sala"}
                  title={chatMuted ? "Liberar sala" : "Silenciar sala"}
                  onClick={() => void handleToggleRoomMute()}
                >
                  <MuteIcon muted={chatMuted} />
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
              className="ghost room-chat-icon-btn"
              aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
              title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
              onClick={() => setIsFullscreen((value) => !value)}
            >
              <FullscreenIcon active={isFullscreen} />
            </button>
            <button
              type="button"
              className="ghost room-chat-close-mobile"
              aria-label="Fechar chat"
              onClick={() => {
                setIsMobileOpen(false);
                setIsFullscreen(false);
              }}
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
                    className={`ghost room-chat-icon-btn room-chat-mute-btn ${participant.chatMuted ? "is-muted" : ""}`}
                    aria-label={participant.chatMuted ? "Liberar" : "Silenciar"}
                    title={participant.chatMuted ? "Liberar participante" : "Silenciar participante"}
                    onClick={() => void handleToggleParticipantMute(participant)}
                  >
                    <MuteIcon muted={participant.chatMuted} />
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
            messages.map((message) => {
              const isOwn =
                props.mode === "admin"
                  ? message.senderRole === "admin"
                  : Boolean(
                      currentParticipantId && message.senderParticipantId === currentParticipantId,
                    );
              const formattedDate = formatChatDate(message.createdAt);
              return (
                <div
                  key={message.id}
                  className={`room-chat-message ${isOwn ? "is-own" : "is-other"} ${message.senderRole === "admin" ? "is-admin" : ""}`}
                >
                  <div className="room-chat-message-meta">
                    <strong>{isOwn ? "Você" : message.senderName}</strong>
                    {message.senderRole === "admin" ? (
                      <span className="room-chat-admin-tag">Admin</span>
                    ) : null}
                    {props.mode === "admin" ? (
                      <button
                        type="button"
                        className="ghost room-chat-delete-btn"
                        aria-label="Remover mensagem"
                        title="Remover mensagem"
                        onClick={() => void handleDeleteMessage(message.id)}
                      >
                        <TrashIcon />
                      </button>
                    ) : null}
                  </div>
                  <p className="room-chat-message-text">{message.content}</p>
                  {formattedDate ? (
                    <time className="room-chat-message-time" dateTime={message.createdAt}>
                      {formattedDate}
                    </time>
                  ) : null}
                </div>
              );
            })
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
              disabled={isSending || isVoterBlocked}
              aria-label={`Enviar emote ${emoji}`}
              onClick={() => void sendContent(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>

        <form className="room-chat-composer" onSubmit={handleSubmit}>
          <input
            type="text"
            value={draft}
            maxLength={280}
            disabled={isSending || isVoterBlocked}
            placeholder={
              chatMuted && props.mode === "voter"
                ? "Sala silenciada pelo admin"
                : participantMuted && props.mode === "voter"
                  ? "Você está silenciado"
                  : "Escreva uma mensagem..."
            }
            aria-label="Mensagem no chat"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            disabled={isSending || isVoterBlocked || draft.trim().length === 0}
          >
            Enviar
          </button>
        </form>
      </aside>
    </>
  );
}
