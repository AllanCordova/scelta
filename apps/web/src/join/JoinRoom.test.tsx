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
    expect(screen.getByText("Sua escolha")).toBeInTheDocument();
    expect(screen.getByText("Paulo")).toBeInTheDocument();
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

  it("shows the wisdom verse on the ballot and toggles office guidance with Ler mais", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/join/invite-token") && init?.method === "POST") {
          return json({
            title: "Diretoria UPA",
            status: "open",
            displayName: "Maria",
            presentCount: 1,
            alreadyJoined: false,
          });
        }
        if (url.endsWith("/v1/join/invite-token")) {
          return json({ title: "Diretoria UPA", status: "open", canJoin: true });
        }
        if (url.endsWith("/v1/join/invite-token/ballot")) {
          return json({
            roomStatus: "open",
            roomType: "upa_board",
            candidates: [{ id: "c1", displayName: "Paulo" }],
            offices: [
              {
                officeLabel: "Presidente",
                order: 1,
                status: "elected",
                winnerName: "Melissa Cerconi",
                winnerPhotoUrl: "https://example.com/melissa.jpg",
              },
              {
                officeLabel: "Vice-Presidente",
                order: 2,
                status: "open",
                winnerName: null,
              },
            ],
            round: {
              id: "r1",
              number: 1,
              officeLabel: "Presidente",
              officeRoundNumber: 1,
              status: "open",
              outcome: null,
            },
          });
        }
        return json({});
      }),
    );

    render(<JoinRoom token="invite-token" />);

    fireEvent.change(await screen.findByLabelText("Código de acesso"), {
      target: { value: "A7K9M2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar na sala" }));

    expect(await screen.findByText(/Tiago 1:5/)).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Ler mais" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Sobre o cargo: Presidente")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Ler menos" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Sobre o cargo: Presidente")).toBeInTheDocument();
    expect(screen.getByText(/Convoca e preside as reuniões/)).toBeInTheDocument();
    expect(screen.queryByText(/Administra os recursos financeiros/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ler menos" }));
    expect(screen.queryByText("Sobre o cargo: Presidente")).not.toBeInTheDocument();

    expect(screen.getByText("Cargos da Diretoria")).toBeInTheDocument();
    const presidentCard = screen.getByText("1. Presidente").closest("li")!;
    expect(presidentCard).toHaveTextContent("Melissa Cerconi");
    expect(presidentCard.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/melissa.jpg",
    );
  });

  it("shows the complete new board paper to the voter once all multi-office votes are elected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/join/board-done-token") && !init) {
          return json({ title: "Assembleia UPA 2026", status: "closed", canJoin: true });
        }
        if (url.endsWith("/v1/join/board-done-token") && init?.method === "POST") {
          return json({
            title: "Assembleia UPA 2026",
            status: "closed",
            displayName: "Ana",
            presentCount: 15,
            alreadyJoined: true,
          });
        }
        if (url.endsWith("/v1/join/board-done-token/ballot")) {
          return json({
            roomStatus: "closed",
            roomType: "upa_board",
            candidates: [],
            offices: [
              {
                officeLabel: "Presidente",
                order: 1,
                status: "elected",
                winnerName: "Melissa Cerconi",
                winnerPhotoUrl: "https://example.com/melissa.jpg",
              },
              {
                officeLabel: "Vice-Presidente",
                order: 2,
                status: "elected",
                winnerName: "Heloísa Pires",
                winnerPhotoUrl: null,
              },
            ],
            round: {
              id: "round-2",
              number: 2,
              officeLabel: "Vice-Presidente",
              officeRoundNumber: 1,
              status: "closed",
              outcome: "elected",
            },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    render(<JoinRoom token="board-done-token" />);

    fireEvent.change(await screen.findByLabelText("Código de acesso"), {
      target: { value: "A7K9M2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar na sala" }));

    const boardPaper = await screen.findByRole("article", {
      name: "Nova Diretoria Eleita — Assembleia UPA 2026",
    });
    expect(boardPaper).toHaveTextContent("Diretoria UPA");
    expect(boardPaper).toHaveTextContent("Nova Diretoria Eleita");
    expect(boardPaper).toHaveTextContent("Presidente");
    expect(boardPaper).toHaveTextContent("Melissa Cerconi");
    expect(boardPaper).toHaveTextContent("Vice-Presidente");
    expect(boardPaper).toHaveTextContent("Heloísa Pires");
    expect(boardPaper).toHaveTextContent("HP");
    expect(boardPaper).toHaveTextContent("1 Pedro 4:10");
    expect(boardPaper.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/melissa.jpg",
    );
    expect(screen.queryByText("Cargos da Diretoria")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Resultado do escrutínio")).not.toBeInTheDocument();
    expect(screen.queryByText("Apuração dos votos")).not.toBeInTheDocument();
  });

  it("paginates voter ballot candidates (12 per page) and closed standings (10 per page)", async () => {
    const manyCandidates = Array.from({ length: 14 }, (_, index) => ({
      id: `cand-${index + 1}`,
      displayName: `Irmão ${String(index + 1).padStart(2, "0")}`,
    }));
    let isClosed = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/join/paged-token") && !init) {
          return json({ title: "Assembleia Geral", status: "voting", canJoin: true });
        }
        if (url.endsWith("/v1/join/paged-token") && init?.method === "POST") {
          return json({
            title: "Assembleia Geral",
            status: "voting",
            displayName: "Ana",
            presentCount: 20,
            alreadyJoined: true,
          });
        }
        if (url.endsWith("/v1/join/paged-token/ballot")) {
          if (!isClosed) {
            return json({
              roomStatus: "voting",
              roomType: "elder",
              candidates: manyCandidates,
              round: { id: "round-1", number: 1, status: "open", outcome: null },
            });
          }
          return json({
            roomStatus: "voting",
            roomType: "elder",
            candidates: manyCandidates,
            round: {
              id: "round-1",
              number: 1,
              status: "closed",
              outcome: "no_majority",
              tally: {
                totalVotes: 20,
                threshold: 11,
                outcome: "no_majority",
                winnerId: null,
                winnerName: null,
                standings: manyCandidates.map((c, idx) => ({
                  candidateId: c.id,
                  displayName: c.displayName,
                  votes: idx < 10 ? 2 : 0,
                })),
              },
            },
          });
        }
        if (url.includes("/v1/join/paged-token/ballot/receipt")) {
          return json({ roundId: "round-1", hasVoted: false });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    render(<JoinRoom token="paged-token" />);

    fireEvent.change(await screen.findByLabelText("Código de acesso"), {
      target: { value: "A7K9M2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar na sala" }));

    expect(await screen.findByText("Página 1 de 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Irmão 01" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Irmão 13" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Irmão 13" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Irmão 01" })).not.toBeInTheDocument();

    // Now test standings pagination in closed round
    isClosed = true;
    const { unmount } = render(<JoinRoom token="paged-token" />);
    expect(await screen.findAllByText("Página 1 de 2")).not.toHaveLength(0);
    unmount();
  });

  it("renders the cargo banner inside the Cédula Eleitoral section when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/v1/join/banner-token") && method === "GET") {
          return json({ title: "Diretoria UPA", status: "open", canJoin: true });
        }
        if (url.endsWith("/v1/join/banner-token") && method === "POST") {
          return json({
            title: "Diretoria UPA",
            status: "open",
            displayName: "Maria",
            presentCount: 1,
            alreadyJoined: false,
          });
        }
        if (url.endsWith("/v1/join/banner-token/ballot")) {
          return json({
            roomStatus: "open",
            roomType: "upa_board",
            officeBanners: {
              Presidente: "https://example.com/presidente-banner.png",
            },
            activeBannerUrl: "https://example.com/presidente-banner.png",
            candidates: [
              { id: "cand-1", displayName: "Paulo Apóstolo", photoUrl: null },
              { id: "cand-2", displayName: "Silas", photoUrl: null },
            ],
            round: {
              id: "round-1",
              number: 1,
              officeLabel: "Presidente",
              status: "open",
              outcome: null,
              tally: null,
            },
          });
        }
        if (url.endsWith("/v1/join/banner-token/ballot/receipt")) {
          return json({ roundId: "round-1", hasVoted: false });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    render(<JoinRoom token="banner-token" />);

    fireEvent.change(await screen.findByLabelText("Código de acesso"), {
      target: { value: "A7K9M2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar na sala" }));

    const banner = await screen.findByAltText("Banner do cargo Presidente");
    expect(banner).toHaveAttribute("src", "https://example.com/presidente-banner.png");
    expect(banner.closest(".voter-scrutiny-brief")).not.toBeNull();
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
