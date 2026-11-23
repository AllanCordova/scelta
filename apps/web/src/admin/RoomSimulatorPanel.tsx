import { useRef, useState } from "react";
import { z } from "zod";
import { apiUrl } from "../api-url";
import { validateWithZod } from "../forms/validation";
import { submitBallot, submitJoin } from "../join/join-api";
import { createJoinKey } from "../join/join-identity";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { createSimulatedAccessCodes, removeParticipants } from "./rooms-api";
import type { RoomDetail } from "./types";

const apiBase = apiUrl("");

type SimulatedVoter = {
  joinKey: string;
  displayName: string;
  votedRoundIds: Set<string>;
};

const simCountSchema = z.object({
  simCount: z
    .string()
    .trim()
    .refine(
      (val) => /^\d+$/.test(val) && Number(val) >= 1 && Number(val) <= 50,
      "Informe um número entre 1 e 50.",
    ),
});

/**
 * Self-contained assembly simulator panel rendered exclusively for rooms in `test` status.
 */
export function RoomSimulatorPanel({
  room,
  onChanged,
  onActionError,
}: {
  room: RoomDetail;
  onChanged: () => void;
  onActionError: (message: string | null) => void;
}) {
  const [simCountInput, setSimCountInput] = useState("5");
  const [simCountError, setSimCountError] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simProgress, setSimProgress] = useState<string | null>(null);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const simulatedVotersRef = useRef<SimulatedVoter[]>([]);

  function validateSimulationCount(): number | null {
    const validation = validateWithZod(simCountSchema, { simCount: simCountInput });
    if (!validation.ok) {
      setSimCountError(validation.firstError);
      onActionError(validation.firstError);
      return null;
    }
    setSimCountError(null);
    return Number.parseInt(validation.data.simCount, 10);
  }

  async function handleSimulateJoin() {
    if (isSimulating) {
      return;
    }
    const targetCount = validateSimulationCount();
    if (targetCount === null) {
      return;
    }
    onActionError(null);
    setIsSimulating(true);
    try {
      setSimProgress(`Gerando ${targetCount} códigos simulados…`);
      const simCodes = await createSimulatedAccessCodes(apiBase, room.id, targetCount);
      for (let i = 0; i < simCodes.length; i += 1) {
        const simCode = simCodes[i]!;
        const joinKey = createJoinKey();
        setSimProgress(`Entrando ${i + 1} / ${simCodes.length}…`);
        await submitJoin(apiBase, room.inviteToken, { code: simCode.code, joinKey });
        simulatedVotersRef.current.push({
          joinKey,
          displayName: simCode.displayName,
          votedRoundIds: new Set(),
        });
        onChanged();
      }
      setSimProgress(`${simCodes.length} participantes simulados entraram na sala.`);
    } catch {
      onActionError("Não foi possível simular a entrada de participantes.");
      setSimProgress(null);
    } finally {
      setIsSimulating(false);
    }
  }

  async function handleSimulateRemove() {
    if (isSimulating) {
      return;
    }
    const targetCount = validateSimulationCount();
    if (targetCount === null) {
      return;
    }
    onActionError(null);
    setIsSimulating(true);
    try {
      const { removedCount } = await removeParticipants(apiBase, room.id, targetCount);
      if (removedCount > 0) {
        simulatedVotersRef.current.splice(-removedCount, removedCount);
      }
      onChanged();
      setSimProgress(
        removedCount === 0
          ? "Nenhum participante presente para remover."
          : `${removedCount} participantes removidos da presença.`,
      );
    } catch {
      onActionError("Não foi possível remover participantes.");
      setSimProgress(null);
    } finally {
      setIsSimulating(false);
    }
  }

  async function handleSimulateVotes() {
    if (isSimulating) {
      return;
    }
    const currentRound = room.round;
    const roomCandidates = room.candidates ?? [];
    if (roomCandidates.length === 0) {
      onActionError("Cadastre candidatos na sala antes de simular votos.");
      return;
    }
    if (!currentRound || currentRound.status !== "open") {
      onActionError("Abra o escrutínio antes de simular votos.");
      return;
    }

    const roundInstanceId = `${currentRound.id}:${currentRound.restartCount ?? 0}`;
    const targetCount = validateSimulationCount();
    if (targetCount === null) {
      return;
    }
    onActionError(null);
    setIsSimulating(true);
    try {
      const pendingVoters = simulatedVotersRef.current.filter(
        (voter) => !voter.votedRoundIds.has(roundInstanceId),
      );
      if (pendingVoters.length < targetCount) {
        const needed = targetCount - pendingVoters.length;
        setSimProgress(`Gerando ${needed} códigos simulados…`);
        const simCodes = await createSimulatedAccessCodes(apiBase, room.id, needed);
        for (let i = 0; i < simCodes.length; i += 1) {
          const simCode = simCodes[i]!;
          const joinKey = createJoinKey();
          setSimProgress(`Preparando fila ${i + 1} / ${simCodes.length}…`);
          await submitJoin(apiBase, room.inviteToken, { code: simCode.code, joinKey });
          const voter: SimulatedVoter = {
            joinKey,
            displayName: simCode.displayName,
            votedRoundIds: new Set(),
          };
          simulatedVotersRef.current.push(voter);
          pendingVoters.push(voter);
        }
      }
      const votersToCast = pendingVoters.slice(0, targetCount);
      for (let i = 0; i < votersToCast.length; i += 1) {
        const voter = votersToCast[i]!;
        const randomCandidate =
          roomCandidates[Math.floor(Math.random() * roomCandidates.length)]!;
        setSimProgress(`Votando ${i + 1} / ${votersToCast.length}…`);
        await submitBallot(apiBase, room.inviteToken, {
          joinKey: voter.joinKey,
          candidateId: randomCandidate.id,
        });
        voter.votedRoundIds.add(roundInstanceId);
        onChanged();
      }
      setSimProgress(`${votersToCast.length} votos aleatórios computados.`);
    } catch {
      onActionError("Não foi possível simular os votos.");
      setSimProgress(null);
    } finally {
      setIsSimulating(false);
    }
  }

  return (
    <section className="panel simulator-card" aria-labelledby="simulator-heading">
      <div className="simulator-header">
        <h2 id="simulator-heading">Simulador de Assembleia (Teste)</h2>
        <p className="muted">
          Disponível exclusivamente em salas de Teste. Simula participantes entrando na fila e
          votando aleatoriamente em candidatos.
        </p>
      </div>
      <div className="simulator-controls">
        <div className="field">
          <label className="simulator-count-label">
            Participantes
            <input
              type="text"
              inputMode="numeric"
              value={simCountInput}
              aria-invalid={Boolean(simCountError)}
              disabled={isSimulating}
              onChange={(event) => {
                setSimCountInput(event.target.value);
                setSimCountError(null);
              }}
            />
          </label>
          {simCountError ? <span className="field-error">{simCountError}</span> : null}
        </div>
        <div className="simulator-buttons">
          <button
            type="button"
            className="ghost round-action"
            disabled={isSimulating}
            onClick={() => void handleSimulateJoin()}
          >
            Simular entrada
          </button>
          <button
            type="button"
            className="ghost round-action danger-action"
            disabled={isSimulating || room.presence.presentCount === 0}
            onClick={() => setConfirmRemoveOpen(true)}
          >
            Remover participantes
          </button>
          <button
            type="button"
            className="round-action"
            disabled={isSimulating}
            onClick={() => void handleSimulateVotes()}
          >
            Simular votos
          </button>
        </div>
      </div>
      {simProgress ? (
        <p className="simulator-status" role="status">
          {simProgress}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmRemoveOpen}
        title="Remover participantes"
        description="Tem certeza que deseja remover os participantes presentes da sala?"
        confirmLabel="Remover participantes"
        tone="danger"
        busy={isSimulating}
        onCancel={() => setConfirmRemoveOpen(false)}
        onConfirm={() => {
          setConfirmRemoveOpen(false);
          void handleSimulateRemove();
        }}
      />
    </section>
  );
}
