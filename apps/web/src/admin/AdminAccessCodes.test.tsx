import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import QRCode from "qrcode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminAccessCodes } from "./AdminAccessCodes";
import type { MemberAccessCodeItem, RoomSummary } from "./types";

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

const sampleRoom: RoomSummary = {
  id: "room-1",
  title: "Assembleia Geral",
  roomType: "elder",
  rulesPreset: "ipb_local_officers",
  quorumValue: 2,
  quorumUnit: "absolute",
  eligibleCount: 0,
  majorityRule: "absolute_majority",
  roundBehavior: "ipb_sequential_rounds",
  status: "open",
  round: null,
  inviteToken: "token-initial",
  invitePath: "/join/token-initial",
  shortCode: "AB12CD",
  shortPath: "/s/AB12CD",
  createdAt: "2026-11-13T21:00:00.000Z",
};

const sampleCodes: MemberAccessCodeItem[] = [
  {
    id: "code-1",
    memberId: "mem-1",
    displayName: "Ana Silva",
    code: "123456",
    revokedAt: null,
    createdAt: "2026-11-13T21:05:00.000Z",
  },
  {
    id: "code-2",
    memberId: "mem-2",
    displayName: "Bruno Costa",
    code: "654321",
    revokedAt: "2026-11-13T21:06:00.000Z",
    createdAt: "2026-11-13T21:05:00.000Z",
  },
];

describe("AdminAccessCodes", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rotates invite token, hides raw URLs, copies code/link, and deletes an access code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    let currentRoom = sampleRoom;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/v1/admin/rooms") && method === "GET") {
          return json({ rooms: [currentRoom] });
        }
        if (url.endsWith("/v1/admin/rooms/room-1/access-codes") && method === "GET") {
          return json({ accessCodes: sampleCodes });
        }
        if (url.endsWith("/v1/admin/rooms/room-1/invite/rotate") && method === "POST") {
          currentRoom = {
            ...currentRoom,
            inviteToken: "token-rotated",
            invitePath: "/join/token-rotated",
          };
          return json({ room: currentRoom });
        }
        if (url.endsWith("/v1/admin/rooms/room-1/access-codes/code-2") && method === "DELETE") {
          return json({ deleted: true });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    render(<AdminAccessCodes />);

    expect(await screen.findByText("Ana Silva")).toBeInTheDocument();
    expect(document.querySelector(".access-code-url")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Copiar código" })[0]!);
    expect(writeText).toHaveBeenCalledWith("123456");

    fireEvent.click(screen.getByRole("button", { name: "Copiar link" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/join/token-initial?code=123456"));

    fireEvent.click(screen.getByRole("button", { name: "Rotacionar convite" }));
    fireEvent.click(screen.getByRole("button", { name: "Rotacionar mesmo assim" }));
    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: "Copiar link" }));
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("/join/token-rotated?code=123456"),
      );
    });

    const removeButtons = screen.getAllByRole("button", { name: "Remover" });
    fireEvent.click(removeButtons[1]!);
    const dialog = screen.getByRole("dialog", { name: "Remover código de acesso" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover" }));

    await waitFor(() => {
      expect(screen.queryByText("Bruno Costa")).not.toBeInTheDocument();
    });
  });

  it("uses PUBLIC_URL, shows origin mismatch warning, and paginates 37 cards into 5 A4 sheets with SVG QRs", async () => {
    const qrSpy = vi
      .spyOn(QRCode, "toString")
      .mockImplementation(async (content: string) => `<svg data-qr-content="${content}"><path /></svg>`);

    const manyCodes: MemberAccessCodeItem[] = Array.from({ length: 37 }, (_, index) => ({
      id: `code-${index + 1}`,
      memberId: `mem-${index + 1}`,
      displayName: `Membro ${String(index + 1).padStart(2, "0")}`,
      code: `C${String(index + 1).padStart(5, "0")}`,
      revokedAt: null,
      createdAt: "2026-11-13T21:05:00.000Z",
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/config")) {
          return json({ publicUrl: "https://vote.igrejapb.org" });
        }
        if (url.endsWith("/v1/admin/rooms")) {
          return json({ rooms: [sampleRoom] });
        }
        if (url.endsWith("/v1/admin/rooms/room-1/access-codes")) {
          return json({ accessCodes: manyCodes });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    render(<AdminAccessCodes />);

    const warning = await screen.findByTestId("public-url-mismatch-warning");
    expect(warning).toHaveTextContent("https://vote.igrejapb.org");

    fireEvent.click(await screen.findByRole("button", { name: /Imprimir cartões/i }));

    await waitFor(() => {
      const sheets = document.querySelectorAll(".print-sheet");
      expect(sheets).toHaveLength(5);
      expect(Array.from(sheets).map((sheet) => sheet.querySelectorAll(".print-card-item").length)).toEqual([
        8, 8, 8, 8, 5,
      ]);
    });

    expect(qrSpy).toHaveBeenCalledWith(
      "https://vote.igrejapb.org/s/AB12CD?c=C00001",
      expect.objectContaining({ type: "svg", errorCorrectionLevel: "Q", margin: 4 }),
    );
    const shortUrlLabels = document.querySelectorAll(".print-card-short-url");
    expect(shortUrlLabels[0]).toHaveTextContent("vote.igrejapb.org/s/AB12CD");
    expect(document.querySelectorAll(".print-card-qr svg")).toHaveLength(37);
  });

  it("prints a single card when clicking the per-row Imprimir cartão button", async () => {
    vi.spyOn(QRCode, "toString").mockImplementation(
      async (content: string) => `<svg data-qr-content="${content}"><path /></svg>`,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/admin/rooms")) {
          return json({ rooms: [sampleRoom] });
        }
        if (url.endsWith("/v1/admin/rooms/room-1/access-codes")) {
          return json({ accessCodes: sampleCodes });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    render(<AdminAccessCodes />);

    const printRowBtn = await screen.findByRole("button", { name: "Imprimir cartão" });
    fireEvent.click(printRowBtn);

    const dialog = await screen.findByRole("dialog", { name: "Cartões de acesso para impressão" });
    expect(dialog.querySelectorAll(".print-card-item")).toHaveLength(1);
    expect(within(dialog).getByText("Ana Silva")).toBeInTheDocument();
    expect(within(dialog).getByText("123456")).toBeInTheDocument();
  });
});
