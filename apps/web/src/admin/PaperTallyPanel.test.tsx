import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperTallyPanel, type PaperTallyCandidate } from "./PaperTallyPanel";

const candidates: PaperTallyCandidate[] = [
  { id: "cand-1", displayName: "Paulo Apóstolo", isEligible: true },
  { id: "cand-2", displayName: "Silas", isEligible: true },
  { id: "cand-3", displayName: "Inelegível", isEligible: false },
];

describe("PaperTallyPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders eligible candidates, validates sums live, and submits valid paper tally", async () => {
    const onSave = vi.fn(async () => undefined);

    render(
      <PaperTallyPanel
        candidates={candidates}
        paperVotersCount={3}
        initialTally={null}
        onSave={onSave}
      />,
    );

    expect(screen.getByTestId("paper-tally-panel")).toBeInTheDocument();
    expect(screen.getByText("Papel: 3")).toBeInTheDocument();

    const candidateInputs = screen.getAllByTestId("paper-candidate-votes-input");
    expect(candidateInputs).toHaveLength(2);
    expect(screen.queryByLabelText(/Inelegível/)).not.toBeInTheDocument();

    const saveBtn = screen.getByTestId("save-paper-tally-btn");
    expect(saveBtn).toBeEnabled();

    fireEvent.change(screen.getByTestId("paper-ballot-count-input"), { target: { value: "4" } });
    expect(saveBtn).toBeDisabled();
    expect(screen.getByTestId("paper-tally-validation")).toHaveTextContent(/excede/i);

    fireEvent.change(screen.getByTestId("paper-ballot-count-input"), { target: { value: "3" } });
    expect(saveBtn).toBeDisabled();
    expect(screen.getByTestId("paper-tally-validation")).toHaveTextContent(/deve ser igual/i);

    fireEvent.change(candidateInputs[0]!, { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("paper-blank-votes-input"), { target: { value: "1" } });
    expect(saveBtn).toBeEnabled();
    expect(screen.getByTestId("paper-tally-validation")).toHaveTextContent(
      /Soma conferida: 3 de 3 cédulas/i,
    );

    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        ballotCount: 3,
        blankVotes: 1,
        nullVotes: 0,
        candidateVotes: {
          "cand-1": 2,
          "cand-2": 0,
        },
      });
    });
  });

  it("displays initialTally values and provenance", () => {
    render(
      <PaperTallyPanel
        candidates={candidates}
        paperVotersCount={2}
        initialTally={{
          id: "pt-1",
          roundId: "round-1",
          ballotCount: 2,
          blankVotes: 0,
          nullVotes: 1,
          candidateVotes: { "cand-1": 1, "cand-2": 0 },
          recordedByAdminId: "admin-1",
          recordedByName: "Secretário João",
          recordedAt: "2026-11-19T12:00:00.000Z",
          updatedAt: "2026-11-19T12:05:00.000Z",
        }}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByTestId("paper-tally-provenance")).toHaveTextContent("Secretário João");
    expect(screen.getByTestId("paper-ballot-count-input")).toHaveValue(2);
    expect(screen.getByTestId("paper-null-votes-input")).toHaveValue(1);
    const candidateInputs = screen.getAllByTestId("paper-candidate-votes-input");
    expect(candidateInputs[0]).toHaveValue(1);
    expect(candidateInputs[1]).toHaveValue(0);
  });

  it("validates multi-vacancy paper marks <= N * validBallots and per-candidate <= validBallots", async () => {
    const onSave = vi.fn(async () => undefined);
    const multiCandidates: PaperTallyCandidate[] = [
      { id: "c1", displayName: "Cand 1", isEligible: true },
      { id: "c2", displayName: "Cand 2", isEligible: true },
      { id: "c3", displayName: "Cand 3", isEligible: true },
      { id: "c4", displayName: "Cand 4", isEligible: true },
    ];

    render(
      <PaperTallyPanel
        candidates={multiCandidates}
        paperVotersCount={3}
        vacancies={3}
        initialTally={null}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByTestId("paper-ballot-count-input"), { target: { value: "2" } });
    const inputs = screen.getAllByTestId("paper-candidate-votes-input");
    const saveBtn = screen.getByTestId("save-paper-tally-btn");

    // 3 marks on a single candidate when validBallots is 2 -> invalid
    fireEvent.change(inputs[0]!, { target: { value: "3" } });
    expect(saveBtn).toBeDisabled();
    expect(screen.getByTestId("paper-tally-validation")).toHaveTextContent(
      /mais votos do que as cédulas válidas \(2\)/i,
    );

    // 2 + 2 + 2 + 1 = 7 marks > 3 * 2 = 6 -> invalid
    fireEvent.change(inputs[0]!, { target: { value: "2" } });
    fireEvent.change(inputs[1]!, { target: { value: "2" } });
    fireEvent.change(inputs[2]!, { target: { value: "2" } });
    fireEvent.change(inputs[3]!, { target: { value: "1" } });
    expect(saveBtn).toBeDisabled();
    expect(screen.getByTestId("paper-tally-validation")).toHaveTextContent(/excede o máximo/i);

    // 2 + 2 + 1 + 0 = 5 <= 6 -> valid
    fireEvent.change(inputs[2]!, { target: { value: "1" } });
    fireEvent.change(inputs[3]!, { target: { value: "0" } });
    expect(saveBtn).toBeEnabled();
    expect(screen.getByTestId("paper-tally-validation")).toHaveTextContent(
      /Marcações nos candidatos: 5 \(máx\. 6 para 2 cédulas válidas × 3 vagas\)/i,
    );

    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        ballotCount: 2,
        blankVotes: 0,
        nullVotes: 0,
        candidateVotes: { c1: 2, c2: 2, c3: 1, c4: 0 },
      });
    });
  });
});
