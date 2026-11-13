import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AuthPages Zod validation", () => {
  it("highlights invalid fields and shows inline errors on LoginPage without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    const emailInput = screen.getByLabelText("E-mail");
    const passwordInput = screen.getByLabelText("Senha");
    expect(emailInput).toHaveAttribute("aria-invalid", "true");
    expect(passwordInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Informe seu e-mail.");
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(emailInput, { target: { value: "not-an-email" } });
    expect(emailInput).toHaveAttribute("aria-invalid", "false");
    fireEvent.change(passwordInput, { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(emailInput).toHaveAttribute("aria-invalid", "true");
    expect(passwordInput).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByRole("alert")).toHaveTextContent("Informe um e-mail válido.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
