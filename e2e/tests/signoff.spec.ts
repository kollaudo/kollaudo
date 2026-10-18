import { expect, test } from "@playwright/test";

// Checks what the verdict page says about the sign-off that run.sh gave to checkout 3.0.0 in staging.

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} not set. Run the tests with e2e/run.sh.`);
  return value;
}

test("shows who signed off a kind, when and their note", async ({ page }) => {
  await page.goto("/projects");
  await page.getByLabel("Add a project").fill(env("E2E_READ_TOKEN"));
  await page.getByRole("button", { name: "Add" }).click();
  await page.waitForURL((url) => url.pathname === "/");

  const target = new URLSearchParams({
    component: "checkout",
    environment: "staging",
    version: "3.0.0",
  });
  await page.goto(`/verdict?${target}`);
  await expect(
    page.getByRole("heading", { name: /^PASS checkout 3\.0\.0 in staging$/ }),
  ).toBeVisible();
  await expect(page.getByText("sign-off from a person for uat")).toBeVisible();
  await expect(page.getByText(/signed off by product-owner/)).toBeVisible();
  await expect(page.getByText(`“${env("E2E_SIGNOFF_NOTE")}”`)).toBeVisible();
});
