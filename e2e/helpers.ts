import { expect, type Page } from "@playwright/test";

export const PASSWORD = process.env.E2E_PASSWORD ?? "Demo@12345";

export const DEMO = {
  admin: "admin@demo.fdr",
  verifier: "verifier@demo.fdr",
  regionalOfficer: "ro.northern@demo.fdr",
  auditor: "auditor@demo.fdr",
  institute: "accounts@alpha.demo.fdr",
} as const;

/**
 * Wait until React has hydrated the form on screen. Clicking before that makes
 * the browser do a native submit and the fields simply reload empty, which in
 * dev happens easily because the first visit compiles the page.
 */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(
    () => {
      const button = document.querySelector('form button[type="submit"]');
      return Boolean(button) && Object.keys(button!).some((key) => key.startsWith("__reactProps$"));
    },
    null,
    { timeout: 30_000 },
  );
}

/** Sign in through the real form and wait for the portal shell. */
export async function signIn(page: Page, email: string, password = PASSWORD) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto("/login");
    await waitForHydration(page);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);

    const left = page
      .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 25_000 })
      .then(() => true)
      .catch(() => false);
    await page.getByRole("button", { name: "Sign in" }).click();
    if (await left) {
      await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeAttached();
      return;
    }
  }
  throw new Error(`could not sign in as ${email}`);
}

/** The desktop sidebar's sign-out (the mobile drawer holds a hidden twin). */
export async function signOut(page: Page) {
  await page.locator('button:visible:text-is("Sign out")').first().click();
  await page.waitForURL("**/login**");
}
