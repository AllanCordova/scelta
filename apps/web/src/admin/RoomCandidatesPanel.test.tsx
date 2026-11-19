import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RoomCandidatesPanel,
  type RoomCandidateView,
} from "./RoomCandidatesPanel";
import type { AvailableMemberOption } from "./RoomRosterPanel";

const sampleCandidates: RoomCandidateView[] = [
  {
    id: "cand-1",
    memberId: "member-1",
    displayName: "Paulo Apóstolo",
    isEligible: true,
  },
  {
    id: "cand-2",
    memberId: null,
    displayName: "Silas Visitante",
    isEligible: false,
  },
];

const availableMembers: AvailableMemberOption[] = [
  { id: "member-4", fullName: "Timóteo Silva" },
  { id: "member-5", fullName: "Tito Oliveira" },
];

describe("RoomCandidatesPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders header, count badge, and candidate rows", () => {
    render(
      <RoomCandidatesPanel
        candidates={sampleCandidates}
        availableMembers={availableMembers}
        isLocked={false}
        onAddCandidate={vi.fn(async () => undefined)}
        onRemoveCandidate={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByRole("heading", { name: "Gerenciar candidatos" })).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByTestId("candidates-locked-notice")).not.toBeInTheDocument();

    const rows = screen.getAllByTestId("candidate-manage-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Paulo Apóstolo")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Silas Visitante")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Avulso")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Inelegível")).toBeInTheDocument();
  });

  it("adds a candidate by name and from availableMembers when unlocked", async () => {
    const onAddCandidate = vi.fn(async () => undefined);

    render(
      <RoomCandidatesPanel
        candidates={sampleCandidates}
        availableMembers={availableMembers}
        isLocked={false}
        onAddCandidate={onAddCandidate}
        onRemoveCandidate={vi.fn(async () => undefined)}
      />,
    );

    const addBtn = screen.getByTestId("add-candidate-btn");
    expect(addBtn).toBeDisabled();

    fireEvent.change(screen.getByTestId("add-candidate-name-input"), {
      target: { value: "  Barnabé  " },
    });
    expect(addBtn).toBeEnabled();
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(onAddCandidate).toHaveBeenCalledWith({ displayName: "Barnabé" });
    });

    fireEvent.change(screen.getByLabelText("Selecionar membro do cadastro"), {
      target: { value: "member-4" },
    });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(onAddCandidate).toHaveBeenCalledWith({ memberId: "member-4" });
    });
  });

  it("confirms candidate removal via ConfirmDialog", async () => {
    const onRemoveCandidate = vi.fn(async () => undefined);

    render(
      <RoomCandidatesPanel
        candidates={sampleCandidates}
        availableMembers={availableMembers}
        isLocked={false}
        onAddCandidate={vi.fn(async () => undefined)}
        onRemoveCandidate={onRemoveCandidate}
      />,
    );

    const removeButtons = screen.getAllByTestId("remove-candidate-btn");
    fireEvent.click(removeButtons[0]!);

    const dialog = screen.getByRole("dialog", { name: "Remover candidato" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(onRemoveCandidate).not.toHaveBeenCalled();

    fireEvent.click(removeButtons[0]!);
    const confirmDialog = screen.getByRole("dialog", { name: "Remover candidato" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Remover" }));

    await waitFor(() => {
      expect(onRemoveCandidate).toHaveBeenCalledWith("cand-1");
    });
  });

  it("shows locked notice and hides add/remove controls when isLocked is true", () => {
    render(
      <RoomCandidatesPanel
        candidates={sampleCandidates}
        availableMembers={availableMembers}
        isLocked={true}
        lockReason="Candidatos bloqueados após a abertura do 1º escrutínio."
        onAddCandidate={vi.fn(async () => undefined)}
        onRemoveCandidate={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByTestId("candidates-locked-notice")).toHaveTextContent(
      "Candidatos bloqueados após a abertura do 1º escrutínio.",
    );
    expect(screen.queryByTestId("add-candidate-name-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-candidate-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("remove-candidate-btn")).not.toBeInTheDocument();
  });
});
