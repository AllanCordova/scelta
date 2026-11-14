import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoomChatPanel } from "./RoomChatPanel";

vi.mock("socket.io-client", () => ({
  io: () => ({
    on: () => undefined,
    off: () => undefined,
    emit: () => undefined,
    disconnect: () => undefined,
  }),
}));

describe("RoomChatPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lets voters send text messages and emotes, handles 429 rate limit, and toggles mobile overlay", async () => {
    let postCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("/v1/join/chat-tok/chat") && method === "GET") {
          return json({
            roomId: "room-1",
            chatMuted: false,
            participantMuted: false,
            allowedEmotes: ["👏", "🙏"],
            messages: [],
          });
        }
        if (url.endsWith("/v1/join/chat-tok/chat") && method === "POST") {
          postCount += 1;
          if (postCount === 3) {
            return json({ error: "chat_rate_limited" }, 429);
          }
          const body = JSON.parse(String(init?.body ?? "{}")) as { content: string };
          return json(
            {
              message: {
                id: `msg-${postCount}`,
                senderName: "Maria",
                senderRole: "voter",
                content: body.content,
                createdAt: "2026-11-13T22:00:00.000Z",
              },
            },
            201,
          );
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    render(<RoomChatPanel mode="voter" roomId="room-1" token="chat-tok" joinKey="jk-1" />);

    const fab = screen.getByRole("button", { name: "Abrir chat ao vivo" });
    fireEvent.click(fab);
    expect(screen.getByLabelText("Chat ao vivo da sala")).toHaveClass("is-open");

    fireEvent.change(screen.getByLabelText("Mensagem no chat"), {
      target: { value: "Olá irmãos!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("Olá irmãos!")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enviar emote 👏" }));
    expect(await screen.findByText("👏", { selector: ".room-chat-message-text" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enviar emote 🙏" }));
    expect(
      await screen.findByText("Limite de 2 mensagens a cada 5 segundos. Aguarde um instante."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    expect(screen.getByLabelText("Chat ao vivo da sala")).toHaveClass("is-fullscreen");
    fireEvent.click(screen.getByRole("button", { name: "Sair da tela cheia" }));
    expect(screen.getByLabelText("Chat ao vivo da sala")).not.toHaveClass("is-fullscreen");
    expect(screen.queryByRole("button", { name: "Remover mensagem" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fechar chat" }));
    expect(screen.getByLabelText("Chat ao vivo da sala")).not.toHaveClass("is-open");
  });

  it("lets admins mute the whole room or individual participants and delete messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/v1/admin/rooms/room-1/chat") && method === "GET") {
          return json({
            roomId: "room-1",
            chatMuted: false,
            allowedEmotes: ["👏"],
            messages: [
              {
                id: "msg-1",
                senderName: "João",
                senderRole: "voter",
                senderParticipantId: "part-1",
                content: "Mensagem de teste",
                createdAt: "2026-11-13T22:00:00.000Z",
              },
            ],
            participants: [
              {
                id: "part-1",
                displayName: "João",
                isPresent: true,
                chatMuted: false,
                joinedAt: "2026-11-13T22:00:00.000Z",
              },
            ],
          });
        }
        if (url.endsWith("/v1/admin/rooms/room-1/chat/msg-1") && method === "DELETE") {
          return json({ deleted: true, messageId: "msg-1" });
        }
        if (url.endsWith("/v1/admin/rooms/room-1") && method === "PATCH") {
          return json({ room: { id: "room-1", chatMuted: true } });
        }
        if (url.endsWith("/v1/admin/rooms/room-1/participants/part-1/mute") && method === "PATCH") {
          return json({
            participant: {
              id: "part-1",
              displayName: "João",
              isPresent: true,
              chatMuted: true,
              joinedAt: "2026-11-13T22:00:00.000Z",
            },
          });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    render(<RoomChatPanel mode="admin" roomId="room-1" />);

    expect(await screen.findByText("Mensagem de teste")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remover mensagem" }));
    await waitFor(() => {
      expect(screen.queryByText("Mensagem de teste")).not.toBeInTheDocument();
    });

    const pessoasBtn = await screen.findByRole("button", { name: "Pessoas (1)" });
    fireEvent.click(pessoasBtn);
    expect(await screen.findByText("João")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Silenciar" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Liberar" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Silenciar sala" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Liberar sala" })).toBeInTheDocument();
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
