import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";

test("admin clicks a room card to open the room detail view and manages the scrutiny", async ({
  page,
  context,
}) => {
  const title = `Detalhe da sala ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await loginAsAdmin(page);

  await page.getByLabel("Título").fill(title);
  await page.getByRole("textbox", { name: "Quórum", exact: true }).fill("1");
  await page.getByRole("combobox", { name: /Unidade do quórum/ }).selectOption("absolute");
  await page.getByLabel("Aptos").fill("2");
  await page.getByLabel("Candidatos").fill("Paulo Apóstolo, Silas");
  await page.getByRole("group", { name: "Situação" }).getByRole("button", { name: "Aberta" }).click();
  await page.getByRole("button", { name: "Criar sala" }).click();

  const item = page.getByRole("listitem").filter({ hasText: title });
  await expect(item).toBeVisible();

  // Click the room title link to navigate to the detail view
  await item.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(/\/admin\/salas\/[0-9a-f-]{36}$/);

  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Votos Computados")).toBeVisible();
  await expect(page.getByText("Faltam Votar")).toBeVisible();
  await expect(page.getByText("Quórum Mínimo")).toBeVisible();
  await expect(page.getByText("Regimento da Eleição")).toBeVisible();
  await expect(page.getByText("Fluxo de Presença")).toBeVisible();
  await expect(page.getByText("Paulo Apóstolo")).toBeVisible();
  await expect(page.getByText("Silas")).toBeVisible();

  const inviteUrlValue = await page.getByLabel("Token Direto para Votantes").inputValue();
  expect(inviteUrlValue).toMatch(/\/join\//);

  // Join as a voter and cast a ballot after admin opens round from detail view
  const voterPage = await context.newPage();
  await voterPage.goto(inviteUrlValue);
  await voterPage.getByLabel("Seu nome").fill("Ana");
  await voterPage.getByRole("button", { name: "Entrar na sala" }).click();
  await expect(voterPage.getByRole("heading", { name: "Você entrou" })).toBeVisible();

  await page.getByRole("button", { name: "Abrir escrutínio" }).click();
  await expect(page.getByText("1º Escrutínio")).toBeVisible();

  await voterPage.reload();
  await voterPage.getByRole("button", { name: "Paulo Apóstolo" }).click();
  await voterPage.getByRole("button", { name: "Confirmar voto" }).click();
  await expect(
    voterPage.getByText("Comprovante: seu voto foi registrado com sigilo neste escrutínio."),
  ).toBeVisible();

  // Live reactivity: admin detail page updates automatically without reloading
  await expect(page.getByText("Cédula recebida e assinada digitalmente")).toBeVisible();

  // Simulator: admin can simulate additional participants joining and casting random votes
  await page.getByLabel("Participantes").fill("2");
  await page.getByRole("button", { name: "Simular votos" }).click();
  await expect(page.getByText("2 votos aleatórios computados.")).toBeVisible();
  await expect(page.getByText("Cédula recebida e assinada digitalmente")).toHaveCount(3);

  await page.getByRole("button", { name: "Encerrar escrutínio" }).click();
  await expect(page.getByText(/Eleito por maioria absoluta: (Paulo Apóstolo|Silas)/i)).toBeVisible();
  await expect(page.getByText("Eleito", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: /Voltar para Painel de Salas/i }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // Failure path: visiting a non-existent room UUID shows a not-found alert
  await page.goto("/admin/salas/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("alert")).toHaveText("Sala não encontrada.");
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
