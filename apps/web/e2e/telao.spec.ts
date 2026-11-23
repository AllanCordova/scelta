import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";
const apiBaseUrl = "http://127.0.0.1:3334";

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

async function createMemberViaApi(page: Page, fullName: string) {
  const res = await page.request.post(`${apiBaseUrl}/v1/admin/members`, {
    data: {
      fullName,
      isCommunicant: true,
      isMale: true,
      birthDate: "1986-05-15",
    },
  });
  expect(res.status()).toBe(201);
}

test("T6.2 & T6.3: telao shows entry QR/code, hides partial unless toggled, and reveals closed result on desk command", async ({
  page,
  browser,
}) => {
  const suffix = uniqueSuffix();
  const title = `Sala Telão ${suffix}`;
  const candOne = `Zacarias Telao ${suffix}`;
  const candTwo = `Zoraide Telao ${suffix}`;
  const voterName = `Zildo Votante ${suffix}`;

  await loginAsAdmin(page);
  await createMemberViaApi(page, candOne);
  await createMemberViaApi(page, candTwo);
  await createMemberViaApi(page, voterName);

  const createRes = await page.request.post(`${apiBaseUrl}/v1/admin/rooms`, {
    data: {
      title,
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      quorumValue: 1,
      quorumUnit: "absolute",
      status: "open",
      entryMode: "codigo",
      candidates: [candOne, candTwo],
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
  const genBody = (await genRes.json()) as {
    accessCodes: Array<{ displayName: string; code: string }>;
  };
  const voterCode = genBody.accessCodes.find((item) => item.displayName === voterName)?.code;
  expect(voterCode).toBeTruthy();

  await page.goto(`/admin/salas/${room.id}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByTestId("open-telao-btn")).toHaveAttribute("href", `/telao/${room.id}`);

  // Open Telão in a second tab within the same authenticated admin context
  const telaoPage = await page.context().newPage();
  await telaoPage.goto(`/telao/${room.id}`);
  await expect(telaoPage.getByTestId("telao-short-code")).toHaveText(room.shortCode);
  await expect(
    telaoPage.getByRole("img", { name: "QR Code de acesso à sala" }),
  ).toBeVisible();

  const voterContext = await browser.newContext();
  try {
    const voterPage = await voterContext.newPage();
    await voterPage.goto(`/s/${room.shortCode}?c=${voterCode}`);
    await expect(voterPage.getByRole("heading", { name: "Você entrou" })).toBeVisible();

    // Open round (switches admin to Conduzir tab)
    await page.getByRole("button", { name: "Abrir escrutínio" }).click();
    await expect(telaoPage.getByTestId("telao-voted-counter")).toHaveText(/Votaram\s+0\s+de\s+1/);
    await expect(telaoPage.getByTestId("telao-live-tally-hidden")).toBeVisible();
    await expect(telaoPage.getByTestId("telao-live-candidate-tally")).toHaveCount(0);

    // Voter casts ballot (filter list first because shared PGlite DB may have >12 candidates)
    const searchInput = voterPage.getByLabel("Buscar candidato por nome");
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(candOne);
    }
    await voterPage.getByRole("button", { name: candOne }).click();
    await voterPage.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(
      voterPage.getByText("Comprovante: seu voto foi registrado com sigilo neste escrutínio."),
    ).toBeVisible();

    // Telão shows general turnout + computed ballot, still hiding candidate breakdown
    await expect(telaoPage.getByTestId("telao-voted-counter")).toHaveText(/Votaram\s+1\s+de\s+1/);
    await expect(telaoPage.getByTestId("telao-general-tally")).toContainText("1");
    await expect(telaoPage.getByTestId("telao-live-candidate-tally")).toHaveCount(0);

    // T6.3: Enable partial tally on Conduzir tab -> Telão immediately displays candidate standings
    await page.getByTestId("toggle-live-candidate-tally").check();
    const partialBox = telaoPage.getByTestId("telao-live-candidate-tally");
    await expect(partialBox).toBeVisible({ timeout: 10_000 });
    await expect(partialBox).toContainText(candOne);
    await expect(partialBox).toContainText("1 voto");

    // Close scrutiny (switches admin to Resultado tab) -> Telão holds result until reveal
    await page.getByRole("button", { name: "Encerrar escrutínio" }).click();
    await expect(telaoPage.getByTestId("telao-awaiting-reveal")).toBeVisible({ timeout: 10_000 });
    await expect(telaoPage.getByTestId("telao-revealed-result")).toHaveCount(0);

    // T6.2: Admin clicks "Revelar resultado" -> Telão reveals winner & standings
    await page.getByTestId("reveal-result-btn").click();
    await expect(page.getByTestId("result-revealed-badge")).toBeVisible();
    const revealedBox = telaoPage.getByTestId("telao-revealed-result");
    await expect(revealedBox).toBeVisible({ timeout: 10_000 });
    await expect(revealedBox).toContainText(candOne);
    await expect(revealedBox).toContainText("Eleito");
  } finally {
    await telaoPage.close();
    await voterContext.close();
  }
});
