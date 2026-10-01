import { expect, type Page, test } from "@playwright/test";

// Checks what people see, on the data run.sh sent. Each test starts with no saved projects.

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run the tests with e2e/run.sh.`);
  return value;
}

const read = () => env("E2E_READ_TOKEN");
const ingest = () => env("E2E_INGEST_TOKEN");
const otherRead = () => env("E2E_OTHER_READ_TOKEN");
const project = () => env("E2E_PROJECT");
const otherProject = () => env("E2E_OTHER_PROJECT");
const version = () => env("E2E_VERSION");

async function addProject(page: Page, token: string) {
  await page.goto("/projects");
  await page.getByLabel("Add a project").fill(token);
  await page.getByRole("button", { name: "Add" }).click();
}

/** Adds a project that can read: the UI saves it, then opens its matrix. */
async function openProject(page: Page, token: string) {
  await addProject(page, token);
  await page.waitForURL((url) => url.pathname === "/");
}

test("shows the health matrix and the tests of a run", async ({ page }) => {
  await openProject(page, read());

  await expect(page.getByRole("heading", { name: project() })).toBeVisible();
  const row = page.getByRole("row", { name: /^kollaudo/ });
  await expect(page.getByRole("columnheader", { name: "ci" })).toBeVisible();
  // The unit tests sent as JUnit XML, at build level.
  await expect(page.getByRole("columnheader", { name: "Build" })).toBeVisible();
  await expect(
    row.getByRole("link", { name: new RegExp(`${version().slice(0, 7)} unit`) }),
  ).toBeVisible();
  const card = row.getByRole("link", { name: new RegExp(`${version().slice(0, 7)} e2e`) });
  await expect(card).toContainText("e2e");
  await expect(card).toContainText("4 passed");
  await expect(page.getByRole("row", { name: /^checkout/ })).toContainText("1 failed");

  // What runs where, sent with kollaudo deployed.
  await expect(row).toContainText(`runs ${version().slice(0, 7)}`);
  await expect(card).not.toContainText("Not the version running here");
  const checkout = page.getByRole("row", { name: /^checkout/ });
  await expect(checkout).toContainText("runs 1.9.0");
  await expect(checkout).toContainText("Not the version running here");
  await expect(checkout).toContainText("No tests of 1.9.0 here yet");
  await expect(page.getByRole("row", { name: /^worker/ })).toContainText(
    "No tests of 1.4.0 here yet",
  );

  await card.click();
  await expect(page.getByRole("heading", { name: /kollaudo .* on ci/ })).toBeVisible();
  await expect(page.getByText("answers the health check")).toBeVisible();
  await expect(page.getByText("serves the web UI on every route")).toBeVisible();
});

test("keeps projects apart", async ({ page }) => {
  await openProject(page, read());
  await openProject(page, otherRead());

  await expect(page.getByRole("heading", { name: otherProject() })).toBeVisible();
  await expect(page.getByRole("row", { name: /^blog-web/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /^kollaudo/ })).toHaveCount(0);

  await page.getByLabel("Project").selectOption({ label: project() });
  await expect(page.getByRole("row", { name: /^kollaudo/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /^blog-web/ })).toHaveCount(0);

  await page.getByRole("link", { name: "Projects" }).click();
  const list = page.getByRole("list");
  await expect(list.getByText(project(), { exact: true })).toBeVisible();
  await expect(list.getByText(otherProject(), { exact: true })).toBeVisible();
});

test("refuses an ingest token when adding a project", async ({ page }) => {
  await addProject(page, ingest());
  await expect(page.getByText("This token can't read.")).toBeVisible();
});
