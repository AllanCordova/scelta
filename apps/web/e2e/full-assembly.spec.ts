import { expect, type Page, test } from "@playwright/test";
import { buildFakeChurchMembersFixture } from "./fixtures/fake-church-members";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";
const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:3334";

function uniqueSuffix(): string {
  return `${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;
}

async function loginAsAdmin(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.locator("form").getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/salas$/);
}

async function importFakeMembersViaUi(page: Page, csv: string) {
  await page.goto("/admin/membros");
  await expect(page.getByRole("heading", { name: "Rol de membros" })).toBeVisible();
  await page.getByLabel("Arquivo CSV de membros").setInputFiles({
    name: "igreja-membros-fake.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });
  await page.getByRole("button", { name: "Importar membros" }).click();
  await expect(page.getByText(/Importação concluída:/).first()).toBeVisible();
}

async function selectBallotCandidate(page: Page, candidateName: string) {
  const searchInput = page.getByLabel("Buscar candidato por nome");
  if (await searchInput.isVisible().catch(() => false)) {
    await searchInput.fill(candidateName);
  }
  await page.getByRole("button", { name: candidateName }).click();
  if (await searchInput.isVisible().catch(() => false)) {
    await searchInput.fill("");
  }
}

test("T7.1 Case 1: UPA assembly uses active UPA socios (incl. non-communicant), supports paper vote, roster removal, and age tie-break", async ({
  page,
  browser,
}) => {
  const suffix = uniqueSuffix();
  const members = buildFakeChurchMembersFixture(suffix);
  const title = `Assembleia UPA T71 ${suffix}`;

  await loginAsAdmin(page);
  await importFakeMembersViaUi(page, members.csv);

  const createRes = await page.request.post(`${apiBaseUrl}/v1/admin/rooms`, {
    data: {
      title,
      roomType: "upa_board",
      rulesPreset: "ipb_society_board",
      quorumValue: 1,
      quorumUnit: "absolute",
      status: "open",
      entryMode: "codigo",
      candidates: [members.upaOnlyCommunicantOlder, members.upaOnlyCommunicantYounger],
    },
  });
  expect(createRes.status()).toBe(201);
  const { room } = (await createRes.json()) as {
    room: { id: string; shortCode: string; inviteToken: string };
  };

  const genRes = await page.request.post(
    `${apiBaseUrl}/v1/admin/rooms/${room.id}/access-codes/generate`,
  );
  expect(genRes.ok()).toBe(true);

  await page.goto(`/admin/salas/${room.id}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("tab", { name: "Preparar" }).click();

  const rosterList = page.getByRole("list", { name: "Rol da sala" });
  // UPA roster includes BOTH non-communicant and communicant active UPA socios
  await expect(
    rosterList.getByTestId("roster-entry-row").filter({ hasText: members.upaOnlyNonCommunicant }),
  ).toBeVisible();
  await expect(
    rosterList.getByTestId("roster-entry-row").filter({ hasText: members.upaOnlyCommunicantOlder }),
  ).toBeVisible();
  // UMP-only and general non-UPA members are excluded from UPA roster
  await expect(
    rosterList.getByTestId("roster-entry-row").filter({ hasText: members.umpOnlyNonCommunicant }),
  ).toHaveCount(0);
  await expect(
    rosterList.getByTestId("roster-entry-row").filter({ hasText: members.generalCommunicantA }),
  ).toHaveCount(0);

  // Mark non-communicant UPA socio as paper voter
  const paperRow = rosterList
    .getByTestId("roster-entry-row")
    .filter({ hasText: members.upaOnlyNonCommunicant });
  await paperRow.getByTestId("toggle-paper-mode-btn").click();
  await page
    .getByRole("dialog", { name: "Marcar para voto em papel" })
    .getByRole("button", { name: "Confirmar voto em papel" })
    .click();
  await expect(page.getByTestId("roster-paper-count")).toHaveText("Papel: 1");

  // Remove one UPA member from the open room roster and confirm their code is revoked
  const removedRow = rosterList
    .getByTestId("roster-entry-row")
    .filter({ hasText: members.upaOnlyRemoved });
  const removedCode = ((await removedRow.locator(".access-code-pin").textContent()) ?? "").trim();
  expect(removedCode.length).toBeGreaterThan(0);
  await removedRow.getByTestId("remove-roster-entry-btn").click();
  await page
    .getByRole("dialog", { name: "Remover do rol" })
    .getByRole("button", { name: "Remover" })
    .click();
  await expect(removedRow).toHaveCount(0);

  const rejectedRemovedJoin = await page.request.post(
    `${apiBaseUrl}/v1/join/${room.inviteToken}`,
    { data: { code: removedCode, joinKey: `join-upa-removed-${suffix}` } },
  );
  expect(rejectedRemovedJoin.status()).toBe(403);

  const onlineRow = rosterList
    .getByTestId("roster-entry-row")
    .filter({ hasText: members.upaOnlyCommunicantOlder });
  const onlineCode = ((await onlineRow.locator(".access-code-pin").textContent()) ?? "").trim();

  const voterContext = await browser.newContext();
  try {
    const voterPage = await voterContext.newPage();
    await voterPage.goto(`/s/${room.shortCode}?c=${onlineCode}`);
    await expect(voterPage.getByRole("heading", { name: "Você entrou" })).toBeVisible();

    // Run 3 scrutinies for Presidente tying 1 vs 1 so 3rd scrutiny triggers age tie-break
    for (let round = 1; round <= 3; round += 1) {
      await page.getByRole("button", { name: "Abrir escrutínio" }).click();
      await expect(page.getByText(`${round}º Escrutínio`)).toBeVisible();

      await expect(voterPage.getByRole("heading", { name: `${round}º escrutínio` })).toBeVisible({
        timeout: 10_000,
      });
      await voterPage.getByRole("button", { name: members.upaOnlyCommunicantOlder }).click();
      await voterPage.getByRole("button", { name: "Confirmar voto" }).click();
      await expect(
        voterPage.getByText("Comprovante: seu voto foi registrado com sigilo neste escrutínio."),
      ).toBeVisible();

      await page.getByTestId("paper-ballot-count-input").fill("1");
      await page.getByLabel(`Votos em papel — ${members.upaOnlyCommunicantYounger}`).fill("1");
      await page.getByTestId("save-paper-tally-btn").click();
      await expect(page.getByTestId("paper-tally-provenance")).toBeVisible();

      await page.getByRole("button", { name: "Encerrar escrutínio" }).click();
      if (round < 3) {
        await expect(page.getByText("Sem maioria absoluta neste escrutínio.")).toBeVisible();
      }
    }

    await expect(
      page.getByText(
        `Eleito por critério de desempate (mais velho): ${members.upaOnlyCommunicantOlder}`,
      ),
    ).toBeVisible();
    await page.getByTestId("reveal-result-btn").click();
    await expect(page.getByTestId("result-revealed-badge")).toBeVisible();
  } finally {
    await voterContext.close();
  }
});

test("T7.1 Case 2: UMP assembly allows non-communicant active UMP socios while excluding UPA-only and general members", async ({
  page,
  browser,
}) => {
  const suffix = uniqueSuffix();
  const members = buildFakeChurchMembersFixture(suffix);
  const title = `Assembleia UMP T71 ${suffix}`;

  await loginAsAdmin(page);
  await importFakeMembersViaUi(page, members.csv);

  const createRes = await page.request.post(`${apiBaseUrl}/v1/admin/rooms`, {
    data: {
      title,
      roomType: "ump_board",
      rulesPreset: "ipb_society_board",
      quorumValue: 1,
      quorumUnit: "absolute",
      status: "open",
      entryMode: "codigo",
      candidates: [members.umpOnlyCommunicant, members.umpOnlyNonCommunicant],
    },
  });
  expect(createRes.status()).toBe(201);
  const { room } = (await createRes.json()) as {
    room: { id: string; shortCode: string };
  };

  await page.request.post(`${apiBaseUrl}/v1/admin/rooms/${room.id}/access-codes/generate`);

  await page.goto(`/admin/salas/${room.id}`);
  await page.getByRole("tab", { name: "Preparar" }).click();

  const rosterList = page.getByRole("list", { name: "Rol da sala" });
  const umpNonCommRow = rosterList
    .getByTestId("roster-entry-row")
    .filter({ hasText: members.umpOnlyNonCommunicant });
  await expect(umpNonCommRow).toBeVisible();
  await expect(
    rosterList.getByTestId("roster-entry-row").filter({ hasText: members.umpOnlyCommunicant }),
  ).toBeVisible();
  await expect(
    rosterList.getByTestId("roster-entry-row").filter({ hasText: members.upaOnlyCommunicantOlder }),
  ).toHaveCount(0);
  await expect(
    rosterList.getByTestId("roster-entry-row").filter({ hasText: members.generalCommunicantA }),
  ).toHaveCount(0);

  const umpCode = ((await umpNonCommRow.locator(".access-code-pin").textContent()) ?? "").trim();

  const voterContext = await browser.newContext();
  try {
    const voterPage = await voterContext.newPage();
    await voterPage.goto(`/s/${room.shortCode}?c=${umpCode}`);
    await expect(voterPage.getByRole("heading", { name: "Você entrou" })).toBeVisible();

    await page.getByRole("button", { name: "Abrir escrutínio" }).click();
    await voterPage.getByRole("button", { name: members.umpOnlyCommunicant }).click();
    await voterPage.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(
      voterPage.getByText("Comprovante: seu voto foi registrado com sigilo neste escrutínio."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Encerrar escrutínio" }).click();
    await expect(
      page.getByText(`Eleito por maioria absoluta: ${members.umpOnlyCommunicant}`),
    ).toBeVisible();
  } finally {
    await voterContext.close();
  }
});

test("T7.1 Case 3: Officers assembly (5 vacancies, approval mode) enforces communicant-only roster and completes in 2 scrutinies", async ({
  page,
  browser,
}) => {
  const suffix = uniqueSuffix();
  const members = buildFakeChurchMembersFixture(suffix);
  const title = `Oficiais 5v T71 ${suffix}`;
  const candidates = [
    members.generalCommunicantA,
    members.generalCommunicantB,
    members.generalCommunicantC,
    members.generalCommunicantD,
    members.generalCommunicantE,
    members.generalCommunicantF,
  ];

  await loginAsAdmin(page);
  await importFakeMembersViaUi(page, members.csv);

  const createRes = await page.request.post(`${apiBaseUrl}/v1/admin/rooms`, {
    data: {
      title,
      roomType: "deacon",
      rulesPreset: "ipb_local_officers",
      quorumValue: 1,
      quorumUnit: "absolute",
      vacancies: 5,
      status: "open",
      entryMode: "aprovacao",
      candidates,
    },
  });
  expect(createRes.status()).toBe(201);
  const { room } = (await createRes.json()) as {
    room: { id: string; shortCode: string };
  };

  await page.goto(`/admin/salas/${room.id}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("tab", { name: "Preparar" }).click();

  const rosterList = page.getByRole("list", { name: "Rol da sala" });
  // Communicants across UPA, UMP, and general church ARE in Officers roster
  await expect(
    rosterList.getByTestId("roster-entry-row").filter({ hasText: members.upaOnlyCommunicantOlder }),
  ).toBeVisible();
  await expect(
    rosterList.getByTestId("roster-entry-row").filter({ hasText: members.umpOnlyCommunicant }),
  ).toBeVisible();
  await expect(
    rosterList.getByTestId("roster-entry-row").filter({ hasText: members.generalCommunicantA }),
  ).toBeVisible();

  // Non-communicants (including active UPA/UMP socios) are EXCLUDED from Officers roster
  await expect(
    rosterList.getByTestId("roster-entry-row").filter({ hasText: members.upaOnlyNonCommunicant }),
  ).toHaveCount(0);
  await expect(
    rosterList.getByTestId("roster-entry-row").filter({ hasText: members.umpOnlyNonCommunicant }),
  ).toHaveCount(0);
  await expect(
    rosterList.getByTestId("roster-entry-row").filter({ hasText: members.generalNonCommunicant }),
  ).toHaveCount(0);

  await page.getByRole("tab", { name: "Conduzir" }).click();

  const voterOneCtx = await browser.newContext();
  const voterTwoCtx = await browser.newContext();
  try {
    const voterOne = await voterOneCtx.newPage();
    const voterTwo = await voterTwoCtx.newPage();

    // Non-communicant UPA socio searches on /s/:shortCode -> not found in Officers roster
    await voterOne.goto(`/s/${room.shortCode}`);
    await voterOne.getByLabel("Buscar seu nome no rol").fill(members.upaOnlyNonCommunicant);
    await voterOne.getByRole("button", { name: "Buscar" }).click();
    await expect(voterOne.getByText(/Nenhum nome encontrado/i)).toBeVisible();

    // Communicant UPA member (2004-02-14) requests entry and gets approved
    await voterOne.getByLabel("Buscar seu nome no rol").fill(members.upaOnlyCommunicantOlder);
    await voterOne.getByRole("button", { name: "Buscar" }).click();
    await expect(voterOne.getByText(members.upaOnlyCommunicantOlder)).toBeVisible();
    await voterOne.getByRole("button", { name: "Selecionar" }).click();
    await voterOne.getByLabel("Dia de nascimento").fill("14");
    await voterOne.getByLabel("Mês de nascimento").fill("2");
    await voterOne.getByTestId("request-entry-btn").click();
    await expect(voterOne.getByTestId("entry-request-pending")).toBeVisible();

    // Communicant UMP member (1998-11-05) requests entry and gets approved
    await voterTwo.goto(`/s/${room.shortCode}`);
    await voterTwo.getByLabel("Buscar seu nome no rol").fill(members.umpOnlyCommunicant);
    await voterTwo.getByRole("button", { name: "Buscar" }).click();
    await expect(voterTwo.getByText(members.umpOnlyCommunicant)).toBeVisible();
    await voterTwo.getByRole("button", { name: "Selecionar" }).click();
    await voterTwo.getByLabel("Dia de nascimento").fill("5");
    await voterTwo.getByLabel("Mês de nascimento").fill("11");
    await voterTwo.getByTestId("request-entry-btn").click();
    await expect(voterTwo.getByTestId("entry-request-pending")).toBeVisible();

    // Desk approves all pending requests
    await expect(page.getByTestId("approve-entry-btn")).toHaveCount(2, { timeout: 10_000 });
    await page.getByTestId("approve-all-entries-btn").click();

    await expect(voterOne.getByRole("heading", { name: "Você entrou" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(voterTwo.getByRole("heading", { name: "Você entrou" })).toBeVisible({
      timeout: 10_000,
    });

    // 1st scrutiny (5 vacancies): both voters vote for A, B, C (3 of 5) -> 3 elected, 2 left
    await page.getByRole("button", { name: "Abrir escrutínio" }).click();
    await expect(page.getByText("1º Escrutínio")).toBeVisible();

    for (const vPage of [voterOne, voterTwo]) {
      await selectBallotCandidate(vPage, members.generalCommunicantA);
      await selectBallotCandidate(vPage, members.generalCommunicantB);
      await selectBallotCandidate(vPage, members.generalCommunicantC);
      await vPage.getByRole("button", { name: "Revisar voto" }).click();
      await expect(vPage.getByRole("heading", { name: "Revisão do seu voto" })).toBeVisible();
      await vPage.getByTestId("ballot-review-confirm-btn").click();
      await expect(
        vPage.getByText("Comprovante: seu voto foi registrado com sigilo neste escrutínio."),
      ).toBeVisible();
    }

    await page.getByRole("button", { name: "Encerrar escrutínio" }).click();
    await expect(page.getByTestId("room-vacancies-summary")).toContainText(
      "Vagas: 3 eleitos de 5 • Vagas restantes: 2",
    );

    // 2nd scrutiny (2 remaining vacancies): already-elected A/B/C hidden; voters elect D and E
    await page.getByTestId("open-next-round-btn").click();
    await expect(page.getByText("2º Escrutínio")).toBeVisible();

    await expect(voterOne.getByRole("button", { name: members.generalCommunicantD })).toBeVisible({
      timeout: 10_000,
    });
    await expect(voterOne.getByRole("button", { name: members.generalCommunicantA })).toHaveCount(0);

    for (const vPage of [voterOne, voterTwo]) {
      await selectBallotCandidate(vPage, members.generalCommunicantD);
      await selectBallotCandidate(vPage, members.generalCommunicantE);
      await vPage.getByRole("button", { name: "Revisar voto" }).click();
      await vPage.getByTestId("ballot-review-confirm-btn").click();
      await expect(
        vPage.getByText("Comprovante: seu voto foi registrado com sigilo neste escrutínio."),
      ).toBeVisible();
    }

    await page.getByRole("button", { name: "Encerrar escrutínio" }).click();
    await expect(page.getByTestId("room-vacancies-summary")).toContainText(
      "Vagas: 5 eleitos de 5 • Vagas restantes: 0",
    );
    await expect(page.getByRole("button", { name: "Todas as vagas preenchidas" })).toBeDisabled();

    await page.getByTestId("reveal-result-btn").click();
    await expect(page.getByTestId("result-revealed-badge")).toBeVisible();
  } finally {
    await voterOneCtx.close();
    await voterTwoCtx.close();
  }
});
