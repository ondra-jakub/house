import { test, expect } from "@playwright/test";

const technicalButton = (page) => page.getByRole("button", { name: "Technika", exact: true });

async function openTechnical(page, hash = "") {
  await page.goto(`/?rezim=technika${hash}`);
  await expect(page.locator("#technical-mode")).toBeVisible();
  await expect(page.locator("#presentation-mode")).toBeHidden();
}

test("prezentace, přepínač, přímé URL, historie a neplatný režim", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle("JIH 140 — Domov otočený za sluncem");
  await expect(page.locator("[data-presentation-plan] .room")).toHaveCount(15);
  await expect(page.locator("[data-summary='residential-value']")).toHaveText("147,7");
  await technicalButton(page).click();
  await expect(page).toHaveURL(/rezim=technika/);
  await expect(page).toHaveTitle("JIH 140 — Technický koncept dřevostavby");
  await expect(technicalButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#technical-mode")).toBeVisible();
  await page.getByRole("button", { name: "Prezentace", exact: true }).click();
  await expect(page.locator("#presentation-mode")).toBeVisible();
  await expect(page.locator("#technical-mode")).toBeHidden();
  await page.goBack();
  await expect(page.locator("#technical-mode")).toBeVisible();
  await page.goto("/?rezim=technika#technika-statika");
  await expect(page.locator("#technika-statika")).toBeVisible();
  await expect(page).toHaveURL(/#technika-statika$/);
  await page.goto("/?rezim=neplatny");
  await expect(page.locator("#presentation-mode")).toBeVisible();
  await expect(page).not.toHaveURL(/rezim=/);
  expect(errors).toEqual([]);
});

test("výběr místnosti funguje kliknutím i klávesnicí", async ({ page }) => {
  await page.goto("/");
  const master = page.locator("[data-presentation-plan] [data-room='master']");
  await master.focus();
  await page.keyboard.press("Enter");
  await expect(master).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#room-area")).toHaveText("15,1");
  await expect(page.locator("#room-name")).toHaveText("Hlavní ložnice");
  const living = page.locator("[data-presentation-plan] [data-room='living']");
  await living.focus();
  await page.keyboard.press("Space");
  await expect(living).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#room-area")).toHaveText("47,9");
});

test("technika obsahuje všechny výkresy, plochy, U i statické mezivýsledky", async ({ page }) => {
  await openTechnical(page);
  await expect(page.locator("[data-elevation] svg")).toHaveCount(4);
  await expect(page.locator(".drawing-scroll[data-section] svg")).toHaveCount(2);
  await expect(page.locator("[data-detail] svg")).toHaveCount(4);
  await expect(page.locator("[data-technical-plan] > svg")).toHaveCount(1);
  await expect(page.locator("[data-technical-plan] svg")).toHaveCount(1);
  await expect(page.locator("[data-technical-plan] .room")).toHaveCount(15);
  await expect(page.locator("#room-table tbody tr")).toHaveCount(15);
  await expect(page.locator("#opening-table tbody tr")).toHaveCount(26);
  await expect(page.locator("#thermal-results")).toContainText("U = 0,135");
  await expect(page.locator("#thermal-results")).toContainText("R′/R″");
  await expect(page.locator("#structural-results")).toContainText("Hlavní lepený průvlak");
  await expect(page.locator("#structural-results")).toContainText("M = qL²/8");
  await expect(page.locator("#structural-results")).toContainText("Neprovádí se:");
  await expect(page.locator("#structural-results .check-state.is-bad")).toHaveCount(0);
  await page.locator("[data-technical-plan]").screenshot({ path: "test-results/technical-plan.png" });
});

test("3D se načte až po použití, nemá CDN a podporuje ovládání", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await openTechnical(page, "#technika-3d");
  expect(requests.some((url) => url.includes("viewer3d.js"))).toBe(false);
  await page.locator("[data-start-3d]").click();
  await expect(page.locator("[data-viewer-controls]")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-viewer-stage] canvas")).toBeVisible();
  await page.getByRole("button", { name: "Jih", exact: true }).click();
  await page.locator("[data-layer='roof']").uncheck();
  await expect(page.locator("[data-layer='roof']")).not.toBeChecked();
  const canvas = page.locator("[data-viewer-stage] canvas");
  await canvas.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("q");
  await page.keyboard.press("+");
  await page.keyboard.press("Home");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.locator("#technika-3d").screenshot({ path: "test-results/3d.png" });
  const external = requests.filter((url) => /^https?:/.test(url) && !url.startsWith("http://127.0.0.1:5173"));
  expect(external).toEqual([]);
});

test("výpadek WebGL ponechá statickou axonometrii a technický obsah", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (String(type).includes("webgl")) return null;
      return original.call(this, type, ...args);
    };
  });
  await openTechnical(page, "#technika-3d");
  await page.locator("[data-start-3d]").click();
  await expect(page.locator("[data-viewer-status]")).toContainText("Živé 3D nelze spustit");
  await expect(page.locator("[data-axo] svg")).toBeVisible();
  await expect(page.locator("#structural-results")).toContainText("Hlavní lepený průvlak");
});

test("výpadek importu 3D ponechá funkční fallback", async ({ page }) => {
  await page.route("**/src/viewer3d.js", (route) => route.abort());
  await openTechnical(page, "#technika-3d");
  await page.locator("[data-start-3d]").click();
  await expect(page.locator("[data-viewer-status]")).toContainText("Živé 3D nelze spustit");
  await expect(page.locator("[data-axo] svg")).toBeVisible();
});

test("mobilní šířka neořezává stránku a výkresy se posouvají", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTechnical(page);
  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  const scroll = await page.locator("[data-technical-plan]").evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(scroll.scroll).toBeGreaterThan(scroll.client);
  expect(await page.locator("html").evaluate((element) => getComputedStyle(element).scrollBehavior)).toBe("auto");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".tech-hero").screenshot({ path: "test-results/mobile-technical.png" });
});

test("tisk techniky používá statickou axonometrii a A3 PDF", async ({ page }) => {
  await openTechnical(page);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("[data-viewer-stage]")).toBeHidden();
  await expect(page.locator(".skip-link")).toBeHidden();
  await expect(page.locator(".tech-actions")).toBeHidden();
  await expect(page.locator("[data-axo]")).toBeVisible();
  await expect(page.locator("#presentation-mode")).toBeHidden();
  const printScale = await page.locator("[data-technical-plan] svg").evaluate((element) => ({ actualMm: element.getBoundingClientRect().width * 25.4 / 96, expectedMm: Number.parseFloat(element.style.getPropertyValue("--print-width")) }));
  expect(Math.abs(printScale.actualMm - printScale.expectedMm)).toBeLessThan(0.2);
  await page.pdf({ path: "test-results/technical-a3.pdf", format: "A3", landscape: true, printBackground: true, preferCSSPageSize: true });
});

test("prezentace je bez JavaScriptu čitelná", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5173/");
  await expect(page.locator("#hero-title")).toBeVisible();
  await expect(page.locator("[data-summary='residential-value']")).toHaveText("147,7");
  await expect(page.locator("#technical-mode")).toBeHidden();
  await context.close();
});
