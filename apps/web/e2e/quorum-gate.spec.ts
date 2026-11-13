import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";

test("admin sees presence against quorum and a failed close", async ({ page }) => {
  const title = `Assembleia abaixo ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await loginAsAdmin(page);
  await page.getByLabel("Título").fill(title);
  await page.getByLabel("Candidatos").fill("Paulo, Silas");
  await page.getByRole("textbox", { name: "Quórum", exact: true }).fill("3");
  await page.getByRole("combobox", { name: /Unidade do quórum/ }).selectOption("absolute");
  await page.getByRole("group", { name: "Situação" }).getByRole("button", { name: "Aberta" }).click();
  await page.getByRole("button", { name: "Criar sala" }).click();

  const item = page.getByRole("listitem").filter({ hasText: title });
  await expect(item).toBeVisible();
  await expect(item.getByText("0 / 3", { exact: true })).toBeVisible();
  await expect(item.getByText("Abaixo do quórum", { exact: true })).toBeVisible();

  await item.getByRole("button", { name: "Abrir escrutínio" }).click();
  await item.getByRole("button", { name: "Encerrar escrutínio" }).click();
  await expect(item.getByRole("status")).toContainText("Quórum não atingido");
  await expect(item.getByRole("button", { name: "Abrir escrutínio" })).toBeVisible();
});

test("admin sees quorum met when required presence joins and closes without failure", async ({
  page,
}) => {
  const title = `Assembleia quórum ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await loginAsAdmin(page);
  await page.getByLabel("Título").fill(title);
  await page.getByLabel("Candidatos").fill("Paulo, Silas");
  await page.getByRole("textbox", { name: "Quórum", exact: true }).fill("1");
  await page.getByRole("combobox", { name: /Unidade do quórum/ }).selectOption("absolute");
  await page.getByRole("group", { name: "Situação" }).getByRole("button", { name: "Aberta" }).click();
  await page.getByRole("button", { name: "Criar sala" }).click();

  const invite = page.getByRole("link", { name: /\/join\// });
  await expect(invite).toBeVisible();
  const href = await invite.getAttribute("href");
  if (!href) {
    throw new Error("Missing invite link");
  }

  const item = page.getByRole("listitem").filter({ hasText: title });
  await expect(item.getByText("0 / 1", { exact: true })).toBeVisible();
  await expect(item.getByText("Abaixo do quórum", { exact: true })).toBeVisible();

  const visitor = await page.context().newPage();
  await visitor.goto(href);
  await visitor.getByLabel("Seu nome").fill("Maria Oliveira");
  await visitor.getByRole("button", { name: "Entrar na sala" }).click();
  await expect(visitor.getByRole("heading", { name: "Você entrou" })).toBeVisible();

  await expect(item.getByText("1 / 1", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(item.getByText("Quórum atingido", { exact: true })).toBeVisible();

  await item.getByRole("button", { name: "Abrir escrutínio" }).click();
  await item.getByRole("button", { name: "Encerrar escrutínio" }).click();
  await expect(item.getByRole("button", { name: "Abrir escrutínio" })).toBeVisible();
  await expect(item.getByRole("status")).not.toContainText("Quórum não atingido");
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
