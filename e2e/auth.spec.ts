import { expect, test } from "@playwright/test";
import { DEMO, signIn, signOut, waitForHydration } from "./helpers";

test("a wrong password is refused without leaving the page", async ({ page }) => {
  await page.goto("/login");
  await waitForHydration(page);
  await page.getByLabel("Email").fill(DEMO.admin);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // The route announcer is also role=alert, so match the message itself.
  await expect(page.getByRole("alert").filter({ hasText: "Invalid email or password" })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("the auditor signs in and sees read-only chrome", async ({ page }) => {
  await signIn(page, DEMO.auditor);
  // The sidebar renders twice (mobile drawer + desktop aside); check the visible one.
  await expect(page.locator("aside").getByText("Auditor (read-only)")).toBeVisible();
  // No administration section for a read-only role.
  await expect(page.getByRole("link", { name: /^Users$/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Settings$/ })).toHaveCount(0);
});

test("signing out ends the session", async ({ page }) => {
  await signIn(page, DEMO.institute);
  await signOut(page);
  await page.goto("/deposits");
  await expect(page).toHaveURL(/\/login/);
});
