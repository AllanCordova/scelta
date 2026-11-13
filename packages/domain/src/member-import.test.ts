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
        photoUrl: null,
        societyFlags: { upaActive: false },
      },
      {
        line: 3,
        fullName: "Lídia de Tiatira",
        isCommunicant: true,
        isMale: false,
        birthDate: "1992-11-03",
        photoUrl: null,
        societyFlags: { upaActive: true, upaEnrolledAt: "2024-01-15" },
      },
      {
        line: 4,
        fullName: "Timóteo Jovem",
        isCommunicant: true,
        isMale: null,
        birthDate: null,
        photoUrl: null,
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
        photoUrl: null,
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
      { line: 3, name: "A".repeat(121), reason: "name_too_long" },
      { line: 4, name: "João", reason: "invalid_communicant" },
      { line: 5, name: "Maria", reason: "invalid_gender" },
      { line: 6, name: "Pedro", reason: "invalid_birth_date" },
      { line: 7, name: "Marta", reason: "invalid_society_flag" },
      { line: 8, name: "Sara", reason: "invalid_society_date" },
    ]);
  });

  it("validates calendar dates in parseIsoDate", () => {
    expect(parseIsoDate("2024-02-29")).toBe("2024-02-29");
    expect(parseIsoDate("2025-02-29")).toBeNull();
    expect(parseIsoDate("1899-12-31")).toBeNull();
    expect(parseIsoDate("2026/01/01")).toBeNull();
  });

  it("parses photo URLs and rejects simultaneous active UPA and UMP membership", () => {
    const csv = [
      "nome,comungante,sexo,data_nascimento,upa_ativo,upa_ingresso,ump_ativo,ump_ingresso,foto",
      "Paulo Apóstolo,sim,M,1990-01-01,sim,2023-01-01,nao,,https://example.com/paulo.jpg",
      "Conflito Silva,sim,M,2005-01-01,sim,2023-01-01,sim,2024-01-01,",
      "Url Invalida,sim,F,1995-05-05,nao,,sim,2023-01-01,ftp://bad.example/photo.png",
    ].join("\n");

    const result = parseMemberImportCsv(csv);
    expect(result.validRows).toEqual([
      {
        line: 2,
        fullName: "Paulo Apóstolo",
        isCommunicant: true,
        isMale: true,
        birthDate: "1990-01-01",
        photoUrl: "https://example.com/paulo.jpg",
        societyFlags: { upaActive: true, upaEnrolledAt: "2023-01-01", umpActive: false },
      },
    ]);
    expect(result.rejectedRows).toEqual([
      { line: 3, name: "Conflito Silva", reason: "conflicting_societies" },
      { line: 4, name: "Url Invalida", reason: "invalid_photo_url" },
    ]);
  });
});
