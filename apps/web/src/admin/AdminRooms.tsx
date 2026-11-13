import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { apiUrl } from "../api-url";
import { PRESET_OPTIONS, ROOM_TYPE_OPTIONS, STATUS_LABELS, describePreset, roomErrorMessage } from "./copy";
import { inviteUrl, quorumDraftFromPreset } from "./room-draft";
import { RoomRequestError, createRoom, fetchPresets, listRooms } from "./rooms-api";
import type { PresetDefinition, QuorumUnit, RoomStatus, RoomSummary, RoomType, RulesPreset } from "./types";

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
  const [status, setStatus] = useState<RoomStatus>("draft");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [qr, setQr] = useState<{ link: string; dataUrl: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [listVersion, setListVersion] = useState(0);

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

    setIsSubmitting(true);

    const payload = {
      title,
      roomType,
      rulesPreset,
      status,
      ...quorumPayload(quorumValue, quorumUnit),
    };

    try {
      const room = await createRoom(apiBase, payload);
      const link = inviteUrl(window.location.origin, room.invitePath);
      setInviteLink(link);
      setTitle("");
      setListVersion((current) => current + 1);
    } catch (error) {
      setInviteLink(null);
      setErrorMessage(messageFromError(error));
    } finally {
      setIsSubmitting(false);
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
              <li key={room.id}>
                <span>{room.title}</span>
                <span className="status">{STATUS_LABELS[room.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
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

function messageFromError(error: unknown): string {
  if (error instanceof RoomRequestError) {
    const field = error.details[0]?.field;
    return roomErrorMessage(error.errorCode, field);
  }

  return roomErrorMessage("unknown");
}
