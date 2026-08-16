import { expect, test } from "@playwright/test";

test("public overview and methodology are reachable", async ({ page }) => {
  await page.goto("/zh-CN");
  await expect(page.getByText("VCT 2026 晋级计算器")).toBeVisible();
  await page.getByRole("link", { name: "方法说明" }).click();
  await expect(page.getByRole("heading", { name: "方法与规则" })).toBeVisible();
});

