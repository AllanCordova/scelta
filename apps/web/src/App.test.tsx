import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { SessionUser } from "./auth/types";

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn(async () => "data:image/png;base64,invite"),
  },
}));

const admin: SessionUser = {
  id: "user-1",
  name: "Ana Admin",
  email: "ana@igreja.local",
  role: "admin",
};

const member: SessionUser = {
  id: "user-2",
  name: "Mia Membro",
  email: "mia@igreja.local",
  role: "member",
};

describe("App access", () => {
  beforeEach(() => {
    window.history.pushState(null, "", "/");
  });

  it("shows login actions and keeps the home page free of the admin form", async () => {
    installSession(null);
    render(<App />);

    expect(await screen.findByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cadastrar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Scelta" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("heading", { name: "Nova sala" })).not.toBeInTheDocument();
  });

  it("shows the signed-in name and icon", async () => {
    installSession(admin);
    render(<App />);

    const name = await screen.findByText("Ana Admin");
    expect(name.closest(".account-identity")?.querySelector("svg")).toBeTruthy();
    const salas = screen.getAllByRole("link", { name: "Salas" });
    expect(salas.length).toBeGreaterThan(0);
    expect(salas.every((link) => link.getAttribute("href") === "/admin")).toBe(true);
    expect(screen.queryByRole("button", { name: "Entrar" })).not.toBeInTheDocument();
  });

  it("asks an anonymous visitor to log in before the admin screen", async () => {
    window.history.pushState(null, "", "/admin");
    installSession(null);
    render(<App />);

    expect(await screen.findByLabelText("E-mail")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nova sala" })).not.toBeInTheDocument();
  });

  it("hides room management from a member", async () => {
    window.history.pushState(null, "", "/admin");
    installSession(member);
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Esta área é só para administradores.");
    expect(screen.getByText("Mia Membro")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Criar sala" })).not.toBeInTheDocument();
  });

  it("shows room management to an admin", async () => {
    window.history.pushState(null, "", "/admin");
    installSession(admin);
    render(<App />);

    expect(await screen.findByRole("button", { name: "Criar sala" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Token de administrador")).not.toBeInTheDocument();
  });
});

function installSession(user: SessionUser | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/auth/me")) {
        return user ? json({ user }) : json({ error: "unauthorized" }, 401);
      }
      if (url.endsWith("/v1/rules/presets")) {
        return json({ presets: [] });
      }
      if (url.endsWith("/v1/admin/rooms")) {
        return json({ rooms: [] });
      }
      return json({ error: "unknown" }, 500);
    }),
  );
}

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}
