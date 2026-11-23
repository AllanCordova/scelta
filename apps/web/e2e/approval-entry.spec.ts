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

async function createMemberViaApi(
  page: Page,
  fullName: string,
  birthDate: string | null = "1988-04-12",
): Promise<{ id: string; fullName: string }> {
  const response = await page.request.post(`${apiBaseUrl}/v1/admin/members`, {
    data: {
      fullName,
      isCommunicant: true,
      isMale: true,
      birthDate,
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { member: { id: string; fullName: string } };
  return body.member;
}

test("T4.2: voter enters via short code in approval mode, confirms birth day/month, gets approved, votes, and duplicate claim triggers dispute", async ({
  page,
  browser,
}) => {
  const suffix = uniqueSuffix();
  const title = `Sala Aprovação ${suffix}`;
  const voterOneName = `Zélia Aprovada ${suffix}`;
  const voterTwoName = `Zaqueu Candidato ${suffix}`;

  await loginAsAdmin(page);
  await createMemberViaApi(page, voterOneName, "1985-04-12");
  await createMemberViaApi(page, voterTwoName, "1990-09-25");

  await page.getByLabel("Título").fill(title);
  await page.getByRole("textbox", { name: "Quórum", exact: true }).fill("1");
  await page.getByRole("combobox", { name: /Unidade do quórum/ }).selectOption("absolute");
  await page.getByRole("group", { name: "Situação" }).getByRole("button", { name: "Aberta" }).click();
  await page
    .getByRole("group", { name: "Modo de entrada" })
    .getByRole("button", { name: "Aprovação da mesa" })
    .click();
  await page.getByRole("button", { name: "Criar sala" }).click();

  const item = page.getByRole("listitem").filter({ hasText: title });
  await expect(item).toBeVisible();
  await item.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(/\/admin\/salas\/[0-9a-f-]{36}$/);

  await page.getByRole("tab", { name: "Preparar" }).click();
  await page.getByRole("button", { name: "QR Code" }).click();
  await expect(page.getByTestId("invite-qr")).toBeVisible();
  const shortCode = ((await page.getByTestId("room-short-code").textContent()) ?? "").trim();
  expect(shortCode).toMatch(/^[A-Z0-9]{6}$/);
  await page.getByRole("tab", { name: "Conduzir" }).click();

  const voterOneContext = await browser.newContext();
  const voterTwoContext = await browser.newContext();
  try {
    const voterOne = await voterOneContext.newPage();
    await voterOne.goto("/");

    const enterSection = voterOne.getByRole("region", { name: "Entrar com código" });
    await enterSection.getByLabel("Código da sala").fill(shortCode);
    await enterSection.getByRole("button", { name: "Entrar na sala" }).click();
    await expect(voterOne).toHaveURL(new RegExp(`/s/${shortCode}$`));

    await voterOne.getByLabel("Buscar seu nome no rol").fill(voterOneName);
    await voterOne.getByRole("button", { name: "Buscar" }).click();
    await expect(voterOne.getByText(voterOneName)).toBeVisible();
    await voterOne.getByRole("button", { name: "Selecionar" }).click();

    // Wrong birth date is rejected
    await voterOne.getByLabel("Dia de nascimento").fill("1");
    await voterOne.getByLabel("Mês de nascimento").fill("1");
    await voterOne.getByTestId("request-entry-btn").click();
    await expect(voterOne.getByRole("alert")).toContainText("Dia ou mês de nascimento não conferem.");

    // Correct birth day and month sends pending request
    await voterOne.getByLabel("Dia de nascimento").fill("12");
    await voterOne.getByLabel("Mês de nascimento").fill("4");
    await voterOne.getByTestId("request-entry-btn").click();
    await expect(voterOne.getByTestId("entry-request-pending")).toContainText(
      "Aguardando aprovação da mesa",
    );

    // Desk approves in queue
    const approveBtn = page.getByTestId("approve-entry-btn").first();
    await expect(approveBtn).toBeVisible({ timeout: 10_000 });
    await approveBtn.click();

    await expect(voterOne.getByRole("heading", { name: "Você entrou" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(voterOne.getByText(voterOneName)).toBeVisible();

    // Admin opens round and voter casts ballot
    await page.getByRole("button", { name: "Abrir escrutínio" }).click();
    await expect(page.getByText("1º Escrutínio")).toBeVisible();

    await voterOne.getByRole("button", { name: voterTwoName }).click();
    await voterOne.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(
      voterOne.getByText("Comprovante: seu voto foi registrado com sigilo neste escrutínio."),
    ).toBeVisible();

    // Second browser attempts to claim the same already-claimed name -> refused & signals dispute
    const voterTwo = await voterTwoContext.newPage();
    await voterTwo.goto(`/s/${shortCode}`);
    await voterTwo.getByLabel("Buscar seu nome no rol").fill(voterOneName);
    await voterTwo.getByRole("button", { name: "Buscar" }).click();
    await expect(voterTwo.getByText("Já reivindicado")).toBeVisible();
    await voterTwo.getByRole("button", { name: "Selecionar" }).click();
    await voterTwo.getByLabel("Dia de nascimento").fill("12");
    await voterTwo.getByLabel("Mês de nascimento").fill("4");
    await voterTwo.getByTestId("request-entry-btn").click();

    await expect(voterTwo.getByRole("alert")).toContainText(
      "Este nome já foi reivindicado. A mesa foi avisada; procure a mesa.",
    );

    await expect(page.getByTestId("disputed-name-alert")).toContainText(
      `Nome disputado: ${voterOneName}`,
      { timeout: 10_000 },
    );
  } finally {
    await voterOneContext.close();
    await voterTwoContext.close();
  }
});

test("T4.3: desk expels wrong person and releases disputed name so the rightful voter can enter", async ({
  page,
  browser,
}) => {
  const suffix = uniqueSuffix();
  const title = `Sala Disputa ${suffix}`;
  const rightfulName = `Zulmira Verdadeira ${suffix}`;

  await loginAsAdmin(page);
  await createMemberViaApi(page, rightfulName, "1992-07-19");

  const createRes = await page.request.post(`${apiBaseUrl}/v1/admin/rooms`, {
    data: {
      title,
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      quorumValue: 1,
      quorumUnit: "absolute",
      status: "open",
      entryMode: "aprovacao",
      candidates: [rightfulName],
    },
  });
  expect(createRes.status()).toBe(201);
  const { room } = (await createRes.json()) as {
    room: { id: string; shortCode: string };
  };

  await page.goto(`/admin/salas/${room.id}`);
  await expect(page.getByTestId("approval-queue-panel")).toBeVisible();

  const impostorContext = await browser.newContext();
  const rightfulContext = await browser.newContext();
  try {
    // Impostor claims Maria's name and gets approved by mistake
    const impostorPage = await impostorContext.newPage();
    await impostorPage.goto(`/s/${room.shortCode}`);
    await impostorPage.getByLabel("Buscar seu nome no rol").fill(rightfulName);
    await impostorPage.getByRole("button", { name: "Buscar" }).click();
    await impostorPage.getByRole("button", { name: "Selecionar" }).click();
    await impostorPage.getByLabel("Dia de nascimento").fill("19");
    await impostorPage.getByLabel("Mês de nascimento").fill("7");
    await impostorPage.getByTestId("request-entry-btn").click();
    await expect(impostorPage.getByTestId("entry-request-pending")).toBeVisible();

    await page.getByTestId("approve-entry-btn").first().click();
    await expect(impostorPage.getByRole("heading", { name: "Você entrou" })).toBeVisible({
      timeout: 10_000,
    });

    // Rightful voter tries to claim their name -> triggers disputed name alert
    const rightfulPage = await rightfulContext.newPage();
    await rightfulPage.goto(`/s/${room.shortCode}`);
    await rightfulPage.getByLabel("Buscar seu nome no rol").fill(rightfulName);
    await rightfulPage.getByRole("button", { name: "Buscar" }).click();
    await expect(rightfulPage.getByText("Já reivindicado")).toBeVisible();
    await rightfulPage.getByRole("button", { name: "Selecionar" }).click();
    await rightfulPage.getByLabel("Dia de nascimento").fill("19");
    await rightfulPage.getByLabel("Mês de nascimento").fill("7");
    await rightfulPage.getByTestId("request-entry-btn").click();
    await expect(rightfulPage.getByRole("alert")).toContainText(
      "Este nome já foi reivindicado. A mesa foi avisada; procure a mesa.",
    );

    // Desk expels impostor and releases the name
    const disputeAlert = page.getByTestId("disputed-name-alert");
    await expect(disputeAlert).toContainText(rightfulName, { timeout: 10_000 });
    await page.getByTestId("release-claimed-name-btn").first().click();
    await expect(disputeAlert).toHaveCount(0, { timeout: 10_000 });

    // Impostor loses access
    await expect(impostorPage.getByRole("alert")).toContainText("Você foi removido da sala", {
      timeout: 10_000,
    });

    // Rightful voter now requests entry cleanly and gets approved
    await rightfulPage.getByTestId("request-entry-btn").click();
    await expect(rightfulPage.getByTestId("entry-request-pending")).toBeVisible();

    await page.getByTestId("approve-entry-btn").first().click();
    await expect(rightfulPage.getByRole("heading", { name: "Você entrou" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(rightfulPage.getByText(rightfulName)).toBeVisible();
  } finally {
    await impostorContext.close();
    await rightfulContext.close();
  }
});

test("T4.1: admin closes and reopens room entry gate while blocking new voters until reopened", async ({
  page,
  browser,
}) => {
  const suffix = uniqueSuffix();
  const title = `Sala Porta ${suffix}`;
  const memberOne = `Zeca Porta ${suffix}`;
  const memberTwo = `Zico Porta ${suffix}`;

  await loginAsAdmin(page);
  await createMemberViaApi(page, memberOne, "1988-04-12");
  await createMemberViaApi(page, memberTwo, "1991-06-20");

  const createRes = await page.request.post(`${apiBaseUrl}/v1/admin/rooms`, {
    data: {
      title,
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      quorumValue: 1,
      quorumUnit: "absolute",
      status: "open",
      entryMode: "aprovacao",
      candidates: [memberOne, memberTwo],
    },
  });
  expect(createRes.status()).toBe(201);
  const { room } = (await createRes.json()) as {
    room: { id: string; shortCode: string };
  };

  await page.goto(`/admin/salas/${room.id}`);
  await page.getByRole("tab", { name: "Preparar" }).click();
  const toggleBtn = page.getByTestId("toggle-room-entry-btn");
  await expect(toggleBtn).toHaveText("Encerrar entrada");
  await toggleBtn.click();
  await expect(toggleBtn).toHaveText("Reabrir entrada");

  const voterContext = await browser.newContext();
  try {
    const voterPage = await voterContext.newPage();
    await voterPage.goto(`/s/${room.shortCode}`);
    await expect(voterPage.getByRole("alert")).toContainText(
      "A entrada nesta sala foi encerrada pela mesa.",
    );

    await toggleBtn.click();
    await expect(toggleBtn).toHaveText("Encerrar entrada");

    await expect(voterPage.getByLabel("Buscar seu nome no rol")).toBeVisible({
      timeout: 10_000,
    });
  } finally {
    await voterContext.close();
  }
});
