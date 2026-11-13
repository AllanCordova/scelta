import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";

test("a visitor joins an open room and the admin sees one presence", async ({ page }) => {
  const title = `Sala aberta ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await loginAsAdmin(page);
  await page.request.post("http://127.0.0.1:3334/v1/admin/members/import", {
    data: {
      csv: "nome,comungante,sexo,data_nascimento\nPaulo,sim,M,1985-04-12\nSilas,sim,M,1990-01-10",
    },
  });
  await page.getByLabel("Título").fill(title);
  await page.locator("fieldset", { hasText: "Situação" }).getByRole("button", { name: "Aberta" }).click();
  await page.getByRole("button", { name: "Criar sala" }).click();

  const invite = page.getByRole("link", { name: /\/join\// });
  await expect(invite).toBeVisible();
  const href = await invite.getAttribute("href");
  if (!href) {
    throw new Error("Missing invite link");
  }

  const item = page.getByRole("listitem").filter({ hasText: title });
  await expect(item.getByText("0 / 0", { exact: true })).toBeVisible();

  const codes = await createSimulatedCodes(page, title, 1);

  const visitor = await page.context().newPage();
  await visitor.goto(href);
  await visitor.getByLabel("Código de acesso").fill(codes[0]!);
  await visitor.getByRole("button", { name: "Entrar na sala" }).click();
  await expect(visitor.getByRole("heading", { name: "Você entrou" })).toBeVisible();
  await expect(visitor.getByText(title)).toBeVisible();
  await expect(item.getByText("1 / 0", { exact: true })).toBeVisible({ timeout: 10_000 });
});

test("an unknown invite is rejected", async ({ page }) => {
  await page.goto("/join/exemplo");
  await expect(page.getByRole("alert")).toContainText("Convite inválido ou expirado.");
  await expect(page.getByLabel("Código de acesso")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Votação com ordem e clareza" })).toHaveCount(0);
});

test("a draft room invite explains that the room is not open", async ({ page }) => {
  const title = `Sala rascunho ${Date.now().toString(36)}`;
  await loginAsAdmin(page);
  await page.request.post("http://127.0.0.1:3334/v1/admin/members/import", {
    data: {
      csv: "nome,comungante,sexo,data_nascimento\nPaulo,sim,M,1985-04-12\nSilas,sim,M,1990-01-10",
    },
  });
  await page.getByLabel("Título").fill(title);
  await page.getByRole("button", { name: "Criar sala" }).click();

  const href = await page.getByRole("link", { name: /\/join\// }).getAttribute("href");
  if (!href) {
    throw new Error("Missing invite link");
  }

  await page.goto(href);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Esta sala ainda não está aberta.");
  await expect(page.getByLabel("Código de acesso")).toHaveCount(0);
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
  await expect(page).toHaveURL(/\/admin\/salas$/);
}
