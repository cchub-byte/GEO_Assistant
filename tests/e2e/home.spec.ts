import { expect, test } from "@playwright/test";

test("dashboard renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /GEO/ })).toBeVisible();
  await expect(page.locator(".stat-card").filter({ hasText: "当前品牌平均位置" })).toBeVisible();
});
