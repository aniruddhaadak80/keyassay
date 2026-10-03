import type { Metadata } from "next";
import { getRepository } from "@/lib/db";
import { getSessionId } from "@/lib/session";
import { verifyAssay } from "@/lib/service";
import { siteConfig } from "@/lib/config";
import { SectionHeading } from "@/components/states";
import { VerifyPanel } from "@/components/verify-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify a seal",
  description:
    "Replay the SHA-384 hash chain behind an assay and prove the grade was never edited after it was struck.",
  alternates: { canonical: `${siteConfig.liveUrl}/verify` },
};

/**
 * The verification route.
 *
 * This page exists because a grade nobody can re-check is just a number. It
 * replays the chain server-side on load, and the client panel can also re-check a
 * single chain on demand.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.assay;
  const requestedId = (Array.isArray(raw) ? raw[0] : raw) ?? "";

  const sessionId = await getSessionId();
  const repo = await getRepository();

  const summaries = await repo.listAssays(sessionId, {
    limit: 100,
    offset: 0,
    includeDeleted: true,
  });

  const results = [];
  for (const summary of summaries) {
    results.push(await verifyAssay({ repo, sessionId }, summary.id));
  }

  const valid = results.filter((entry) => entry.ok).length;
  const allValid = results.length === 0 || valid === results.length;

  return (
    <div className="pt-10">
      <SectionHeading
        eyebrow="Integrity"
        title="Verify a seal"
        lede="Every mutation appends to a per-assay hash chain. Replaying it recomputes each digest from scratch and reports the first link that no longer holds."
      />

      <div className="sheet rounded-sm p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="ledger-head">Ledger integrity</p>
            <p className="mt-1.5 font-mono text-3xl tabular text-ink-900">
              {valid} / {results.length}
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] ${
              allValid
                ? "border-verdigris-500 bg-verdigris-100 text-verdigris-700"
                : "border-retort-500 bg-retort-100 text-retort-700"
            }`}
          >
            {results.length === 0
              ? "No assays to replay"
              : allValid
                ? "Every chain replays clean"
                : "At least one chain is broken"}
          </span>
        </div>

        <p className="mt-4 border-t border-parchment-200 pt-3 font-mono text-[0.66rem] leading-relaxed text-ash-600">
          genesis <code className="text-ink-700">keyassay/genesis/1</code> · seal(n) ={" "}
          <code className="text-ink-700">SHA-384(UTF-8(prevSeal) || canonicalJson(event(n)))</code> ·
          canonical JSON sorts object keys recursively and preserves array order, because array order
          is part of the data.
        </p>
      </div>

      <VerifyPanel
        initialId={requestedId}
        chains={results.map((entry, index) => ({
          id: entry.entityId,
          host: summaries[index]?.host ?? entry.entityId,
          ok: entry.ok,
          eventsChecked: entry.eventsChecked,
          headSeal: entry.headSeal,
          firstBrokenSeq: entry.firstBrokenSeq,
          reason: entry.reason,
        }))}
      />

      <section className="mt-10">
        <h2 className="text-xl text-ink-900">Why a stored grade can be trusted</h2>
        <div className="mt-3 space-y-4 text-sm leading-relaxed text-ink-500">
          <p>
            A score on its own is an assertion. What makes this one checkable is that every event is
            hashed together with the seal that preceded it, so altering any earlier event invalidates
            every later digest in the chain. Removing an event does not help either: the following
            event&apos;s recorded <code className="font-mono">prevSeal</code> no longer matches the
            computed head.
          </p>
          <p>
            Deleting an assay does not erase this. A delete appends its own event and tombstones the
            row, so a verification of a record you can no longer see in the ledger still succeeds.
            That is deliberate: an auditor who asks about an assay six months later should not find
            that the evidence vanished with the row.
          </p>
        </div>
      </section>
    </div>
  );
}