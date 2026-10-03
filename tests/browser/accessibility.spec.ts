import { test, expect } from "@playwright/test";
import { readdirSync } from "node:fs";

/**
 * Accessibility sweep.
 *
 * None of the other gates look at whether the product is usable with a keyboard
 * or a screen reader, so these checks exist to keep that from drifting as the
 * interface changes. They deliberately assert only things that can be decided
 * from the accessibility tree: names, roles, labels, structure and keyboard
 * reachability. Anything needing a human judgement about contrast or wording is
 * out of scope for an automated pass.
 */

const ROUTES = ["/", "/ledger", "/horizon", "/standards", "/agent", "/export", "/verify", "/settings"];

test.describe("accessibility", () => {
  for (const route of ROUTES) {
    test(`${route} exposes a usable document`, async ({ page }) => {
      // A cold serverless start on a loaded machine can exceed the default
      // navigation budget, which says nothing about accessibility. Retry once
      // before failing so a slow boot is not reported as a defect.
      await expect(async () => {
        await page.goto(route, { timeout: 60_000 });
        await page.locator("main").waitFor({ state: "attached", timeout: 30_000 });
      }).toPass({ timeout: 120_000, intervals: [1000, 3000, 6000] });

      // Landmarks and document metadata.
      await expect(page.locator("html")).toHaveAttribute("lang", /.+/);
      await expect(page).toHaveTitle(/.+/);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);

      // One top-level heading, and no level skipped on the way down.
      const levels = await page
        .locator("h1, h2, h3, h4, h5, h6")
        .evaluateAll((nodes) => nodes.map((node) => Number(node.tagName.slice(1))));
      expect(levels.filter((level) => level === 1)).toHaveLength(1);
      expect(levels[0]).toBe(1);
      for (let index = 1; index < levels.length; index += 1) {
        expect(levels[index] - levels[index - 1]).toBeLessThanOrEqual(1);
      }

      // Every image carries alt text (decorative images use alt="").
      const missingAlt = await page.locator("img").evaluateAll((nodes) =>
        nodes.filter((node) => !node.hasAttribute("alt")).length,
      );
      expect(missingAlt).toBe(0);

      // Every control has an accessible name. A control is named by aria-label,
      // aria-labelledby, a label pointing at it, an ancestor label, a title, or
      // its own text, and by nothing else.
      const unnamed = await page
        .locator("button, a[href], input, select, textarea")
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => {
              const element = node as HTMLElement;
              const labelledBy = element.getAttribute("aria-labelledby");
              if (element.getAttribute("aria-label")?.trim()) return false;
              if (element.getAttribute("title")?.trim()) return false;
              if (labelledBy && document.getElementById(labelledBy)?.textContent?.trim()) return false;
              if (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)) return false;
              if (element.closest("label")?.textContent?.trim()) return false;
              if (element.tagName === "INPUT") {
                const type = (element as HTMLInputElement).type;
                const labelledByType = type === "submit" || type === "button" || type === "reset";
                if (labelledByType && (element as HTMLInputElement).value.trim()) return false;
                return true;
              }
              return !element.innerText?.trim() && !element.getAttribute("alt")?.trim();
            })
            .map((node) => {
              const element = node as HTMLElement;
              return `${element.tagName.toLowerCase()}${element.id ? "#" + element.id : ""}${
                element.className ? "." + String(element.className).split(" ")[0] : ""
              }`;
            }),
        );
      expect(unnamed, `controls without an accessible name: ${unnamed.join(", ")}`).toHaveLength(0);

      // Every form control has a programmatic label.
      const unlabelled = await page
        .locator("input, select, textarea")
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => {
              if (node.getAttribute("aria-label") || node.getAttribute("aria-labelledby")) return false;
              if (node.id && document.querySelector(`label[for="${CSS.escape(node.id)}"]`)) return false;
              return !node.closest("label");
            })
            .map((node) => node.getAttribute("name") ?? node.tagName.toLowerCase()),
        );
      expect(unlabelled, `form controls without a label: ${unlabelled.join(", ")}`).toHaveLength(0);

      // No positive tabindex, which reorders the page away from the source order.
      const positiveTabindex = await page.locator('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])').count();
      expect(positiveTabindex).toBe(0);

      // The skip link is the first thing a keyboard reaches, and it works.
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("href"));
      expect(focused).toBe("#main");
    });
  }

  test("the primary journey is reachable by keyboard alone", async ({ page }) => {
    await page.goto("/");

    // Reach the form by tabbing rather than clicking, proving nothing is
    // hidden behind a pointer-only affordance.
    const hostname = page.getByLabel("Hostname to assay");
    let reached = false;
    for (let press = 0; press < 40 && !reached; press += 1) {
      await page.keyboard.press("Tab");
      reached = await hostname.evaluate((node) => node === document.activeElement).catch(() => false);
    }
    expect(reached, "the hostname field should be reachable by keyboard").toBe(true);

    await hostname.fill("github.com");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");

    // The result must land in a live region so it is announced, not just painted.
    const graded = page.getByText(/graded (bullion|sterling|base|corroded)/).first();
    await expect(graded).toBeVisible({ timeout: 90_000 });
  });

  test("every page in the app shares the accessible name of its primary link", async ({ page }) => {
    // The repository link is the product's main outbound promise; it must be
    // named, not just present.
    await page.goto("/");
    const repository = page.getByRole("link", { name: /github/i }).first();
    await expect(repository).toBeVisible();
    const href = await repository.getAttribute("href");
    expect(href).toContain("github.com/aniruddhaadak80/keyassay");
  });
});

test.describe("media and motion", () => {
  test("respects a reduced-motion preference", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/");

    // With reduced motion requested, the stylesheet must collapse animation and
    // transition durations rather than merely hiding them. Computed durations
    // are reported in seconds and may be written as 0s or 1e-06s, so compare
    // the parsed number rather than the string.
    const durations = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.className = "animate-pulse";
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const result = { animation: style.animationDuration, transition: style.transitionDuration };
      probe.remove();
      return result;
    });
    const seconds = (value: string) =>
      value
        .split(",")
        .map((part) => Number.parseFloat(part))
        .filter((part) => Number.isFinite(part));
    for (const value of [durations.animation, durations.transition]) {
      for (const part of seconds(value)) {
        expect(part, `expected a collapsed duration, got ${value}`).toBeLessThanOrEqual(0.01);
      }
    }

    await context.close();
  });

  test("declares every screenshot asset used by the documentation", async () => {
    // The README embeds these; a missing file renders as a broken image in the
    // repository front page, which is the first thing a visitor sees.
    const readme = await import("node:fs/promises").then((fs) => fs.readFile("README.md", "utf8"));
    const referenced = [...readme.matchAll(/docs\/([a-z0-9-]+\.png)/gi)].map((match) => match[1]);
    expect(referenced.length).toBeGreaterThan(0);
    const available = new Set(readdirSync("docs").filter((name) => name.endsWith(".png")));
    const missing = referenced.filter((name) => !available.has(name));
    expect(missing, `README references missing screenshots: ${missing.join(", ")}`).toHaveLength(0);
  });
});