import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RoomRosterPanel,
  type AvailableMemberOption,
  type RosterEntryView,
} from "./RoomRosterPanel";

const sampleEntries: RosterEntryView[] = [
  {
    id: "entry-1",
    memberId: "member-1",
    fullName: "Ana Paula",
    birthDate: "1985-04-12",
    isEligibleVoter: true,
    accessCode: { id: "code-1", code: "ANA123", revokedAt: null },
    isPresent: true,
  },
  {
    id: "entry-2",
    memberId: null,
    fullName: "Carlos Avulso",
    birthDate: null,
    isEligibleVoter: true,
    accessCode: null,
    isPresent: false,
  },
  {
    id: "entry-3",
    memberId: "member-3",
    fullName: "Beatriz Revogada",
    birthDate: null,
    isEligibleVoter: true,
    accessCode: { id: "code-3", code: "OLD999", revokedAt: "2026-11-19T10:00:00.000Z" },
    isPresent: false,
  },
];

const availableMembers: AvailableMemberOption[] = [
  { id: "member-4", fullName: "Daniel Souza", birthDate: "1990-08-20" },
  { id: "member-5", fullName: "Elena Lima", birthDate: null },
];

describe("RoomRosterPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders roster header, count badge, entries, badges, and filters by search", () => {
    render(
      <RoomRosterPanel
        entries={sampleEntries}
        availableMembers={availableMembers}
        isRoomClosed={false}
        onAddMember={vi.fn(async () => undefined)}
        onAddAdHoc={vi.fn(async () => undefined)}
        onRemoveEntry={vi.fn(async () => undefined)}
        onPrintSingleCard={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Rol da sala" })).toBeInTheDocument();
    expect(screen.getByText("3 eleitores")).toBeInTheDocument();

    const list = screen.getByRole("list", { name: "Rol da sala" });
    const rows = within(list).getAllByTestId("roster-entry-row");
    expect(rows).toHaveLength(3);

    expect(within(rows[0]!).getByText("Ana Paula")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("ANA123")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Presente")).toBeInTheDocument();
    expect(within(rows[0]!).getByTestId("print-single-card-btn")).toBeEnabled();

    expect(within(rows[1]!).getByText("Carlos Avulso")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Avulso")).toBeInTheDocument();
    expect(within(rows[1]!).getByTestId("print-single-card-btn")).toBeDisabled();

    expect(within(rows[2]!).getByText("Beatriz Revogada")).toBeInTheDocument();
    expect(within(rows[2]!).queryByText("OLD999")).not.toBeInTheDocument();
    expect(within(rows[2]!).getByTestId("print-single-card-btn")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Buscar no rol"), { target: { value: "Carlos" } });
    expect(within(list).getAllByTestId("roster-entry-row")).toHaveLength(1);
    expect(screen.getByText("Carlos Avulso")).toBeInTheDocument();
  });

  it("adds a member from the directory", async () => {
    const onAddMember = vi.fn(async () => undefined);

    render(
      <RoomRosterPanel
        entries={sampleEntries}
        availableMembers={availableMembers}
        isRoomClosed={false}
        onAddMember={onAddMember}
        onAddAdHoc={vi.fn(async () => undefined)}
        onRemoveEntry={vi.fn(async () => undefined)}
        onPrintSingleCard={vi.fn()}
      />,
    );

    const addBtn = screen.getByTestId("add-roster-member-btn");
    expect(addBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Adicionar do cadastro"), {
      target: { value: "member-4" },
    });
    expect(addBtn).toBeEnabled();

    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(onAddMember).toHaveBeenCalledWith("member-4");
    });
  });

  it("adds an ad-hoc voter with optional birth date", async () => {
    const onAddAdHoc = vi.fn(async () => undefined);

    render(
      <RoomRosterPanel
        entries={sampleEntries}
        availableMembers={availableMembers}
        isRoomClosed={false}
        onAddMember={vi.fn(async () => undefined)}
        onAddAdHoc={onAddAdHoc}
        onRemoveEntry={vi.fn(async () => undefined)}
        onPrintSingleCard={vi.fn()}
      />,
    );

    const addBtn = screen.getByTestId("add-roster-adhoc-btn");
    expect(addBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Nome completo (avulso)"), {
      target: { value: "  Marcos Visitante  " },
    });
    fireEvent.change(screen.getByLabelText("Data de nascimento"), {
      target: { value: "1992-01-15" },
    });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(onAddAdHoc).toHaveBeenCalledWith({
        fullName: "Marcos Visitante",
        birthDate: "1992-01-15",
      });
    });
  });

  it("confirms removal via ConfirmDialog before calling onRemoveEntry", async () => {
    const onRemoveEntry = vi.fn(async () => undefined);

    render(
      <RoomRosterPanel
        entries={sampleEntries}
        availableMembers={availableMembers}
        isRoomClosed={false}
        onAddMember={vi.fn(async () => undefined)}
        onAddAdHoc={vi.fn(async () => undefined)}
        onRemoveEntry={onRemoveEntry}
        onPrintSingleCard={vi.fn()}
      />,
    );

    const removeButtons = screen.getAllByTestId("remove-roster-entry-btn");
    fireEvent.click(removeButtons[0]!);

    const dialog = screen.getByRole("dialog", { name: "Remover do rol" });
    expect(dialog).toHaveTextContent(/revogado/i);
    expect(dialog).toHaveTextContent(/preservado/i);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(onRemoveEntry).not.toHaveBeenCalled();

    fireEvent.click(removeButtons[0]!);
    const confirmDialog = screen.getByRole("dialog", { name: "Remover do rol" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Remover" }));

    await waitFor(() => {
      expect(onRemoveEntry).toHaveBeenCalledWith("entry-1");
    });
  });

  it("invokes onPrintSingleCard for entries with active code", () => {
    const onPrintSingleCard = vi.fn();

    render(
      <RoomRosterPanel
        entries={sampleEntries}
        availableMembers={availableMembers}
        isRoomClosed={false}
        onAddMember={vi.fn(async () => undefined)}
        onAddAdHoc={vi.fn(async () => undefined)}
        onRemoveEntry={vi.fn(async () => undefined)}
        onPrintSingleCard={onPrintSingleCard}
      />,
    );

    const printButtons = screen.getAllByTestId("print-single-card-btn");
    fireEvent.click(printButtons[0]!);

    expect(onPrintSingleCard).toHaveBeenCalledTimes(1);
    expect(onPrintSingleCard).toHaveBeenCalledWith(sampleEntries[0]);
  });

  it("hides add forms and disables removal when isRoomClosed is true", () => {
    render(
      <RoomRosterPanel
        entries={sampleEntries}
        availableMembers={availableMembers}
        isRoomClosed={true}
        onAddMember={vi.fn(async () => undefined)}
        onAddAdHoc={vi.fn(async () => undefined)}
        onRemoveEntry={vi.fn(async () => undefined)}
        onPrintSingleCard={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("add-roster-member-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-roster-adhoc-btn")).not.toBeInTheDocument();

    const removeButtons = screen.getAllByTestId("remove-roster-entry-btn");
    for (const button of removeButtons) {
      expect(button).toBeDisabled();
    }
  });

  it("renders paper badge, header counter, and toggles paper mode with confirmation", async () => {
    const onTogglePaperMode = vi.fn(async () => undefined);
    const entriesWithPaper: RosterEntryView[] = [
      { ...sampleEntries[0]!, votesOnPaper: false },
      { ...sampleEntries[1]!, votesOnPaper: true },
    ];

    render(
      <RoomRosterPanel
        entries={entriesWithPaper}
        availableMembers={availableMembers}
        isRoomClosed={false}
        onAddMember={vi.fn(async () => undefined)}
        onAddAdHoc={vi.fn(async () => undefined)}
        onRemoveEntry={vi.fn(async () => undefined)}
        onPrintSingleCard={vi.fn()}
        onTogglePaperMode={onTogglePaperMode}
      />,
    );

    expect(screen.getByTestId("roster-paper-count")).toHaveTextContent("Papel: 1");

    const list = screen.getByRole("list", { name: "Rol da sala" });
    const rows = within(list).getAllByTestId("roster-entry-row");
    expect(within(rows[0]!).queryByTestId("paper-voter-badge")).not.toBeInTheDocument();
    expect(within(rows[1]!).getByTestId("paper-voter-badge")).toHaveTextContent("Papel");

    fireEvent.click(within(rows[0]!).getByTestId("toggle-paper-mode-btn"));
    const dialog = screen.getByRole("dialog", { name: "Marcar para voto em papel" });
    expect(dialog).toHaveTextContent(/revogado/i);
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar voto em papel" }));

    await waitFor(() => {
      expect(onTogglePaperMode).toHaveBeenCalledWith("entry-1", true);
    });

    fireEvent.click(within(rows[1]!).getByTestId("toggle-paper-mode-btn"));
    await waitFor(() => {
      expect(onTogglePaperMode).toHaveBeenCalledWith("entry-2", false);
    });
  });
});
