import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JoinRoom } from "./JoinRoom";
import { writeJoinIdentity } from "./join-identity";

describe("JoinRoom", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("asks for a name and confirms entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
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
    fireEvent.change(screen.getByLabelText("Seu nome"), { target: { value: "João" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar na sala" }));

    expect(await screen.findByRole("heading", { name: "Você entrou" })).toBeInTheDocument();
    expect(screen.getByText("Eleição de presbíteros")).toBeInTheDocument();
    expect(screen.getByText("Sua presença foi registrada.")).toBeInTheDocument();
  });

  it("rejoins with the stored name", async () => {
    writeJoinIdentity(window.localStorage, "invite-token", {
      joinKey: "a".repeat(32),
      displayName: "João",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { displayName: string; joinKey: string };
          expect(body).toEqual({ displayName: "João", joinKey: "a".repeat(32) });
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
    expect(screen.queryByLabelText("Seu nome")).not.toBeInTheDocument();
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
    expect(screen.queryByLabelText("Seu nome")).not.toBeInTheDocument();
  });

  it("lets a joined voter cast one anonymous vote and hides the chosen candidate on the receipt", async () => {
    let voted = false;
    writeJoinIdentity(window.localStorage, "invite-token", {
      joinKey: "a".repeat(32),
      displayName: "Ana",
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
});

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}
