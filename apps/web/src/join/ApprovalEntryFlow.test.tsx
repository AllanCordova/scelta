import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalEntryFlow } from "./ApprovalEntryFlow";
import { readJoinIdentity } from "./join-identity";

describe("ApprovalEntryFlow", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("searches roster, confirms birth day/month, polls pending request, and calls onApproved", async () => {
    let status: "pending" | "approved" = "pending";
    const onApproved = vi.fn();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/roster-search?q=Jo")) {
          return json({
            entries: [
              {
                rosterEntryId: "roster-1",
                fullName: "João Silva",
                requiresBirthDate: true,
                isClaimed: false,
              },
            ],
          });
        }
        if (url.endsWith("/entry-requests") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            rosterEntryId: string;
            joinKey: string;
            birthDay?: number;
            birthMonth?: number;
          };
          expect(body).toEqual({
            rosterEntryId: "roster-1",
            joinKey: "k".repeat(32),
            birthDay: 12,
            birthMonth: 4,
          });
          return json(
            {
              status: "pending",
              requestId: "req-1",
              displayName: "João Silva",
              inviteToken: "invite-tok-1",
              shortCode: "APR123",
            },
            201,
          );
        }
        if (url.endsWith("/entry-requests/req-1")) {
          return json({
            requestId: "req-1",
            status,
            displayName: "João Silva",
            title: "Assembleia Solene",
            roomStatus: "open",
            inviteToken: "invite-tok-1",
            shortCode: "APR123",
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    render(
      <ApprovalEntryFlow
        target={{ mode: "shortCode", shortCode: "APR123" }}
        storageKey="s.APR123"
        title="Assembleia Solene"
        joinKey={"k".repeat(32)}
        onApproved={onApproved}
      />,
    );

    fireEvent.change(screen.getByLabelText("Buscar seu nome no rol"), {
      target: { value: "João" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

    expect(await screen.findByText("João Silva")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Selecionar" }));

    fireEvent.change(screen.getByLabelText("Dia de nascimento"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Mês de nascimento"), { target: { value: "4" } });
    fireEvent.click(screen.getByTestId("request-entry-btn"));

    expect(await screen.findByTestId("entry-request-pending")).toHaveTextContent(
      "Aguardando aprovação da mesa…",
    );
    expect(readJoinIdentity(window.localStorage, "s.APR123")?.pendingRequestId).toBe("req-1");

    status = "approved";

    await waitFor(
      () => {
        expect(onApproved).toHaveBeenCalledWith({
          title: "Assembleia Solene",
          joinKey: "k".repeat(32),
          displayName: "João Silva",
          inviteToken: "invite-tok-1",
        });
      },
      { timeout: 4000 },
    );
    expect(readJoinIdentity(window.localStorage, "s.APR123")?.pendingRequestId).toBeUndefined();
    expect(readJoinIdentity(window.localStorage, "s.APR123")?.displayName).toBe("João Silva");
  });

  it("shows birth_date_mismatch and roster_name_already_claimed alerts", async () => {
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/roster-search?q=Maria")) {
          return json({
            entries: [
              {
                rosterEntryId: "roster-2",
                fullName: "Maria Souza",
                requiresBirthDate: true,
                isClaimed: true,
              },
            ],
          });
        }
        if (url.endsWith("/entry-requests") && init?.method === "POST") {
          attempt += 1;
          if (attempt === 1) {
            return json({ error: "birth_date_mismatch" }, 403);
          }
          return json({ error: "roster_name_already_claimed" }, 409);
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    render(
      <ApprovalEntryFlow
        target={{ mode: "token", token: "tok-1" }}
        storageKey="tok-1"
        title="Assembleia"
        joinKey={"m".repeat(32)}
        onApproved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Buscar seu nome no rol"), {
      target: { value: "Maria" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

    expect(await screen.findByText("Já reivindicado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Selecionar" }));

    fireEvent.change(screen.getByLabelText("Dia de nascimento"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Mês de nascimento"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("request-entry-btn"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Dia ou mês de nascimento não conferem.",
    );

    fireEvent.change(screen.getByLabelText("Dia de nascimento"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Mês de nascimento"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("request-entry-btn"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este nome já foi reivindicado. A mesa foi avisada; procure a mesa.",
    );
  });

  it("handles rejected requests by clearing pendingRequestId and allowing retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/entry-requests/req-99")) {
          return json({
            requestId: "req-99",
            status: "rejected",
            displayName: "Pedro",
            title: "Assembleia",
            roomStatus: "open",
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    render(
      <ApprovalEntryFlow
        target={{ mode: "token", token: "tok-1" }}
        storageKey="tok-1"
        title="Assembleia"
        joinKey={"p".repeat(32)}
        initialPendingRequestId="req-99"
        initialPendingDisplayName="Pedro"
        onApproved={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Seu pedido de entrada foi recusado pela mesa.",
    );
    expect(screen.getByLabelText("Buscar seu nome no rol")).toBeInTheDocument();
    expect(readJoinIdentity(window.localStorage, "tok-1")?.pendingRequestId).toBeUndefined();
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
