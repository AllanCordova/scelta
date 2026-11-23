import { useId, useState } from "react";
import { toast } from "sonner";
import type { RoundPaperTally } from "./types";

export type PaperTallyCandidate = {
  id: string;
  displayName: string;
  isEligible?: boolean;
};

export type PaperTallyFormValue = {
  ballotCount: number;
  blankVotes: number;
  nullVotes: number;
  candidateVotes: Record<string, number>;
};

export type PaperTallyPanelProps = {
  candidates: readonly PaperTallyCandidate[];
  paperVotersCount: number;
  vacancies?: number;
  initialTally?: RoundPaperTally | null;
  disabled?: boolean;
  onSave: (payload: PaperTallyFormValue) => Promise<void>;
};

type PaperTallyValidation =
  | { valid: true; totalMarks: number; candidateSum: number; validBallots: number }
  | { valid: false; totalMarks: number; candidateSum: number; validBallots: number; message: string };

function parseCountInput(raw: string): number {
  if (raw.trim() === "") {
    return 0;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : -1;
}

function validatePaperTallyForm(
  value: PaperTallyFormValue,
  paperVotersCount: number,
  eligibleCandidateIds: readonly string[],
  vacancies = 1,
): PaperTallyValidation {
  const candidateSum = eligibleCandidateIds.reduce(
    (sum, id) => sum + (value.candidateVotes[id] ?? 0),
    0,
  );
  const totalMarks = candidateSum + value.blankVotes + value.nullVotes;
  const validBallots = Math.max(0, value.ballotCount - value.blankVotes - value.nullVotes);

  if (
    value.ballotCount < 0 ||
    value.blankVotes < 0 ||
    value.nullVotes < 0 ||
    eligibleCandidateIds.some((id) => (value.candidateVotes[id] ?? 0) < 0)
  ) {
    return {
      valid: false,
      totalMarks,
      candidateSum,
      validBallots,
      message: "Todos os campos devem ser números inteiros não negativos.",
    };
  }

  if (value.ballotCount > paperVotersCount) {
    return {
      valid: false,
      totalMarks,
      candidateSum,
      validBallots,
      message: `O total de cédulas de papel (${value.ballotCount}) excede os eleitores em papel (${paperVotersCount}).`,
    };
  }

  if (value.blankVotes + value.nullVotes > value.ballotCount) {
    return {
      valid: false,
      totalMarks,
      candidateSum,
      validBallots,
      message: "A soma de votos em branco e nulos excede o total de cédulas de papel.",
    };
  }

  if (vacancies > 1) {
    if (eligibleCandidateIds.some((id) => (value.candidateVotes[id] ?? 0) > validBallots)) {
      return {
        valid: false,
        totalMarks,
        candidateSum,
        validBallots,
        message: `Nenhum candidato pode receber mais votos do que as cédulas válidas (${validBallots}).`,
      };
    }
    const maxAllowedMarks = vacancies * validBallots;
    if (candidateSum > maxAllowedMarks) {
      return {
        valid: false,
        totalMarks,
        candidateSum,
        validBallots,
        message: `O total de marcações (${candidateSum}) excede o máximo permitido (${maxAllowedMarks} para ${validBallots} cédulas válidas × ${vacancies} vagas).`,
      };
    }
    return { valid: true, totalMarks, candidateSum, validBallots };
  }

  if (candidateSum !== value.ballotCount - value.blankVotes - value.nullVotes) {
    return {
      valid: false,
      totalMarks,
      candidateSum,
      validBallots,
      message: `A soma dos votos (${totalMarks}) deve ser igual ao total de cédulas (${value.ballotCount}).`,
    };
  }

  return { valid: true, totalMarks, candidateSum, validBallots };
}

function formatRecordedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildInitialCandidateInputs(
  candidates: readonly PaperTallyCandidate[],
  initialTally?: RoundPaperTally | null,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const candidate of candidates) {
    const count = initialTally?.candidateVotes?.[candidate.id] ?? 0;
    next[candidate.id] = String(count);
  }
  return next;
}

export function PaperTallyPanel({
  candidates,
  paperVotersCount,
  vacancies = 1,
  initialTally,
  disabled = false,
  onSave,
}: PaperTallyPanelProps) {
  const headingId = useId();
  const ballotCountId = useId();
  const blankVotesId = useId();
  const nullVotesId = useId();

  const eligibleCandidates = candidates.filter((candidate) => candidate.isEligible !== false);

  const [ballotCountInput, setBallotCountInput] = useState(() =>
    String(initialTally?.ballotCount ?? 0),
  );
  const [blankVotesInput, setBlankVotesInput] = useState(() =>
    String(initialTally?.blankVotes ?? 0),
  );
  const [nullVotesInput, setNullVotesInput] = useState(() =>
    String(initialTally?.nullVotes ?? 0),
  );
  const [candidateInputs, setCandidateInputs] = useState<Record<string, string>>(() =>
    buildInitialCandidateInputs(eligibleCandidates, initialTally),
  );
  const [isBusy, setIsBusy] = useState(false);

  const parsedCandidateVotes: Record<string, number> = {};
  for (const candidate of eligibleCandidates) {
    parsedCandidateVotes[candidate.id] = parseCountInput(candidateInputs[candidate.id] ?? "0");
  }

  const formValue: PaperTallyFormValue = {
    ballotCount: parseCountInput(ballotCountInput),
    blankVotes: parseCountInput(blankVotesInput),
    nullVotes: parseCountInput(nullVotesInput),
    candidateVotes: parsedCandidateVotes,
  };

  const validation = validatePaperTallyForm(
    formValue,
    paperVotersCount,
    eligibleCandidates.map((candidate) => candidate.id),
    vacancies,
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isBusy || disabled || !validation.valid) {
      return;
    }
    setIsBusy(true);
    try {
      await onSave(formValue);
      toast.success("Totais da urna de papel salvos.");
    } catch {
      toast.error("Não foi possível salvar os totais da urna de papel.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section
      className="panel paper-tally-panel"
      aria-labelledby={headingId}
      data-testid="paper-tally-panel"
    >
      <div className="audit-feed-header">
        <div>
          <h2 id={headingId}>Urna de Papel</h2>
          <p className="muted">
            Informe os totais apurados das cédulas físicas ({paperVotersCount}{" "}
            {paperVotersCount === 1 ? "eleitor em papel" : "eleitores em papel"}).
          </p>
        </div>
        <span className="detail-kpi-pill">Papel: {paperVotersCount}</span>
      </div>

      {initialTally ? (
        <p className="muted" data-testid="paper-tally-provenance">
          Último lançamento por <strong>{initialTally.recordedByName ?? "Administrador"}</strong> às{" "}
          {formatRecordedAt(initialTally.updatedAt)}.
        </p>
      ) : null}

      <form className="paper-tally-form" onSubmit={(event) => void handleSubmit(event)}>
        <div className="paper-tally-grid">
          <div className="field">
            <label htmlFor={ballotCountId}>Cédulas de papel</label>
            <input
              id={ballotCountId}
              type="number"
              min={0}
              max={paperVotersCount}
              step={1}
              value={ballotCountInput}
              disabled={isBusy || disabled}
              data-testid="paper-ballot-count-input"
              onChange={(event) => setBallotCountInput(event.target.value)}
            />
          </div>

          {eligibleCandidates.map((candidate) => {
            const inputId = `${headingId}-cand-${candidate.id}`;
            return (
              <div key={candidate.id} className="field">
                <label htmlFor={inputId}>{candidate.displayName}</label>
                <input
                  id={inputId}
                  type="number"
                  min={0}
                  step={1}
                  value={candidateInputs[candidate.id] ?? "0"}
                  disabled={isBusy || disabled}
                  data-testid="paper-candidate-votes-input"
                  data-candidate-id={candidate.id}
                  aria-label={`Votos em papel — ${candidate.displayName}`}
                  onChange={(event) =>
                    setCandidateInputs((current) => ({
                      ...current,
                      [candidate.id]: event.target.value,
                    }))
                  }
                />
              </div>
            );
          })}

          <div className="field">
            <label htmlFor={blankVotesId}>Brancos (papel)</label>
            <input
              id={blankVotesId}
              type="number"
              min={0}
              step={1}
              value={blankVotesInput}
              disabled={isBusy || disabled}
              data-testid="paper-blank-votes-input"
              onChange={(event) => setBlankVotesInput(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor={nullVotesId}>Nulos (papel)</label>
            <input
              id={nullVotesId}
              type="number"
              min={0}
              step={1}
              value={nullVotesInput}
              disabled={isBusy || disabled}
              data-testid="paper-null-votes-input"
              onChange={(event) => setNullVotesInput(event.target.value)}
            />
          </div>
        </div>

        <p
          className={validation.valid ? "muted" : "field-error"}
          role="status"
          data-testid="paper-tally-validation"
        >
          {validation.valid
            ? vacancies > 1
              ? `Marcações nos candidatos: ${validation.candidateSum} (máx. ${vacancies * validation.validBallots} para ${validation.validBallots} cédulas válidas × ${vacancies} vagas).`
              : `Soma conferida: ${validation.totalMarks} de ${formValue.ballotCount} cédulas (máximo ${paperVotersCount} eleitores em papel).`
            : validation.message}
        </p>

        <div className="paper-tally-actions">
          <button
            type="submit"
            className="round-action"
            data-testid="save-paper-tally-btn"
            disabled={isBusy || disabled || !validation.valid}
          >
            Salvar totais do papel
          </button>
        </div>
      </form>
    </section>
  );
}
