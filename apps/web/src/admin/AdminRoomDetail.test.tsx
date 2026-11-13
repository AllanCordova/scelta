import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminRoomDetail } from "./AdminRoomDetail";
import type { RoomDetail } from "./types";

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn(async () => "data:image/png;base64,invite-qr"),
  },
}));

const sampleRoom: RoomDetail = {
  id: "11111111-2222-4333-8444-555555555555",
  title: "Eleição de Presbíteros 2026",
  roomType: "elder",
  rulesPreset: "ipb_local_officers",
  quorumValue: 1,
  quorumUnit: "absolute",
  eligibleCount: 4,
  status: "open",
  candidates: [
    { id: "cand-1", displayName: "Paulo Apóstolo" },
    { id: "cand-2", displayName: "Silas" },
  ],
  round: {
    id: "round-1",
    number: 1,
    status: "open",
    outcome: null,
  },
  inviteToken: "token-elder-2026",
  invitePath: "/join/token-elder-2026",
  majorityRule: "absolute_majority",
  roundBehavior: "most voted",
  createdAt: "2026-11-13T12:00:00.000Z",
  presence: {
    presentCount: 3,
    eligibleCount: 4,
    requiredCount: 1,
    quorumMet: true,
  },
  votedCount: 2,
  receiptTimestamps: ["2026-11-13T12:05:00.000Z", "2026-11-13T12:02:00.000Z"],
};

describe("AdminRoomDetail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders room detail KPIs, regimental rules, candidates, and anonymous receipts", async () => {
    let currentRoom = sampleRoom;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: currentRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/rounds/round-1/close`) && method === "POST") {
          const closedRound = {
            id: "round-1",
            number: 1,
            status: "closed" as const,
            outcome: "elected" as const,
            tally: {
              totalVotes: 2,
              threshold: 2,
              outcome: "elected" as const,
              winnerId: "cand-1",
              winnerName: "Paulo Apóstolo",
              standings: [
                { candidateId: "cand-1", displayName: "Paulo Apóstolo", votes: 2 },
                { candidateId: "cand-2", displayName: "Silas", votes: 0 },
              ],
            },
          };
          currentRoom = { ...currentRoom, round: closedRound };
          return json({ round: closedRound });
        }
        return json({ error: "not_found" }, 404);
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    expect(
      await screen.findByRole("heading", { name: "Eleição de Presbíteros 2026" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Voltar para Painel de Salas/i })).toHaveAttribute(
      "href",
      "/admin",
    );
    expect(screen.getByText("Votos Computados")).toBeInTheDocument();
    expect(screen.getByText("Faltam Votar")).toBeInTheDocument();
    expect(screen.getByText("1 Membros Aguardando")).toBeInTheDocument();
    expect(screen.getByText("Regimento da Eleição")).toBeInTheDocument();
    expect(screen.getByText("Secreto / Cédula única")).toBeInTheDocument();
    expect(screen.getByText("50% + 1 (Absoluta)")).toBeInTheDocument();
    expect(screen.getByText("Paulo Apóstolo")).toBeInTheDocument();
    expect(screen.getByText("PA")).toBeInTheDocument();
    expect(screen.getAllByText("Cédula recebida e assinada digitalmente")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "QR Code" }));
    expect(await screen.findByTestId("invite-qr")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Encerrar escrutínio" }));
    expect(
      await screen.findByText(/Eleito por maioria absoluta: Paulo Apóstolo/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Eleito")).toBeInTheDocument();
  });

  it("shows not-found alert when room does not exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "room_not_found" }, 404)),
    );

    render(<AdminRoomDetail roomId="00000000-0000-4000-8000-000000000000" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Sala não encontrada.");
  });

  it("supports opening and restarting a round from the room detail header", async () => {
    let currentRoom: RoomDetail = { ...sampleRoom, round: null, votedCount: 0, receiptTimestamps: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: currentRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/rounds`) && method === "POST") {
          const opened = { id: "round-1", number: 1, status: "open" as const, outcome: null };
          currentRoom = { ...currentRoom, round: opened };
          return json({ round: opened });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/rounds/round-1/restart`) && method === "POST") {
          const restarted = {
            id: "round-1",
            number: 1,
            status: "open" as const,
            outcome: null,
            restartCount: 1,
          };
          currentRoom = { ...currentRoom, round: restarted };
          return json({ round: restarted });
        }
        return json({ error: "not_found" }, 404);
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    expect(await screen.findByText("Não iniciado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abrir escrutínio" }));
    expect(await screen.findByText("1º Escrutínio")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reiniciar escrutínio" }));
    expect(
      await screen.findByText("Escrutínio reiniciado — os votos anteriores foram limpos."),
    ).toBeInTheDocument();
  });
});

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}
