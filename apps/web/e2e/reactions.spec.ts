import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";
const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:3334";

test("participant sends reactions, hits rate limit, and admin disables and re-enables reactions", async ({
  page,
}) => {
  const title = `Reações ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await loginAsAdmin(page);
  await page.request.post(`${apiBaseUrl}/v1/admin/members/import`, {
    data: {
      csv: "nome,comungante,sexo,data_nascimento\nPaulo,sim,M,1985-04-12",
    },
  });
  await page.getByLabel("Título").fill(title);
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

  const codes = await createSimulatedCodes(page, title, 1);

  const voterContext = await page.context().browser()!.newContext();
  try {
    const voter = await voterContext.newPage();
    await voter.goto(new URL(href, page.url()).toString());
    await voter.getByLabel("Código de acesso").fill(codes[0]!);
    await voter.getByRole("button", { name: "Entrar na sala" }).click();
    await expect(voter.getByRole("heading", { name: "Você entrou" })).toBeVisible();

    const clapButton = voter.getByRole("button", { name: "Reagir com 👏" });
    await expect(clapButton).toBeVisible();

    // Send 5 reactions (max per 10s window), verify feed renders 👏, then 6th hits rate limit
    for (let index = 0; index < 5; index += 1) {
      await clapButton.click();
    }
    await expect(voter.locator(".voter-reactions-feed").getByText("👏").first()).toBeVisible();

    await clapButton.click();
    await expect(voter.getByText("Muitas reações em sequência. Aguarde alguns segundos.")).toBeVisible({
      timeout: 10_000,
    });

    // Admin opens room detail and disables reactions
    await item.getByRole("link", { name: title }).click();
    const disableBtn = page.getByRole("button", { name: "Reações: Ativadas" });
    await expect(disableBtn).toBeVisible();
    await disableBtn.click();
    const enableBtn = page.getByRole("button", { name: "Reações: Desativadas" });
    await expect(enableBtn).toBeVisible();

    await expect(voter.getByText("Reações desativadas pelo administrador.")).toBeVisible({
      timeout: 10_000,
    });
    await expect(voter.getByRole("button", { name: "Reagir com 👏" })).toBeHidden();

    // Admin re-enables reactions
    await enableBtn.click();
    await expect(page.getByRole("button", { name: "Reações: Ativadas" })).toBeVisible();
    await expect(voter.getByRole("button", { name: "Reagir com 👏" })).toBeVisible({
      timeout: 10_000,
    });
  } finally {
    await voterContext.close();
  }
});

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.getByRole("region", { name: "Entrar" }).getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

async function createSimulatedCodes(page: Page, roomTitle: string, count: number): Promise<string[]> {
  const roomsRes = await page.request.get(`${apiBaseUrl}/v1/admin/rooms`);
  expect(roomsRes.ok()).toBe(true);
  const roomsBody = (await roomsRes.json()) as {
    rooms: Array<{ id: string; title: string }>;
  };
  const room = roomsBody.rooms.find((entry) => entry.title === roomTitle);
  if (!room) {
    throw new Error(`Room not found: ${roomTitle}`);
  }

  const simRes = await page.request.post(
    `${apiBaseUrl}/v1/admin/rooms/${room.id}/access-codes/simulate`,
    { data: { count } },
  );
  expect(simRes.ok()).toBe(true);
  const simBody = (await simRes.json()) as {
    accessCodes: Array<{ code: string }>;
  };
  return simBody.accessCodes.map((entry) => entry.code);
}
