import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";
const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:3334";

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function loginAsAdmin(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.locator("form").getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/salas$/);
  await expect(page.getByRole("button", { name: "Criar sala" })).toBeVisible();
}

async function createMemberViaApi(page: Page, fullName: string): Promise<{ id: string; fullName: string }> {
  const response = await page.request.post(`${apiBaseUrl}/v1/admin/members`, {
    data: {
      fullName,
      isCommunicant: true,
      isMale: true,
      birthDate: "1986-03-14",
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { member: { id: string; fullName: string } };
  return body.member;
}

test("T5.3: voters cast multi-choice ballots for N, fewer than N, and blank with review step on small mobile", async ({
  page,
  browser,
}) => {
  const suffix = uniqueSuffix();
  const title = `Diáconos T53 ${suffix}`;
  const cand1 = `Zacarias Cand ${suffix}`;
  const cand2 = `Zaqueu Cand ${suffix}`;
  const cand3 = `Zélio Cand ${suffix}`;
  const cand4 = `Zózimo Cand ${suffix}`;

  await loginAsAdmin(page);
  await createMemberViaApi(page, cand1);
  await createMemberViaApi(page, cand2);
  await createMemberViaApi(page, cand3);
  await createMemberViaApi(page, cand4);

  await page.getByLabel("Título").fill(title);
  await page.getByRole("button", { name: "Diácono" }).click();
  await page.getByTestId("room-vacancies-input").fill("3");
  await page.getByRole("textbox", { name: "Quórum", exact: true }).fill("1");
  await page.getByRole("combobox", { name: /Unidade do quórum/ }).selectOption("absolute");
  await page.getByRole("group", { name: "Situação" }).getByRole("button", { name: "Aberta" }).click();
  await page.getByRole("button", { name: "Criar sala" }).click();

  const item = page.getByRole("listitem").filter({ hasText: title });
  await expect(item).toBeVisible();
  await item.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(/\/admin\/salas\/[0-9a-f-]{36}$/);

  const detailUrl = page.url();
  const roomId = detailUrl.split("/").pop()!;

  const roomRes = await page.request.get(`${apiBaseUrl}/v1/admin/rooms/${roomId}`);
  const { room } = (await roomRes.json()) as { room: { shortCode: string } };

  const genRes = await page.request.post(
    `${apiBaseUrl}/v1/admin/rooms/${roomId}/access-codes/generate`,
  );
  expect(genRes.ok()).toBe(true);
  const { accessCodes } = (await genRes.json()) as {
    accessCodes: Array<{ code: string; displayName: string }>;
  };
  expect(accessCodes.length).toBeGreaterThanOrEqual(3);

  const mobileContext = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const voterTwoContext = await browser.newContext();
  const voterThreeContext = await browser.newContext();

  try {
    const voterOne = await mobileContext.newPage();
    await voterOne.goto(`/s/${room.shortCode}?c=${accessCodes[0]!.code}`);
    await expect(voterOne.getByRole("heading", { name: "Você entrou" })).toBeVisible();

    const voterTwo = await voterTwoContext.newPage();
    await voterTwo.goto(`/s/${room.shortCode}?c=${accessCodes[1]!.code}`);
    await expect(voterTwo.getByRole("heading", { name: "Você entrou" })).toBeVisible();

    const voterThree = await voterThreeContext.newPage();
    await voterThree.goto(`/s/${room.shortCode}?c=${accessCodes[2]!.code}`);
    await expect(voterThree.getByRole("heading", { name: "Você entrou" })).toBeVisible();

    await page.getByRole("button", { name: "Abrir escrutínio" }).click();
    await expect(page.getByText("1º Escrutínio")).toBeVisible();

    // Voter 1 (360x640 mobile): filters to room's 4 candidates and votes for N = 3 candidates
    await voterOne.getByLabel("Buscar candidato por nome").fill(suffix);
    await expect(voterOne.getByTestId("ballot-marks-counter")).toHaveText("0 de 3");
    await voterOne.getByRole("button", { name: cand1 }).click();
    await voterOne.getByRole("button", { name: cand2 }).click();
    await voterOne.getByRole("button", { name: cand3 }).click();
    await expect(voterOne.getByTestId("ballot-marks-counter")).toHaveText("3 de 3");
    await expect(voterOne.getByRole("button", { name: cand4 })).toBeDisabled();

    // Ensure no horizontal overflow on small mobile
    const hasOverflow = await voterOne.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(hasOverflow).toBe(false);

    await voterOne.getByRole("button", { name: "Revisar voto" }).click();
    await expect(voterOne.getByTestId("ballot-review-step")).toContainText(cand1);
    await voterOne.getByTestId("ballot-review-confirm-btn").click();
    await expect(
      voterOne.getByText("Comprovante: seu voto foi registrado com sigilo neste escrutínio."),
    ).toBeVisible();

    // Voter 2: votes for fewer than N (2 of 3), tests "Voltar e alterar", then confirms
    await voterTwo.getByLabel("Buscar candidato por nome").fill(suffix);
    await voterTwo.getByRole("button", { name: cand1 }).click();
    await voterTwo.getByRole("button", { name: cand2 }).click();
    await expect(voterTwo.getByTestId("ballot-marks-counter")).toHaveText("2 de 3");
    await voterTwo.getByRole("button", { name: "Revisar voto" }).click();
    await expect(voterTwo.getByTestId("ballot-review-step")).toContainText(
      "Você selecionou 2 de 3 vagas disponíveis.",
    );
    await voterTwo.getByTestId("ballot-review-back-btn").click();
    await voterTwo.getByRole("button", { name: "Revisar voto" }).click();
    await voterTwo.getByTestId("ballot-review-confirm-btn").click();
    await expect(
      voterTwo.getByText("Comprovante: seu voto foi registrado com sigilo neste escrutínio."),
    ).toBeVisible();

    // Voter 3: votes blank
    await voterThree.getByRole("button", { name: "Voto Nulo / Em Branco" }).click();
    await expect(voterThree.getByTestId("ballot-marks-counter")).toHaveText("0 de 3");
    await voterThree.getByRole("button", { name: "Revisar voto" }).click();
    await expect(voterThree.getByTestId("ballot-review-step")).toContainText(
      "Voto em Branco / Nulo",
    );
    await voterThree.getByTestId("ballot-review-confirm-btn").click();
    await expect(
      voterThree.getByText("Comprovante: seu voto foi registrado com sigilo neste escrutínio."),
    ).toBeVisible();

    // Close round -> cand1 & cand2 (2 of 3 ballots = > 50%) are elected, 1 vacancy remains
    await page.getByRole("button", { name: "Encerrar escrutínio" }).click();
    await expect(page.getByTestId("room-vacancies-summary")).toContainText(
      "Vagas: 2 eleitos de 3 • Vagas restantes: 1",
    );
    await expect(page.getByTestId("open-next-round-btn")).toContainText(
      "Abrir próximo escrutínio (1 vaga)",
    );
  } finally {
    await mobileContext.close();
    await voterTwoContext.close();
    await voterThreeContext.close();
  }
});

test("T5.4: admin launches multi-vacancy paper tally, closes round, and opens next scrutiny for remaining vacancy", async ({
  page,
  browser,
}) => {
  const suffix = uniqueSuffix();
  const title = `Presbíteros T54 ${suffix}`;
  const candA = `Zeca CandA ${suffix}`;
  const candB = `Zico CandB ${suffix}`;
  const candC = `Zulmiro CandC ${suffix}`;
  const paperVoter = `Zulmira Papel ${suffix}`;
  const onlineVoter = `Zuleica Online ${suffix}`;

  await loginAsAdmin(page);
  await createMemberViaApi(page, candA);
  await createMemberViaApi(page, candB);
  await createMemberViaApi(page, candC);
  await createMemberViaApi(page, paperVoter);
  await createMemberViaApi(page, onlineVoter);

  const createRes = await page.request.post(`${apiBaseUrl}/v1/admin/rooms`, {
    data: {
      title,
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      status: "open",
      quorumValue: 1,
      quorumUnit: "absolute",
      vacancies: 3,
      candidates: [candA, candB, candC],
    },
  });
  expect(createRes.status()).toBe(201);
  const { room } = (await createRes.json()) as {
    room: { id: string; shortCode: string };
  };

  const genRes = await page.request.post(
    `${apiBaseUrl}/v1/admin/rooms/${room.id}/access-codes/generate`,
  );
  expect(genRes.ok()).toBe(true);

  await page.goto(`/admin/salas/${room.id}`);
  await page.getByRole("tab", { name: "Preparar" }).click();
  const rosterList = page.getByRole("list", { name: "Rol da sala" });

  // Mark paperVoter for paper mode
  const paperRow = rosterList.getByTestId("roster-entry-row").filter({ hasText: paperVoter });
  await paperRow.getByTestId("toggle-paper-mode-btn").click();
  await page
    .getByRole("dialog", { name: "Marcar para voto em papel" })
    .getByRole("button", { name: "Confirmar voto em papel" })
    .click();
  await expect(page.getByTestId("roster-paper-count")).toHaveText("Papel: 1");

  const onlineRow = rosterList.getByTestId("roster-entry-row").filter({ hasText: onlineVoter });
  const onlineCode = ((await onlineRow.locator(".access-code-pin").textContent()) ?? "").trim();

  const voterContext = await browser.newContext();
  try {
    const voterPage = await voterContext.newPage();
    await voterPage.goto(`/s/${room.shortCode}?c=${onlineCode}`);
    await expect(voterPage.getByRole("heading", { name: "Você entrou" })).toBeVisible();

    // Open scrutiny 1 (3 vacancies)
    await page.getByRole("button", { name: "Abrir escrutínio" }).click();
    await expect(page.getByTestId("room-paper-count")).toHaveText("Papel: 1");
    await expect(page.getByTestId("paper-tally-panel")).toBeVisible();

    // Online voter marks candA and candB (2 of 3)
    await voterPage.getByRole("button", { name: candA }).click();
    await voterPage.getByRole("button", { name: candB }).click();
    await voterPage.getByRole("button", { name: "Revisar voto" }).click();
    await voterPage.getByTestId("ballot-review-confirm-btn").click();
    await expect(
      voterPage.getByText("Comprovante: seu voto foi registrado com sigilo neste escrutínio."),
    ).toBeVisible();

    // Paper tally: 1 ballot with 2 marks (candA = 1, candB = 1) <= 3 * 1
    await page.getByTestId("paper-ballot-count-input").fill("1");
    await page.getByLabel(`Votos em papel — ${candA}`).fill("1");
    await page.getByLabel(`Votos em papel — ${candB}`).fill("1");
    await expect(page.getByTestId("paper-tally-validation")).toContainText(
      "Marcações nos candidatos: 2 (máx. 3 para 1 cédulas válidas × 3 vagas)",
    );
    await page.getByTestId("save-paper-tally-btn").click();
    await expect(page.getByTestId("paper-tally-provenance")).toBeVisible();

    // Close scrutiny 1 -> candA (2/2) & candB (2/2) elected, 1 vacancy left
    await page.getByRole("button", { name: "Encerrar escrutínio" }).click();
    await expect(page.getByTestId("room-vacancies-summary")).toContainText(
      "Vagas: 2 eleitos de 3 • Vagas restantes: 1",
    );

    // Open scrutiny 2 for remaining 1 vacancy
    await page.getByTestId("open-next-round-btn").click();
    await expect(page.getByText("2º Escrutínio")).toBeVisible();

    // Online voter now sees only single-choice ballot with candC (candA & candB already elected)
    await expect(voterPage.getByRole("button", { name: candC })).toBeVisible({ timeout: 10_000 });
    await expect(voterPage.getByRole("button", { name: candA })).toHaveCount(0);
    await voterPage.getByRole("button", { name: candC }).click();
    await voterPage.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(
      voterPage.getByText("Comprovante: seu voto foi registrado com sigilo neste escrutínio."),
    ).toBeVisible();

    // Paper tally for 2nd scrutiny (1 vacancy): candC = 1
    await page.getByTestId("paper-ballot-count-input").fill("1");
    await page.getByLabel(`Votos em papel — ${candC}`).fill("1");
    await page.getByTestId("save-paper-tally-btn").click();
    await expect(page.getByTestId("paper-tally-provenance")).toBeVisible();

    await page.getByRole("button", { name: "Encerrar escrutínio" }).click();
    await expect(page.getByTestId("room-vacancies-summary")).toContainText(
      "Vagas: 3 eleitos de 3 • Vagas restantes: 0",
    );
    await expect(page.getByRole("button", { name: "Todas as vagas preenchidas" })).toBeDisabled();
  } finally {
    await voterContext.close();
  }
});
