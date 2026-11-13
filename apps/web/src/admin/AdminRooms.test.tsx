import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import QRCode from "qrcode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminRooms } from "./AdminRooms";

vi.mock("socket.io-client", () => ({
  io: () => ({
    on: () => undefined,
    off: () => undefined,
    emit: () => undefined,
    disconnect: () => undefined,
  }),
}));

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn(async () => "data:image/png;base64,invite"),
  },
}));

const presets = [
  {
    preset: "ipb_local_officers",
    quorumValue: 34,
    quorumUnit: "percent",
    majorityRule: "absolute_majority",
    roundBehavior: "most voted",
  },
  {
    preset: "ipb_society_board",
    quorumValue: 51,
    quorumUnit: "percent",
    majorityRule: "absolute_majority",
    roundBehavior: "top two",
  },
  {
    preset: "custom",
    quorumValue: null,
    quorumUnit: null,
    majorityRule: "absolute_majority",
    roundBehavior: "manual",
  },
];

describe("AdminRooms", () => {
  beforeEach(() => {
    listedRoom = null;
    vi.stubGlobal("fetch", vi.fn(handleFetch));
  });

  it("pre-fills quorum when the admin picks a rules preset", async () => {
    render(<AdminRooms />);

    expect(await screen.findByDisplayValue("34")).toBeInTheDocument();
    expect(screen.getByText(/mais votados/)).toBeInTheDocument();

    fireEvent.click(within(rulesGroup()).getByRole("button", { name: "Personalizado" }));
    expect(await screen.findByText(/Sem rodada automática/)).toBeInTheDocument();
    expect(screen.getByText(/Mais de 50%/)).toBeInTheDocument();

    fireEvent.click(within(rulesGroup()).getByRole("button", { name: "Diretoria de sociedade" }));

    expect(await screen.findByDisplayValue("51")).toBeInTheDocument();
    expect(screen.getByText(/dois mais votados/)).toBeInTheDocument();
  });

  it("shows the invite link and QR after creating a room", async () => {
    render(<AdminRooms />);
    await screen.findByDisplayValue("34");

    fireEvent.change(screen.getByLabelText("Título"), {
      target: { value: "Eleição de presbíteros" },
    });
    fireEvent.change(screen.getByLabelText("Candidatos"), {
      target: { value: "Paulo, Silas" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar sala" }));

    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "http://localhost:3000/join/invite-token");
    const fetchMock = vi.mocked(fetch);
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    const body = JSON.parse(String(post?.[1]?.body)) as { eligibleCount?: number };
    expect(body.eligibleCount).toBeUndefined();
    expect(await screen.findByTestId("invite-qr")).toHaveAttribute(
      "src",
      "data:image/png;base64,invite",
    );
    expect(QRCode.toDataURL).toHaveBeenCalledWith("http://localhost:3000/join/invite-token", {
      margin: 1,
      width: 180,
    });
    expect(await screen.findByRole("list", { name: "Salas" })).toHaveTextContent("Rascunho");
  });

  it("shows a validation error when quorum is rejected", async () => {
    render(<AdminRooms />);
    await screen.findByDisplayValue("34");

    fireEvent.change(screen.getByLabelText("Título"), {
      target: { value: "Assembleia" },
    });
    fireEvent.change(screen.getByLabelText("Candidatos"), {
      target: { value: "Paulo, Silas" },
    });
    fireEvent.click(within(rulesGroup()).getByRole("button", { name: "Personalizado" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Quórum")).toHaveValue("");
    });
    fireEvent.change(screen.getByLabelText("Quórum"), {
      target: { value: "101" },
    });
    fireEvent.change(screen.getByLabelText("Unidade do quórum"), {
      target: { value: "percent" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar sala" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Quórum inválido.");
  });

  it("does not submit a blank quorum as the hidden preset default", async () => {
    render(<AdminRooms />);
    await screen.findByDisplayValue("34");

    fireEvent.change(screen.getByLabelText("Título"), {
      target: { value: "Assembleia" },
    });
    fireEvent.change(screen.getByLabelText("Candidatos"), {
      target: { value: "Paulo, Silas" },
    });
    fireEvent.change(screen.getByLabelText("Quórum"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar sala" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Quórum inválido.");
    const fetchMock = vi.mocked(fetch);
    const posted = fetchMock.mock.calls.some(([, init]) => init?.method === "POST");
    expect(posted).toBe(false);
  });

  it("rejects creating a room without candidates", async () => {
    render(<AdminRooms />);
    await screen.findByDisplayValue("34");

    fireEvent.change(screen.getByLabelText("Título"), {
      target: { value: "Assembleia" },
    });
    fireEvent.change(screen.getByLabelText("Candidatos"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar sala" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Informe ao menos um candidato.");
    const fetchMock = vi.mocked(fetch);
    const posted = fetchMock.mock.calls.some(([, init]) => init?.method === "POST");
    expect(posted).toBe(false);
  });

  it("shows presence against the required quorum for an open room", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/rules/presets")) {
          return json({ presets });
        }
        if (url.endsWith("/presence")) {
          return json({
            presentCount: 1,
            eligibleCount: 10,
            requiredCount: 4,
            quorumMet: false,
          });
        }
        return json({
          rooms: [{ id: "room-1", title: "Assembleia aberta", status: "open", round: null }],
        });
      }),
    );

    render(<AdminRooms />);

    const item = await screen.findByRole("listitem");
    expect(item).toHaveTextContent("Assembleia aberta");
    expect(await within(item).findByText("1 / 4")).toBeInTheDocument();
    expect(item).toHaveTextContent("Abaixo do quórum");
    expect(within(item).getByRole("button", { name: "Abrir escrutínio" })).toBeDisabled();
    expect(item).toHaveTextContent("Aberta");
  });

  it("opens when quorum is met and shows failed_quorum guidance if presence drops before close", async () => {
    const room = {
      id: "room-1",
      title: "Assembleia aberta",
      status: "open",
      round: null as null | {
        id: string;
        number: number;
        status: string;
        outcome: string | null;
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/rules/presets")) {
          return json({ presets });
        }
        if (url.endsWith("/presence")) {
          return json({
            presentCount: 4,
            eligibleCount: 10,
            requiredCount: 4,
            quorumMet: true,
          });
        }
        if (url.endsWith("/close") && init?.method === "POST") {
          room.round = { id: "round-1", number: 1, status: "closed", outcome: "failed_quorum" };
          return json({ round: room.round });
        }
        if (url.endsWith("/rounds") && init?.method === "POST") {
          room.round = { id: "round-1", number: 1, status: "open", outcome: null };
          return json({ round: room.round }, 201);
        }
        return json({ rooms: [{ ...room }] });
      }),
    );

    render(<AdminRooms />);
    const item = await screen.findByRole("listitem");
    const openBtn = await within(item).findByRole("button", { name: "Abrir escrutínio" });
    await waitFor(() => {
      expect(openBtn).toBeEnabled();
    });

    fireEvent.click(openBtn);
    fireEvent.click(await within(item).findByRole("button", { name: "Encerrar escrutínio" }));

    expect(await within(item).findByRole("status")).toHaveTextContent(
      "Quórum não atingido. O escrutínio foi encerrado sem eleger ninguém.",
    );
    expect(within(item).getByRole("button", { name: "Abrir escrutínio" })).toBeInTheDocument();
  });

  it("shows quorum met and round error messages when a round action fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/rules/presets")) {
          return json({ presets });
        }
        if (url.endsWith("/presence")) {
          return json({
            presentCount: 4,
            eligibleCount: 10,
            requiredCount: 4,
            quorumMet: true,
          });
        }
        if (url.endsWith("/rounds") && init?.method === "POST") {
          return json({ error: "round_already_open" }, 409);
        }
        return json({
          rooms: [{ id: "room-1", title: "Assembleia cheia", status: "open", round: null }],
        });
      }),
    );

    render(<AdminRooms />);
    const item = await screen.findByRole("listitem");
    expect(await within(item).findByText("4 / 4")).toBeInTheDocument();
    expect(item).toHaveTextContent("Quórum atingido");

    fireEvent.click(within(item).getByRole("button", { name: "Abrir escrutínio" }));
    expect(await within(item).findByRole("alert")).toHaveTextContent(
      "Já existe um escrutínio aberto.",
    );
  });

  it("displays the automatic tally and candidate standings when a round closes with votes", async () => {
    const room = {
      id: "room-1",
      title: "Eleição de diáconos",
      status: "open",
      round: {
        id: "round-1",
        number: 1,
        status: "open",
        outcome: null as string | null,
        tally: undefined as
          | undefined
          | {
              totalVotes: number;
              threshold: number;
              outcome: "elected" | "no_majority";
              winnerId: string | null;
              winnerName: string | null;
              standings: { candidateId: string; displayName: string; votes: number }[];
            },
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/rules/presets")) {
          return json({ presets });
        }
        if (url.endsWith("/presence")) {
          return json({
            presentCount: 2,
            eligibleCount: 2,
            requiredCount: 2,
            quorumMet: true,
          });
        }
        if (url.endsWith("/close") && init?.method === "POST") {
          room.round = {
            id: "round-1",
            number: 1,
            status: "closed",
            outcome: "elected",
            tally: {
              totalVotes: 2,
              threshold: 2,
              outcome: "elected",
              winnerId: "cand-1",
              winnerName: "Paulo",
              standings: [
                { candidateId: "cand-1", displayName: "Paulo", votes: 2 },
                { candidateId: "cand-2", displayName: "Silas", votes: 0 },
              ],
            },
          };
          return json({ round: room.round });
        }
        return json({ rooms: [{ ...room }] });
      }),
    );

    render(<AdminRooms />);
    const item = await screen.findByRole("listitem");
    fireEvent.click(await within(item).findByRole("button", { name: "Encerrar escrutínio" }));

    expect(await within(item).findByRole("status")).toHaveTextContent(
      "Eleito por maioria absoluta: Paulo",
    );
    expect(within(item).getByText("Paulo: 2 votos")).toBeInTheDocument();
    expect(within(item).getByText("Silas: 0 votos")).toBeInTheDocument();
  });

  it("restarts an open round and displays the restarted notice", async () => {
    const room = {
      id: "room-1",
      title: "Assembleia em votação",
      status: "open",
      round: {
        id: "round-1",
        number: 1,
        status: "open",
        outcome: null as string | null,
        restartCount: undefined as number | undefined,
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/rules/presets")) {
          return json({ presets });
        }
        if (url.endsWith("/presence")) {
          return json({
            presentCount: 2,
            eligibleCount: 2,
            requiredCount: 2,
            quorumMet: true,
          });
        }
        if (url.endsWith("/restart") && init?.method === "POST") {
          room.round = {
            id: "round-1",
            number: 1,
            status: "open",
            outcome: null,
            restartCount: 1,
          };
          return json({ round: room.round });
        }
        return json({ rooms: [{ ...room }] });
      }),
    );

    render(<AdminRooms />);
    const item = await screen.findByRole("listitem");
    fireEvent.click(await within(item).findByRole("button", { name: "Reiniciar escrutínio" }));

    expect(
      await within(item).findByText("Escrutínio reiniciado — os votos anteriores foram limpos."),
    ).toBeInTheDocument();
  });

  it("sends the eligible count when the admin sets it and rejects a bad one", async () => {
    render(<AdminRooms />);
    await screen.findByDisplayValue("34");
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Assembleia" } });
    fireEvent.change(screen.getByLabelText("Candidatos"), { target: { value: "Paulo, Silas" } });
    fireEvent.change(screen.getByLabelText("Aptos"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar sala" }));
    await screen.findByRole("link");

    const fetchMock = vi.mocked(fetch);
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    const body = JSON.parse(String(post?.[1]?.body)) as { eligibleCount?: number };
    expect(body.eligibleCount).toBe(40);

    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Outra" } });
    fireEvent.change(screen.getByLabelText("Candidatos"), { target: { value: "Paulo, Silas" } });
    fireEvent.change(screen.getByLabelText("Aptos"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar sala" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Número de aptos inválido.");
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
  });

  it("shows a list failure instead of an empty room list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/rules/presets")) {
          return json({ presets });
        }
        return json({ error: "persistence_unavailable" }, 503);
      }),
    );

    render(<AdminRooms />);

    expect(await screen.findByRole("alert")).toHaveTextContent("A API está sem banco de dados.");
    expect(screen.queryByRole("list", { name: "Salas" })).not.toBeInTheDocument();
  });

  it("loads candidate suggestions by room type and allows toggling names before creating a room", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/rules/presets")) {
          return json({ presets });
        }
        if (url.includes("/v1/admin/members/suggestions?roomType=elder")) {
          return json({
            suggestions: [
              { memberId: "m-1", fullName: "Paulo Apóstolo" },
              { memberId: "m-2", fullName: "Silas Companheiro" },
            ],
          });
        }
        if (url.includes("/v1/admin/members/suggestions?roomType=upa_board")) {
          return json({
            suggestions: [{ memberId: "m-3", fullName: "Lídia de Tiatira" }],
          });
        }
        return handleFetch(input, init);
      }),
    );

    render(<AdminRooms />);
    await screen.findByDisplayValue("34");

    const suggestionsGroup = await screen.findByRole("group", {
      name: "Sugestões de candidatos",
    });
    const pauloButton = within(suggestionsGroup).getByRole("button", { name: "Paulo Apóstolo" });
    const silasButton = within(suggestionsGroup).getByRole("button", { name: "Silas Companheiro" });

    fireEvent.click(pauloButton);
    fireEvent.click(silasButton);
    expect(screen.getByLabelText("Candidatos")).toHaveValue("Paulo Apóstolo, Silas Companheiro");

    // Exclude Paulo before creating the room
    fireEvent.click(pauloButton);
    expect(screen.getByLabelText("Candidatos")).toHaveValue("Silas Companheiro");

    // Switch room type to Diretoria UPA and verify UPA suggestions load
    const typeGroup = screen.getByRole("group", { name: "Tipo" });
    fireEvent.click(within(typeGroup).getByRole("button", { name: "Diretoria UPA" }));
    expect(
      await within(suggestionsGroup).findByRole("button", { name: "Lídia de Tiatira" }),
    ).toBeInTheDocument();
  });

  it("opens the QR code, copies the link, and deletes an existing room from the list", async () => {
    const roomsList = [
      {
        id: "room-1",
        title: "Sala existente",
        status: "open",
        inviteToken: "token-existente",
        invitePath: "/join/token-existente",
        round: null,
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/rules/presets")) {
          return json({ presets });
        }
        if (url.includes("/v1/admin/members/suggestions")) {
          return json({ suggestions: [] });
        }
        if (url.endsWith("/presence")) {
          return json({
            presentCount: 1,
            eligibleCount: 2,
            requiredCount: 1,
            quorumMet: true,
          });
        }
        if (url.endsWith("/v1/admin/rooms/room-1") && init?.method === "DELETE") {
          roomsList.splice(0, roomsList.length);
          return new Response(null, { status: 204 });
        }
        return json({ rooms: [...roomsList] });
      }),
    );

    render(<AdminRooms />);
    const item = await screen.findByRole("listitem");
    expect(item).toHaveTextContent("Sala existente");

    // Open QR Code for the existing room
    fireEvent.click(within(item).getByRole("button", { name: "QR Code" }));
    expect(await screen.findByRole("link", { name: /\/join\/token-existente/ })).toBeInTheDocument();
    expect(await screen.findByTestId("invite-qr")).toBeInTheDocument();

    // Copy link for the existing room
    fireEvent.click(within(item).getByRole("button", { name: "Copiar link" }));
    expect(await within(item).findByRole("button", { name: "Link copiado" })).toBeInTheDocument();

    // Delete the existing room
    fireEvent.click(within(item).getByRole("button", { name: "Excluir" }));
    expect(await screen.findByText("Nenhuma sala ainda.")).toBeInTheDocument();
  });
});

function rulesGroup() {
  return screen.getByRole("group", { name: "Regras" });
}

let listedRoom: { id: string; title: string; status: string } | null = null;

function handleFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);

  if (url.endsWith("/v1/rules/presets")) {
    return json({ presets });
  }

  if (url.includes("/v1/admin/members/suggestions")) {
    return json({ suggestions: [] });
  }

  if (url.endsWith("/v1/admin/rooms") && init?.method === "POST") {
    const payload = JSON.parse(String(init.body)) as { quorumValue?: number; title?: string };
    if (payload.quorumValue === 101) {
      return json(
        { error: "invalid_room", details: [{ field: "quorumValue", code: "out_of_range" }] },
        400,
      );
    }

    listedRoom = {
      id: "room-1",
      title: payload.title ?? "Eleição de presbíteros",
      status: "draft",
    };
    return json({
      room: {
        id: "room-1",
        title: payload.title,
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 34,
        quorumUnit: "percent",
        status: "draft",
        inviteToken: "invite-token",
        invitePath: "/join/invite-token",
        majorityRule: "absolute_majority",
        roundBehavior: "most voted",
        createdAt: "2026-11-12T00:00:00.000Z",
      },
    });
  }

  return json({
    rooms: listedRoom ? [listedRoom] : [],
  });
}

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}
