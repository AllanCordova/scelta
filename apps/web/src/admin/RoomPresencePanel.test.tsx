import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomPresencePanel } from "./RoomPresencePanel";

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("RoomPresencePanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("releases a participant session after confirmation and refreshes the presence list", async () => {
    let participants = [
      { id: "part-1", displayName: "Ana Silva", joinedAt: "2026-11-19T12:00:00.000Z" },
      { id: "part-2", displayName: "Bruno Costa", joinedAt: "2026-11-19T12:01:00.000Z" },
    ];
    const onChanged = vi.fn();

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/v1/admin/rooms/room-1/participants") && method === "GET") {
        return json({ participants });
      }
      if (
        url.endsWith("/v1/admin/rooms/room-1/participants/part-1/release-session") &&
        method === "POST"
      ) {
        participants = participants.filter((p) => p.id !== "part-1");
        return json({
          released: true,
          participant: { id: "part-1", displayName: "Ana Silva", isPresent: false },
        });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RoomPresencePanel roomId="room-1" onChanged={onChanged} />);

    expect(await screen.findByText("Ana Silva")).toBeInTheDocument();
    const releaseButtons = screen.getAllByTestId("release-session-btn");
    expect(releaseButtons).toHaveLength(2);

    fireEvent.click(releaseButtons[0]!);

    const dialog = screen.getByRole("dialog", { name: "Liberar sessão" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Liberar sessão" }));

    await waitFor(() => {
      expect(screen.queryByText("Ana Silva")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Bruno Costa")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/admin/rooms/room-1/participants/part-1/release-session"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
