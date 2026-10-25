import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers";

test("an institute account cannot reach admin screens or the officer desk", async ({ page }) => {
  await signIn(page, DEMO.institute);

  await expect(page.getByRole("link", { name: /^Escalations/ })).toHaveCount(0);

  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/escalations");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("the auditor reads the escalation desk but gets no acknowledge control", async ({ page }) => {
  await signIn(page, DEMO.auditor);
  await page.goto("/escalations");
  await expect(page.getByRole("heading", { name: "Escalation desk" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
});

test("an official sees the escalation desk in the sidebar", async ({ page }) => {
  await signIn(page, DEMO.regionalOfficer);
  await expect(page.getByRole("link", { name: /^Escalations/ })).toHaveCount(1);
});
