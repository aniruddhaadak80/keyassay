import Link from "next/link";
import type { Metadata } from "next";
import { getRepository } from "@/lib/db";
import { getSessionId } from "@/lib/session";
import { loadPolicy, rerateStored } from "@/lib/service";
import { siteConfig } from "@/lib/config";
import { HorizonDial, type DialAssay } from "@/components/horizon-dial";
import { AssayForm } from "@/components/assay-form";
import { GradeMark, DataRow } from "@/components/grade-mark";
import { EmptyState, SectionHeading } from "@/components/states";
import { ASSAY_ENGINE_CITATIONS, DEFAULT_POLICY } from "@/lib/engine/assay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Horizon dial",
  description:
    "Set the year by which harvested traffic must still be unreadable and watch every stored assay re-rate through the deterministic engine.",
  alternates: { canonical: `${siteConfig.liveUrl}/horizon` },
};

/**
 * The analysis route.
 *
 * This is where the product's central claim becomes checkable. The dial writes a
 * policy to the server; the server re-rates every stored observation through the
 * same engine the certificate used. Nothing here recomputes a score in the
 * browser.
 */
export default async function HorizonPage() {
  const sessionId = await getSessionId();
  const repo = await getRepository();
  const [policy, pageResult] = await Promise.all([
    loadPolicy({ repo, sessionId }),
    repo.listAssaysPage(sessionId, { limit: 100, offset: 0, includeDeleted: false }),
  ]);
  const currentYear = new Date().getFullYear();

  // The page arrives as full rows from a single query, so re-rating costs no
  // further round trips. Fetching each row separately would be an N+1 that
  // exhausts the connection pool under serverless concurrency.
  const complete = pageResult.items.map((assay) => {
    const result = rerateStored(assay, policy, currentYear);
    return {
      dial: {
        id: assay.id,
        host: assay.host,
        label: assay.label,
        storedGrade: assay.grade,
        grade: result.grade,
        score: result.score,
        exposed: result.exposure.exposed,
        breakYear: result.exposure.breakYear,
        decision: assay.decision,
      } as DialAssay,
      assay,
      result,
    };
  });
  const dials = complete.map((entry) => entry.dial);
  const exposed = complete.filter((entry) => entry.result.exposure.exposed);

  return (
    <div className="pt-10">
      <SectionHeading
        eyebrow="Analysis"
        title="The horizon dial"
        lede="Exposure is measured against the year your data must still be secret, not against the certificate's expiry. Move the horizon and every stored assay is re-rated by the engine."
      />

      <HorizonDial initial={policy.horizonYear} assays={dials} />

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_1fr]">
        <section>
          <h2 className="text-xl text-ink-900">Why expiry is the wrong clock</h2>
          <div className="mt-3 space-y-4 text-sm leading-relaxed text-ink-500">
            <p>
              A ninety-day certificate is the standard remedy for a leaked key, and it works against an
              adversary who has to break the key <em>now</em>. It does nothing against one who simply
              records the session and waits. The ciphertext they stored in March 2026 does not expire
              with the certificate that carried it.
            </p>
            <p>
              So the question that matters is not when this certificate ends. It is whether the key
              behind the traffic you have already emitted will still be unbroken in{" "}
              <strong className="font-semibold text-ink-700">{policy.horizonYear}</strong>, the year by
              which anything captured today has to have become unreadable.
            </p>
            <p>
              For most organisations that horizon is driven by data whose secrecy has to outlive a
              hardware refresh cycle: infrastructure signing keys, PKI roots, long-lived government or
              health records, code-signing material. NIST IR 8547 prioritises exactly those, naming PKI
              and code signing as the systems that carry the longest preparation lead time.
            </p>
          </div>

          <div className="sheet mt-6 rounded-sm p-5">
            <p className="ledger-head">Assumptions behind the dial</p>
            <dl className="mt-2">
              <DataRow label="Confidentiality horizon" value={policy.horizonYear} />
              <DataRow
                label="Cost anchor"
                value={policy.costModel === "gidney-2025" ? "Gidney 2025 · <1M qubits" : "Gidney & Ekerå · 20M qubits"}
              />
              <DataRow
                label="Qubit capacity in {policy.capabilityBaseYear}"
                value={policy.capabilityBaseQubits.toLocaleString("en-US")}
              />
              <DataRow label="Annual growth" value={`${(policy.capabilityGrowth * 100).toFixed(0)}%`} />
              <DataRow label="Default horizon" value={DEFAULT_POLICY.horizonYear} />
            </dl>
            <p className="mt-3 border-t border-parchment-200 pt-3 text-xs leading-relaxed text-ash-600">
              {ASSAY_ENGINE_CITATIONS.capability} Change any of these in{" "}
              <Link href="/settings" className="underline underline-offset-4">
                settings
              </Link>
              .
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-xl text-ink-900">Consequences under the current horizon</h2>
          {complete.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="Nothing to re-rate yet"
                body="Run one assay and it will appear on the scale above, with its projected break year marked against your horizon."
                action={{ href: "/#assay", label: "Run an assay" }}
              />
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">
                {exposed.length} of {complete.length} assays fall inside the {policy.horizonYear}{" "}
                horizon. Ranked by how soon they break:
              </p>
              <ul className="mt-4 space-y-3">
                {complete
                  .slice()
                  .sort(
                    (a, b) =>
                      (a.result.exposure.breakYear ?? 9999) - (b.result.exposure.breakYear ?? 9999),
                  )
                  .map((entry) => (
                    <li key={entry.assay.id} className="rule-hair pt-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <Link
                          href={`/ledger/${entry.assay.id}`}
                          className="text-sm text-ink-900 underline-offset-4 hover:text-ultramarine-700 hover:underline"
                        >
                          {entry.assay.label}
                        </Link>
                        <GradeMark grade={entry.result.grade} score={entry.result.score} size="sm" />
                      </div>
                      <p className="mt-1 font-mono text-xs text-ink-500">
                        {entry.assay.host} · breaks{" "}
                        {entry.result.exposure.breakYear ?? "never modelled"} ·{" "}
                        <span className={entry.result.exposure.exposed ? "text-retort-700" : "text-verdigris-700"}>
                          {entry.result.exposure.exposed ? "inside horizon" : "beyond horizon"}
                        </span>
                      </p>
                    </li>
                  ))}
              </ul>
              <div className="mt-6">
                <AssayForm compact showExamples />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}