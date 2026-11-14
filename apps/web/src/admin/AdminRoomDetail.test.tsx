import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminRoomDetail } from "./AdminRoomDetail";
import type { RoomDetail } from "./types";

const socketHandlers = new Map<string, Set<(payload: unknown) => void>>();

vi.mock("socket.io-client", () => ({
  io: () => ({
    on: (event: string, handler: (payload: unknown) => void) => {
      const set = socketHandlers.get(event) ?? new Set();
      set.add(handler);
      socketHandlers.set(event, set);
    },
    off: (event: string, handler: (payload: unknown) => void) => {
      socketHandlers.get(event)?.delete(handler);
    },
    emit: () => undefined,
    disconnect: () => undefined,
  }),
}));

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
    socketHandlers.clear();
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
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/access-codes`) && method === "GET") {
          return json({ accessCodes: [] });
        }
        if (
          url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/access-codes/simulate`) &&
          method === "POST"
        ) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { count?: number };
          const total = body.count ?? 1;
          const accessCodes = Array.from({ length: total }, (_, idx) => ({
            id: `sim-${idx + 1}`,
            memberId: null,
            displayName: `Simulado ${idx + 1}`,
            code: `SIM00${idx + 1}`,
            revokedAt: null,
            createdAt: "2026-11-13T12:00:00.000Z",
          }));
          return json({ accessCodes });
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
      "/admin/salas",
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
    expect(screen.getAllByText("Eleito").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Minimizar destaque do eleito" })).toBeInTheDocument();
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
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/access-codes`) && method === "GET") {
          return json({ accessCodes: [] });
        }
        if (
          url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/access-codes/simulate`) &&
          method === "POST"
        ) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { count?: number };
          const total = body.count ?? 1;
          const accessCodes = Array.from({ length: total }, (_, idx) => ({
            id: `sim-${idx + 1}`,
            memberId: null,
            displayName: `Simulado ${idx + 1}`,
            code: `SIM00${idx + 1}`,
            revokedAt: null,
            createdAt: "2026-11-13T12:00:00.000Z",
          }));
          return json({ accessCodes });
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

  it("updates live on socket ballot/presence events and simulates participants joining and voting", async () => {
    let currentRoom: RoomDetail = {
      ...sampleRoom,
      presence: {
        presentCount: 0,
        eligibleCount: 4,
        requiredCount: 1,
        quorumMet: false,
      },
      votedCount: 0,
      receiptTimestamps: [],
    };
    let joinedCount = 0;
    let castCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: currentRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/access-codes`) && method === "GET") {
          return json({ accessCodes: [] });
        }
        if (
          url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/access-codes/simulate`) &&
          method === "POST"
        ) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { count?: number };
          const total = body.count ?? 1;
          const accessCodes = Array.from({ length: total }, (_, idx) => ({
            id: `sim-${idx + 1}`,
            memberId: null,
            displayName: `Simulado ${idx + 1}`,
            code: `SIM00${idx + 1}`,
            revokedAt: null,
            createdAt: "2026-11-13T12:00:00.000Z",
          }));
          return json({ accessCodes });
        }
        if (url.endsWith(`/v1/join/${sampleRoom.inviteToken}`) && method === "POST") {
          joinedCount += 1;
          currentRoom = {
            ...currentRoom,
            presence: {
              presentCount: joinedCount,
              eligibleCount: 4,
              requiredCount: 1,
              quorumMet: joinedCount >= 1,
            },
          };
          return json({
            title: sampleRoom.title,
            status: "open",
            displayName: `Simulado ${joinedCount}`,
            presentCount: joinedCount,
            alreadyJoined: false,
          });
        }
        if (url.endsWith(`/v1/join/${sampleRoom.inviteToken}/ballot`) && method === "POST") {
          castCount += 1;
          currentRoom = {
            ...currentRoom,
            votedCount: castCount,
            receiptTimestamps: [
              ...currentRoom.receiptTimestamps,
              "2026-11-13T12:10:00.000Z",
            ],
          };
          return json({
            receipt: { roundId: "round-1", roundNumber: 1, voted: true },
          });
        }
        if (
          url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/participants/remove`) &&
          method === "POST"
        ) {
          joinedCount = Math.max(0, joinedCount - 1);
          currentRoom = {
            ...currentRoom,
            presence: {
              presentCount: joinedCount,
              eligibleCount: 4,
              requiredCount: 1,
              quorumMet: joinedCount >= 1,
            },
          };
          return json({ removedCount: 1 });
        }
        return json({ error: "not_found" }, 404);
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    expect(await screen.findByText("0 / 1 (presentes / mínimo)")).toBeInTheDocument();

    // Simulate 2 participants joining
    fireEvent.change(screen.getByLabelText("Participantes"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Simular entrada" }));

    expect(
      await screen.findByText("2 participantes simulados entraram na sala."),
    ).toBeInTheDocument();
    expect(await screen.findByText("2 / 1 (presentes / mínimo)")).toBeInTheDocument();
    expect(screen.getByText("2 Membros Aguardando")).toBeInTheDocument();

    // Simulate randomized votes for the 2 waiting participants
    fireEvent.click(screen.getByRole("button", { name: "Simular votos" }));
    expect(await screen.findByText("2 votos aleatórios computados.")).toBeInTheDocument();
    expect(await screen.findAllByText("Cédula recebida e assinada digitalmente")).toHaveLength(2);
    expect(screen.getByText("0 Membros Aguardando")).toBeInTheDocument();

    // Remove 1 participant from presence
    fireEvent.change(screen.getByLabelText("Participantes"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Remover participantes" }));
    const confirmDialog = await screen.findByRole("dialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Remover participantes" }));
    expect(await screen.findByText("1 participantes removidos da presença.")).toBeInTheDocument();
    expect(await screen.findByText("1 / 1 (presentes / mínimo)")).toBeInTheDocument();

    // Emit a socket ballot:activity event and verify live refresh
    currentRoom = {
      ...currentRoom,
      votedCount: 3,
      receiptTimestamps: [...currentRoom.receiptTimestamps, "2026-11-13T12:11:00.000Z"],
    };
    for (const handler of socketHandlers.get("ballot:activity") ?? []) {
      handler({ roomId: sampleRoom.id, roundId: "round-1" });
    }
    await waitFor(() => {
      expect(screen.getAllByText("Cédula recebida e assinada digitalmente")).toHaveLength(3);
    });
  });

  it("renders IPB board offices and lets admin follow IPB order or pick an unelected office", async () => {
    let openedOfficePayload: string | undefined;
    const boardRoom: RoomDetail = {
      ...sampleRoom,
      roomType: "ump_board",
      rulesPreset: "ipb_society_board",
      round: {
        id: "round-1",
        number: 1,
        officeLabel: "Presidente",
        officeRoundNumber: 1,
        status: "closed",
        outcome: "elected",
      },
      offices: [
        {
          officeLabel: "Presidente",
          order: 1,
          status: "elected",
          roundCount: 1,
          winnerCandidateId: "cand-1",
          winnerName: "Paulo",
          winnerPhotoUrl: "https://example.com/paulo.jpg",
        },
        {
          officeLabel: "Vice-Presidente",
          order: 2,
          status: "pending",
          roundCount: 0,
          winnerCandidateId: null,
          winnerName: null,
        },
        {
          officeLabel: "1º Secretário",
          order: 3,
          status: "pending",
          roundCount: 0,
          winnerCandidateId: null,
          winnerName: null,
        },
        {
          officeLabel: "2º Secretário",
          order: 4,
          status: "pending",
          roundCount: 0,
          winnerCandidateId: null,
          winnerName: null,
        },
        {
          officeLabel: "Tesoureiro",
          order: 5,
          status: "pending",
          roundCount: 0,
          winnerCandidateId: null,
          winnerName: null,
        },
      ],
      recommendedOffice: "Vice-Presidente",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: boardRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/access-codes`) && method === "GET") {
          return json({ accessCodes: [] });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/rounds`) && method === "POST") {
          const body = JSON.parse(String(init?.body ?? "{}")) as { officeLabel?: string };
          openedOfficePayload = body.officeLabel;
          return json({
            round: {
              id: "round-2",
              number: 2,
              officeLabel: body.officeLabel ?? "Vice-Presidente",
              officeRoundNumber: 1,
              status: "open",
              outcome: null,
            },
          });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    expect(await screen.findByText("Cargos da Diretoria (Ordem IPB)")).toBeInTheDocument();
    const presidentCard = screen.getByText("1. Presidente").closest("li")!;
    expect(presidentCard).toHaveTextContent("Paulo");
    expect(presidentCard).toHaveTextContent("Eleito");
    expect(presidentCard.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/paulo.jpg",
    );
    expect(screen.queryByRole("button", { name: "Compartilhar resultado" })).not.toBeInTheDocument();

    const select = screen.getByLabelText("Cargo para votação") as HTMLSelectElement;
    expect(select.value).toBe("Vice-Presidente");

    fireEvent.change(select, { target: { value: "Tesoureiro" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir escrutínio — Tesoureiro" }));

    await waitFor(() => {
      expect(openedOfficePayload).toBe("Tesoureiro");
    });
  });

  it("paginates presence flow receipts 5 per page", async () => {
    const manyReceiptsRoom: RoomDetail = {
      ...sampleRoom,
      votedCount: 7,
      receiptTimestamps: [
        "2026-04-04T15:01:00.000Z",
        "2026-04-04T15:02:00.000Z",
        "2026-04-04T15:03:00.000Z",
        "2026-04-04T15:04:00.000Z",
        "2026-04-04T15:05:00.000Z",
        "2026-04-04T15:06:00.000Z",
        "2026-04-04T15:07:00.000Z",
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: manyReceiptsRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/access-codes`) && method === "GET") {
          return json({ accessCodes: [] });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    expect(await screen.findByText("Página 1 de 2")).toBeInTheDocument();
    expect(screen.getAllByText("Cédula recebida e assinada digitalmente")).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    expect(screen.getAllByText("Cédula recebida e assinada digitalmente")).toHaveLength(2);
  });

  it("shows the share board paper when all offices are elected with photos, initials, ministry, and Bible verse", async () => {
    const completedBoardRoom: RoomDetail = {
      ...sampleRoom,
      roomType: "upa_board",
      rulesPreset: "ipb_society_board",
      title: "Assembleia UPA 2026",
      offices: [
        {
          officeLabel: "Presidente",
          order: 1,
          status: "elected",
          roundCount: 1,
          winnerCandidateId: "cand-1",
          winnerName: "Paulo Silva",
          winnerPhotoUrl: "https://example.com/paulo.jpg",
        },
        {
          officeLabel: "Vice-Presidente",
          order: 2,
          status: "elected",
          roundCount: 1,
          winnerCandidateId: "cand-2",
          winnerName: "Helena Costa",
          winnerPhotoUrl: null,
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: completedBoardRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/access-codes`) && method === "GET") {
          return json({ accessCodes: [] });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    const shareButton = await screen.findByRole("button", { name: "Compartilhar resultado" });
    fireEvent.click(shareButton);

    const dialog = screen.getByRole("dialog", {
      name: "Documento de compartilhamento — Assembleia UPA 2026",
    });
    expect(dialog).toHaveTextContent("Diretoria UPA");
    expect(dialog).toHaveTextContent("Assembleia UPA 2026");
    expect(dialog).toHaveTextContent("Presidente");
    expect(dialog).toHaveTextContent("Paulo Silva");
    expect(dialog).toHaveTextContent("Vice-Presidente");
    expect(dialog).toHaveTextContent("Helena Costa");
    expect(dialog).toHaveTextContent("HC");
    expect(dialog).toHaveTextContent("1 Pedro 4:10");
    expect(dialog.querySelector("img")).toHaveAttribute("src", "https://example.com/paulo.jpg");

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(
      screen.queryByRole("dialog", { name: "Documento de compartilhamento — Assembleia UPA 2026" }),
    ).not.toBeInTheDocument();
  });

  it("shows the share board paper for a single-office room once a winner is elected", async () => {
    const singleOfficeElectedRoom: RoomDetail = {
      ...sampleRoom,
      roomType: "elder",
      title: "Eleição de Presbítero",
      candidates: [
        { id: "cand-1", displayName: "Paulo", photoUrl: "https://example.com/paulo-elder.jpg" },
        { id: "cand-2", displayName: "Marcos", photoUrl: null },
      ],
      round: {
        id: "round-1",
        number: 1,
        status: "closed",
        outcome: "elected",
        tally: {
          totalVotes: 10,
          threshold: 6,
          outcome: "elected",
          winnerId: "cand-1",
          winnerName: "Paulo",
          standings: [
            { candidateId: "cand-1", displayName: "Paulo", votes: 7 },
            { candidateId: "cand-2", displayName: "Marcos", votes: 3 },
          ],
        },
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: singleOfficeElectedRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/access-codes`) && method === "GET") {
          return json({ accessCodes: [] });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    fireEvent.click(await screen.findByRole("button", { name: "Compartilhar resultado" }));

    const dialog = screen.getByRole("dialog", {
      name: "Documento de compartilhamento — Eleição de Presbítero",
    });
    expect(dialog).toHaveTextContent("Presbítero");
    expect(dialog).toHaveTextContent("Paulo");
    expect(dialog).toHaveTextContent("1 Pedro 4:10");
    expect(dialog.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/paulo-elder.jpg",
    );
  });

  it("paginates admin candidate tally list 10 per page", async () => {
    const manyCandidates = Array.from({ length: 12 }, (_, index) => ({
      id: `cand-${index + 1}`,
      displayName: `Candidato ${String(index + 1).padStart(2, "0")}`,
    }));
    const manyCandidatesRoom: RoomDetail = {
      ...sampleRoom,
      candidates: manyCandidates,
      round: {
        id: "round-1",
        number: 1,
        status: "closed",
        outcome: "no_majority",
        tally: {
          totalVotes: 24,
          threshold: 13,
          outcome: "no_majority",
          winnerId: null,
          winnerName: null,
          standings: manyCandidates.map((c, idx) => ({
            candidateId: c.id,
            displayName: c.displayName,
            votes: 12 - idx,
          })),
        },
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: manyCandidatesRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/access-codes`) && method === "GET") {
          return json({ accessCodes: [] });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    expect(await screen.findByText("Página 1 de 2")).toBeInTheDocument();
    expect(screen.getByText("Candidato 01")).toBeInTheDocument();
    expect(screen.queryByText("Candidato 11")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    expect(screen.getByText("Candidato 11")).toBeInTheDocument();
    expect(screen.queryByText("Candidato 01")).not.toBeInTheDocument();
  });

  it("opens the edit modal to update room details and allows closing an open room to Completa", async () => {
    let currentRoom: RoomDetail = { ...sampleRoom };
    const patchBodies: unknown[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: currentRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/access-codes`) && method === "GET") {
          return json({ accessCodes: [] });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "PATCH") {
          const body = JSON.parse(String(init?.body ?? "{}")) as Partial<RoomDetail>;
          patchBodies.push(body);
          currentRoom = { ...currentRoom, ...body };
          return json({ room: currentRoom });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    const editDialog = screen.getByRole("dialog", { name: "Editar sala" });
    expect(editDialog).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Título da sala"), {
      target: { value: "Eleição Diáconos Editada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => {
      expect(patchBodies[0]).toMatchObject({ title: "Eleição Diáconos Editada" });
    });
    expect(await screen.findByRole("heading", { name: "Eleição Diáconos Editada" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fechar sala" }));
    const closeDialog = screen.getByRole("dialog", { name: "Fechar sala" });
    fireEvent.click(closeDialog.querySelector("button:not(.ghost)")!);

    await waitFor(() => {
      expect(patchBodies[1]).toEqual({ status: "closed" });
    });
    expect(await screen.findByText("Completa")).toBeInTheDocument();
  });

  it("rotates the invite token and updates the voter invite link", async () => {
    let currentRoom: RoomDetail = sampleRoom;
    const rotatedRoom: RoomDetail = {
      ...sampleRoom,
      inviteToken: "rotated-token-xyz",
      invitePath: "/join/rotated-token-xyz",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({
            room: currentRoom,
            participantsCount: 0,
            latestRound: null,
            candidates: [],
            results: null,
            eligibleMembers: [],
          });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/access-codes`) && method === "GET") {
          return json({ accessCodes: [] });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/invite/rotate`) && method === "POST") {
          currentRoom = rotatedRoom;
          return json({ room: rotatedRoom });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    const inviteInput = (await screen.findByLabelText("Token Direto para Votantes")) as HTMLInputElement;
    expect(inviteInput.value).toContain("/join/token-elder-2026");

    fireEvent.click(screen.getByRole("button", { name: "Rotacionar convite" }));

    await waitFor(() => {
      expect(inviteInput.value).toContain("/join/rotated-token-xyz");
    });
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
