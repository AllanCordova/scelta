import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";

test("society board election runs 2 inconclusive rounds then narrows 3rd round to top 2 and elects a winner", async ({
  page,
}) => {
  const title = `Diretoria UPA ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await loginAsAdmin(page);
  await page.getByLabel("Título").fill(title);
  await page.getByRole("group", { name: "Tipo" }).getByRole("button", { name: "Diretoria UPA" }).click();
  await page
    .getByRole("group", { name: "Regras" })
    .getByRole("button", { name: "Diretoria de sociedade" })
    .click();
  await page.getByRole("textbox", { name: "Quórum", exact: true }).fill("2");
  await page.getByRole("combobox", { name: /Unidade do quórum/ }).selectOption("absolute");
  await page.getByLabel("Candidatos").fill("Ana, Bia, Caio");
  await page.getByRole("group", { name: "Situação" }).getByRole("button", { name: "Aberta" }).click();
  await page.getByRole("button", { name: "Criar sala" }).click();

  const invite = page.getByRole("link", { name: /\/join\// });
  await expect(invite).toBeVisible();
  const href = await invite.getAttribute("href");
  if (!href) {
    throw new Error("Missing invite link");
  }

  const voterOneContext = await page.context().browser()!.newContext();
  const voterTwoContext = await page.context().browser()!.newContext();
  try {
    const inviteUrl = new URL(href, page.url()).toString();
    const voterOne = await voterOneContext.newPage();
    await voterOne.goto(inviteUrl);
    await voterOne.getByLabel("Seu nome").fill("Membro Um");
    await voterOne.getByRole("button", { name: "Entrar na sala" }).click();
    await expect(voterOne.getByRole("heading", { name: "Você entrou" })).toBeVisible();

    const voterTwo = await voterTwoContext.newPage();
    await voterTwo.goto(inviteUrl);
    await voterTwo.getByLabel("Seu nome").fill("Membro Dois");
    await voterTwo.getByRole("button", { name: "Entrar na sala" }).click();
    await expect(voterTwo.getByRole("heading", { name: "Você entrou" })).toBeVisible();

    const item = page.getByRole("listitem").filter({ hasText: title });
    await expect(item.getByText("2 / 2", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Round 1: all 3 candidates present; votes split Ana 1, Bia 1, Caio 0 -> no majority
    await item.getByRole("button", { name: "Abrir escrutínio" }).click();
    await expect(item.getByText("1º escrutínio — Candidatos: Ana, Bia, Caio")).toBeVisible();

    await expect(voterOne.getByRole("heading", { name: "1º escrutínio" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(voterOne.getByRole("button", { name: "Caio" })).toBeVisible();
    await voterOne.getByRole("button", { name: "Ana" }).click();
    await voterOne.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(voterOne.getByRole("status")).toContainText("seu voto foi registrado com sigilo");

    await expect(voterTwo.getByRole("heading", { name: "1º escrutínio" })).toBeVisible({
      timeout: 10_000,
    });
    await voterTwo.getByRole("button", { name: "Bia" }).click();
    await voterTwo.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(voterTwo.getByRole("status")).toContainText("seu voto foi registrado com sigilo");

    await item.getByRole("button", { name: "Encerrar escrutínio" }).click();
    await expect(item.getByText("Sem maioria absoluta neste escrutínio.")).toBeVisible();
    await expect(item.getByText("Caio: 0 votos")).toBeVisible();

    // Round 2: all 3 candidates remain; one-vote-per-person resets; votes split Ana 1, Bia 1, Caio 0 -> no majority
    await item.getByRole("button", { name: "Abrir escrutínio" }).click();
    await expect(item.getByText("2º escrutínio — Candidatos: Ana, Bia, Caio")).toBeVisible();

    await expect(voterOne.getByRole("heading", { name: "2º escrutínio" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(voterOne.getByRole("button", { name: "Caio" })).toBeVisible();
    await voterOne.getByRole("button", { name: "Ana" }).click();
    await voterOne.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(voterOne.getByRole("status")).toContainText("seu voto foi registrado com sigilo");

    await expect(voterTwo.getByRole("heading", { name: "2º escrutínio" })).toBeVisible({
      timeout: 10_000,
    });
    await voterTwo.getByRole("button", { name: "Bia" }).click();
    await voterTwo.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(voterTwo.getByRole("status")).toContainText("seu voto foi registrado com sigilo");

    await item.getByRole("button", { name: "Encerrar escrutínio" }).click();
    await expect(item.getByText("Sem maioria absoluta neste escrutínio.")).toBeVisible();

    // Round 3: runoff of top 2 (Ana and Bia); Caio is eliminated
    await item.getByRole("button", { name: "Abrir escrutínio" }).click();
    await expect(item.getByText("3º escrutínio — Candidatos: Ana, Bia")).toBeVisible();

    await expect(voterOne.getByRole("heading", { name: "3º escrutínio" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(voterOne.getByRole("button", { name: "Ana" })).toBeVisible();
    await expect(voterOne.getByRole("button", { name: "Bia" })).toBeVisible();
    await expect(voterOne.getByRole("button", { name: "Caio" })).toHaveCount(0);

    await voterOne.getByRole("button", { name: "Ana" }).click();
    await voterOne.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(voterOne.getByRole("status")).toContainText("seu voto foi registrado com sigilo");

    await expect(voterTwo.getByRole("heading", { name: "3º escrutínio" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(voterTwo.getByRole("button", { name: "Caio" })).toHaveCount(0);
    await voterTwo.getByRole("button", { name: "Ana" }).click();
    await voterTwo.getByRole("button", { name: "Confirmar voto" }).click();
    await expect(voterTwo.getByRole("status")).toContainText("seu voto foi registrado com sigilo");

    await item.getByRole("button", { name: "Encerrar escrutínio" }).click();
    await expect(item.getByText("Eleito por maioria absoluta: Ana")).toBeVisible();
    await expect(item.getByText("Ana: 2 votos")).toBeVisible();
    await expect(item.getByText("Bia: 0 votos")).toBeVisible();

    await expect(voterOne.getByText("Eleito por maioria absoluta: Ana")).toBeVisible({
      timeout: 10_000,
    });
  } finally {
    await voterOneContext.close();
    await voterTwoContext.close();
  }
});

async function loginAsAdmin(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.locator("form").getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("button", { name: "Criar sala" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Quórum", exact: true })).toHaveValue("34");
}
