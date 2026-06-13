/**
 * Viewport responsiveness tests.
 *
 * Verifies that at common laptop/desktop resolutions the app:
 *  - has no horizontal scrollbar (scrollWidth <= clientWidth)
 *  - has no body-level vertical scrollbar (root container fills the viewport)
 *  - has no layout overlap between the header, side panels, center, and footer
 *  - keeps all major panels within the visible viewport
 *  - remains usable after loading demo data and reaching graph phase
 */

import { test, expect, type Page } from "@playwright/test";

const VIEWPORTS = [
  { width: 1366, height: 768,  label: "1366x768"  },
  { width: 1440, height: 900,  label: "1440x900"  },
  { width: 1920, height: 1080, label: "1920x1080" },
] as const;

// ── helpers ──────────────────────────────────────────────────────────────────

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth:  document.documentElement.scrollWidth,
    clientWidth:  document.documentElement.clientWidth,
    bodyScrollW:  document.body.scrollWidth,
  }));
  expect(overflow.scrollWidth, "document horizontal overflow").toBeLessThanOrEqual(
    overflow.clientWidth + 1, // 1px tolerance for sub-pixel rounding
  );
  expect(overflow.bodyScrollW, "body horizontal overflow").toBeLessThanOrEqual(
    overflow.clientWidth + 1,
  );
}

async function noVerticalPageScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  // The root SPA container is height:100vh with overflow:hidden — the document
  // itself must never grow taller than the viewport.
  expect(overflow.scrollHeight, "document vertical overflow").toBeLessThanOrEqual(
    overflow.clientHeight + 1,
  );
}

async function panelBounds(page: Page, testId: string) {
  const box = await page.locator(`[data-testid="${testId}"]`).boundingBox();
  expect(box, `${testId} not found in DOM`).not.toBeNull();
  return box!;
}

async function noPanelOverlap(page: Page) {
  const header = await panelBounds(page, "rp-header");
  const left   = await panelBounds(page, "rp-left-panel");
  const center = await panelBounds(page, "rp-center");
  const right  = await panelBounds(page, "rp-right-panel");
  const footer = await panelBounds(page, "rp-footer");
  const vw     = page.viewportSize()!.width;
  const vh     = page.viewportSize()!.height;

  // All panels must lie within the viewport.
  for (const [id, box] of Object.entries({ header, left, center, right, footer })) {
    expect(box.x, `${id} left edge`).toBeGreaterThanOrEqual(-1);
    expect(box.y, `${id} top edge`).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width,  `${id} right edge`).toBeLessThanOrEqual(vw + 1);
    expect(box.y + box.height, `${id} bottom edge`).toBeLessThanOrEqual(vh + 1);
  }

  // Header must not overlap left / center / right / footer.
  const headerBottom = header.y + header.height;
  expect(left.y,   "left panel top must be below header").toBeGreaterThanOrEqual(headerBottom - 2);
  expect(center.y, "center top must be below header").toBeGreaterThanOrEqual(headerBottom - 2);
  expect(right.y,  "right panel top must be below header").toBeGreaterThanOrEqual(headerBottom - 2);

  // Footer must be below center / side panels.
  expect(footer.y, "footer top must be below panels").toBeGreaterThanOrEqual(
    Math.min(left.y + left.height, center.y + center.height, right.y + right.height) - 2,
  );

  // Left and right panels must not overlap the center panel.
  const leftRight  = left.x + left.width;
  const rightLeft  = right.x;
  expect(leftRight,  "left panel must not intrude into center").toBeLessThanOrEqual(center.x + 2);
  expect(rightLeft,  "right panel must not intrude from right").toBeGreaterThanOrEqual(center.x + center.width - 2);
}

async function loadDemoAndReachGraph(page: Page) {
  // Click "LOAD DEMO DATASET" button.
  await page.getByText("LOAD DEMO DATASET").click();
  // Click "REPLAY MEMORY" button that appears on the intro screen.
  await page.getByText("REPLAY MEMORY").click();
  // Wait until the graph phase indicator is visible.
  await page.waitForSelector('[data-testid="rp-center"]');
  // Wait for graph phase — poll until GLOBAL CRITIC SUMMARY text appears.
  await page.waitForFunction(
    () => document.body.innerText.includes("GLOBAL CRITIC SUMMARY"),
    { timeout: 20_000 },
  );
}

// ── test suites per viewport ──────────────────────────────────────────────────

for (const { width, height, label } of VIEWPORTS) {
  test.describe(`viewport ${label}`, () => {
    test.use({ viewport: { width, height } });

    test.beforeEach(async ({ page }) => {
      await page.goto("/");
      // Wait for the root container and a visible interactive element.
      await page.waitForSelector('[data-testid="rp-root"]');
    });

    // ── ingest screen (initial load) ─────────────────────────────────────────

    test("ingest screen — no horizontal scroll", async ({ page }) => {
      await noHorizontalScroll(page);
    });

    test("ingest screen — no body-level vertical scroll", async ({ page }) => {
      await noVerticalPageScroll(page);
    });

    test("ingest screen — panels within viewport and not overlapping", async ({ page }) => {
      await noPanelOverlap(page);
    });

    // ── graph phase (after demo load + replay) ───────────────────────────────

    test("graph phase — no horizontal scroll", async ({ page }) => {
      await loadDemoAndReachGraph(page);
      await noHorizontalScroll(page);
    });

    test("graph phase — no body-level vertical scroll", async ({ page }) => {
      await loadDemoAndReachGraph(page);
      await noVerticalPageScroll(page);
    });

    test("graph phase — panels within viewport and not overlapping", async ({ page }) => {
      await loadDemoAndReachGraph(page);
      await noPanelOverlap(page);
    });

    test("graph phase — center panel has internal scroll, not page scroll", async ({ page }) => {
      await loadDemoAndReachGraph(page);

      // The center panel should have a scrollable interior (multiple panels stacked).
      const centerScrollable = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="rp-center"]') as HTMLElement | null;
        if (!el) return null;
        return {
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          overflowY:    getComputedStyle(el).overflowY,
        };
      });
      expect(centerScrollable).not.toBeNull();
      // overflowY must be auto or scroll — not visible/hidden.
      expect(["auto", "scroll"]).toContain(centerScrollable!.overflowY);
      // The document must still have no body scroll.
      await noVerticalPageScroll(page);
    });
  });
}
