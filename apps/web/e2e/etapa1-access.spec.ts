import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";
const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:3334";

test("voter enters from / using room short code + personal code, URL strips ?c=, and reload restores session", async ({
  page,
  browser,
}) => {
  const title = `Sala Curta ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const { shortCode, codes } = await setupOpenRoomWithCodes(page, title, [
    "Paulo,sim,M,1985-04-12",
    "Silas,sim,M,1990-01-10",
  ]);

  const voterContext = await browser.newContext();
  try {
    const voter = await voterContext.newPage();
    await voter.goto("/");

    const enterSection = voter.getByRole("region", { name: "Entrar com código" });
    await expect(enterSection).toBeVisible();
    await enterSection.getByLabel("Código da sala").fill(shortCode.toLowerCase());
    await enterSection.getByLabel("Seu código").fill(codes[0]!.code);
    await enterSection.getByRole("button", { name: "Entrar na sala" }).click();

    await expect(voter.getByRole("heading", { name: "Você entrou" })).toBeVisible();
    await expect(voter.getByText(title)).toBeVisible();
    await expect(voter.getByText(codes[0]!.displayName)).toBeVisible();
    expect(new URL(voter.url()).pathname).toBe(`/s/${shortCode}`);
    expect(new URL(voter.url()).search).toBe("");

    await voter.reload();
    await expect(voter.getByRole("heading", { name: "Você entrou" })).toBeVisible();
    await expect(voter.getByText(codes[0]!.displayName)).toBeVisible();
  } finally {
    await voterContext.close();
  }
});

test("second browser is blocked with 409 until admin releases session", async ({
  page,
  browser,
}) => {
  const title = `Sessão Única ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const { roomId, shortCode, codes } = await setupOpenRoomWithCodes(page, title, [
    "Marcos,sim,M,1988-02-14",
    "Lucas,sim,M,1991-06-20",
  ]);
  const code = codes[0]!;

  const browserOne = await browser.newContext();
  const browserTwo = await browser.newContext();
  try {
    const pageOne = await browserOne.newPage();
    await pageOne.goto(`/s/${shortCode}?c=${code.code}`);
    await expect(pageOne.getByRole("heading", { name: "Você entrou" })).toBeVisible();
    expect(new URL(pageOne.url()).search).toBe("");

    const pageTwo = await browserTwo.newPage();
    await pageTwo.goto(`/s/${shortCode}?c=${code.code}`);
    await expect(pageTwo.getByRole("alert")).toContainText(
      "Este código já está em uso. Procure a mesa.",
    );

    await page.goto(`/admin/salas/${roomId}`);
    const releaseBtn = page.getByTestId("release-session-btn").first();
    await expect(releaseBtn).toBeVisible({ timeout: 10_000 });
    await releaseBtn.click();
    await page
      .getByRole("dialog", { name: "Liberar sessão" })
      .getByRole("button", { name: "Liberar sessão" })
      .click();
    await expect(page.getByText(/Sessão de .* liberada\./)).toBeVisible({ timeout: 10_000 });

    await pageTwo.getByRole("button", { name: "Entrar na sala" }).click();
    await expect(pageTwo.getByRole("heading", { name: "Você entrou" })).toBeVisible();
    expect(new URL(pageTwo.url()).search).toBe("");
  } finally {
    await browserOne.close();
    await browserTwo.close();
  }
});

test("in-app browser warning blocks code binding until dismissed", async ({ page, browser }) => {
  const title = `InApp Guard ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const { roomId, shortCode, codes } = await setupOpenRoomWithCodes(page, title, [
    "Mateus,sim,M,1987-09-01",
    "João,sim,M,1992-03-15",
  ]);
  const code = codes[0]!;

  const inAppContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.1",
  });
  try {
    const inAppPage = await inAppContext.newPage();
    await inAppPage.goto(`/s/${shortCode}?c=${code.code}`);

    const warning = inAppPage.getByTestId("in-app-browser-warning");
    await expect(warning).toBeVisible();
    expect(new URL(inAppPage.url()).search).toBe(`?c=${code.code}`);

    const participantsBeforeRes = await page.request.get(
      `${apiBaseUrl}/v1/admin/rooms/${roomId}/participants`,
    );
    expect(participantsBeforeRes.ok()).toBe(true);
    const beforeBody = (await participantsBeforeRes.json()) as {
      participants: Array<{ displayName: string }>;
    };
    expect(beforeBody.participants).toHaveLength(0);

    await warning.getByRole("button", { name: "Continuar mesmo assim" }).click();
    await expect(inAppPage.getByRole("heading", { name: "Você entrou" })).toBeVisible();
    expect(new URL(inAppPage.url()).search).toBe("");
  } finally {
    await inAppContext.close();
  }
});

async function setupOpenRoomWithCodes(
  page: Page,
  title: string,
  memberRows: string[],
): Promise<{
  roomId: string;
  shortCode: string;
  codes: Array<{ code: string; displayName: string }>;
}> {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.locator("form").getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/salas$/);

  const importRes = await page.request.post(`${apiBaseUrl}/v1/admin/members/import`, {
    data: {
      csv: ["nome,comungante,sexo,data_nascimento", ...memberRows].join("\n"),
    },
  });
  expect(importRes.ok()).toBe(true);

  const createRes = await page.request.post(`${apiBaseUrl}/v1/admin/rooms`, {
    data: {
      title,
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      quorumValue: 1,
      quorumUnit: "absolute",
      status: "open",
      candidates: ["Paulo", "Silas"],
    },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as {
    room: { id: string; shortCode: string };
  };

  const genRes = await page.request.post(
    `${apiBaseUrl}/v1/admin/rooms/${created.room.id}/access-codes/generate`,
  );
  expect(genRes.ok()).toBe(true);
  const generated = (await genRes.json()) as {
    accessCodes: Array<{ code: string; displayName: string }>;
  };

  return {
    roomId: created.room.id,
    shortCode: created.room.shortCode,
    codes: generated.accessCodes,
  };
}
