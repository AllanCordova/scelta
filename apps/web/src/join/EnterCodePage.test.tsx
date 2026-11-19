import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EnterCodePage } from "./EnterCodePage";

describe("EnterCodePage", () => {
  it("validates fields and shows inline errors before navigating", () => {
    const onNavigate = vi.fn();
    render(<EnterCodePage onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "Entrar na sala" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Informe o código da sala.");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("normalizes room short code and personal code and navigates to /s/:shortCode?c=:code", () => {
    const onNavigate = vi.fn();
    render(<EnterCodePage onNavigate={onNavigate} />);

    fireEvent.change(screen.getByLabelText("Código da sala"), { target: { value: " k7m-2p9 " } });
    fireEvent.change(screen.getByLabelText("Seu código"), { target: { value: "a7k9m2" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar na sala" }));

    expect(onNavigate).toHaveBeenCalledWith("/s/K7M2P9?c=A7K9M2");
  });
});
