import { expect, type Page, test } from "@playwright/test";

const adminEmail = "e2e-admin@scelta.test";
const adminPassword = "e2e-admin-password";
const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:3334";

test("live room chat supports text + emotes, 2 msgs/5s rate limit, and admin mute controls", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const title = `Chat ao Vivo ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await loginAsAdmin(page);
  await page.request.post(`${apiBaseUrl}/v1/admin/members/import`, {
    data: {
      csv: "nome,comungante,sexo,data_nascimento\nMarcos,sim,M,1988-02-14",
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

  // Admin opens room detail where chat sidebar is visible on desktop
  await item.getByRole("link", { name: title }).click();
  const adminChat = page.getByRole("complementary", { name: "Chat ao vivo da sala" });
  await expect(adminChat).toBeVisible();

  const voterContext = await page.context().browser()!.newContext();
  try {
    const voter = await voterContext.newPage();
    await voter.goto(new URL(href, page.url()).toString());
    await voter.getByLabel("Código de acesso").fill(codes[0]!);
    await voter.getByRole("button", { name: "Entrar na sala" }).click();
    await expect(voter.getByRole("heading", { name: "Você entrou" })).toBeVisible();

    const voterChat = voter.getByRole("complementary", { name: "Chat ao vivo da sala" });
    await expect(voterChat).toBeVisible();

    // Voter sends 1 text message and 1 emote (2 msgs in 5s window), then 3rd hits rate limit
    await voterChat.getByLabel("Mensagem no chat").fill("Boa noite a todos!");
    await voterChat.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(voterChat.getByText("Boa noite a todos!")).toBeVisible({ timeout: 5_000 });
    await expect(adminChat.getByText("Boa noite a todos!")).toBeVisible({ timeout: 10_000 });

    await voterChat.getByRole("button", { name: "Enviar emote 🎉" }).click();
    await expect(adminChat.getByText("🎉")).toBeVisible({ timeout: 10_000 });

    await voterChat.getByLabel("Mensagem no chat").fill("Terceira mensagem seguida");
    await voterChat.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(
      voterChat.getByText("Limite de 2 mensagens a cada 5 segundos. Aguarde um instante."),
    ).toBeVisible({ timeout: 10_000 });

    // Admin sends a message back; voter sees it left-aligned while own message is right-aligned (is-own) and has no delete button
    await adminChat.getByLabel("Mensagem no chat").fill("Bem-vindos à assembleia!");
    await adminChat.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(voterChat.getByText("Bem-vindos à assembleia!")).toBeVisible({ timeout: 10_000 });
    await expect(voterChat.locator(".room-chat-message.is-own").filter({ hasText: "Boa noite a todos!" })).toBeVisible();
    await expect(voterChat.getByRole("button", { name: "Remover mensagem" })).toHaveCount(0);

    // Admin deletes the voter's first message and voter sees it removed live
    await adminChat
      .locator(".room-chat-message")
      .filter({ hasText: "Boa noite a todos!" })
      .getByRole("button", { name: "Remover mensagem" })
      .click();
    await expect(voterChat.getByText("Boa noite a todos!")).toHaveCount(0, { timeout: 10_000 });

    // Fullscreen toggle works on desktop
    await voterChat.getByRole("button", { name: "Tela cheia" }).click();
    await expect(voterChat).toHaveClass(/is-fullscreen/);
    await voterChat.getByRole("button", { name: "Sair da tela cheia" }).click();
    await expect(voterChat).not.toHaveClass(/is-fullscreen/);

    // Admin mutes the individual participant (shows toast & disables composer)
    await adminChat.getByRole("button", { name: /Pessoas \(/ }).click();
    const moderationList = adminChat.getByLabel("Moderação por participante");
    await expect(moderationList).toBeVisible();
    await moderationList.getByRole("button", { name: "Silenciar" }).first().click();

    await expect(voter.getByText("Você foi silenciado pelo administrador.")).toBeVisible({
      timeout: 10_000,
    });
    await expect(voterChat.getByLabel("Mensagem no chat")).toBeDisabled();

    // Admin unmutes participant, then mutes whole room
    await moderationList.getByRole("button", { name: "Liberar" }).first().click();
    await expect(voterChat.getByLabel("Mensagem no chat")).toBeEnabled({ timeout: 10_000 });

    await adminChat.getByRole("button", { name: "Silenciar sala" }).click();
    await expect(voter.getByText("Sala silenciada pelo administrador.")).toBeVisible({
      timeout: 10_000,
    });
    await expect(voterChat.getByLabel("Mensagem no chat")).toBeDisabled();

    // Admin can still post while room is muted, then unmutes room
    await adminChat.getByLabel("Mensagem no chat").fill("Ordem do dia.");
    await adminChat.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(voterChat.getByText("Ordem do dia.")).toBeVisible({ timeout: 10_000 });

    await adminChat.getByRole("button", { name: "Liberar sala" }).click();
    await expect(voterChat.getByLabel("Mensagem no chat")).toBeEnabled({ timeout: 10_000 });

    // Mobile viewport shows floating chat button that toggles overlay
    await voter.setViewportSize({ width: 390, height: 844 });
    const fab = voter.getByRole("button", { name: "Abrir chat ao vivo" });
    await expect(fab).toBeVisible();
    await fab.click();
    await expect(voterChat).toHaveClass(/is-open/);
    await voterChat.getByRole("button", { name: "Fechar chat" }).click();
    await expect(voterChat).toBeHidden();
  } finally {
    await voterContext.close();
  }
});

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.getByRole("region", { name: "Entrar" }).getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/salas/);
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
