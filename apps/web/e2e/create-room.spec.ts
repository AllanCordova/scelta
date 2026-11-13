import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";

test("admin creates a room and sees the invite link and QR", async ({ page }) => {
  await loginAsAdmin(page);
  await page.request.post("http://127.0.0.1:3334/v1/admin/members/import", {
    data: {
      csv: "nome,comungante,sexo,data_nascimento\nPaulo,sim,M,1985-04-12\nSilas,sim,M,1990-01-10",
    },
  });
  await expect(page.getByText("Ana Admin")).toBeVisible();
  await page.getByLabel("Título").fill("Eleição de presbíteros");
  await page.getByRole("button", { name: "Presbítero" }).click();
  await expect(page.getByRole("textbox", { name: "Quórum", exact: true })).toHaveValue("34");

  await page.getByRole("button", { name: "Criar sala" }).click();

  const invite = page.getByRole("link", { name: /\/join\// });
  await expect(invite).toBeVisible();
  await expect(invite).toHaveAttribute("href", /\/join\//);
  await expect(page.getByTestId("invite-qr")).toBeVisible();
  await expect(page.getByRole("list", { name: "Salas" })).toContainText("Eleição de presbíteros");
  await expect(page.getByRole("list", { name: "Salas" })).toContainText("Rascunho");
});

test("admin sees an error when the quorum is invalid", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByLabel("Título").fill("Quórum fora da faixa");
  await page.locator("fieldset", { hasText: "Regras" }).getByRole("button", { name: "Personalizado" }).click();
  await expect(page.getByRole("textbox", { name: "Quórum", exact: true })).toHaveValue("");
  await page.getByRole("combobox", { name: /Unidade do quórum/ }).selectOption("percent");
  await page.getByRole("textbox", { name: "Quórum", exact: true }).fill("101");

  await page.getByRole("button", { name: "Criar sala" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Quórum inválido" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Quórum fora da faixa" })).toHaveCount(0);
});

test("logout leaves the room screen closed", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/admin");
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await expect(page.getByRole("button", { name: "Criar sala" })).toHaveCount(0);
});

async function loginAsAdmin(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.locator("form").getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/salas$/);
  await expect(page.getByRole("button", { name: "Criar sala" })).toBeVisible();
}
