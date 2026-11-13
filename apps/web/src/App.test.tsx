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

    expect((await screen.findAllByRole("button", { name: "Entrar" })).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cadastrar" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Scelta" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Membros" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nova sala" })).not.toBeInTheDocument();
  });

  it("shows the signed-in name and icon", async () => {
    installSession(admin);
    render(<App />);

    const name = await screen.findByText("Ana Admin");
    const identityLink = name.closest(".account-identity");
    expect(identityLink).toHaveAttribute("href", "/admin/perfil");
    expect(identityLink?.querySelector(".header-avatar-initials")?.textContent).toBe("AA");
    const salas = screen.getAllByRole("link", { name: "Salas" });
    expect(salas.length).toBeGreaterThan(0);
    expect(salas.every((link) => link.getAttribute("href") === "/admin/salas")).toBe(true);
    const adminLinks = screen.getAllByRole("link", { name: "Admin" });
    expect(adminLinks.length).toBeGreaterThan(0);
    expect(adminLinks.every((link) => link.getAttribute("href") === "/admin")).toBe(true);
    expect(screen.queryByRole("link", { name: "Membros" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Criar sala" })).not.toBeInTheDocument();
  });

  it("shows an invalid invite instead of the home page", async () => {
    window.history.pushState(null, "", "/join/exemplo");
    installSession(null);
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Convite inválido ou expirado.");
    expect(screen.queryByRole("heading", { name: "Votação com ordem e clareza" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nova sala" })).not.toBeInTheDocument();
  });

  it("shows admin hub on /admin to an admin", async () => {
    window.history.pushState(null, "", "/admin");
    installSession(admin);
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Administração" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Códigos de Acesso/i })).toHaveAttribute(
      "href",
      "/admin/codigos",
    );
    expect(screen.getByRole("link", { name: /Membros da Plataforma/i })).toHaveAttribute(
      "href",
      "/admin/membros",
    );
  });

  it("shows room management on /admin/salas to an admin", async () => {
    window.history.pushState(null, "", "/admin/salas");
    installSession(admin);
    render(<App />);

    expect(await screen.findByRole("button", { name: "Criar sala" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Token de administrador")).not.toBeInTheDocument();
  });

  it("shows access codes management on /admin/codigos to an admin", async () => {
    window.history.pushState(null, "", "/admin/codigos");
    installSession(admin);
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Códigos de Acesso" })).toBeInTheDocument();
  });

  it("shows member roll import on /admin/membros to an admin", async () => {
    window.history.pushState(null, "", "/admin/membros");
    installSession(admin);
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Rol de membros" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Baixar template CSV" })).toBeInTheDocument();
  });

  it("shows room detail page on /admin/salas/:roomId to an admin", async () => {
    window.history.pushState(null, "", "/admin/salas/11111111-2222-4333-8444-555555555555");
    installSession(admin);
    render(<App />);

    expect(
      await screen.findByRole("link", { name: /Voltar para Painel de Salas/i }),
    ).toBeInTheDocument();
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
      if (url.includes("/v1/admin/members/suggestions")) {
        return json({ suggestions: [] });
      }
      if (url.endsWith("/v1/admin/members")) {
        return json({ members: [] });
      }
      if (url.includes("/v1/join/")) {
        return json({ error: "invite_not_found" }, 404);
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
