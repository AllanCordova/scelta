import { describe, expect, it } from "vitest";
import { BALLOT_WISDOM_VERSE, officeGuidanceForBallot } from "./ballot-guidance";

describe("ballot-guidance", () => {
  it("exposes a standard wisdom verse reference", () => {
    expect(BALLOT_WISDOM_VERSE.reference).toBe("Tiago 1:5");
    expect(BALLOT_WISDOM_VERSE.text).toContain("sabedoria");
  });

  it("returns only the active office peculiarity for board elections", () => {
    const guidance = officeGuidanceForBallot("upa_board", "Tesoureiro");
    expect(guidance.title).toBe("Sobre o cargo: Tesoureiro");
    expect(guidance.officeLabel).toBe("Tesoureiro");
    expect(guidance.description).toContain("financeiros");
  });

  it("returns session board Vice-Presidente peculiarity for Mesa do Conselho", () => {
    const guidance = officeGuidanceForBallot("session_board", "Vice-Presidente");
    expect(guidance.title).toBe("Sobre o cargo: Vice-Presidente");
    expect(guidance.description).toContain("Pastor Presidente");
  });

  it("returns specific guidance for single-office elections such as Presbítero and Diácono", () => {
    const elder = officeGuidanceForBallot("elder", null);
    expect(elder.title).toBe("Sobre o cargo: Presbítero");
    expect(elder.description).toContain("governo espiritual");

    const deacon = officeGuidanceForBallot("deacon", null);
    expect(deacon.title).toBe("Sobre o cargo: Diácono");
    expect(deacon.description).toContain("misericórdia");

    const pastor = officeGuidanceForBallot("pastor", null);
    expect(pastor.title).toBe("Sobre o cargo: Pastor");
    expect(pastor.description).toContain("Palavra e dos Sacramentos");
  });

  it("falls back cleanly for unrecognized office labels and custom/undefined room types", () => {
    const unknownBoardOffice = officeGuidanceForBallot("upa_board", "Vogal");
    expect(unknownBoardOffice.title).toBe("Sobre o cargo: Vogal");
    expect(unknownBoardOffice.description).toContain("atribuições regimentais");

    const customRoom = officeGuidanceForBallot(undefined, null);
    expect(customRoom.title).toBe("Sobre o cargo: Deliberação da sala");
    expect(customRoom.description).toContain("edificação");
  });
});
