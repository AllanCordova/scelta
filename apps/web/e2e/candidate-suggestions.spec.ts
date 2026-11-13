import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";

test("admin navigates via /admin hub, manages members manually and via CSV, and creates a room with auto-pulled communicant candidates", async ({
  page,
}) => {
  const title = `Auto candidatos ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await loginAsAdmin(page);

  const csv = [
    "nome,comungante,sexo,data_nascimento,upa_ativo,upa_ingresso",
    "Paulo Apóstolo,sim,M,1985-04-12,nao,",
    "Silas Companheiro,sim,M,1998-06-01,sim,2024-01-10",
  ].join("\n");

  // Navigate to Admin hub (/admin) -> Membros da Plataforma (/admin/membros)
  await expect(page.getByRole("link", { name: "Membros" })).toHaveCount(0);
  await page.getByRole("link", { name: "Admin" }).first().click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Administração" })).toBeVisible();

  await page.getByRole("link", { name: /Membros da Plataforma/i }).click();
  await expect(page).toHaveURL(/\/admin\/membros$/);
  await expect(page.getByRole("heading", { name: "Rol de membros" })).toBeVisible();

  // Add a member manually, search, and remove
  await page.getByLabel("Nome completo").fill("Membro Temporário");
  await page.getByRole("button", { name: "Adicionar membro" }).click();
  await expect(page.getByText("Membro Temporário")).toBeVisible();

  await page.getByLabel("Buscar membro").fill("Temporário");
  await expect(page.getByText("Membro Temporário")).toBeVisible();
  await page.getByRole("button", { name: "Remover" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Remover" }).click();
  await expect(page.getByText("Membro Temporário")).toHaveCount(0);
  await page.getByLabel("Buscar membro").fill("");

  // Import CSV
  await page.getByLabel("Arquivo CSV de membros").setInputFiles({
    name: "membros.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });
  await page.getByRole("button", { name: "Importar membros" }).click();
  await expect(page.getByText(/Importação concluída:/).first()).toBeVisible();

  // Navigate back to Salas (/admin/salas)
  await page.getByRole("link", { name: "Salas" }).first().click();
  await expect(page).toHaveURL(/\/admin\/salas$/);

  await expect(page.getByLabel("Candidatos")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Sugestões de candidatos" })).toHaveCount(0);

  await page.getByLabel("Título").fill(title);
  await page.getByLabel("Aptos").fill("1");
  await page.getByRole("button", { name: "Aberta" }).click();
  await page.getByRole("button", { name: "Criar sala" }).click();

  const item = page.getByRole("listitem").filter({ hasText: title });
  await expect(item).toBeVisible();

  const listResponse = await page.request.get("http://127.0.0.1:3334/v1/admin/rooms");
  const listBody = (await listResponse.json()) as {
    rooms: Array<{ id: string; title: string; inviteToken: string }>;
  };
  const createdRoom = listBody.rooms.find((room) => room.title === title)!;
  const codesResponse = await page.request.post(
    `http://127.0.0.1:3334/v1/admin/rooms/${createdRoom.id}/access-codes/generate`,
  );
  const codesBody = (await codesResponse.json()) as { accessCodes: Array<{ code: string }> };
  await page.request.post(`http://127.0.0.1:3334/v1/join/${createdRoom.inviteToken}`, {
    data: { code: codesBody.accessCodes[0]!.code, joinKey: `join-auto-${Date.now()}` },
  });

  await item.getByRole("button", { name: "Abrir escrutínio" }).click();
  await expect(item.getByText("1º escrutínio", { exact: true })).toBeVisible();
  await item.getByRole("link", { name: title }).click();
  await expect(page.locator(".candidate-name", { hasText: "Paulo Apóstolo" })).toBeVisible();
  await expect(page.locator(".candidate-name", { hasText: "Silas Companheiro" })).toBeVisible();
});

async function loginAsAdmin(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.locator("form").getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/salas$/);
  await expect(page.getByRole("button", { name: "Criar sala" })).toBeVisible();
}
