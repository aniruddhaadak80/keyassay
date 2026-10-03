import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Capture product screenshots for the README and the write-up.
 *
 * Everything shown is real state produced by the live deployment: a genuine TLS
 * handshake, a genuine Certificate Transparency history, a genuine engine result.
 */
const base = process.env.BASE_URL ?? "https://keyassay.vercel.app";
const out = process.env.SHOT_DIR ?? "docs";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();

async function capture(name, contextOptions, steps) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  try {
    await steps(page);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
    console.log("captured", name);
  } finally {
    await context.close();
  }
}

const desktop = { viewport: { width: 1440, height: 900 } };

await capture("01-landing", desktop, async (page) => {
  await page.goto(`${base}/`);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
});

await capture("02-detail", desktop, async (page) => {
  await page.goto(`${base}/`);
  const created = await page.request.post(`${base}/api/assays`, {
    data: { host: "github.com", label: "github.com — edge" },
  });
  const { assay } = await created.json();
  await page.request.post(`${base}/api/assays/${assay.id}`, {
    data: { decision: "plan-hybrid", notes: "Stand up a hybrid ML-KEM key exchange before the modelled break year." },
  });
  await page.goto(`${base}/ledger/${assay.id}`);
  await page.getByText("Itemised factors", { exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 620));
});

await capture("03-horizon", desktop, async (page) => {
  await page.goto(`${base}/horizon`);
  await page.locator("#horizon-range").waitFor();
  await page.locator("#horizon-range").fill("2035");
  await page.evaluate(() => window.scrollTo(0, 340));
});

await capture("04-agent", desktop, async (page) => {
  await page.goto(`${base}/agent`);
  await page.getByRole("button", { name: /initialize/ }).click();
  await page.getByText(/"protocolVersion"/).first().waitFor({ timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 420));
});

await capture("05-standards", desktop, async (page) => {
  await page.goto(`${base}/standards`);
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 240));
});

await capture("06-mobile-detail", { ...devices["Pixel 5"] }, async (page) => {
  await page.goto(`${base}/`);
  const created = await page.request.post(`${base}/api/assays`, {
    data: { host: "letsencrypt.org", label: "letsencrypt.org" },
  });
  const { assay } = await created.json();
  await page.goto(`${base}/ledger/${assay.id}`);
  await page.getByText("Itemised factors", { exact: true }).waitFor();
});

await browser.close();
console.log("done");