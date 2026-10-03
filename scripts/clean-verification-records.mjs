/**
 * Remove verification records from a deployment's store.
 *
 * Every run of the live verifier and the browser journey creates a real assay
 * against a real host. They are scoped to anonymous sessions so no visitor can
 * see them, but they still accumulate, and a fresh deployment should not open
 * with a ledger full of another machine's test runs.
 *
 * Usage:
 *   node scripts/clean-verification-records.mjs            # report only
 *   node scripts/clean-verification-records.mjs --apply    # delete
 *
 * Only rows whose label marks them as verification traffic are touched. A record
 * a person created is never a candidate, whatever its host.
 */
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");

/**
 * Labels written by the automated checks. Every one of these strings is
 * emitted by a script in this repository, so a row carrying one of them is
 * verification traffic by construction.
 *
 * Rows with no label at all are deliberately NOT candidates. The browser
 * journeys submit only a hostname, so their records are indistinguishable from
 * a record a person created, and this script does not guess. The count of those
 * is reported so a human can decide.
 */
const VERIFICATION_LABELS = [
  "live-verifier",
  "live-verifier-renamed",
  "github.com - edge",
  "letsencrypt.org",
  "stability-probe",
];

function readDatabaseUrl() {
  try {
    const line = readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .find((entry) => entry.startsWith("DATABASE_URL="));
    return line ? line.slice("DATABASE_URL=".length).trim() : null;
  } catch {
    return null;
  }
}

const databaseUrl = readDatabaseUrl();
if (!databaseUrl) {
  console.error("No DATABASE_URL in .env.local. Nothing to do.");
  process.exit(1);
}

const { Client } = await import("pg");
const client = new Client({
  connectionString: databaseUrl,
  ssl: /sslmode=disable/.test(databaseUrl) ? false : { rejectUnauthorized: false },
});

await client.connect();

const schema = process.env.DATABASE_SCHEMA ?? "public";

// Diagnostics first, so it is obvious what would go before anything is removed.
const totals = await client.query(
  `select count(*)::int as total,
          count(*) filter (where deleted_at is not null)::int as tombstoned,
          count(*) filter (where deleted_at is null)::int as live
     from ${schema}.assays`,
);
console.log(`assays: ${JSON.stringify(totals.rows[0])}`);

const candidates = await client.query(
  `select id, host, label, created_at
     from ${schema}.assays
    where label = any($1::text[])
    order by created_at desc`,
  [VERIFICATION_LABELS],
);

console.log(`\nverification records found: ${candidates.rows.length}`);
for (const row of candidates.rows.slice(0, 10)) {
  console.log(`  ${row.created_at.toISOString?.() ?? row.created_at}  ${row.host}  [${row.label}]`);
}
if (candidates.rows.length > 10) console.log(`  ... and ${candidates.rows.length - 10} more`);

if (!APPLY) {
  const unattributable = await client.query(
    `select count(*)::int as total
       from ${schema}.assays
      where label is null or label = '' or not (label = any($1::text[]))`,
    [VERIFICATION_LABELS],
  );
  console.log(
    `\n${unattributable.rows[0].total} further record(s) carry no verification label. The browser ` +
      "journeys submit only a hostname, so these cannot be told apart from a real visitor's work and " +
      "this script leaves them alone. Clear them by hand if the deployment has had no other visitors.",
  );
  console.log("\nDry run. Re-run with --apply to remove the labelled ones.");
  await client.end();
  process.exit(0);
}

if (candidates.rows.length === 0) {
  console.log("\nNothing to remove.");
  await client.end();
  process.exit(0);
}

const ids = candidates.rows.map((row) => row.id);

// The audit chain is append-only by design, so removing a record also has to
// remove the events that reference it, or replay would fail for every survivor.
await client.query("begin");
try {
  await client.query(`delete from ${schema}.audit_events where entity_id = any($1::uuid[])`, [ids]);
  const deleted = await client.query(`delete from ${schema}.assays where id = any($1::uuid[])`, [ids]);
  await client.query("commit");
  console.log(`\nremoved ${deleted.rowCount} assay record(s) and their audit events.`);
} catch (error) {
  await client.query("rollback");
  console.error("Removal failed and was rolled back:", error.message);
  await client.end();
  process.exit(1);
}

const after = await client.query(`select count(*)::int as total from ${schema}.assays`);
console.log(`assays remaining: ${after.rows[0].total}`);
await client.end();