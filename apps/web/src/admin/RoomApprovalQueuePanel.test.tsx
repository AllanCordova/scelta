import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomApprovalQueuePanel } from "./RoomApprovalQueuePanel";
import type { RoomDetail } from "./types";

const sampleApprovalRoom: RoomDetail = {
  id: "room-apr-1",
  title: "Assembleia Aprovação",
  roomType: "elder",
  rulesPreset: "ipb_local_officers",
  quorumValue: 1,
  quorumUnit: "absolute",
  eligibleCount: 5,
  status: "open",
  round: null,
  inviteToken: "tok-apr",
  invitePath: "/join/tok-apr",
  shortCode: "APR001",
  shortPath: "/s/APR001",
  majorityRule: "absolute_majority",
  roundBehavior: "most voted",
  entryMode: "aprovacao",
  entryOpen: true,
  maxParticipants: 5,
  createdAt: "2026-11-23T12:00:00.000Z",
  presence: {
    presentCount: 1,
    eligibleCount: 5,
    requiredCount: 1,
    quorumMet: true,
  },
  votedCount: 0,
  receiptTimestamps: [],
};

describe("RoomApprovalQueuePanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders pending requests, disputed alerts, and triggers approve, reject, approve-all, and release-name", async () => {
    let state = {
      requests: [
        {
          id: "req-1",
          rosterEntryId: "roster-1",
          displayName: "João Silva",
          status: "pending",
          disputedAttemptCount: 0,
          lastDisputedAt: null,
          createdAt: "2026-11-23T12:05:00.000Z",
          decidedAt: null,
        },
        {
          id: "req-2",
          rosterEntryId: "roster-2",
          displayName: "Maria Souza",
          status: "pending",
          disputedAttemptCount: 1,
          lastDisputedAt: "2026-11-23T12:06:00.000Z",
          createdAt: "2026-11-23T12:04:00.000Z",
          decidedAt: null,
        },
      ],
      claimedParticipants: [
        {
          participantId: "part-1",
          rosterEntryId: "roster-3",
          displayName: "Carlos Lima",
          isPresent: true,
          joinedAt: "2026-11-23T12:01:00.000Z",
          disputedAttemptCount: 2,
          lastDisputedAt: "2026-11-23T12:07:00.000Z",
        },
      ],
      disputes: [
        {
          rosterEntryId: "roster-3",
          displayName: "Carlos Lima",
          disputedAttemptCount: 2,
          lastDisputedAt: "2026-11-23T12:07:00.000Z",
          currentHolderStatus: "approved",
          requestId: null,
          participantId: "part-1",
        },
      ],
    };

    const calls: string[] = [];
    const onChanged = vi.fn();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        calls.push(`${method} ${url}`);
        if (url.endsWith("/entry-requests") && method === "GET") {
          return json(state);
        }
        if (url.endsWith("/entry-requests/req-1/approve") && method === "POST") {
          state = {
            ...state,
            requests: state.requests.filter((r) => r.id !== "req-1"),
          };
          return json({ approved: true });
        }
        if (url.endsWith("/entry-requests/req-2/reject") && method === "POST") {
          state = {
            ...state,
            requests: state.requests.filter((r) => r.id !== "req-2"),
          };
          return json({ rejected: true });
        }
        if (url.endsWith("/entry-requests/approve-all") && method === "POST") {
          state = { ...state, requests: [] };
          return json({ approvedCount: 1 });
        }
        if (url.endsWith("/entry-requests/release-name") && method === "POST") {
          state = {
            ...state,
            claimedParticipants: [],
            disputes: [],
          };
          return json({ released: true });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    render(<RoomApprovalQueuePanel room={sampleApprovalRoom} onChanged={onChanged} />);

    expect(await screen.findByTestId("approval-pending-count")).toHaveTextContent("2 pendentes");
    expect(screen.getByTestId("approval-entry-gate-status")).toHaveTextContent("Entrada aberta");
    expect(screen.getByTestId("approval-capacity-badge")).toHaveTextContent("1 / 5");
    expect(screen.getByTestId("disputed-name-alert")).toHaveTextContent(
      "Nome disputado: Carlos Lima (2 tentativas bloqueadas)",
    );

    fireEvent.click(screen.getAllByTestId("approve-entry-btn")[0]!);
    await waitFor(() => {
      expect(screen.getByTestId("approval-pending-count")).toHaveTextContent("1 pendente");
    });

    fireEvent.click(screen.getByTestId("release-claimed-name-btn"));
    await waitFor(() => {
      expect(screen.queryByTestId("disputed-name-alert")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("reject-entry-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("approval-pending-count")).toHaveTextContent("0 pendentes");
    });
    expect(screen.getByTestId("approve-all-entries-btn")).toBeDisabled();
    expect(onChanged).toHaveBeenCalledTimes(3);
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
