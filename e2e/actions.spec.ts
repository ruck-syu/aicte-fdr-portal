import { expect, test } from "@playwright/test";
import { DEMO, signIn, waitForHydration } from "./helpers";

test("saving the settings form round-trips through a server action", async ({ page }) => {
  await signIn(page, DEMO.admin);
  await page.goto("/admin/settings");
  await waitForHydration(page);

  // Re-submitting the form's own values proves the client form hydrated and the
  // action ran: a non-hydrated form would post the page instead.
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toContainText("Settings saved");
  await expect(page).toHaveURL(/\/admin\/settings$/);
});

test("the escalation desk renders its counters", async ({ page }) => {
  await signIn(page, DEMO.verifier);
  await page.goto("/escalations");
  await expect(page.getByText("Open escalations")).toBeVisible();
  await expect(page.getByRole("link", { name: "Not yet acknowledged" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Closed" })).toBeVisible();
});

test("the sign-in security page reports the factor state", async ({ page }) => {
  await signIn(page, DEMO.auditor);
  await page.goto("/account/security");
  await expect(page.getByRole("heading", { name: "Sign-in security" })).toBeVisible();
  await expect(page.getByText(/No second factor|Two-factor active|Code required/).first()).toBeVisible();
});
