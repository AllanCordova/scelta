import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminLogs } from "./AdminLogs";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("AdminLogs", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders undeletable human-voting proof logs, filters by category, and triggers PDF export", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/admin/logs")) {
          return json({
            logs: [
              {
                id: "log-1",
                sequence: 1,
                roomId: "room-1",
                roomTitle: "Eleição de Presbíteros 2026",
                roomStatus: "open",
                actorRole: "admin",
                action: "room_created",
                payload: { status: "open" },
                createdAt: "2026-11-14T14:00:00.000Z",
                integrityHash: "A1B2C3D4E5F60718",
              },
              {
                id: "log-2",
                sequence: 2,
                roomId: "room-1",
                roomTitle: "Eleição de Presbíteros 2026",
                roomStatus: "open",
                actorRole: "voter",
                action: "participant_joined",
                payload: {
                  voterOrigin: "authenticated_member",
                  isSimulated: false,
                  memberVerified: true,
                  sessionFingerprint: "9f8e7d6c5b4a",
                  adminIntervention: false,
                },
                createdAt: "2026-11-14T14:01:00.000Z",
                integrityHash: "B2C3D4E5F6071829",
              },
              {
                id: "log-3",
                sequence: 3,
                roomId: "room-1",
                roomTitle: "Eleição de Presbíteros 2026",
                roomStatus: "open",
                actorRole: "voter",
                action: "ballot_cast",
                payload: {
                  roundNumber: 1,
                  voterOrigin: "authenticated_member",
                  isSimulated: false,
                  memberVerified: true,
                  sessionFingerprint: "9f8e7d6c5b4a",
                  receiptFingerprint: "112233445566",
                  adminIntervention: false,
                },
                createdAt: "2026-11-14T14:02:00.000Z",
                integrityHash: "C3D4E5F60718293A",
              },
            ],
            rooms: [
              {
                id: "room-1",
                title: "Eleição de Presbíteros 2026",
                status: "open",
              },
            ],
            summary: {
              totalEvents: 3,
              humanBallotsCast: 1,
              simulatedBallotsCast: 0,
              humanParticipantsJoined: 1,
              adminVoteInterventions: 0,
              chainHeadHash: "C3D4E5F60718293A",
              immutable: true,
            },
          });
        }
        return json({ error: "not_found" }, 404);
      }),
    );

    render(<AdminLogs />);

    expect(
      await screen.findByRole("heading", {
        name: "Histórico de Comprovação e Auditoria de Votos",
      }),
    ).toBeInTheDocument();

    expect(screen.getByTestId("kpi-admin-interventions")).toHaveTextContent("0");
    expect(screen.getByTestId("kpi-human-ballots")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-human-joins")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-chain-hash")).toHaveTextContent("#C3D4E5F60718293A");

    expect(screen.getByText("Voto Computado por Pessoa")).toBeInTheDocument();
    expect(screen.getByText("Entrada de Participante")).toBeInTheDocument();
    expect(screen.getByText("Sala Criada")).toBeInTheDocument();

    // Filter to show only voter joins & ballots
    fireEvent.change(screen.getByLabelText("Tipo de Registro"), {
      target: { value: "voters_only" },
    });
    expect(screen.queryByText("Sala Criada")).not.toBeInTheDocument();
    expect(screen.getByText("Voto Computado por Pessoa")).toBeInTheDocument();

    // Click Exportar para PDF
    fireEvent.click(screen.getByRole("button", { name: "Exportar para PDF" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });
});
