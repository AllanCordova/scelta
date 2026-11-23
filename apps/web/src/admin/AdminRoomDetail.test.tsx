import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminRoomDetail } from "./AdminRoomDetail";
import type { RoomDetail, RoomRosterEntryItem } from "./types";

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
    toString: vi.fn(async () => "<svg data-testid='mock-qr'><path /></svg>"),
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
  shortCode: "ELD202",
  shortPath: "/s/ELD202",
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
    expect(screen.queryByText("Fluxo de Presença")).not.toBeInTheDocument();
    expect(screen.getByTestId("open-telao-btn")).toHaveAttribute(
      "href",
      `/telao/${sampleRoom.id}`,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Preparar" }));
    expect(screen.getByText("Regimento da Eleição")).toBeInTheDocument();
    expect(screen.getByText("Secreto / Cédula única")).toBeInTheDocument();
    expect(screen.getByText("50% + 1 (Absoluta)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "QR Code" }));
    expect(await screen.findByTestId("invite-qr")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Encerrar escrutínio" }));
    expect(
      await screen.findByText(/Eleito por maioria absoluta: Paulo Apóstolo/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Paulo Apóstolo").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("PA").length).toBeGreaterThanOrEqual(1);
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
      status: "test",
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

    // Simulate 2 participants joining from Preparar tab
    fireEvent.click(screen.getByRole("tab", { name: "Preparar" }));
    fireEvent.change(screen.getByLabelText("Participantes"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Simular entrada" }));

    expect(
      await screen.findByText("2 participantes simulados entraram na sala."),
    ).toBeInTheDocument();

    // Simulate randomized votes for the 2 waiting participants
    fireEvent.click(screen.getByRole("button", { name: "Simular votos" }));
    expect(await screen.findByText("2 votos aleatórios computados.")).toBeInTheDocument();

    // Remove 1 participant from presence
    fireEvent.change(screen.getByLabelText("Participantes"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Remover participantes" }));
    const confirmDialog = await screen.findByRole("dialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Remover participantes" }));
    expect(await screen.findByText("1 participantes removidos da presença.")).toBeInTheDocument();

    // Verify updated KPIs and socket ballot:activity live refresh in Conduzir tab
    fireEvent.click(screen.getByRole("tab", { name: "Conduzir" }));
    expect(await screen.findByText("1 / 1 (presentes / mínimo)")).toBeInTheDocument();

    currentRoom = {
      ...currentRoom,
      votedCount: 3,
      receiptTimestamps: [...currentRoom.receiptTimestamps, "2026-11-13T12:11:00.000Z"],
    };
    for (const handler of socketHandlers.get("ballot:activity") ?? []) {
      handler({ roomId: sampleRoom.id, roundId: "round-1" });
    }
    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument();
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

  it("resolves initial tab from lifecycle state, toggles live candidate tally, and triggers telao reveal", async () => {
    const patchCalls: unknown[] = [];
    const revealCalls: string[] = [];
    let currentRoom: RoomDetail = {
      ...sampleRoom,
      status: "draft",
      round: null,
      showLiveCandidateTally: false,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: currentRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "PATCH") {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            showLiveCandidateTally?: boolean;
          };
          patchCalls.push(body);
          currentRoom = {
            ...currentRoom,
            showLiveCandidateTally: Boolean(body.showLiveCandidateTally),
          };
          return json({ room: currentRoom });
        }
        if (
          url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/rounds/round-1/reveal`) &&
          method === "POST"
        ) {
          revealCalls.push("round-1");
          currentRoom = {
            ...currentRoom,
            round: currentRoom.round ? { ...currentRoom.round, resultRevealed: true } : null,
          };
          return json({ round: currentRoom.round, alreadyRevealed: false });
        }
        return json({ accessCodes: [], entries: [], eligibleCount: 0, members: [] });
      }),
    );

    const { unmount } = render(<AdminRoomDetail roomId={sampleRoom.id} />);
    expect(await screen.findByRole("tab", { name: "Preparar" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const liveCheckbox = screen.getByTestId("toggle-live-candidate-tally");
    expect(liveCheckbox).not.toBeChecked();
    fireEvent.click(liveCheckbox);
    await waitFor(() => {
      expect(patchCalls).toEqual([{ showLiveCandidateTally: true }]);
    });
    unmount();

    currentRoom = {
      ...sampleRoom,
      status: "open",
      round: {
        id: "round-1",
        number: 1,
        status: "closed",
        outcome: "elected",
        resultRevealed: false,
        tally: {
          totalVotes: 2,
          threshold: 2,
          outcome: "elected",
          winnerId: "cand-1",
          winnerName: "Paulo Apóstolo",
          standings: [{ candidateId: "cand-1", displayName: "Paulo Apóstolo", votes: 2 }],
        },
      },
    };
    render(<AdminRoomDetail roomId={sampleRoom.id} />);
    expect(await screen.findByRole("tab", { name: "Resultado" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(await screen.findByTestId("reveal-result-btn"));
    await waitFor(() => {
      expect(revealCalls).toEqual(["round-1"]);
    });
    expect(await screen.findByTestId("result-revealed-badge")).toHaveTextContent(
      "Revelado no telão",
    );
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

    fireEvent.click(await screen.findByRole("tab", { name: "Resultado" }));
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
    const tallyCardsContainer = document.querySelector(".candidate-cards-list") as HTMLElement;
    expect(within(tallyCardsContainer).getByText("Candidato 01")).toBeInTheDocument();
    expect(within(tallyCardsContainer).queryByText("Candidato 11")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    const tallyCardsPage2 = document.querySelector(".candidate-cards-list") as HTMLElement;
    expect(within(tallyCardsPage2).getByText("Candidato 11")).toBeInTheDocument();
    expect(within(tallyCardsPage2).queryByText("Candidato 01")).not.toBeInTheDocument();
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

  it("lets admin select each cargo in multi-office rooms and preview its distinct banner", async () => {
    const boardRoom: RoomDetail = {
      ...sampleRoom,
      roomType: "upa_board",
      officeBanners: {
        Presidente: "https://example.com/presidente-banner.png",
        Tesoureiro: "https://example.com/tesoureiro-banner.png",
      },
      offices: [
        {
          officeLabel: "Presidente",
          order: 1,
          status: "open",
          roundCount: 1,
          winnerCandidateId: null,
          winnerName: null,
        },
        {
          officeLabel: "Tesoureiro",
          order: 2,
          status: "pending",
          roundCount: 0,
          winnerCandidateId: null,
          winnerName: null,
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: boardRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/access-codes`) && method === "GET") {
          return json({ accessCodes: [] });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    fireEvent.click(await screen.findByRole("tab", { name: "Preparar" }));
    const select = (await screen.findByLabelText("Cargo do banner")) as HTMLSelectElement;
    expect(select.value).toBe("Presidente");
    expect(screen.getByAltText("Banner do cargo Presidente")).toHaveAttribute(
      "src",
      "https://example.com/presidente-banner.png",
    );

    fireEvent.change(select, { target: { value: "Tesoureiro" } });
    expect(screen.getByAltText("Banner do cargo Tesoureiro")).toHaveAttribute(
      "src",
      "https://example.com/tesoureiro-banner.png",
    );
  });

  it("does not expose invite rotation on room detail (kept on /admin/codigos)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({
            room: sampleRoom,
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
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    fireEvent.click(await screen.findByRole("tab", { name: "Preparar" }));
    const inviteInput = (await screen.findByLabelText("Token Direto para Votantes")) as HTMLInputElement;
    expect(inviteInput.value).toContain("/s/ELD202");
    expect(screen.queryByRole("button", { name: "Rotacionar convite" })).not.toBeInTheDocument();
  });

  it("renders the room audit log section when auditEvents are returned", async () => {
    const auditedRoom: RoomDetail = {
      ...sampleRoom,
      auditEvents: [
        {
          id: "evt-1",
          actorRole: "admin",
          action: "room_created",
          payload: {},
          createdAt: "2026-11-13T21:00:00.000Z",
        },
        {
          id: "evt-2",
          actorRole: "admin",
          action: "quorum_changed",
          payload: {},
          createdAt: "2026-11-13T21:01:00.000Z",
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: auditedRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/access-codes`) && method === "GET") {
          return json({ accessCodes: [] });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Resultado" }));
    expect(await screen.findByRole("heading", { name: "Auditoria da sala" })).toBeInTheDocument();
    expect(screen.getByText("Sala criada")).toBeInTheDocument();
    expect(screen.getByText("Quórum alterado")).toBeInTheDocument();
  });

  it("blocks opening a 4th scrutiny on a 3rd-round tie without birth dates and lets the admin resolve the winner by age", async () => {
    let currentRoom: RoomDetail = {
      ...sampleRoom,
      roomType: "upa_board",
      rulesPreset: "ipb_society_board",
      round: {
        id: "round-3",
        number: 3,
        officeLabel: "Presidente",
        officeRoundNumber: 3,
        status: "closed",
        outcome: "no_majority",
        tally: {
          totalVotes: 2,
          threshold: 2,
          outcome: "no_majority",
          winnerId: null,
          winnerName: null,
          standings: [
            { candidateId: "cand-1", displayName: "Paulo Apóstolo", votes: 1 },
            { candidateId: "cand-2", displayName: "Silas", votes: 1 },
          ],
          tieBreakRequired: true,
          tiedCandidates: [
            { id: "cand-1", displayName: "Paulo Apóstolo", birthDate: null },
            { id: "cand-2", displayName: "Silas", birthDate: null },
          ],
        },
      },
    };

    const resolveCalls: { winnerCandidateId: string }[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: currentRoom });
        }
        if (
          url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/rounds/round-3/resolve-tie`) &&
          method === "POST"
        ) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { winnerCandidateId: string };
          resolveCalls.push(body);
          const resolvedRound = {
            ...currentRoom.round!,
            outcome: "elected" as const,
            tally: {
              ...currentRoom.round!.tally!,
              outcome: "elected" as const,
              winnerId: "cand-2",
              winnerName: "Silas",
              tieBreakReason: "admin_tiebreak" as const,
              tieBreakRequired: false,
            },
          };
          currentRoom = { ...currentRoom, round: resolvedRound };
          return json({ round: resolvedRound });
        }
        return json({ accessCodes: [] });
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    expect(
      await screen.findByText(/Desempate do 3º Escrutínio — Critério de Idade/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Desempate pendente (3º escrutínio)" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Declarar Silas eleito (mais velho)" }));

    await waitFor(() => {
      expect(resolveCalls).toEqual([{ winnerCandidateId: "cand-2" }]);
    });
    expect(
      await screen.findByText(/Eleito por desempate de idade \(decisão da mesa\): Silas/i),
    ).toBeInTheDocument();
  });

  it("prompts confirmation when closing with voting_incomplete and displays didNotVoteCount", async () => {
    let currentRoom: RoomDetail = {
      ...sampleRoom,
      presence: { presentCount: 3, eligibleCount: 3, requiredCount: 2, quorumMet: true },
      votedCount: 1,
      round: {
        id: "round-1",
        number: 1,
        status: "open",
        outcome: null,
      },
    };
    const closeCalls: unknown[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: currentRoom });
        }
        if (
          url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/rounds/round-1/close`) &&
          method === "POST"
        ) {
          const body = init?.body ? JSON.parse(String(init.body)) : {};
          closeCalls.push(body);
          if (!body.confirmPending) {
            return json({ error: "voting_incomplete", votedCount: 1, presentCount: 3 }, 409);
          }
          const closedRound = {
            id: "round-1",
            number: 1,
            status: "closed" as const,
            outcome: "no_majority" as const,
            didNotVoteCount: 2,
            tally: {
              totalVotes: 1,
              threshold: 1,
              outcome: "no_majority" as const,
              winnerId: null,
              winnerName: null,
              standings: [
                { candidateId: "cand-1", displayName: "Paulo Apóstolo", votes: 1 },
                { candidateId: "cand-2", displayName: "Silas", votes: 0 },
              ],
              didNotVoteCount: 2,
            },
          };
          currentRoom = { ...currentRoom, round: closedRound };
          return json({ round: closedRound });
        }
        return json({ accessCodes: [] });
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    expect(await screen.findByRole("button", { name: "Encerrar escrutínio" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Encerrar escrutínio" }));

    expect(
      await screen.findByText("Encerrar com votantes pendentes"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Nem todos os membros presentes votaram/i),
    ).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", { name: "Encerrar escrutínio" });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(closeCalls).toEqual([{}, { confirmPending: true }]);
    });

    const notVotedNotice = await screen.findByText(/Não votaram:/i);
    expect(notVotedNotice).toBeInTheDocument();
    expect(notVotedNotice).toHaveTextContent("Não votaram: 2");
  });

  it("integrates RoomRosterPanel, single-card print dialog, and RoomCandidatesPanel", async () => {
    let rosterEntries: RoomRosterEntryItem[] = [
      {
        id: "ros-1",
        roomId: sampleRoom.id,
        memberId: "mem-1",
        fullName: "Ana Silva",
        birthDate: "1990-01-01",
        isCommunicant: true,
        isMale: false,
        isEligibleVoter: true,
        createdAt: "2026-11-13T12:00:00.000Z",
        accessCode: { id: "code-1", code: "111222", revokedAt: null },
        isPresent: false,
      },
    ];
    let currentRoom: RoomDetail = {
      ...sampleRoom,
      hasRounds: false,
      candidates: [
        { id: "cand-1", memberId: "mem-1", displayName: "Ana Silva", isEligible: true },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: currentRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/roster`) && method === "GET") {
          return json({ entries: rosterEntries, eligibleCount: rosterEntries.length });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/roster`) && method === "POST") {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            memberId?: string;
            fullName?: string;
          };
          const newEntry = {
            id: "ros-2",
            roomId: sampleRoom.id,
            memberId: body.memberId ?? null,
            fullName: body.memberId ? "Bruno Costa" : (body.fullName ?? "Avulso"),
            birthDate: null,
            isCommunicant: true,
            isMale: null,
            isEligibleVoter: true,
            createdAt: "2026-11-13T12:05:00.000Z",
            accessCode: { id: "code-2", code: "333444", revokedAt: null },
            isPresent: false,
          };
          rosterEntries = [...rosterEntries, newEntry];
          return json({ entry: newEntry, accessCode: newEntry.accessCode, eligibleCount: 2 }, 201);
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/candidates`) && method === "POST") {
          const added = {
            id: "cand-2",
            memberId: null,
            displayName: "Carlos Eduardo",
            isEligible: true,
          };
          currentRoom = { ...currentRoom, candidates: [...(currentRoom.candidates ?? []), added] };
          return json({ candidate: added, candidates: currentRoom.candidates }, 201);
        }
        if (url.endsWith("/v1/admin/members") && method === "GET") {
          return json({
            members: [
              {
                id: "mem-1",
                fullName: "Ana Silva",
                isCommunicant: true,
                isMale: false,
                birthDate: "1990-01-01",
                societyFlags: {},
              },
              {
                id: "mem-2",
                fullName: "Bruno Costa",
                isCommunicant: true,
                isMale: true,
                birthDate: "1988-05-05",
                societyFlags: {},
              },
            ],
          });
        }
        return json({ accessCodes: [] });
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    fireEvent.click(await screen.findByRole("tab", { name: "Preparar" }));
    expect(await screen.findByText("111222")).toBeInTheDocument();

    // Add ad-hoc voter
    fireEvent.change(screen.getByLabelText("Nome completo (avulso)"), {
      target: { value: "Visitante João" },
    });
    fireEvent.click(screen.getByTestId("add-roster-adhoc-btn"));
    expect(await screen.findByText("Visitante João")).toBeInTheDocument();
    expect(screen.getByText("333444")).toBeInTheDocument();

    // Print single card
    const printButtons = screen.getAllByTestId("print-single-card-btn");
    fireEvent.click(printButtons[0]!);
    const printDialog = await screen.findByTestId("single-card-print-dialog");
    expect(printDialog.querySelectorAll(".print-card-item")).toHaveLength(1);
    expect(within(printDialog).getByText("111222")).toBeInTheDocument();
    fireEvent.click(within(printDialog).getByRole("button", { name: "Fechar" }));
    expect(screen.queryByTestId("single-card-print-dialog")).not.toBeInTheDocument();

    // Add candidate
    fireEvent.change(screen.getByTestId("add-candidate-name-input"), {
      target: { value: "Carlos Eduardo" },
    });
    fireEvent.click(screen.getByTestId("add-candidate-btn"));
    const addedCandidates = await screen.findAllByText("Carlos Eduardo");
    expect(addedCandidates.length).toBeGreaterThanOrEqual(1);
  });

  it("renders paper voting controls, excludes paper voters from online pending, handles 409 paper_tally_required, and shows origin breakdown", async () => {
    let currentRoom: RoomDetail = {
      ...sampleRoom,
      eligibleCount: 2,
      presence: {
        presentCount: 2,
        onlinePresentCount: 1,
        paperVotersCount: 1,
        eligibleCount: 2,
        requiredCount: 1,
        quorumMet: true,
      },
      votedCount: 1,
      receiptTimestamps: ["2026-11-13T12:05:00.000Z"],
      auditEvents: [
        {
          id: "audit-1",
          actorRole: "admin",
          action: "roster_paper_mode_enabled",
          payload: {},
          createdAt: "2026-11-13T12:01:00.000Z",
        },
        {
          id: "audit-2",
          actorRole: "admin",
          action: "paper_tally_recorded",
          payload: {},
          createdAt: "2026-11-13T12:04:00.000Z",
        },
      ],
    };

    const rosterEntries: RoomRosterEntryItem[] = [
      {
        id: "entry-online",
        roomId: sampleRoom.id,
        memberId: "mem-1",
        fullName: "Ana Online",
        birthDate: "1990-01-01",
        isCommunicant: true,
        isMale: false,
        isEligibleVoter: true,
        createdAt: "2026-11-13T12:00:00.000Z",
        accessCode: { id: "code-1", code: "111222", revokedAt: null },
        isPresent: true,
        votesOnPaper: false,
      },
      {
        id: "entry-paper",
        roomId: sampleRoom.id,
        memberId: "mem-2",
        fullName: "Bruno Papel",
        birthDate: "1988-05-05",
        isCommunicant: true,
        isMale: true,
        isEligibleVoter: true,
        createdAt: "2026-11-13T12:00:00.000Z",
        accessCode: null,
        isPresent: false,
        votesOnPaper: true,
      },
    ];

    let closeAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: currentRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/roster`) && method === "GET") {
          return json({ entries: rosterEntries, eligibleCount: 2 });
        }
        if (url.endsWith("/v1/admin/members") && method === "GET") {
          return json({ members: [] });
        }
        if (
          url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/rounds/round-1/paper-tally`) &&
          method === "PUT"
        ) {
          const paperTally = {
            id: "pt-1",
            roundId: "round-1",
            ballotCount: 1,
            blankVotes: 0,
            nullVotes: 0,
            candidateVotes: { "cand-1": 1, "cand-2": 0 },
            recordedByAdminId: "admin-1",
            recordedByName: "Admin Mesa",
            recordedAt: "2026-11-13T12:04:00.000Z",
            updatedAt: "2026-11-13T12:04:00.000Z",
          };
          currentRoom = {
            ...currentRoom,
            round: currentRoom.round ? { ...currentRoom.round, paperTally } : null,
          };
          return json({ paperTally });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/rounds/round-1/close`) && method === "POST") {
          closeAttempts += 1;
          const body = init?.body ? (JSON.parse(String(init.body)) as { confirmNoPaperBallots?: boolean }) : {};
          if (!body.confirmNoPaperBallots && !currentRoom.round?.paperTally) {
            return json({ error: "paper_tally_required" }, 409);
          }
          const closedRound = {
            id: "round-1",
            number: 1,
            status: "closed" as const,
            outcome: "elected" as const,
            paperTally: currentRoom.round?.paperTally ?? null,
            tally: {
              totalVotes: 2,
              threshold: 2,
              outcome: "elected" as const,
              winnerId: "cand-1",
              winnerName: "Paulo Apóstolo",
              standings: [
                {
                  candidateId: "cand-1",
                  displayName: "Paulo Apóstolo",
                  votes: 2,
                  onlineVotes: 1,
                  paperVotes: 1,
                },
                {
                  candidateId: "cand-2",
                  displayName: "Silas",
                  votes: 0,
                  onlineVotes: 0,
                  paperVotes: 0,
                },
              ],
              voteOrigin: {
                online: { ballots: 1, candidateVotes: 1, blankVotes: 0 },
                paper: { ballots: 1, candidateVotes: 1, blankVotes: 0, nullVotes: 0 },
              },
            },
          };
          currentRoom = { ...currentRoom, round: closedRound };
          return json({ round: closedRound });
        }
        return json({ accessCodes: [] });
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    expect(await screen.findByTestId("room-paper-count")).toHaveTextContent("Papel: 1");
    expect(screen.getByTestId("paper-tally-panel")).toBeInTheDocument();

    // Try closing without paper tally -> opens confirmation dialog
    fireEvent.click(screen.getByRole("button", { name: "Encerrar escrutínio" }));
    const noPaperDialog = await screen.findByRole("dialog", { name: "Urna de papel sem lançamento" });
    expect(noPaperDialog).toBeInTheDocument();
    fireEvent.click(within(noPaperDialog).getByRole("button", { name: "Cancelar" }));
    expect(closeAttempts).toBe(1);

    // Fill paper tally and save
    fireEvent.change(screen.getByTestId("paper-ballot-count-input"), { target: { value: "1" } });
    const candidateInputs = screen.getAllByTestId("paper-candidate-votes-input");
    fireEvent.change(candidateInputs[0]!, { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("save-paper-tally-btn"));
    await screen.findByTestId("paper-tally-provenance");

    // Close scrutiny -> shows combined origin breakdown and audit events on Resultado tab
    fireEvent.click(screen.getByRole("button", { name: "Encerrar escrutínio" }));
    const originSummary = await screen.findByTestId("tally-origin-summary");
    expect(originSummary).toHaveTextContent("Total: 2");
    expect(originSummary).toHaveTextContent("Online: 1");
    expect(originSummary).toHaveTextContent("Papel: 1");
    expect(screen.getByTestId("tally-paper-recorded-by")).toHaveTextContent("Admin Mesa");
    expect(screen.getByText(/Online: 1 · Papel: 1/)).toBeInTheDocument();
    expect(screen.getByText("Marcado para voto em papel")).toBeInTheDocument();
    expect(screen.getByText("Totais da urna de papel lançados")).toBeInTheDocument();
  });

  it("shows approval mode details, short code below QR, and toggles room entry open/closed", async () => {
    let currentRoom: RoomDetail = {
      ...sampleRoom,
      entryMode: "aprovacao",
      entryOpen: true,
      maxParticipants: 10,
      auditEvents: [
        {
          id: "evt-entry-1",
          actorRole: "admin",
          action: "entry_request_approved",
          payload: {},
          createdAt: "2026-11-13T12:04:00.000Z",
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "GET") {
          return json({ room: currentRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`) && method === "PATCH") {
          const body = JSON.parse(String(init?.body ?? "{}")) as { entryOpen?: boolean };
          currentRoom = { ...currentRoom, entryOpen: body.entryOpen };
          return json({ room: currentRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/entry-requests`) && method === "GET") {
          return json({ requests: [], claimedParticipants: [], disputes: [] });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/participants`) && method === "GET") {
          return json({ participants: [] });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/roster`) && method === "GET") {
          return json({ entries: [], eligibleCount: 4 });
        }
        if (url.endsWith("/v1/admin/members") && method === "GET") {
          return json({ members: [] });
        }
        if (url.includes("/chat")) {
          return json({ messages: [], chatMuted: false });
        }
        if (url.endsWith("/v1/public-config")) {
          return json({ publicUrl: null });
        }
        return json({ accessCodes: [] });
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    expect(await screen.findByTestId("approval-queue-panel")).toBeInTheDocument();
    expect(screen.getAllByText("Entrada aberta").length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole("tab", { name: "Resultado" }));
    expect(screen.getByText("Pedido de entrada aprovado pela mesa")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Preparar" }));
    expect(screen.getByText("Aprovação da mesa")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "QR Code" }));
    expect(await screen.findByTestId("room-short-code")).toHaveTextContent("ELD202");

    const toggleBtn = screen.getByTestId("toggle-room-entry-btn");
    expect(toggleBtn).toHaveTextContent("Encerrar entrada");
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(screen.getByTestId("toggle-room-entry-btn")).toHaveTextContent("Reabrir entrada");
    });
  });

  it("displays multi-vacancy progress, partial election next-round button, and close-with-open-vacancies action", async () => {
    const multiRoom: RoomDetail = {
      ...sampleRoom,
      roomType: "deacon",
      vacancies: 5,
      remainingVacancies: 2,
      hasRounds: true,
      electedCandidates: [
        { id: "cand-1", displayName: "Paulo Apóstolo", photoUrl: null },
        { id: "cand-2", displayName: "Silas", photoUrl: null },
        { id: "cand-3", displayName: "Timóteo", photoUrl: null },
      ],
      round: {
        id: "round-1",
        number: 1,
        vacancies: 5,
        status: "closed",
        outcome: "elected",
        winnerCandidateIds: ["cand-1", "cand-2", "cand-3"],
        tally: {
          totalVotes: 10,
          threshold: 6,
          outcome: "elected",
          winnerId: "cand-1",
          winnerName: "Paulo Apóstolo, Silas, Timóteo",
          vacancies: 5,
          winnerIds: ["cand-1", "cand-2", "cand-3"],
          winnerNames: ["Paulo Apóstolo", "Silas", "Timóteo"],
          remainingVacancies: 2,
          partialElection: true,
          standings: [
            { candidateId: "cand-1", displayName: "Paulo Apóstolo", votes: 8 },
            { candidateId: "cand-2", displayName: "Silas", votes: 7 },
            { candidateId: "cand-3", displayName: "Timóteo", votes: 6 },
          ],
        },
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}`)) {
          return json({ room: multiRoom });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/participants`)) {
          return json({ participants: [] });
        }
        if (url.endsWith(`/v1/admin/rooms/${sampleRoom.id}/roster`)) {
          return json({ entries: [], eligibleCount: 4 });
        }
        if (url.endsWith("/v1/admin/members")) {
          return json({ members: [] });
        }
        if (url.includes("/chat")) {
          return json({ messages: [], chatMuted: false });
        }
        if (url.endsWith("/v1/public-config")) {
          return json({ publicUrl: null });
        }
        return json({ accessCodes: [] });
      }),
    );

    render(<AdminRoomDetail roomId={sampleRoom.id} />);

    expect(await screen.findByTestId("room-vacancies-summary")).toHaveTextContent(
      "Vagas: 3 eleitos de 5 • Vagas restantes: 2",
    );
    expect(screen.getByTestId("open-next-round-btn")).toHaveTextContent(
      "Abrir próximo escrutínio (2 vagas)",
    );
    expect(screen.getByTestId("close-with-open-vacancies-btn")).toBeInTheDocument();
    expect(
      screen.getByText("Eleitos por maioria absoluta: Paulo Apóstolo, Silas, Timóteo"),
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
