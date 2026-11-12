import { expect, test } from "@playwright/test";

test("home shows Scelta brand", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Scelta")).toBeVisible();
});
