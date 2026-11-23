export type FakeChurchRosterGroup = {
  upaOnlyNonCommunicant: string;
  upaOnlyCommunicantOlder: string;
  upaOnlyCommunicantYounger: string;
  upaOnlyRemoved: string;
  umpOnlyNonCommunicant: string;
  umpOnlyCommunicant: string;
  generalCommunicantA: string;
  generalCommunicantB: string;
  generalCommunicantC: string;
  generalCommunicantD: string;
  generalCommunicantE: string;
  generalCommunicantF: string;
  generalNonCommunicant: string;
  csv: string;
};

/**
 * Builds a realistic fake church CSV spreadsheet with:
 * - UPA-only active members (both non-communicant and communicant, with distinct birth dates)
 * - UMP-only active members (both non-communicant and communicant)
 * - General church members in neither UPA nor UMP (both communicant adults and non-communicant)
 *
 * Names start with `Z` and avoid existing test substrings so parallel E2E runs never collide.
 */
export function buildFakeChurchMembersFixture(suffix: string): FakeChurchRosterGroup {
  const upaOnlyNonCommunicant = `Z7UpaSocioNaoCom ${suffix}`;
  const upaOnlyCommunicantOlder = `Z7UpaMaisVelho ${suffix}`;
  const upaOnlyCommunicantYounger = `Z7UpaMaisNovo ${suffix}`;
  const upaOnlyRemoved = `Z7UpaRemovido ${suffix}`;

  const umpOnlyNonCommunicant = `Z7UmpSocioNaoCom ${suffix}`;
  const umpOnlyCommunicant = `Z7UmpComungante ${suffix}`;

  const generalCommunicantA = `Z7GeralComA ${suffix}`;
  const generalCommunicantB = `Z7GeralComB ${suffix}`;
  const generalCommunicantC = `Z7GeralComC ${suffix}`;
  const generalCommunicantD = `Z7GeralComD ${suffix}`;
  const generalCommunicantE = `Z7GeralComE ${suffix}`;
  const generalCommunicantF = `Z7GeralComF ${suffix}`;
  const generalNonCommunicant = `Z7GeralNaoCom ${suffix}`;

  const rows = [
    "nome,comungante,sexo,data_nascimento,upa_ativo,upa_ingresso,ump_ativo,ump_ingresso",
    `${upaOnlyNonCommunicant},nao,M,2009-03-10,sim,2024-01-10,nao,`,
    `${upaOnlyCommunicantOlder},sim,M,2004-02-14,sim,2022-03-01,nao,`,
    `${upaOnlyCommunicantYounger},sim,F,2007-09-22,sim,2023-05-15,nao,`,
    `${upaOnlyRemoved},nao,F,2010-08-18,sim,2025-01-20,nao,`,
    `${umpOnlyNonCommunicant},nao,M,2002-04-11,nao,,sim,2023-04-01`,
    `${umpOnlyCommunicant},sim,F,1998-11-05,nao,,sim,2021-05-01`,
    `${generalCommunicantA},sim,M,1975-06-15,nao,,nao,`,
    `${generalCommunicantB},sim,M,1978-08-20,nao,,nao,`,
    `${generalCommunicantC},sim,M,1981-01-09,nao,,nao,`,
    `${generalCommunicantD},sim,M,1984-12-03,nao,,nao,`,
    `${generalCommunicantE},sim,M,1988-07-25,nao,,nao,`,
    `${generalCommunicantF},sim,M,1991-10-30,nao,,nao,`,
    `${generalNonCommunicant},nao,F,2012-05-04,nao,,nao,`,
  ];

  return {
    upaOnlyNonCommunicant,
    upaOnlyCommunicantOlder,
    upaOnlyCommunicantYounger,
    upaOnlyRemoved,
    umpOnlyNonCommunicant,
    umpOnlyCommunicant,
    generalCommunicantA,
    generalCommunicantB,
    generalCommunicantC,
    generalCommunicantD,
    generalCommunicantE,
    generalCommunicantF,
    generalNonCommunicant,
    csv: rows.join("\n"),
  };
}
