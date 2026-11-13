import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JoinRoom } from "./JoinRoom";
import { writeJoinIdentity } from "./join-identity";

describe("JoinRoom", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("asks for an access code and confirms entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { code: string; joinKey: string };
          expect(body.code).toBe("A7K9M2");
          return json({
            title: "Eleição de presbíteros",
            status: "open",
            displayName: "João",
            presentCount: 1,
            alreadyJoined: false,
          });
        }
        return json({ title: "Eleição de presbíteros", status: "open", canJoin: true });
      }),
    );

    render(<JoinRoom token="invite-token" />);

    expect(await screen.findByText("Eleição de presbíteros")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Código de acesso"), { target: { value: "a7k9m2" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar na sala" }));

    expect(await screen.findByRole("heading", { name: "Você entrou" })).toBeInTheDocument();
    expect(screen.getByText("Eleição de presbíteros")).toBeInTheDocument();
    expect(screen.getByText("João")).toBeInTheDocument();
    expect(screen.getByText("Sua presença foi registrada.")).toBeInTheDocument();
  });

  it("rejoins with the stored access code", async () => {
    writeJoinIdentity(window.localStorage, "invite-token", {
      joinKey: "a".repeat(32),
      displayName: "João",
      accessCode: "A7K9M2",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { code: string; joinKey: string };
          expect(body).toEqual({ code: "A7K9M2", joinKey: "a".repeat(32) });
          return json({
            title: "Eleição de presbíteros",
            status: "open",
            displayName: "João",
            presentCount: 1,
            alreadyJoined: true,
          });
        }
        return json({ title: "Eleição de presbíteros", status: "open", canJoin: true });
      }),
    );

    render(<JoinRoom token="invite-token" />);

    expect(await screen.findByRole("heading", { name: "Você entrou" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Código de acesso")).not.toBeInTheDocument();
  });

  it("explains an invalid invite", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "invite_not_found" }, 404)));

    render(<JoinRoom token="missing" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Convite inválido ou expirado.");
    expect(screen.queryByRole("button", { name: "Entrar na sala" })).not.toBeInTheDocument();
  });

  it("explains when the room cannot be joined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ title: "Assembleia", status: "closed", canJoin: false })),
    );

    render(<JoinRoom token="closed-token" />);

    expect(await screen.findByRole("heading", { name: "Assembleia" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Esta sala foi encerrada.");
    expect(screen.queryByLabelText("Código de acesso")).not.toBeInTheDocument();
  });

  it("lets a joined voter cast one anonymous vote and hides the chosen candidate on the receipt", async () => {
    let voted = false;
    writeJoinIdentity(window.localStorage, "invite-token", {
      joinKey: "a".repeat(32),
      displayName: "Ana",
      accessCode: "A7K9M2",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/ballot/receipt")) {
          return json({ roundId: "round-1", hasVoted: voted });
        }
        if (url.endsWith("/ballot") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { joinKey: string; candidateId: string };
          expect(body).toEqual({ joinKey: "a".repeat(32), candidateId: "cand-1" });
          voted = true;
          return json({ receipt: { roundId: "round-1", roundNumber: 1, voted: true } }, 201);
        }
        if (url.endsWith("/ballot")) {
          return json({
            roomStatus: "open",
            candidates: [
              { id: "cand-1", displayName: "Paulo" },
              { id: "cand-2", displayName: "Silas" },
            ],
            round: { id: "round-1", number: 1, status: "open", outcome: null },
          });
        }
        if (init?.method === "POST") {
          return json({
            title: "Eleição de presbíteros",
            status: "open",
            displayName: "Ana",
            presentCount: 1,
            alreadyJoined: true,
          });
        }
        return json({ title: "Eleição de presbíteros", status: "open", canJoin: true });
      }),
    );

    render(<JoinRoom token="invite-token" />);

    expect(await screen.findByRole("button", { name: "Paulo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Paulo" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar voto" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Comprovante: seu voto foi registrado com sigilo neste escrutínio.",
    );
    expect(screen.queryByRole("button", { name: "Confirmar voto" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Paulo" })).not.toBeInTheDocument();
  });

  it("shows an error if a second vote attempt is rejected", async () => {
    writeJoinIdentity(window.localStorage, "invite-token", {
      joinKey: "a".repeat(32),
      displayName: "Ana",
      accessCode: "A7K9M2",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/ballot/receipt")) {
          return json({ roundId: "round-1", hasVoted: false });
        }
        if (url.endsWith("/ballot") && init?.method === "POST") {
          return json({ error: "already_voted" }, 409);
        }
        if (url.endsWith("/ballot")) {
          return json({
            roomStatus: "open",
            candidates: [{ id: "cand-1", displayName: "Paulo" }],
            round: { id: "round-1", number: 1, status: "open", outcome: null },
          });
        }
        if (init?.method === "POST") {
          return json({
            title: "Eleição de presbíteros",
            status: "open",
            displayName: "Ana",
            presentCount: 1,
            alreadyJoined: true,
          });
        }
        return json({ title: "Eleição de presbíteros", status: "open", canJoin: true });
      }),
    );

    render(<JoinRoom token="invite-token" />);

    fireEvent.click(await screen.findByRole("button", { name: "Paulo" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar voto" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Você já votou neste escrutínio.");
  });

  it("shows restarted round notification and lets the voter cast a fresh ballot", async () => {
    writeJoinIdentity(window.localStorage, "invite-token", {
      joinKey: "a".repeat(32),
      displayName: "Ana",
      accessCode: "A7K9M2",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/ballot/receipt")) {
          return json({ roundId: "round-1", hasVoted: false });
        }
        if (url.endsWith("/ballot")) {
          return json({
            roomStatus: "open",
            candidates: [{ id: "cand-1", displayName: "Paulo" }],
            round: { id: "round-1", number: 1, status: "open", outcome: null, restartCount: 1 },
          });
        }
        if (init?.method === "POST") {
          return json({
            title: "Eleição de presbíteros",
            status: "open",
            displayName: "Ana",
            presentCount: 1,
            alreadyJoined: true,
          });
        }
        return json({ title: "Eleição de presbíteros", status: "open", canJoin: true });
      }),
    );

    render(<JoinRoom token="invite-token" />);

    expect(
      await screen.findByText(
        "Escrutínio reiniciado — os votos anteriores foram limpos. Vote novamente.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paulo" })).toBeInTheDocument();
  });

  it("filters candidates by name and renders the elected result hero card", async () => {
    window.localStorage.setItem(
      "scelta.join.invite-token",
      JSON.stringify({ joinKey: "join-key-filter-1", displayName: "Ana", accessCode: "A7K9M2" }),
    );
    let closed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/ballot")) {
          if (closed) {
            return json({
              round: {
                id: "round-1",
                number: 1,
                officeLabel: "Presidente",
                officeRoundNumber: 1,
                status: "closed",
                outcome: "elected",
                tally: {
                  outcome: "elected",
                  winnerName: "Paulo",
                  standings: [
                    { candidateId: "cand-1", displayName: "Paulo", votes: 3 },
                    { candidateId: "cand-2", displayName: "Silas", votes: 1 },
                  ],
                },
              },
              candidates: [],
            });
          }
          return json({
            round: {
              id: "round-1",
              number: 1,
              officeLabel: "Presidente",
              officeRoundNumber: 1,
              status: "open",
              outcome: null,
            },
            candidates: [
              { id: "cand-1", displayName: "Paulo" },
              { id: "cand-2", displayName: "Silas" },
            ],
          });
        }
        if (url.includes("/receipt")) {
          return json({ roundId: "round-1", hasVoted: false });
        }
        if (init?.method === "POST") {
          return json({
            title: "Diretoria UPA",
            status: "open",
            displayName: "Ana",
            presentCount: 1,
            alreadyJoined: true,
          });
        }
        return json({ title: "Diretoria UPA", status: "open", canJoin: true });
      }),
    );

    const { rerender } = render(<JoinRoom token="invite-token" />);

    const searchInput = await screen.findByLabelText("Buscar candidato por nome");
    expect(screen.getByText("Mostrando 2 de 2 candidatos")).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "Sil" } });
    expect(screen.getByText("Mostrando 1 de 2 candidatos")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Paulo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Silas" })).toBeInTheDocument();

    closed = true;
    rerender(<JoinRoom token="invite-token" />);
    await waitFor(
      () => {
        expect(screen.getByText("Presidente Eleito")).toBeInTheDocument();
        expect(screen.getAllByText("75%").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText("Paulo: 3 votos")).toBeInTheDocument();
      },
      { timeout: 2500 },
    );
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
