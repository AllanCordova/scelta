import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";
const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:3334";

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function loginAsAdmin(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.locator("form").getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/salas$/);
  await expect(page.getByRole("button", { name: "Criar sala" })).toBeVisible();
}

async function createMemberViaApi(page: Page, fullName: string): Promise<{ id: string; fullName: string }> {
  const response = await page.request.post(`${apiBaseUrl}/v1/admin/members`, {
    data: {
      fullName,
      isCommunicant: true,
      isMale: true,
      birthDate: "1985-05-10",
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { member: { id: string; fullName: string } };
  return body.member;
}

async function createOpenRoomViaUi(
  page: Page,
  title: string,
): Promise<{ id: string; inviteToken: string }> {
  await page.getByLabel("Título").fill(title);
  await page.getByRole("textbox", { name: "Quórum", exact: true }).fill("1");
  await page.getByRole("combobox", { name: /Unidade do quórum/ }).selectOption("absolute");
  await page.getByRole("group", { name: "Situação" }).getByRole("button", { name: "Aberta" }).click();
  await page.getByRole("button", { name: "Criar sala" }).click();

  const item = page.getByRole("listitem").filter({ hasText: title });
  await expect(item).toBeVisible();

  const listResponse = await page.request.get(`${apiBaseUrl}/v1/admin/rooms`);
  expect(listResponse.ok()).toBe(true);
  const listBody = (await listResponse.json()) as {
    rooms: Array<{ id: string; title: string; inviteToken: string }>;
  };
  const created = listBody.rooms.find((room) => room.title === title);
  if (!created) {
    throw new Error(`Created room not found: ${title}`);
  }
  return { id: created.id, inviteToken: created.inviteToken };
}

test("admin manages room roster, revokes removed member code, adds ad-hoc voter, and prints single card", async ({
  page,
}) => {
  const suffix = uniqueSuffix();
  const memberName = `Membro Rol ${suffix}`;
  const adHocName = `Eleitor Avulso ${suffix}`;
  const roomTitle = `Sala Rol ${suffix}`;

  await loginAsAdmin(page);
  await createMemberViaApi(page, memberName);

  const room = await createOpenRoomViaUi(page, roomTitle);
  const generateRes = await page.request.post(
    `${apiBaseUrl}/v1/admin/rooms/${room.id}/access-codes/generate`,
  );
  expect(generateRes.ok()).toBe(true);

  await page.goto(`/admin/salas/${room.id}`);
  await expect(page.getByRole("heading", { name: roomTitle })).toBeVisible();
  await page.getByRole("tab", { name: "Preparar" }).click();

  const rosterList = page.getByRole("list", { name: "Rol da sala" });
  await expect(rosterList).toBeVisible();

  const memberRow = rosterList.getByTestId("roster-entry-row").filter({ hasText: memberName });
  await expect(memberRow).toBeVisible();
  const oldCode = (await memberRow.locator(".access-code-pin").textContent())?.trim() ?? "";
  expect(oldCode.length).toBeGreaterThan(0);

  await memberRow.getByTestId("remove-roster-entry-btn").click();
  await page
    .getByRole("dialog", { name: "Remover do rol" })
    .getByRole("button", { name: "Remover" })
    .click();
  await expect(memberRow).toHaveCount(0);

  const rejectedJoin = await page.request.post(`${apiBaseUrl}/v1/join/${room.inviteToken}`, {
    data: { code: oldCode, joinKey: `join-revoked-${suffix}` },
  });
  expect(rejectedJoin.status()).toBe(403);
  const rejectedBody = (await rejectedJoin.json()) as { error: string };
  expect(rejectedBody.error).toBe("invalid_access_code");

  await page.getByLabel("Nome completo (avulso)").fill(adHocName);
  await page.getByTestId("add-roster-adhoc-btn").click();

  const adHocRow = rosterList.getByTestId("roster-entry-row").filter({ hasText: adHocName });
  await expect(adHocRow).toBeVisible();
  await expect(adHocRow.getByText("Avulso", { exact: true })).toBeVisible();
  await expect(adHocRow.locator(".access-code-pin")).toBeVisible();

  await adHocRow.getByTestId("print-single-card-btn").click();
  const printDialog = page.getByRole("dialog", { name: "Cartões de acesso para impressão" });
  await expect(printDialog).toBeVisible();
  await expect(printDialog.locator(".print-card-item")).toHaveCount(1);
  await expect(printDialog.locator(".print-card-item")).toContainText(adHocName);
  await expect(printDialog.locator(".print-card-item svg")).toBeVisible();

  await printDialog.getByRole("button", { name: "Fechar" }).click();
  await expect(printDialog).toHaveCount(0);
});

test("admin manages candidates before 1st scrutiny and candidates lock after round opens", async ({
  page,
}) => {
  const suffix = uniqueSuffix();
  const voterName = `Votante Cand ${suffix}`;
  const candidateName = `Candidato Extra ${suffix}`;
  const roomTitle = `Sala Candidatos ${suffix}`;

  await loginAsAdmin(page);
  await createMemberViaApi(page, voterName);

  const room = await createOpenRoomViaUi(page, roomTitle);
  const generateRes = await page.request.post(
    `${apiBaseUrl}/v1/admin/rooms/${room.id}/access-codes/generate`,
  );
  expect(generateRes.ok()).toBe(true);
  const generateBody = (await generateRes.json()) as {
    accessCodes: Array<{ code: string }>;
  };
  const voterCode = generateBody.accessCodes[0]?.code;
  expect(voterCode).toBeTruthy();

  await page.goto(`/admin/salas/${room.id}`);
  await expect(page.getByRole("heading", { name: roomTitle })).toBeVisible();
  await page.getByRole("tab", { name: "Preparar" }).click();

  await page.getByTestId("add-candidate-name-input").fill(candidateName);
  await page.getByTestId("add-candidate-btn").click();

  const candidatesList = page.getByRole("list", { name: "Candidatos da sala" });
  const candidateRow = candidatesList
    .getByTestId("candidate-manage-row")
    .filter({ hasText: candidateName });
  await expect(candidateRow).toBeVisible();

  await candidateRow.getByTestId("remove-candidate-btn").click();
  await page
    .getByRole("dialog", { name: "Remover candidato" })
    .getByRole("button", { name: "Remover" })
    .click();
  await expect(candidateRow).toHaveCount(0);

  const joinRes = await page.request.post(`${apiBaseUrl}/v1/join/${room.inviteToken}`, {
    data: { code: voterCode, joinKey: `join-cand-${suffix}` },
  });
  expect(joinRes.ok()).toBe(true);

  await page.getByRole("button", { name: "Abrir escrutínio" }).click();
  await expect(page.getByText("1º Escrutínio")).toBeVisible();
  await page.getByRole("tab", { name: "Preparar" }).click();
  await expect(page.getByTestId("candidates-locked-notice")).toBeVisible();
  await expect(page.getByTestId("add-candidate-name-input")).toHaveCount(0);
  await expect(page.getByTestId("add-candidate-btn")).toHaveCount(0);
  await expect(page.getByTestId("remove-candidate-btn")).toHaveCount(0);
});

test("deleting a member in /admin/membros revokes their open-room access code", async ({ page }) => {
  const suffix = uniqueSuffix();
  const memberName = `Membro Removido ${suffix}`;
  const roomTitle = `Sala Soft Delete ${suffix}`;

  await loginAsAdmin(page);
  await createMemberViaApi(page, memberName);

  const room = await createOpenRoomViaUi(page, roomTitle);
  const generateRes = await page.request.post(
    `${apiBaseUrl}/v1/admin/rooms/${room.id}/access-codes/generate`,
  );
  expect(generateRes.ok()).toBe(true);

  const rosterRes = await page.request.get(`${apiBaseUrl}/v1/admin/rooms/${room.id}/roster`);
  expect(rosterRes.ok()).toBe(true);
  const rosterBody = (await rosterRes.json()) as {
    entries: Array<{ fullName: string; accessCode: { code: string } | null }>;
  };
  const memberEntry = rosterBody.entries.find((entry) => entry.fullName === memberName);
  const memberCode = memberEntry?.accessCode?.code ?? "";
  expect(memberCode.length).toBeGreaterThan(0);

  await page.goto("/admin/membros");
  await expect(page.getByRole("heading", { name: "Rol de membros" })).toBeVisible();
  await page.getByLabel("Buscar membro").fill(memberName);

  const memberRow = page.getByRole("listitem").filter({ hasText: memberName });
  await expect(memberRow).toBeVisible();
  await memberRow.getByRole("button", { name: "Remover" }).click();

  const confirmDialog = page.getByRole("dialog");
  await expect(confirmDialog).toContainText(/salas abertas/i);
  await confirmDialog.getByRole("button", { name: "Remover" }).click();
  await expect(memberRow).toHaveCount(0);

  const rejectedJoin = await page.request.post(`${apiBaseUrl}/v1/join/${room.inviteToken}`, {
    data: { code: memberCode, joinKey: `join-deleted-member-${suffix}` },
  });
  expect(rejectedJoin.status()).toBe(403);
  const rejectedBody = (await rejectedJoin.json()) as { error: string };
  expect(rejectedBody.error).toBe("invalid_access_code");
});
