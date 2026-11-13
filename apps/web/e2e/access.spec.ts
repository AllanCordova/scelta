import { expect, test } from "@playwright/test";

test("home and invite links stay open without a login", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Scelta" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: "Entrar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cadastrar" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Nova sala" })).toHaveCount(0);

  await page.goto("/join/exemplo");
  await expect(page).toHaveURL(/\/join\/exemplo$/);
  await expect(page.getByRole("alert")).toContainText("Convite inválido ou expirado.");
  await expect(page.getByRole("heading", { name: "Votação com ordem e clareza" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Criar sala" })).toHaveCount(0);
});

test("anonymous user cannot open room management or self-signup", async ({ page }) => {
  await page.goto("/cadastrar");
  await expect(page.getByRole("button", { name: "Criar conta" })).toHaveCount(0);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Criar sala" })).toHaveCount(0);
});
