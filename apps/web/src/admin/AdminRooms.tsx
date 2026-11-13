import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { apiUrl } from "../api-url";
import {
  CLOSE_ROUND_LABEL,
  FAILED_QUORUM_MESSAGE,
  OPEN_ROUND_LABEL,
  PRESET_OPTIONS,
  ROOM_TYPE_OPTIONS,
  STATUS_LABELS,
  activeCandidatesLabel,
  describePreset,
  quorumLabel,
  quorumStateLabel,
  roomErrorMessage,
  roundErrorMessage,
  showsPresence,
  standingLabel,
  tallySummaryLabel,
} from "./copy";
import { inviteUrl, quorumDraftFromPreset } from "./room-draft";
import {
  RoomRequestError,
  closeRound,
  createRoom,
  fetchPresets,
  listRooms,
  openRound,
} from "./rooms-api";
import type { QuorumPresence } from "./presence-event";
import type {
  CreatableRoomStatus,
  PresetDefinition,
  QuorumUnit,
  RoomSummary,
  RoomType,
  RulesPreset,
} from "./types";
import { useRoomPresence } from "./use-room-presence";

const apiBase = apiUrl("");

export function AdminRooms() {
  const [presets, setPresets] = useState<PresetDefinition[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [title, setTitle] = useState("");
  const [roomType, setRoomType] = useState<RoomType>("elder");
  const [rulesPreset, setRulesPreset] = useState<RulesPreset>("ipb_local_officers");
  const [quorumOverride, setQuorumOverride] = useState<{
    quorumValue: string;
    quorumUnit: QuorumUnit;
  } | null>(null);
  const [eligibleCount, setEligibleCount] = useState("");
  const [candidatesInput, setCandidatesInput] = useState("");
  const [status, setStatus] = useState<CreatableRoomStatus>("draft");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [roundError, setRoundError] = useState<{ roomId: string; message: string } | null>(null);
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [qr, setQr] = useState<{ link: string; dataUrl: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  const presence = useRoomPresence(rooms);

  useEffect(() => {
    let cancelled = false;

    void fetchPresets(apiBase)
      .then((nextPresets) => {
        if (!cancelled) {
          setPresets(nextPresets);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErrorMessage("Não foi possível carregar os conjuntos de regras.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listRooms(apiBase)
      .then((nextRooms) => {
        if (!cancelled) {
          setRooms(nextRooms);
          setListError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setListError(messageFromError(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [listVersion]);

  useEffect(() => {
    if (!inviteLink) {
      return;
    }

    let cancelled = false;
    void QRCode.toDataURL(inviteLink, { margin: 1, width: 180 })
      .then((dataUrl) => {
        if (!cancelled) {
          setQr({ link: inviteLink, dataUrl });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQr(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [inviteLink]);

  const selectedPreset = presets.find((item) => item.preset === rulesPreset);
  const presetDraft = selectedPreset
    ? quorumDraftFromPreset(selectedPreset)
    : { quorumValue: "", quorumUnit: "percent" as const };
  const quorumValue = quorumOverride?.quorumValue ?? presetDraft.quorumValue;
  const quorumUnit = quorumOverride?.quorumUnit ?? presetDraft.quorumUnit;
  const qrDataUrl = inviteLink && qr?.link === inviteLink ? qr.dataUrl : null;
  const behavior = describePreset(rulesPreset, selectedPreset?.majorityRule);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (quorumValue.trim().length === 0 || Number.isNaN(Number(quorumValue))) {
      setErrorMessage(roomErrorMessage("invalid_room", "quorumValue"));
      return;
    }

    const eligible = eligiblePayload(eligibleCount);
    if ("error" in eligible) {
      setErrorMessage(roomErrorMessage("invalid_room", "eligibleCount"));
      return;
    }

    const candidates = candidatesPayload(candidatesInput);
    if ("error" in candidates) {
      setErrorMessage(roomErrorMessage("invalid_room", "candidates"));
      return;
    }

    setIsSubmitting(true);

    const payload = {
      title,
      roomType,
      rulesPreset,
      status,
      ...quorumPayload(quorumValue, quorumUnit),
      ...eligible,
      ...candidates,
    };

    try {
      const room = await createRoom(apiBase, payload);
      const link = inviteUrl(window.location.origin, room.invitePath);
      setInviteLink(link);
      setTitle("");
      setCandidatesInput("");
      setListVersion((current) => current + 1);
    } catch (error) {
      setInviteLink(null);
      setErrorMessage(messageFromError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleOpenRound(roomId: string) {
    setRoundError(null);
    setBusyRoomId(roomId);
    try {
      const round = await openRound(apiBase, roomId);
      setRooms((current) => current.map((item) => (item.id === roomId ? { ...item, round } : item)));
      setListVersion((current) => current + 1);
    } catch (error) {
      setRoundError({ roomId, message: messageFromRoundError(error) });
    } finally {
      setBusyRoomId(null);
    }
  }

  async function handleCloseRound(roomId: string, roundId: string) {
    setRoundError(null);
    setBusyRoomId(roomId);
    try {
      const round = await closeRound(apiBase, roomId, roundId);
      setRooms((current) => current.map((item) => (item.id === roomId ? { ...item, round } : item)));
      setListVersion((current) => current + 1);
    } catch (error) {
      setRoundError({ roomId, message: messageFromRoundError(error) });
    } finally {
      setBusyRoomId(null);
    }
  }

  return (
    <div className="admin-page">
      <header className="page-intro">
        <h1>Nova sala</h1>
        <p className="lede">Título, ofício, regras e quórum. O convite aparece depois de criar.</p>
      </header>

      <section className="panel" aria-labelledby="admin-rooms-heading">
        <h2 id="admin-rooms-heading" className="sr-only">
          Formulário
        </h2>
        <form className="room-form" onSubmit={handleSubmit}>
          <label className="title-field">
            Título
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Eleição de presbíteros"
              required
            />
          </label>

          <fieldset className="choice-field">
            <legend>Tipo</legend>
            <div className="choice-row">
              {ROOM_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={roomType === option.value ? "choice selected" : "choice"}
                  aria-pressed={roomType === option.value}
                  onClick={() => setRoomType(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="choice-field">
            <legend>Regras</legend>
            <div className="choice-row">
              {PRESET_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={rulesPreset === option.value ? "choice selected" : "choice"}
                  aria-pressed={rulesPreset === option.value}
                  onClick={() => {
                    setRulesPreset(option.value);
                    setQuorumOverride(null);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="preset-behavior">
              {behavior.majority} {behavior.rounds}
            </p>
          </fieldset>

          <div className="quorum-row">
            <label>
              Quórum
              <input
                inputMode="numeric"
                value={quorumValue}
                onChange={(event) =>
                  setQuorumOverride({ quorumValue: event.target.value, quorumUnit })
                }
              />
            </label>
            <label>
              Unidade
              <select
                aria-label="Unidade do quórum"
                value={quorumUnit}
                onChange={(event) =>
                  setQuorumOverride({
                    quorumValue,
                    quorumUnit: event.target.value as QuorumUnit,
                  })
                }
              >
                <option value="absolute">Número absoluto</option>
                <option value="percent">Percentual</option>
              </select>
            </label>
          </div>

          <label>
            Aptos
            <input
              inputMode="numeric"
              value={eligibleCount}
              placeholder="Opcional"
              onChange={(event) => setEligibleCount(event.target.value)}
            />
          </label>

          <label>
            Candidatos
            <input
              value={candidatesInput}
              placeholder="Opcional (ex.: Paulo, Silas)"
              onChange={(event) => setCandidatesInput(event.target.value)}
            />
          </label>

          <fieldset className="choice-field">
            <legend>Situação</legend>
            <div className="choice-row compact">
              <button
                type="button"
                className={status === "draft" ? "choice selected" : "choice"}
                aria-pressed={status === "draft"}
                onClick={() => setStatus("draft")}
              >
                Rascunho
              </button>
              <button
                type="button"
                className={status === "open" ? "choice selected" : "choice"}
                aria-pressed={status === "open"}
                onClick={() => setStatus("open")}
              >
                Aberta
              </button>
            </div>
          </fieldset>

          {errorMessage ? (
            <p className="form-error" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <button type="submit" disabled={isSubmitting}>
            Criar sala
          </button>
        </form>
      </section>

      {inviteLink ? (
        <section className="invite panel" aria-label="Convite">
          <h2>Convite</h2>
          <a href={inviteLink}>{inviteLink}</a>
          {qrDataUrl ? <img data-testid="invite-qr" alt="QR do convite" src={qrDataUrl} /> : null}
        </section>
      ) : null}

      <section className="room-list" aria-labelledby="rooms-heading">
        <h2 id="rooms-heading">Salas</h2>
        {listError ? (
          <p className="form-error" role="alert">
            {listError}
          </p>
        ) : rooms.length === 0 ? (
          <p className="empty">Nenhuma sala ainda.</p>
        ) : (
          <ul aria-label="Salas">
            {rooms.map((room) => (
              <RoomRow
                key={room.id}
                room={room}
                presence={presence[room.id]}
                isBusy={busyRoomId === room.id}
                error={roundError?.roomId === room.id ? roundError.message : null}
                onOpen={() => void handleOpenRound(room.id)}
                onClose={(roundId) => void handleCloseRound(room.id, roundId)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RoomRow({
  room,
  presence,
  isBusy,
  error,
  onOpen,
  onClose,
}: {
  room: RoomSummary;
  presence: QuorumPresence | undefined;
  isBusy: boolean;
  error: string | null;
  onOpen: () => void;
  onClose: (roundId: string) => void;
}) {
  const openRoundId = room.round?.status === "open" ? room.round.id : null;

  return (
    <li>
      <div className="room-main">
        <span className="room-title">{room.title}</span>
        {room.round?.status === "open" && room.candidates && room.candidates.length > 0 ? (
          <p className="round-candidates">
            {activeCandidatesLabel(
              room.round.number,
              room.candidates.map((item) => item.displayName),
            )}
          </p>
        ) : null}
        {room.round?.outcome === "failed_quorum" ? (
          <p className="quorum-failed" role="status">
            {FAILED_QUORUM_MESSAGE}
          </p>
        ) : null}
        {room.round?.tally ? (
          <div className="round-tally" role="status">
            <p className="tally-outcome">{tallySummaryLabel(room.round.tally)}</p>
            <ul className="tally-standings" aria-label="Apuração">
              {room.round.tally.standings.map((item) => (
                <li key={item.candidateId}>{standingLabel(item.displayName, item.votes)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="room-meta">
        {showsPresence(room.status) ? (
          <>
            <span className="presence" aria-live="polite">
              {presence === undefined ? (
                "…"
              ) : (
                <>
                  <span className="presence-count">
                    {quorumLabel(presence.presentCount, presence.requiredCount)}
                  </span>
                  <span className="quorum-state">{quorumStateLabel(presence.quorumMet)}</span>
                </>
              )}
            </span>
            <button
              type="button"
              className="ghost round-action"
              disabled={isBusy}
              onClick={() => (openRoundId ? onClose(openRoundId) : onOpen())}
            >
              {openRoundId ? CLOSE_ROUND_LABEL : OPEN_ROUND_LABEL}
            </button>
          </>
        ) : null}
        <span className="status">{STATUS_LABELS[room.status]}</span>
      </div>
    </li>
  );
}

function quorumPayload(quorumValue: string, quorumUnit: QuorumUnit) {
  const trimmed = quorumValue.trim();
  if (trimmed.length === 0) {
    return {};
  }

  return {
    quorumValue: Number(trimmed),
    quorumUnit,
  };
}

function eligiblePayload(
  value: string,
): { eligibleCount: number } | { error: true } | Record<string, never> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return {};
  }
  if (!/^\d+$/.test(trimmed)) {
    return { error: true };
  }

  const count = Number(trimmed);
  if (count > 100_000) {
    return { error: true };
  }

  return { eligibleCount: count };
}

function candidatesPayload(
  value: string,
): { candidates: string[] } | { error: true } | Record<string, never> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return {};
  }

  const names = trimmed.split(",").map((part) => part.trim());
  if (names.length > 50) {
    return { error: true };
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (name.length === 0 || name.length > 120) {
      return { error: true };
    }
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) {
      return { error: true };
    }
    seen.add(key);
  }

  return { candidates: names };
}

function messageFromError(error: unknown): string {
  if (error instanceof RoomRequestError) {
    const field = error.details[0]?.field;
    return roomErrorMessage(error.errorCode, field);
  }

  return roomErrorMessage("unknown");
}

function messageFromRoundError(error: unknown): string {
  if (error instanceof RoomRequestError) {
    return roundErrorMessage(error.errorCode);
  }

  return roundErrorMessage("unknown");
}
