import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OfficeProgressGrid } from "./OfficeProgressGrid";

afterEach(() => {
  cleanup();
});

describe("OfficeProgressGrid", () => {
  it("renders each office as a card with photo when present, initials fallback, and pending status", () => {
    render(
      <OfficeProgressGrid
        offices={[
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
            winnerName: "Heloísa Pires Romio",
            winnerPhotoUrl: null,
          },
          {
            officeLabel: "1º Secretário",
            order: 3,
            status: "open",
            winnerName: null,
          },
          {
            officeLabel: "2º Secretário",
            order: 4,
            status: "in_progress",
            roundCount: 2,
            winnerName: null,
          },
          {
            officeLabel: "Tesoureiro",
            order: 5,
            status: "pending",
            winnerName: null,
          },
        ]}
      />,
    );

    const presidentCard = screen.getByText("1. Presidente").closest("li")!;
    expect(presidentCard).toHaveTextContent("Melissa Cerconi");
    expect(presidentCard.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/melissa.jpg",
    );

    const viceCard = screen.getByText("2. Vice-Presidente").closest("li")!;
    expect(viceCard).toHaveTextContent("HR");
    expect(viceCard).toHaveTextContent("Heloísa Pires Romio");
    expect(viceCard.querySelector("img")).toBeNull();

    const firstSecretaryCard = screen.getByText("3. 1º Secretário").closest("li")!;
    expect(firstSecretaryCard).toHaveClass("open");
    expect(firstSecretaryCard).toHaveTextContent("Em votação");
    expect(firstSecretaryCard).toHaveTextContent("•");

    const secondSecretaryCard = screen.getByText("4. 2º Secretário").closest("li")!;
    expect(secondSecretaryCard).toHaveTextContent("Em andamento (2º escrutínio)");
    expect(secondSecretaryCard).toHaveTextContent("—");

    const treasurerCard = screen.getByText("5. Tesoureiro").closest("li")!;
    expect(treasurerCard).toHaveTextContent("Aguardando");
  });

  it("handles single-word initials and missing winnerName fallback", () => {
    render(
      <OfficeProgressGrid
        offices={[
          {
            officeLabel: "Presidente",
            order: 1,
            status: "elected",
            winnerName: "Paulo",
          },
          {
            officeLabel: "Vice-Presidente",
            order: 2,
            status: "elected",
            winnerName: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("1. Presidente").closest("li")).toHaveTextContent("PA");
    const viceCard = screen.getByText("2. Vice-Presidente").closest("li")!;
    expect(viceCard).toHaveTextContent("Confirmado");
    expect(viceCard).toHaveTextContent("CO");
  });
});
