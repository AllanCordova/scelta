import { describe, expect, it } from "vitest";
import { parseIsoDate, parseMemberImportCsv } from "./member-import.js";

describe("parseMemberImportCsv", () => {
  it("parses valid rows with header columns including communicant, gender, birthDate, and society flags", () => {
    const csv = [
      "fullName,isCommunicant,gender,birthDate,upaActive,upaEnrolledAt",
      "Paulo Apóstolo,true,M,1980-05-14,false,",
      "Lídia de Tiatira,sim,F,1992-11-03,sim,2024-01-15",
      "Timóteo Jovem,,,,true,2025-06-01",
    ].join("\n");

    const result = parseMemberImportCsv(csv);
    expect(result.rejectedRows).toEqual([]);
    expect(result.validRows).toEqual([
      {
        line: 2,
        fullName: "Paulo Apóstolo",
        isCommunicant: true,
        isMale: true,
        birthDate: "1980-05-14",
        societyFlags: { upaActive: false },
      },
      {
        line: 3,
        fullName: "Lídia de Tiatira",
        isCommunicant: true,
        isMale: false,
        birthDate: "1992-11-03",
        societyFlags: { upaActive: true, upaEnrolledAt: "2024-01-15" },
      },
      {
        line: 4,
        fullName: "Timóteo Jovem",
        isCommunicant: true,
        isMale: null,
        birthDate: null,
        societyFlags: { upaActive: true, upaEnrolledAt: "2025-06-01" },
      },
    ]);
  });

  it("parses positional rows without headers and supports semicolon delimiters", () => {
    const csv = "Silas Irmão;não;masculino;1975-03-20;sim;2023-08-10";
    const result = parseMemberImportCsv(csv);

    expect(result.rejectedRows).toEqual([]);
    expect(result.validRows).toEqual([
      {
        line: 1,
        fullName: "Silas Irmão",
        isCommunicant: false,
        isMale: true,
        birthDate: "1975-03-20",
        societyFlags: { upaActive: true, upaEnrolledAt: "2023-08-10" },
      },
    ]);
  });

  it("collects rejected rows with line numbers and reasons without discarding valid rows", () => {
    const csv = [
      "nome,comungante,sexo,nascimento,upa_ativo,upa_ingresso",
      ",sim,M,1990-01-01,,",
      `${"A".repeat(121)},sim,M,1990-01-01,,`,
      "João,talvez,M,1990-01-01,,",
      "Maria,sim,X,1990-01-01,,",
      "Pedro,sim,M,2026-02-30,,",
      "Marta,sim,F,1995-04-12,invalido,",
      "Sara,sim,F,1995-04-12,sim,data-ruim",
      "Barnabé Consolador,sim,M,1982-09-10,nao,",
    ].join("\n");

    const result = parseMemberImportCsv(csv);
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]?.fullName).toBe("Barnabé Consolador");
    expect(result.rejectedRows).toEqual([
      { line: 2, reason: "missing_name" },
      { line: 3, reason: "name_too_long" },
      { line: 4, reason: "invalid_communicant" },
      { line: 5, reason: "invalid_gender" },
      { line: 6, reason: "invalid_birth_date" },
      { line: 7, reason: "invalid_society_flag" },
      { line: 8, reason: "invalid_society_date" },
    ]);
  });

  it("validates calendar dates in parseIsoDate", () => {
    expect(parseIsoDate("2024-02-29")).toBe("2024-02-29");
    expect(parseIsoDate("2025-02-29")).toBeNull();
    expect(parseIsoDate("1899-12-31")).toBeNull();
    expect(parseIsoDate("2026/01/01")).toBeNull();
  });
});
