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

test("etapa 3: paper voter mode, paper tally form, close guard, and combined online+paper results", async ({
  page,
}) => {
  const suffix = uniqueSuffix();
  const paperVoterName = `Eleitor Papel ${suffix}`;
  const onlineVoterName = `Eleitor Online ${suffix}`;
  const candAlfaName = `Candidato Alfa ${suffix}`;
  const candBetaName = `Candidato Beta ${suffix}`;
  const roomTitle = `Sala Papel ${suffix}`;

  await loginAsAdmin(page);
  await createMemberViaApi(page, paperVoterName);
  await createMemberViaApi(page, onlineVoterName);

  // Create open room via API with 2 candidates
  const createRoomRes = await page.request.post(`${apiBaseUrl}/v1/admin/rooms`, {
    data: {
      title: roomTitle,
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      status: "open",
      quorumValue: 1,
      quorumUnit: "absolute",
      candidates: [candAlfaName, candBetaName],
    },
  });
  expect(createRoomRes.status()).toBe(201);
  const createRoomBody = (await createRoomRes.json()) as {
    room: { id: string; inviteToken: string };
  };
  const room = createRoomBody.room;

  const generateRes = await page.request.post(
    `${apiBaseUrl}/v1/admin/rooms/${room.id}/access-codes/generate`,
  );
  expect(generateRes.ok()).toBe(true);

  await page.goto(`/admin/salas/${room.id}`);
  await expect(page.getByRole("heading", { name: roomTitle })).toBeVisible();
  await page.getByRole("tab", { name: "Preparar" }).click();

  const rosterList = page.getByRole("list", { name: "Rol da sala" });
  await expect(rosterList).toBeVisible();

  const paperRow = rosterList.getByTestId("roster-entry-row").filter({ hasText: paperVoterName });
  const onlineRow = rosterList.getByTestId("roster-entry-row").filter({ hasText: onlineVoterName });
  await expect(paperRow).toBeVisible();
  await expect(onlineRow).toBeVisible();

  const paperVoterOldCode = (await paperRow.locator(".access-code-pin").textContent())?.trim() ?? "";
  const onlineVoterCode = (await onlineRow.locator(".access-code-pin").textContent())?.trim() ?? "";
  expect(paperVoterOldCode.length).toBeGreaterThan(0);
  expect(onlineVoterCode.length).toBeGreaterThan(0);

  // Mark 1 voter as "Vota no papel" via confirm dialog
  await paperRow.getByTestId("toggle-paper-mode-btn").click();
  const paperConfirmDialog = page.getByRole("dialog", { name: "Marcar para voto em papel" });
  await expect(paperConfirmDialog).toBeVisible();
  await paperConfirmDialog.getByRole("button", { name: "Confirmar voto em papel" }).click();

  await expect(page.getByTestId("roster-paper-count")).toHaveText("Papel: 1");
  await expect(paperRow.getByTestId("paper-voter-badge")).toHaveText("Papel");

  // Old code of paper voter must be rejected (403)
  const rejectedJoin = await page.request.post(`${apiBaseUrl}/v1/join/${room.inviteToken}`, {
    data: { code: paperVoterOldCode, joinKey: `join-paper-revoked-${suffix}` },
  });
  expect(rejectedJoin.status()).toBe(403);

  // 2nd voter joins online
  const onlineJoinKey = `join-online-${suffix}`;
  const onlineJoinRes = await page.request.post(`${apiBaseUrl}/v1/join/${room.inviteToken}`, {
    data: { code: onlineVoterCode, joinKey: onlineJoinKey },
  });
  expect(onlineJoinRes.ok()).toBe(true);

  // Open scrutiny -> transitions to Conduzir tab
  await page.getByRole("button", { name: "Abrir escrutínio" }).click();
  await expect(page.getByTestId("room-paper-count")).toHaveText("Papel: 1");
  await expect(page.getByRole("button", { name: "Encerrar escrutínio" })).toBeVisible();
  await expect(page.getByTestId("paper-tally-panel")).toBeVisible();

  // Online voter casts ballot for Candidato Alfa
  const detailRes = await page.request.get(`${apiBaseUrl}/v1/admin/rooms/${room.id}`);
  expect(detailRes.ok()).toBe(true);
  const detailBody = (await detailRes.json()) as {
    room: { candidates: Array<{ id: string; displayName: string }> };
  };
  const alfaCandidate = detailBody.room.candidates.find((c) => c.displayName === candAlfaName);
  expect(alfaCandidate).toBeTruthy();

  const ballotRes = await page.request.post(`${apiBaseUrl}/v1/join/${room.inviteToken}/ballot`, {
    data: { joinKey: onlineJoinKey, candidateId: alfaCandidate!.id },
  });
  expect(ballotRes.ok()).toBe(true);

  // Paper voter is NOT counted as pending online -> Faltam Votar KPI shows 0
  const pendingKpi = page.locator(".detail-kpi-card").filter({ hasText: "Faltam Votar" });
  await expect(pendingKpi.locator(".detail-kpi-number")).toHaveText("0");

  // Try closing without paper tally -> verify "Urna de papel sem lançamento" dialog appears, cancel it
  await page.getByRole("button", { name: "Encerrar escrutínio" }).click();
  const noPaperDialog = page.getByRole("dialog", { name: "Urna de papel sem lançamento" });
  await expect(noPaperDialog).toBeVisible();
  await noPaperDialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(noPaperDialog).toHaveCount(0);

  // Fill PaperTallyPanel (ballotCount: 1, 1 vote for Candidato Alfa) and save
  await page.getByTestId("paper-ballot-count-input").fill("1");
  await page.getByLabel(`Votos em papel — ${candAlfaName}`).fill("1");
  await page.getByTestId("save-paper-tally-btn").click();
  await expect(page.getByTestId("paper-tally-provenance")).toBeVisible();

  // Close scrutiny -> verify combined Online + Papel winner & tally-origin-summary
  await page.getByRole("button", { name: "Encerrar escrutínio" }).click();
  const originSummary = page.getByTestId("tally-origin-summary");
  await expect(originSummary).toBeVisible();
  await expect(originSummary).toContainText("Total: 2");
  await expect(originSummary).toContainText("Online: 1");
  await expect(originSummary).toContainText("Papel: 1");

  const alfaCard = page.locator(".candidate-detail-card").filter({ hasText: candAlfaName });
  await expect(alfaCard).toContainText("2 votos");
  await expect(alfaCard).toContainText("Online: 1 · Papel: 1");

  // Open ShareBoardPaper and verify originSummary
  await page.getByRole("button", { name: "Compartilhar resultado" }).click();
  const shareDialog = page.getByRole("dialog", { name: new RegExp(`Documento de compartilhamento.*${roomTitle}`) });
  await expect(shareDialog).toBeVisible();
  await expect(shareDialog.getByTestId("share-paper-origin")).toContainText(
    "(Total: 2 — Online: 1 · Papel: 1)",
  );
});
