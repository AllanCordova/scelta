import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";

test("admin imports members via CSV file on /admin/membros, sees room-type candidate suggestions, includes/excludes names, opens ballot, and can open QR/delete rooms", async ({
  page,
}) => {
  const title = `Sugestão de candidatos ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await loginAsAdmin(page);

  const csv = [
    "nome,comungante,sexo,data_nascimento,upa_ativo,upa_ingresso",
    "Paulo Apóstolo,sim,M,1985-04-12,nao,",
    "Silas Companheiro,sim,M,1998-06-01,sim,2024-01-10",
    "Timóteo Menor,sim,M,2015-09-15,sim,2026-09-01",
    "Lídia de Tiatira,sim,F,1995-03-20,sim,2023-05-01",
  ].join("\n");

  // Navigate to dedicated /admin/membros route
  await page.getByRole("link", { name: "Membros" }).first().click();
  await expect(page).toHaveURL(/\/admin\/membros$/);
  await expect(page.getByRole("heading", { name: "Rol de membros" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Baixar template CSV" })).toBeVisible();

  await page.getByLabel("Arquivo CSV de membros").setInputFiles({
    name: "membros.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });
  await expect(page.getByText(/membros\.csv/)).toBeVisible();
  await page.getByRole("button", { name: "Importar membros" }).click();
  await expect(page.getByText(/Importação concluída:/)).toBeVisible();

  // Navigate back to /admin (Salas)
  await page.getByRole("link", { name: "Salas" }).first().click();
  await expect(page).toHaveURL(/\/admin$/);

  const suggestionsGroup = page.getByRole("group", { name: "Sugestões de candidatos" });
  await expect(suggestionsGroup).toBeVisible();

  // Default roomType is Presbítero (elder): only communicant men >= 18 appear
  await expect(suggestionsGroup.getByRole("button", { name: "Paulo Apóstolo" })).toBeVisible();
  await expect(suggestionsGroup.getByRole("button", { name: "Silas Companheiro" })).toBeVisible();
  await expect(suggestionsGroup.getByRole("button", { name: "Lídia de Tiatira" })).toHaveCount(0);
  await expect(suggestionsGroup.getByRole("button", { name: "Timóteo Menor" })).toHaveCount(0);

  // Switch roomType to Diretoria UPA: only active UPA members with >= 6 months seniority appear
  await page.getByRole("group", { name: "Tipo" }).getByRole("button", { name: "Diretoria UPA" }).click();
  await expect(suggestionsGroup.getByRole("button", { name: "Lídia de Tiatira" })).toBeVisible();
  await expect(suggestionsGroup.getByRole("button", { name: "Silas Companheiro" })).toBeVisible();
  await expect(suggestionsGroup.getByRole("button", { name: "Paulo Apóstolo" })).toHaveCount(0);
  await expect(suggestionsGroup.getByRole("button", { name: "Timóteo Menor" })).toHaveCount(0);

  // Switch back to Presbítero, include both Paulo and Silas, then exclude Paulo and re-include Paulo
  await page.getByRole("group", { name: "Tipo" }).getByRole("button", { name: "Presbítero" }).click();
  await expect(suggestionsGroup.getByRole("button", { name: "Paulo Apóstolo" })).toBeVisible();

  await suggestionsGroup.getByRole("button", { name: "Paulo Apóstolo" }).click();
  await suggestionsGroup.getByRole("button", { name: "Silas Companheiro" }).click();
  await expect(page.getByLabel("Candidatos")).toHaveValue("Paulo Apóstolo, Silas Companheiro");

  await suggestionsGroup.getByRole("button", { name: "Paulo Apóstolo" }).click();
  await expect(page.getByLabel("Candidatos")).toHaveValue("Silas Companheiro");
  await suggestionsGroup.getByRole("button", { name: "Paulo Apóstolo" }).click();
  await expect(page.getByLabel("Candidatos")).toHaveValue("Silas Companheiro, Paulo Apóstolo");

  await page.getByLabel("Título").fill(title);
  await page.getByRole("textbox", { name: "Quórum", exact: true }).fill("1");
  await page.getByRole("combobox", { name: /Unidade do quórum/ }).selectOption("absolute");
  await page.getByRole("group", { name: "Situação" }).getByRole("button", { name: "Aberta" }).click();
  await page.getByRole("button", { name: "Criar sala" }).click();

  const item = page.getByRole("listitem").filter({ hasText: title });
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Abrir escrutínio" }).click();
  await expect(
    item.getByText("1º escrutínio — Candidatos: Paulo Apóstolo, Silas Companheiro"),
  ).toBeVisible();

  // Verify QR Code, Copiar link, and Excluir actions on the room card
  await item.getByRole("button", { name: "Copiar link" }).click();
  await expect(item.getByRole("button", { name: "Link copiado" })).toBeVisible();

  await item.getByRole("button", { name: "QR Code" }).click();
  await expect(page.getByTestId("invite-qr")).toBeVisible();

  await item.getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(0);
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
