import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers";

const ROUTES = [
  "/dashboard",
  "/deposits",
  "/demands",
  "/releases",
  "/notifications",
  "/escalations",
  "/reports",
  "/audit",
  "/admin/users",
  "/admin/institutions",
  "/admin/settings",
  "/account/security",
];

test("a signed-out visitor is sent to the sign-in page", async ({ page }) => {
  await page.goto("/deposits");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("every portal route renders for an administrator", async ({ page }) => {
  await signIn(page, DEMO.admin);
  for (const route of ROUTES) {
    const response = await page.goto(route);
    expect(response?.status(), `${route} returned ${response?.status()}`).toBe(200);
    expect(new URL(page.url()).pathname, `${route} redirected`).toBe(route);
    await expect(page.getByRole("heading", { level: 1 }), `${route} has no heading`).toBeVisible();
  }
});
