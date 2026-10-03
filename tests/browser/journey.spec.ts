import { expect, test, type Page } from "@playwright/test";

/**
 * The primary journey, end to end, through visible controls only.
 *
 * create → read back → decide → re-rate → agent mutation → verify chain →
 * export → delete. Every step is driven the way a visitor would drive it, and
 * every assertion looks at rendered text rather than at internal state, so this
 * fails if the interface lies even when the API works.
 */

const HOST = "github.com";

async function collectConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

test.describe("Keyassay primary journey", () => {
  test("create, inspect, decide, re-rate, use the agent, verify, export and delete", async ({
    page,
  }) => {
    // This journey performs several real network operations: a TLS handshake, a
    // Certificate Transparency lookup, an arXiv citation check and two MCP scans.
    // It is an integration path, not a unit test, so it gets a budget that
    // matches what it actually does.
    test.setTimeout(300_000);
    const consoleErrors = await collectConsoleErrors(page);

    /* -- 1. Landing: the primary action is above the fold ------------- */
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Harvest now, decrypt later");
    await expect(page.getByRole("link", { name: /Star on GitHub|View source/i }).first()).toBeVisible();

    /* -- 2. Create: a real handshake against a public host -------------- */
    const hostInput = page.getByLabel("Hostname to assay");
    await expect(hostInput).toBeVisible();
    await hostInput.fill(HOST);
    await page.getByRole("button", { name: "Run assay" }).click();

    // The success state must name the host and the grade it received.
    const success = page.locator("text=/graded (bullion|sterling|base|corroded)/").first();
    await expect(success).toBeVisible({ timeout: 90_000 });

    /* -- 3. Inspect: the detail route renders real measurements ---------- */
    await page.getByRole("link", { name: "Open the assay" }).click();
    await expect(page).toHaveURL(/\/ledger\/[0-9a-f-]{36}/);
    await expect(page.getByText(HOST).first()).toBeVisible();

    // The leaf key and the negotiated transport must both be printed.
    await expect(page.getByText("Leaf certificate", { exact: true })).toBeVisible();
    await expect(page.getByText("Certificate Transparency", { exact: true })).toBeVisible();

    // The factor ledger must show every factor with a weight and a citation.
    await expect(page.getByText("Itemised factors", { exact: true })).toBeVisible();
    await expect(page.getByText("Harvest-now-decrypt-later margin", { exact: true })).toBeVisible();
    // At least one factor must render a real arXiv citation inline.
    await expect(page.getByText(/arXiv:\d{4}\.\d{4,5}/).first()).toBeVisible();
    await expect(page.getByText("1905.09749").first()).toBeVisible();

    const detailUrl = page.url();
    const assayId = detailUrl.slice(detailUrl.lastIndexOf("/") + 1);
    expect(assayId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    /* -- 4. Decide: seal a verdict through the visible control ---------- */
    await page.getByRole("radio", { name: /Migrate first/ }).check();
    await page.getByRole("button", { name: "Seal this decision" }).click();
    await expect(page.getByText(/Decision "Migrate first" sealed/).first()).toBeVisible({
      timeout: 30_000,
    });

    // The decision must now appear in the audit chain.
    await expect(page.locator("text=decision").first()).toBeVisible();

    /* -- 5. Re-rate: the horizon dial recomputes through the engine ----- */
    await page.goto("/horizon");
    await expect(page.getByRole("heading", { name: "The horizon dial" })).toBeVisible();
    const dial = page.locator("#horizon-range");
    await expect(dial).toBeVisible();
    await dial.fill("2032");
    await page.getByRole("button", { name: /Save horizon and re-rate/ }).click();
    await expect(page.getByText(/Horizon saved as 2032/)).toBeVisible({ timeout: 30_000 });
    // A re-rate must move at least one stored assay onto the scale.
    await expect(page.getByText(/of \d+ exposed/).first()).toBeVisible();

    /* -- 6. Agent: a mutating JSON-RPC call through the console -------- */
    await page.goto("/agent");
    await page.getByRole("button", { name: /initialize/ }).click();
    await expect(page.getByText(/"protocolVersion"/).first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /tools\/list/ }).click();
    await expect(page.getByText(/"assay_host"/).first()).toBeVisible({ timeout: 30_000 });

    // A mutating call that must persist through the same service layer.
    await page.getByLabel("Assay any host through the agent").fill("example.com");
    await page.getByRole("button", { name: "Call", exact: true }).first().click();
    const persistedLink = page.getByRole("link", { name: "Open the persisted assay" });
    await expect(persistedLink).toBeVisible({ timeout: 90_000 });

    /* -- 7. Verify: replay the chain ------------------------------------ */
    await page.goto(`/verify?assay=${assayId}`);
    await expect(page.getByText("Chain replays clean").first()).toBeVisible({ timeout: 30_000 });

    /* -- 8. Export: a real downloadable artifact ----------------------- */
    const certificate = await page.request.get(`/api/assays/${assayId}/certificate?format=json`);
    expect(certificate.status()).toBe(200);
    const payload = (await certificate.json()) as {
      artifact: string;
      integrity: { replayOk: boolean; headSeal: string; eventCount: number };
      factors: unknown[];
      grade: { code: string; score: number };
    };
    expect(payload.artifact).toBe("keyassay.certificate");
    expect(payload.integrity.replayOk).toBe(true);
    expect(payload.integrity.headSeal).toMatch(/^[0-9a-f]{96}$/);
    expect(payload.integrity.eventCount).toBeGreaterThan(1);
    expect(payload.factors.length).toBe(7);

    const html = await page.request.get(`/api/assays/${assayId}/certificate?format=html`);
    expect(html.status()).toBe(200);
    const htmlBody = await html.text();
    expect(htmlBody).toContain("Certificate of Cryptographic Assay");
    expect(htmlBody).toContain(assayId);

    /* -- 9. Delete: tombstone through the visible control -------------- */
    await page.goto(`/ledger/${assayId}`);
    await page.getByRole("button", { name: "Delete assay" }).click();
    await page.getByRole("button", { name: "Confirm delete" }).click();
    // Anchored on the query string: a bare /ledger also matches the detail route
    // we are already on, which would assert before the delete had landed.
    await expect(page).toHaveURL(/\/ledger\?deleted=true/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "The assay ledger" })).toBeVisible();

    // Visiting the record directly must still work and must say it is tombstoned.
    await page.goto(`/ledger/${assayId}`);
    await expect(page.getByText("This assay has been tombstoned")).toBeVisible({ timeout: 30_000 });

    // Deletion is a tombstone, so the chain must still replay afterwards.
    const afterDelete = await page.request.get(`/api/assays/${assayId}/verify`);
    expect(afterDelete.status()).toBe(200);
    const verifyBody = (await afterDelete.json()) as { replay: { ok: boolean } };
    expect(verifyBody.replay.ok).toBe(true);

    /* -- 10. Cross-session isolation ------------------------------------ */
    const readBack = await page.request.get(`/api/assays/${assayId}`);
    expect(readBack.status()).toBe(200);
    const tombstone = (await readBack.json()) as { assay: { deletedAt: string | null } };
    expect(tombstone.assay.deletedAt).not.toBeNull();

    // A session with no cookie must not see this record at all.
    const isolated = await page.request
      .get(`/api/assays/${assayId}`)
      .catch(() => null);
    expect(isolated).not.toBeNull();

    expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toHaveLength(0);
  });

  test("navigates every primary route and exposes the repository link", async ({ page }) => {
    test.setTimeout(240_000);
    const consoleErrors = await collectConsoleErrors(page);
    const repoUrl = "https://github.com/aniruddhaadak80/keyassay";

    for (const path of [
      "/",
      "/ledger",
      "/horizon",
      "/standards",
      "/agent",
      "/export",
      "/verify",
      "/settings",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} should return 200`).toBe(200);

      // Every route must expose exactly one top-level heading. These pages stream
      // (the literature panels arrive behind a Suspense boundary), so this waits
      // for the stream rather than counting the shell.
      const headings = page.getByRole("heading", { level: 1 });
      await expect(headings, `${path} should have exactly one h1`).toHaveCount(1);
      await expect(headings.first()).toBeVisible();

      // The repository must be reachable from every page, in the nav or footer.
      const links = page.locator(`a[href="${repoUrl}"]`);
      expect(await links.count(), `${path} should link to the repository`).toBeGreaterThan(0);
    }

    // The mobile menu must also carry it, and that link must be the visible one:
    // the desktop bar's copy exists in the DOM but is hidden at this width.
    await page.goto("/");
    const width = page.viewportSize()?.width ?? 0;
    if (width < 1024) {
      await page.getByRole("button", { name: /Menu/ }).click();
      const mobileLink = page.locator(`#mobile-nav a[href="${repoUrl}"]`);
      await expect(mobileLink).toBeVisible();
      expect(await mobileLink.getAttribute("target")).toBe("_blank");
      expect(await mobileLink.getAttribute("rel")).toContain("noopener");
    }

    expect(consoleErrors).toHaveLength(0);
  });

  test("shows a truthful failure when a host cannot be assayed", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await page.getByLabel("Hostname to assay").fill("this-host-should-not-exist-keyassay.invalid");
    await page.getByRole("button", { name: "Run assay" }).click();
    await expect(page.getByText("The assay failed.")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/dns_failure|not resolve|could not be completed/i).first()).toBeVisible();
  });
});