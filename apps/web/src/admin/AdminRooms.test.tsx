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
    fireEvent.change(screen.getByLabelText("Quórum"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar sala" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Quórum inválido.");
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
    expect(within(item).getByRole("button", { name: "Abrir escrutínio" })).toBeInTheDocument();
    expect(item).toHaveTextContent("Aberta");
  });

  it("closes a short round and shows that quorum failed", async () => {
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
            presentCount: 1,
            eligibleCount: 10,
            requiredCount: 4,
            quorumMet: false,
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
    fireEvent.click(await within(item).findByRole("button", { name: "Abrir escrutínio" }));
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

  it("sends the eligible count when the admin sets it and rejects a bad one", async () => {
    render(<AdminRooms />);
    await screen.findByDisplayValue("34");
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Assembleia" } });
    fireEvent.change(screen.getByLabelText("Aptos"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar sala" }));
    await screen.findByRole("link");

    const fetchMock = vi.mocked(fetch);
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    const body = JSON.parse(String(post?.[1]?.body)) as { eligibleCount?: number };
    expect(body.eligibleCount).toBe(40);

    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Outra" } });
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
