import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";

test("admin starts, restarts, and closes a round while participants receive state notifications and cast new votes", async ({
  page,
}) => {
  const title = `Reinício de escrutínio ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await loginAsAdmin(page);
  await page.getByLabel("Título").fill(title);
  await page.getByRole("textbox", { name: "Quórum", exact: true }).fill("2");
  await page.getByRole("combobox", { name: /Unidade do quórum/ }).selectOption("absolute");
  await page.getByLabel("Candidatos").fill("Paulo, Silas");
  await page.getByRole("group", { name: "Situação" }).getByRole("button", { name: "Aberta" }).click();
  await page.getByRole("button", { name: "Criar sala" }).click();

  const invite = page.getByRole("link", { name: /\/join\// });
  await expect(invite).toBeVisible();
  const href = await invite.getAttribute("href");
  if (!href) {
    throw new Error("Missing invite link");
  }

  const codes = await createSimulatedCodes(page, title, 2);

  const voterOneContext = await page.context().browser()!.newContext();
  const voterTwoContext = await page.context().browser()!.newContext();
  try {
    const inviteUrl = new URL(href, page.url()).toString();
    const voterOne = await voterOneContext.newPage();
    await voterOne.goto(inviteUrl);
    await voterOne.getByLabel("Código de acesso").fill(codes[0]!);
    await voterOne.getByRole("button", { name: "Entrar na sala" }).click();
    await expect(voterOne.getByRole("heading", { name: "Você entrou" })).toBeVisible();

    const voterTwo = await voterTwoContext.newPage();
    await voterTwo.goto(inviteUrl);
    await voterTwo.getByLabel("Código de acesso").fill(codes[1]!);
    await voterTwo.getByRole("button", { name: "Entrar na sala" }).click();
    await expect(voterTwo.getByRole("heading", { name: "Você entrou" })).toBeVisible();

    const item = page.getByRole("listitem").filter({ hasText: title });
    await expect(item.getByText("2 / 2", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Start voting
    await item.getByRole("button", { name: "Abrir escrutínio" }).click();
    await expect(item.getByRole("button", { name: "Reiniciar escrutínio" })).toBeVisible();

    await expect(voterOne.getByText("Escrutínio aberto para votação.")).toBeVisible({
      timeout: 10_000,
    });
    await voterOne.getByRole("button", { name: "Paulo" }).click();
    await voterOne.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(voterOne.getByRole("status")).toContainText("seu voto foi registrado com sigilo");

    await expect(voterTwo.getByText("Escrutínio aberto para votação.")).toBeVisible({
      timeout: 10_000,
    });
    await voterTwo.getByRole("button", { name: "Paulo" }).click();
    await voterTwo.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(voterTwo.getByRole("status")).toContainText("seu voto foi registrado com sigilo");

    // Admin restarts the current round
    await item.getByRole("button", { name: "Reiniciar escrutínio" }).click();
    await expect(
      item.getByText("Escrutínio reiniciado — os votos anteriores foram limpos."),
    ).toBeVisible();

    // Participants are notified of the restart and can vote again
    await expect(
      voterOne.getByText("Escrutínio reiniciado — os votos anteriores foram limpos. Vote novamente."),
    ).toBeVisible({ timeout: 10_000 });
    await voterOne.getByRole("button", { name: "Silas" }).click();
    await voterOne.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(voterOne.getByRole("status")).toContainText("seu voto foi registrado com sigilo");

    await expect(
      voterTwo.getByText("Escrutínio reiniciado — os votos anteriores foram limpos. Vote novamente."),
    ).toBeVisible({ timeout: 10_000 });
    await voterTwo.getByRole("button", { name: "Silas" }).click();
    await voterTwo.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(voterTwo.getByRole("status")).toContainText("seu voto foi registrado com sigilo");

    // Admin closes the round; only post-restart votes (Silas: 2) count
    await item.getByRole("button", { name: "Encerrar escrutínio" }).click();
    await expect(item.getByText("Eleito por maioria absoluta: Silas")).toBeVisible();
    await expect(item.getByText("Silas: 2 votos")).toBeVisible();
    await expect(item.getByText("Paulo: 0 votos")).toBeVisible();

    await expect(voterOne.getByText("Escrutínio encerrado.")).toBeVisible({ timeout: 10_000 });
    await expect(voterOne.getByText("Eleito por maioria absoluta: Silas")).toBeVisible();
  } finally {
    await voterOneContext.close();
    await voterTwoContext.close();
  }
});

async function createSimulatedCodes(page: Page, roomTitle: string, count: number): Promise<string[]> {
  const roomsRes = await page.request.get("http://127.0.0.1:3334/v1/admin/rooms");
  const { rooms } = (await roomsRes.json()) as { rooms: Array<{ id: string; title: string }> };
  const room = rooms.find((r) => r.title === roomTitle);
  if (!room) {
    throw new Error(`Room not found: ${roomTitle}`);
  }
  const simRes = await page.request.post(
    `http://127.0.0.1:3334/v1/admin/rooms/${room.id}/access-codes/simulate`,
    { data: { count } },
  );
  const { accessCodes } = (await simRes.json()) as { accessCodes: Array<{ code: string }> };
  return accessCodes.map((c) => c.code);
}

async function loginAsAdmin(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.locator("form").getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("button", { name: "Criar sala" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Quórum", exact: true })).toHaveValue("34");
}
