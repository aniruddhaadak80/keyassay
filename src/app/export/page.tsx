import Link from "next/link";
import type { Metadata } from "next";
import { getRepository } from "@/lib/db";
import { getSessionId } from "@/lib/session";
import { loadPolicy } from "@/lib/service";
import { siteConfig } from "@/lib/config";
import { DataRow } from "@/components/grade-mark";
import { EmptyState, SectionHeading } from "@/components/states";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Export centre",
  description:
    "Download the whole ledger as a JSON portfolio, a CSV for a ticket, or a single combined HTML dossier with one certificate per assay.",
  alternates: { canonical: `${siteConfig.liveUrl}/export` },
};

const FORMATS = [
  {
    value: "json",
    label: "JSON portfolio",
    body: "Every assay with its full engine result, itemised factors, provenance, seal chain and a complete certificate object. This is the format to attach to a machine-readable audit.",
  },
  {
    value: "html",
    label: "Combined HTML dossier",
    body: "One self-contained printable file with a certificate section per assay. No scripts, no external assets, so it survives being emailed or attached to a ticket.",
  },
  {
    value: "csv",
    label: "CSV",
    body: "One row per assay with grade, score, break year, exposure, decision and seal. Paste it straight into a spreadsheet or a ticket.",
  },
] as const;

/** The export centre. Every button downloads real content from the server. */
export default async function ExportPage() {
  const sessionId = await getSessionId();
  const repo = await getRepository();
  const policy = await loadPolicy({ repo, sessionId });
  const total = await repo.countAssays(sessionId, { limit: 1, offset: 0, includeDeleted: false });
  const tombstones = await repo.countAssays(sessionId, { limit: 1, offset: 0, includeDeleted: true });

  return (
    <div className="pt-10">
      <SectionHeading
        eyebrow="Output"
        title="Export centre"
        lede="Everything the product knows, in a format you can hand to someone else. Exports carry each assay's seal, every factor with its citation, and the provenance of each external source."
      />

      <div className="sheet rounded-sm p-5">
        <dl>
          <DataRow label="Assays in the active ledger" value={total} />
          <DataRow label="Including tombstones" value={tombstones} />
          <DataRow label="Horizon applied" value={policy.horizonYear} />
          <DataRow label="Cost model" value={policy.costModel} />
          <DataRow
            label="Per-assay certificates"
            value={
              <Link href="/ledger" className="underline underline-offset-4">
                open in the ledger
              </Link>
            }
            mono={false}
          />
        </dl>
      </div>

      {total === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Nothing to export yet"
            body="An export of an empty ledger would be a file with nothing in it. Run one assay first and the DownloadIcon becomes a real certificate."
            action={{ href: "/#assay", label: "Run an assay" }}
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {FORMATS.map((format) => (
            <article key={format.value} className="sheet flex flex-col rounded-sm p-5">
              <h2 className="text-base text-ink-900">{format.label}</h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-500">{format.body}</p>
              <a
                href={`/api/export?format=${format.value}`}
                download={`keyassay-ledger-${new Date().toISOString().slice(0, 10)}.${format.value}`}
                className="mt-5 inline-block rounded-sm bg-ultramarine-700 px-4 py-2.5 text-center font-mono text-[0.68rem] uppercase tracking-[0.12em] text-parchment-50 hover:bg-ultramarine-600"
              >
                DownloadIcon .{format.value}
              </a>
            </article>
          ))}
        </div>
      )}

      <section className="mt-10">
        <h2 className="text-xl text-ink-900">What lands inside</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sheet rounded-sm p-5">
            <p className="ledger-head">Provenance, never dropped</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              Each source carries its status, upstream identifier, retrieval timestamp and attribution
              line. A sealed fallback is exported as a fallback and keeps its reason, so a consumer of
              the file can tell a live measurement from an offline sample without asking the sender.
            </p>
          </div>
          <div className="sheet rounded-sm p-5">
            <p className="ledger-head">Seals and replay</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              Every record exports its chain head and the rule used to derive it. Replay that chain
              from the exported events and you can confirm independently that no factor was edited
              after the fact:{" "}
              <code className="rounded-sm bg-parchment-200 px-1.5 py-0.5 font-mono text-xs">
                seal(n) = SHA-384(prevSeal || canonicalJson(event(n)))
              </code>
              .
            </p>
          </div>
          <div className="sheet rounded-sm p-5">
            <p className="ledger-head">Both current and stored grades</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              Alongside the grade struck at scan time, the export includes what the engine returns
              under the policy in force right now. Where those differ, the assumption moved, and the
              file shows it rather than hiding it.
            </p>
          </div>
          <div className="sheet rounded-sm p-5">
            <p className="ledger-head">The disclaimer travels with it</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              Every artifact carries the same statement: this is an engineering measurement from
              public data, not a penetration test or an audit opinion, and break years are outputs of
              a stated assumption rather than predictions.
            </p>
          </div>
        </div>
      </section>

      <p className="mt-10 border-t border-parchment-300 pt-4 font-mono text-[0.66rem] text-ash-600">
        Exports are generated from this session&apos;s records only. Nothing is cached publicly and no
        link grants access to another visitor&apos;s ledger.
      </p>
    </div>
  );
}