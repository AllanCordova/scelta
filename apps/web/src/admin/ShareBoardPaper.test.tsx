import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShareBoardPaper, formatShareBoardText } from "./ShareBoardPaper";

describe("ShareBoardPaper", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders originSummary when paper votes are present and omits it when paper is zero", () => {
    render(
      <ShareBoardPaper
        open={true}
        roomTitle="Eleição de Presbíteros"
        ministryLabel="Presbítero"
        entries={[
          {
            officeLabel: "Presbítero",
            winnerName: "Paulo Apóstolo",
            originSummary: { total: 5, online: 3, paper: 2 },
          },
          {
            officeLabel: "Diácono",
            winnerName: "Estevão",
            originSummary: { total: 4, online: 4, paper: 0 },
          },
        ]}
        onClose={() => undefined}
      />,
    );

    const origins = screen.getAllByTestId("share-paper-origin");
    expect(origins).toHaveLength(1);
    expect(origins[0]).toHaveTextContent("(Total: 5 — Online: 3 · Papel: 2)");

    const text = formatShareBoardText("Eleição de Presbíteros", "Presbítero", [
      {
        officeLabel: "Presbítero",
        winnerName: "Paulo Apóstolo",
        originSummary: { total: 5, online: 3, paper: 2 },
      },
      {
        officeLabel: "Diácono",
        winnerName: "Estevão",
        originSummary: { total: 4, online: 4, paper: 0 },
      },
    ]);
    expect(text).toContain("• Presbítero: Paulo Apóstolo (Total: 5 — Online: 3 · Papel: 2)");
    expect(text).toContain("• Diácono: Estevão\n");
  });
});
