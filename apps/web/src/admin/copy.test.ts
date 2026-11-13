import { describe, expect, it } from "vitest";
import {
  FAILED_QUORUM_MESSAGE,
  quorumLabel,
  quorumStateLabel,
  roundErrorMessage,
  showsPresence,
} from "./copy";

describe("presence copy", () => {
  it("only counts open or voting rooms", () => {
    expect(showsPresence("open")).toBe(true);
    expect(showsPresence("voting")).toBe(true);
    expect(showsPresence("draft")).toBe(false);
    expect(showsPresence("closed")).toBe(false);
    expect(showsPresence("cancelled")).toBe(false);
  });

  it("compares presence with the required quorum", () => {
    expect(quorumLabel(1, 4)).toBe("1 / 4");
    expect(quorumStateLabel(false)).toBe("Abaixo do quórum");
    expect(quorumStateLabel(true)).toBe("Quórum atingido");
    expect(FAILED_QUORUM_MESSAGE).toBe(
      "Quórum não atingido. O escrutínio foi encerrado sem eleger ninguém.",
    );
    expect(roundErrorMessage("room_not_open")).toBe("Abra a sala antes do escrutínio.");
    expect(roundErrorMessage("round_already_open")).toBe("Já existe um escrutínio aberto.");
    expect(roundErrorMessage("round_not_open")).toBe("Esse escrutínio não está aberto.");
    expect(roundErrorMessage("failed_quorum")).toBe("Não foi possível atualizar o escrutínio.");
  });
});
