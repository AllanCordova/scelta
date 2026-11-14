import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";

test("admin clicks a room card to open the room detail view and manages the scrutiny", async ({
  page,
  context,
}) => {
  const title = `Detalhe da sala ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await loginAsAdmin(page);
  await page.request.post("http://127.0.0.1:3334/v1/admin/members/import", {
    data: {
      csv: "nome,comungante,sexo,data_nascimento\nPaulo Apóstolo,sim,M,1985-04-12\nSilas,sim,M,1990-01-10",
    },
  });

  await page.getByLabel("Título").fill(title);
  await page.getByRole("textbox", { name: "Quórum", exact: true }).fill("1");
  await page.getByRole("combobox", { name: /Unidade do quórum/ }).selectOption("absolute");
  await page.getByLabel("Aptos").fill("2");
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
  await expect(page.getByText("Silas", { exact: true })).toBeVisible();

  const initialInviteUrl = await page.getByLabel("Token Direto para Votantes").inputValue();
  expect(initialInviteUrl).toMatch(/\/join\//);

  // Invite rotation and access codes are managed under /admin/codigos, not on room detail
  await expect(page.getByRole("button", { name: "Rotacionar convite" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gerar códigos do rol" })).toHaveCount(0);

  const roomDetailUrl = page.url();

  await page.getByRole("link", { name: "Admin" }).first().click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("link", { name: /Códigos de Acesso/i }).click();
  await expect(page).toHaveURL(/\/admin\/codigos$/);

  const roomOption = page.getByLabel("Sala").locator("option", { hasText: title });
  const roomOptionValue = await roomOption.getAttribute("value");
  await page.getByLabel("Sala").selectOption(roomOptionValue!);

  await page.getByRole("button", { name: "Rotacionar convite" }).click();
  await expect(page.getByText("Link de convite rotacionado.")).toBeVisible();

  await page.getByRole("button", { name: "Gerar códigos do rol" }).click();
  await expect(page.locator(".simulator-status").filter({ hasText: /códigos ativos prontos para credenciamento/ })).toBeVisible();
  const firstPin = await page.locator(".access-code-pin").first().textContent();
  expect(firstPin).toBeTruthy();

  // List hides raw URL and exposes both copy code and copy link buttons plus delete button
  await expect(page.locator(".access-code-url")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copiar código" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Copiar link" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Remover" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Imprimir cartões A4" }).click();
  await expect(page.getByRole("dialog", { name: "Cartões de acesso para impressão" })).toBeVisible();
  await page.getByRole("button", { name: "Fechar" }).click();

  // Delete one access code permanently (delete last so firstPin remains active)
  const initialCodeCount = await page.locator(".access-code-row").count();
  await page.getByRole("button", { name: "Remover" }).last().click();
  await page.getByRole("dialog", { name: "Remover código de acesso" }).getByRole("button", { name: "Remover" }).click();
  await expect(page.locator(".access-code-row")).toHaveCount(initialCodeCount - 1);

  await page.goto(roomDetailUrl);
  const inviteUrlValue = await page.getByLabel("Token Direto para Votantes").inputValue();
  expect(inviteUrlValue).toMatch(/\/join\//);
  expect(inviteUrlValue).not.toBe(initialInviteUrl);

  // Simulator: clicking Simular votos before opening a round shows clear feedback
  await page.getByRole("button", { name: "Simular votos" }).click();
  await expect(page.getByRole("alert")).toHaveText("Abra o escrutínio antes de simular votos.");

  // Simulator: admin can add and remove participants before opening round
  await page.getByLabel("Participantes").fill("2");
  await page.getByRole("button", { name: "Simular entrada" }).click();
  await expect(page.getByText("2 participantes simulados entraram na sala.")).toBeVisible();

  await page.getByLabel("Participantes").fill("1");
  await page.getByRole("button", { name: "Remover participantes" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remover participantes" }).click();
  await expect(page.getByText("1 participantes removidos da presença.")).toBeVisible();

  const voterPage = await context.newPage();
  await voterPage.goto(inviteUrlValue);
  await voterPage.getByLabel("Código de acesso").fill(firstPin!.trim());
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
  await expect(
    page.getByText(/Eleito por maioria absoluta:|Sem maioria absoluta neste escrutínio\./i),
  ).toBeVisible();

  const auditSection = page.getByRole("region", { name: "Auditoria da sala" });
  await expect(auditSection).toBeVisible();
  await expect(auditSection.getByText("Sala criada", { exact: true })).toBeVisible();
  await expect(auditSection.getByText("Escrutínio iniciado", { exact: true })).toBeVisible();
  await expect(auditSection.getByText("Escrutínio encerrado", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: /Voltar para Painel de Salas/i }).click();
  await expect(page).toHaveURL(/\/admin\/salas$/);

  // Failure path: visiting a non-existent room UUID shows a not-found alert
  await page.goto("/admin/salas/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("alert")).toHaveText("Sala não encontrada.");
});

async function loginAsAdmin(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.locator("form").getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/salas$/);
  await expect(page.getByRole("button", { name: "Criar sala" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Quórum", exact: true })).toHaveValue("34");
}
