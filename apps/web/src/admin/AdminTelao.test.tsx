import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminTelao } from "./AdminTelao";
import type { RoomDetail } from "./types";

const socketHandlers = new Map<string, Set<(payload: unknown) => void>>();

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: (event: string, cb: (payload: unknown) => void) => {
      const group = socketHandlers.get(event) ?? new Set();
      group.add(cb);
      socketHandlers.set(event, group);
    },
    off: (event: string, cb: (payload: unknown) => void) => {
      socketHandlers.get(event)?.delete(cb);
    },
    disconnect: vi.fn(),
  })),
}));

vi.mock("qrcode", () => ({
  default: {
    toString: vi.fn(async () => "<svg data-testid='mock-qr'></svg>"),
  },
}));

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const baseRoom: RoomDetail = {
  id: "11111111-2222-4333-8444-555555555555",
  title: "Assembleia Geral 2026",
  roomType: "elder",
  rulesPreset: "ipb_local_officers",
  quorumValue: 50,
  quorumUnit: "percent",
  eligibleCount: 10,
  status: "open",
  inviteToken: "tok-telao-1",
  invitePath: "/join/tok-telao-1",
  shortCode: "TL2026",
  majorityRule: "absolute_majority",
  roundBehavior: "ipb_max_3_then_age",
  showLiveCandidateTally: false,
  createdAt: "2026-11-23T12:00:00.000Z",
  presence: { presentCount: 6, eligibleCount: 10, requiredCount: 5, quorumMet: true },
  votedCount: 0,
  receiptTimestamps: [],
  round: null,
};

afterEach(() => {
  cleanup();
  socketHandlers.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AdminTelao", () => {
  it("renders QR code, short code, and quorum during entry phase", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/config")) {
          return json({ publicUrl: "https://scelta.igreja.test" });
        }
        return json({ room: baseRoom });
      }),
    );

    render(<AdminTelao roomId={baseRoom.id} />);

    expect(await screen.findByTestId("telao-short-code")).toHaveTextContent("TL2026");
    expect(
      await screen.findByRole("img", { name: "QR Code de acesso à sala" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("scelta.igreja.test/s/TL2026")).toBeInTheDocument();
    expect(screen.getByText("Atingido")).toBeInTheDocument();
  });

  it("hides candidate partial by default and reveals live standings when showLiveCandidateTally is toggled via socket", async () => {
    let currentRoom: RoomDetail = {
      ...baseRoom,
      votedCount: 4,
      showLiveCandidateTally: false,
      round: {
        id: "round-1",
        number: 1,
        officeLabel: "Presbítero",
        status: "open",
        outcome: null,
        resultRevealed: false,
        liveTally: {
          totalBallots: 4,
          onlineBallots: 4,
          paperBallots: 0,
          blankVotes: 1,
          nullVotes: 0,
        },
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/config")) {
          return json({ publicUrl: null });
        }
        return json({ room: currentRoom });
      }),
    );

    render(<AdminTelao roomId={baseRoom.id} />);

    expect(await screen.findByTestId("telao-voted-counter")).toHaveTextContent("Votaram 4 de 6");
    expect(screen.getByTestId("telao-general-tally")).toHaveTextContent("4");
    expect(screen.getByTestId("telao-live-tally-hidden")).toBeInTheDocument();
    expect(screen.queryByTestId("telao-live-candidate-tally")).not.toBeInTheDocument();

    currentRoom = {
      ...currentRoom,
      showLiveCandidateTally: true,
      round: {
        ...currentRoom.round!,
        liveTally: {
          totalBallots: 4,
          onlineBallots: 4,
          paperBallots: 0,
          blankVotes: 1,
          nullVotes: 0,
          standings: [
            { candidateId: "c1", displayName: "Zaqueu Souza", votes: 2 },
            { candidateId: "c2", displayName: "Barnabé Lima", votes: 1 },
          ],
        },
      },
    };

    for (const handler of socketHandlers.get("telao:updated") ?? []) {
      handler({ roomId: baseRoom.id });
    }

    const partial = await screen.findByTestId("telao-live-candidate-tally");
    expect(partial).toHaveTextContent("Zaqueu Souza");
    expect(partial).toHaveTextContent("2 votos");
  });

  it("hides closed round results until reveal is triggered and then displays full standings", async () => {
    const revealCalls: string[] = [];
    let currentRoom: RoomDetail = {
      ...baseRoom,
      votedCount: 5,
      round: {
        id: "round-1",
        number: 1,
        status: "closed",
        outcome: "elected",
        resultRevealed: false,
        tally: {
          totalVotes: 5,
          nullVotes: 1,
          didNotVoteCount: 1,
          threshold: 3,
          outcome: "elected",
          winnerId: "c1",
          winnerName: "Zaqueu Souza",
          standings: [
            {
              candidateId: "c1",
              displayName: "Zaqueu Souza",
              votes: 4,
              onlineVotes: 3,
              paperVotes: 1,
            },
          ],
        },
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/v1/config")) {
          return json({ publicUrl: null });
        }
        if (url.endsWith(`/v1/admin/rooms/${baseRoom.id}/rounds/round-1/reveal`) && method === "POST") {
          revealCalls.push("round-1");
          currentRoom = {
            ...currentRoom,
            round: { ...currentRoom.round!, resultRevealed: true },
          };
          return json({ round: currentRoom.round, alreadyRevealed: false });
        }
        return json({ room: currentRoom });
      }),
    );

    render(<AdminTelao roomId={baseRoom.id} />);

    expect(await screen.findByTestId("telao-awaiting-reveal")).toBeInTheDocument();
    expect(screen.queryByTestId("telao-revealed-result")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("telao-reveal-result-btn"));

    await waitFor(() => {
      expect(revealCalls).toEqual(["round-1"]);
    });

    const revealed = await screen.findByTestId("telao-revealed-result");
    expect(revealed).toHaveTextContent("Zaqueu Souza");
    expect(revealed).toHaveTextContent("Online: 3 · Papel: 1");
  });
});
