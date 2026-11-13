import { expect, test } from "@playwright/test";

test("home and invite links stay open without a login", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Scelta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cadastrar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nova sala" })).toHaveCount(0);

  await page.goto("/join/exemplo");
  await expect(page).toHaveURL(/\/join\/exemplo$/);
  await expect(page.getByRole("heading", { name: "Votação com ordem e clareza" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Criar sala" })).toHaveCount(0);
});

test("a member can sign up and cannot open room management", async ({ page }) => {
  const email = `membro-${Date.now()}@scelta.test`;
  await page.goto("/cadastrar");
  await page.getByLabel("Nome").fill("Mia Membro");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("senha-segura");
  await page.locator("form").getByRole("button", { name: "Criar conta" }).click();

  await expect(page.getByText("Mia Membro")).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("alert")).toContainText("Esta área é só para administradores.");
  await expect(page.getByRole("button", { name: "Criar sala" })).toHaveCount(0);
});
