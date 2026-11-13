import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { z } from "zod";
import { apiUrl } from "../api-url";
import { validateWithZod, type FieldErrors } from "../forms/validation";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import {
  CLOSE_ROUND_LABEL,
  FAILED_QUORUM_MESSAGE,
  OPEN_ROUND_LABEL,
  PRESET_OPTIONS,
  RESTART_ROUND_LABEL,
  ROOM_TYPE_LABELS,
  ROOM_TYPE_OPTIONS,
  ROUND_RESTARTED_MESSAGE,
  STATUS_LABELS,
  describePreset,
  quorumLabel,
  quorumStateLabel,
  roomErrorMessage,
  roundErrorMessage,
  showsPresence,
} from "./copy";
import { inviteUrl, quorumDraftFromPreset } from "./room-draft";
import {
  RoomRequestError,
  closeRound,
  createRoom,
  deleteRoom,
  fetchPresets,
  listRooms,
  openRound,
  restartRound,
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
  const [status, setStatus] = useState<CreatableRoomStatus>("draft");
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrors<"title" | "quorumValue" | "eligibleCount">
  >({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [roundError, setRoundError] = useState<{ roomId: string; message: string } | null>(null);
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);
  const [pendingDeleteRoom, setPendingDeleteRoom] = useState<RoomSummary | null>(null);
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
    : {
        quorumValue:
          rulesPreset === "ipb_local_officers"
            ? "34"
            : rulesPreset === "ipb_society_board"
              ? "51"
              : "",
        quorumUnit: "percent" as const,
      };
  const quorumValue = quorumOverride?.quorumValue ?? presetDraft.quorumValue;
  const quorumUnit = quorumOverride?.quorumUnit ?? presetDraft.quorumUnit;
  const qrDataUrl = inviteLink && qr?.link === inviteLink ? qr.dataUrl : null;
  const behavior = describePreset(rulesPreset, selectedPreset?.majorityRule);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const validation = validateWithZod(createRoomFormSchema, {
      title,
      quorumValue,
      quorumUnit,
      eligibleCount,
    });
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors);
      setErrorMessage(validation.firstError);
      return;
    }

    setFieldErrors({});
    const eligible = eligiblePayload(eligibleCount);
    if ("error" in eligible) {
      return;
    }

    setIsSubmitting(true);

    const payload = {
      title: validation.data.title,
      roomType,
      rulesPreset,
      status,
      ...quorumPayload(quorumValue, quorumUnit),
      ...eligible,
    };

    try {
      const room = await createRoom(apiBase, payload);
      const link = inviteUrl(window.location.origin, room.invitePath);
      setInviteLink(link);
      setTitle("");
      setListVersion((current) => current + 1);
      toast.success("Sala criada com sucesso.");
    } catch (error) {
      setInviteLink(null);
      if (error instanceof RoomRequestError && error.details.length > 0) {
        const nextFieldErrors: FieldErrors<"title" | "quorumValue" | "eligibleCount"> = {};
        for (const detail of error.details) {
          if (
            detail.field === "title" ||
            detail.field === "quorumValue" ||
            detail.field === "eligibleCount"
          ) {
            nextFieldErrors[detail.field] = roomErrorMessage(error.errorCode, detail.field);
          }
        }
        setFieldErrors(nextFieldErrors);
      }
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
      toast.success("Escrutínio aberto.");
    } catch (error) {
      const msg = messageFromRoundError(error);
      setRoundError({ roomId, message: msg });
      toast.error(msg);
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
      toast.success("Escrutínio encerrado.");
    } catch (error) {
      const msg = messageFromRoundError(error);
      setRoundError({ roomId, message: msg });
      toast.error(msg);
    } finally {
      setBusyRoomId(null);
    }
  }

  async function handleRestartRound(roomId: string, roundId: string) {
    setRoundError(null);
    setBusyRoomId(roomId);
    try {
      const round = await restartRound(apiBase, roomId, roundId);
      setRooms((current) => current.map((item) => (item.id === roomId ? { ...item, round } : item)));
      setListVersion((current) => current + 1);
      toast.success("Escrutínio reiniciado.");
    } catch (error) {
      const msg = messageFromRoundError(error);
      setRoundError({ roomId, message: msg });
      toast.error(msg);
    } finally {
      setBusyRoomId(null);
    }
  }

  async function handleDeleteRoom(roomId: string) {
    setRoundError(null);
    setBusyRoomId(roomId);
    try {
      await deleteRoom(apiBase, roomId);
      setRooms((current) => current.filter((item) => item.id !== roomId));
      setListVersion((current) => current + 1);
      toast.success("Sala excluída.");
    } catch {
      setRoundError({ roomId, message: "Não foi possível excluir a sala." });
      toast.error("Não foi possível excluir a sala.");
    } finally {
      setBusyRoomId(null);
    }
  }

  function handleShowRoomQr(room: RoomSummary) {
    const path = room.invitePath ?? (room.inviteToken ? `/join/${room.inviteToken}` : null);
    if (!path) {
      return;
    }
    const link = inviteUrl(window.location.origin, path);
    setInviteLink(link);
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
        <form className="room-form" onSubmit={handleSubmit} noValidate>
          <div className="field title-field">
            <label>
              Título
              <input
                value={title}
                aria-invalid={Boolean(fieldErrors.title)}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setFieldErrors((current) => ({ ...current, title: undefined }));
                }}
                placeholder="Ex.: Eleição de presbíteros"
              />
            </label>
            {fieldErrors.title ? <span className="field-error">{fieldErrors.title}</span> : null}
          </div>

          <fieldset className="choice-field">
            <legend>Tipo</legend>
            <div className="choice-row">
              {ROOM_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={roomType === option.value ? "choice selected" : "choice"}
                  aria-pressed={roomType === option.value}
                  onClick={() => {
                    setRoomType(option.value);
                    if (option.value === "upa_board" || option.value === "ump_board") {
                      setRulesPreset("ipb_society_board");
                      setQuorumOverride(null);
                    } else if (option.value === "session_board") {
                      setRulesPreset("ipb_local_officers");
                      setQuorumOverride(null);
                    }
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {roomType === "upa_board" || roomType === "ump_board" ? (
              <p className="field-hint">
                Cargos na ordem IPB: Presidente → Vice-Presidente → 1º Secretário → 2º Secretário →
                Tesoureiro.
              </p>
            ) : roomType === "session_board" ? (
              <p className="field-hint">
                Cargos da Mesa do Conselho: Vice-Presidente → Secretário → Tesoureiro.
              </p>
            ) : null}
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
            <div className="field">
              <label>
                Quórum
                <input
                  inputMode="numeric"
                  value={quorumValue}
                  aria-invalid={Boolean(fieldErrors.quorumValue)}
                  onChange={(event) => {
                    setQuorumOverride({ quorumValue: event.target.value, quorumUnit });
                    setFieldErrors((current) => ({ ...current, quorumValue: undefined }));
                  }}
                />
              </label>
              {fieldErrors.quorumValue ? (
                <span className="field-error">{fieldErrors.quorumValue}</span>
              ) : null}
            </div>
            <label>
              Unidade
              <select
                aria-label="Unidade do quórum"
                value={quorumUnit}
                onChange={(event) => {
                  setQuorumOverride({
                    quorumValue,
                    quorumUnit: event.target.value as QuorumUnit,
                  });
                  setFieldErrors((current) => ({ ...current, quorumValue: undefined }));
                }}
              >
                <option value="absolute">Número absoluto</option>
                <option value="percent">Percentual</option>
              </select>
            </label>
          </div>

          <div className="field">
            <label>
              Aptos
              <input
                inputMode="numeric"
                value={eligibleCount}
                placeholder="Opcional"
                aria-invalid={Boolean(fieldErrors.eligibleCount)}
                onChange={(event) => {
                  setEligibleCount(event.target.value);
                  setFieldErrors((current) => ({ ...current, eligibleCount: undefined }));
                }}
              />
            </label>
            {fieldErrors.eligibleCount ? (
              <span className="field-error">{fieldErrors.eligibleCount}</span>
            ) : null}
          </div>

          <p className="field-hint">
            Candidatos: todos os membros comungantes cadastrados na plataforma serão incluídos
            automaticamente.
          </p>

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
          <div className="invite-header">
            <h2>Convite</h2>
            <button type="button" className="ghost round-action" onClick={() => setInviteLink(null)}>
              Fechar
            </button>
          </div>
          <a href={inviteLink}>{inviteLink}</a>
          {qrDataUrl ? <img data-testid="invite-qr" alt="QR do convite" src={qrDataUrl} /> : null}
        </section>
      ) : null}

      <section className="room-list" aria-labelledby="rooms-heading">
        <div className="room-list-header">
          <div>
            <h2 id="rooms-heading">Salas de Escrutínio</h2>
            <p className="muted">Controle de quórum, apuração e status das deliberações</p>
          </div>
        </div>
        {listError ? (
          <p className="form-error" role="alert">
            {listError}
          </p>
        ) : rooms.length === 0 ? (
          <p className="empty">Nenhuma sala ainda.</p>
        ) : (
          <ul className="room-cards-grid" aria-label="Salas">
            {rooms.map((room, index) => (
              <RoomRow
                key={room.id}
                room={room}
                index={index + 1}
                presence={presence[room.id]}
                isBusy={busyRoomId === room.id}
                error={roundError?.roomId === room.id ? roundError.message : null}
                onOpen={() => void handleOpenRound(room.id)}
                onClose={(roundId) => void handleCloseRound(room.id, roundId)}
                onRestart={(roundId) => void handleRestartRound(room.id, roundId)}
                onShowQr={() => handleShowRoomQr(room)}
                onDelete={() => setPendingDeleteRoom(room)}
              />
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={pendingDeleteRoom !== null}
        title="Excluir sala"
        description={
          pendingDeleteRoom
            ? `Tem certeza que deseja excluir a sala "${pendingDeleteRoom.title}"? Essa ação não pode ser desfeita.`
            : ""
        }
        confirmLabel="Excluir"
        busy={Boolean(pendingDeleteRoom && busyRoomId === pendingDeleteRoom.id)}
        onCancel={() => setPendingDeleteRoom(null)}
        onConfirm={() => {
          const target = pendingDeleteRoom;
          setPendingDeleteRoom(null);
          if (target) {
            void handleDeleteRoom(target.id);
          }
        }}
      />
    </div>
  );
}

function RoomRow({
  room,
  index,
  presence,
  isBusy,
  error,
  onOpen,
  onClose,
  onRestart,
  onShowQr,
  onDelete,
}: {
  room: RoomSummary;
  index: number;
  presence: QuorumPresence | undefined;
  isBusy: boolean;
  error: string | null;
  onOpen: () => void;
  onClose: (roundId: string) => void;
  onRestart: (roundId: string) => void;
  onShowQr: () => void;
  onDelete: () => void;
}) {
  const [isCopied, setIsCopied] = useState(false);
  const openRoundId = room.round?.status === "open" ? room.round.id : null;
  const isActive = showsPresence(room.status);
  const roomCode = `SALA-${String(index).padStart(3, "0")}`;
  const roomTypeLabel = room.roomType ? ROOM_TYPE_LABELS[room.roomType] : "Sessão";
  const invitePath = room.invitePath ?? (room.inviteToken ? `/join/${room.inviteToken}` : null);

  const progressPercent =
    presence && presence.requiredCount > 0
      ? Math.min(100, Math.round((presence.presentCount / presence.requiredCount) * 100))
      : presence && presence.presentCount > 0
        ? 100
        : 4;

  async function handleCopyLink() {
    if (!invitePath) {
      return;
    }
    const fullUrl = inviteUrl(window.location.origin, invitePath);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(fullUrl).catch(() => undefined);
    }
    setIsCopied(true);
    toast.success("Link de convite copiado.");
    setTimeout(() => setIsCopied(false), 1800);
  }

  const detailHref = `/admin/salas/${encodeURIComponent(room.id)}`;

  function handleCardClick(event: MouseEvent<HTMLLIElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a")) {
      return;
    }
    window.location.assign(detailHref);
  }

  return (
    <li
      className={isActive ? "card-room active clickable" : "card-room draft clickable"}
      onClick={handleCardClick}
    >
      <div className="room-main">
        <div className="card-room-header">
          <div className="card-room-title-group">
            <a className="room-title room-title-link" href={detailHref}>
              {room.title}
            </a>
            <span className="card-room-subtitle">
              {roomCode} • {roomTypeLabel}
            </span>
          </div>
          <span className={isActive ? "status status-badge active" : "status status-badge"}>
            {isActive ? <span className="status-dot" aria-hidden="true" /> : null}
            {STATUS_LABELS[room.status]}
          </span>
        </div>

        <div className="card-room-body">
          {room.round?.status === "open" && (room.round.restartCount ?? 0) > 0 ? (
            <p className="round-restarted">{ROUND_RESTARTED_MESSAGE}</p>
          ) : null}

          {isActive ? (
            <div className="quorum-block" aria-live="polite">
              <div className="quorum-block-top">
                <span className="quorum-block-label">Presença &amp; Votação</span>
                {presence !== undefined ? (
                  <span
                    className={
                      presence.quorumMet ? "quorum-state badge-met" : "quorum-state badge-below"
                    }
                  >
                    {quorumStateLabel(presence.quorumMet)}
                  </span>
                ) : null}
              </div>
              <div className="presence">
                {presence === undefined ? (
                  "…"
                ) : (
                  <>
                    <span className="presence-count">
                      {quorumLabel(presence.presentCount, presence.requiredCount)}
                    </span>
                    <span className="presence-caption">presentes / mínimo</span>
                  </>
                )}
              </div>
              <div className="quorum-progress-track" aria-hidden="true">
                <div
                  className={
                    presence?.quorumMet ? "quorum-progress-bar met" : "quorum-progress-bar below"
                  }
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          ) : room.status === "closed" ? (
            <div className="draft-room-summary">
              <p className="draft-room-description">Assembleia encerrada.</p>
            </div>
          ) : room.status === "cancelled" ? (
            <div className="draft-room-summary">
              <p className="draft-room-description">Sala cancelada.</p>
            </div>
          ) : (
            <div className="draft-room-summary">
              <p className="draft-room-description">
                Aguardando abertura formal de assembleia. Parâmetros regimentais configurados.
              </p>
              {room.quorumValue !== undefined ? (
                <div className="draft-room-meta">
                  <span>
                    Quórum: {room.quorumValue}
                    {room.quorumUnit === "percent" ? "%" : ""}
                  </span>
                </div>
              ) : null}
            </div>
          )}

          {room.round?.status === "open" ? (
            <p className="round-candidates">
              {room.round.officeRoundNumber ?? room.round.number}º escrutínio
            </p>
          ) : null}

          {room.round?.outcome === "failed_quorum" ? (
            <p className="quorum-failed" role="status">
              {FAILED_QUORUM_MESSAGE}
            </p>
          ) : null}

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="room-meta card-room-footer">
        <div className="room-utility-actions">
          {invitePath ? (
            <>
              <button type="button" className="ghost round-action" onClick={onShowQr}>
                QR Code
              </button>
              <button
                type="button"
                className="ghost round-action"
                onClick={() => void handleCopyLink()}
              >
                {isCopied ? "Link copiado" : "Copiar link"}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="ghost round-action danger-action"
            disabled={isBusy}
            onClick={onDelete}
          >
            Excluir
          </button>
        </div>

        {isActive ? (
          <div className="room-round-actions">
            {openRoundId ? (
              <button
                type="button"
                className="ghost round-action"
                disabled={isBusy}
                onClick={() => onRestart(openRoundId)}
              >
                {RESTART_ROUND_LABEL}
              </button>
            ) : null}
            <button
              type="button"
              className="ghost round-action"
              disabled={isBusy || (!openRoundId && !presence?.quorumMet)}
              title={
                !openRoundId && !presence?.quorumMet
                  ? "Quórum mínimo não atingido para abrir o escrutínio."
                  : undefined
              }
              onClick={() => (openRoundId ? onClose(openRoundId) : onOpen())}
            >
              {openRoundId ? CLOSE_ROUND_LABEL : OPEN_ROUND_LABEL}
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

const createRoomFormSchema = z
  .object({
    title: z.string().trim().min(1, roomErrorMessage("invalid_room", "title")),
    quorumValue: z.string().trim(),
    quorumUnit: z.enum(["absolute", "percent"]),
    eligibleCount: z.string().trim(),
  })
  .superRefine((data, ctx) => {
    if (
      data.quorumValue.length === 0 ||
      !/^\d+$/.test(data.quorumValue) ||
      Number(data.quorumValue) < 1 ||
      (data.quorumUnit === "percent" && Number(data.quorumValue) > 100)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quorumValue"],
        message: roomErrorMessage("invalid_room", "quorumValue"),
      });
    }

    if ("error" in eligiblePayload(data.eligibleCount)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eligibleCount"],
        message: roomErrorMessage("invalid_room", "eligibleCount"),
      });
    }
  });

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
