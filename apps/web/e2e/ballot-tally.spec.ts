import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";

test("two voters cast distinct votes, results match, and neither UI exposes who voted for whom", async ({
  page,
}) => {
  const title = `Eleição sigilosa ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
    await item.getByRole("button", { name: "Abrir escrutínio" }).click();
    await expect(item.getByRole("button", { name: "Encerrar escrutínio" })).toBeVisible();

    await expect(voterOne.getByRole("button", { name: "Paulo" })).toBeVisible({ timeout: 10_000 });
    await voterOne.getByRole("button", { name: "Paulo" }).click();
    await voterOne.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(voterOne.getByRole("status")).toContainText("seu voto foi registrado com sigilo");

    await expect(voterTwo.getByRole("button", { name: "Silas" })).toBeVisible({ timeout: 10_000 });
    await voterTwo.getByRole("button", { name: "Silas" }).click();
    await voterTwo.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(voterTwo.getByRole("status")).toContainText("seu voto foi registrado com sigilo");

    await item.getByRole("button", { name: "Encerrar escrutínio" }).click();
    await expect(item.getByText("Sem maioria absoluta neste escrutínio.")).toBeVisible();
    await expect(item.getByText("Paulo: 1 voto")).toBeVisible();
    await expect(item.getByText("Silas: 1 voto")).toBeVisible();

    await expect(voterOne.getByText("Sem maioria absoluta neste escrutínio.")).toBeVisible({
      timeout: 10_000,
    });
    await expect(voterOne.getByText("Paulo: 1 voto")).toBeVisible();
    await expect(voterOne.getByText("Silas: 1 voto")).toBeVisible();

    const adminText = await item.innerText();
    expect(adminText).not.toContain("Votante Alfa");
    expect(adminText).not.toContain("Votante Beta");

    const voterOneResultsText = await voterOne
      .getByRole("region", { name: "Resultado do escrutínio" })
      .innerText();
    expect(voterOneResultsText).not.toContain("Votante Alfa");
    expect(voterOneResultsText).not.toContain("Votante Beta");
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
