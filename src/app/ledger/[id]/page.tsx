import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getRepository } from "@/lib/db";
import { getSessionId } from "@/lib/session";
import { loadPolicy, rerateStored, verifyAssay } from "@/lib/service";

import { GradeMark, SourceBadge, DataRow } from "@/components/grade-mark";
import { FactorLedger } from "@/components/factor-ledger";
import { ErrorState, SectionHeading } from "@/components/states";
import { DecisionControl } from "@/components/decision-control";
import { CertificateLinks } from "@/components/certificate-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Assay detail",
  description: "Full observation, itemised factors, exposure analysis and seal chain for one assay.",
};

export default async function AssayDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionId = await getSessionId();
  const repo = await getRepository();

  const assay = await repo.getAssay(sessionId, id, true);
  if (!assay) {
    notFound();
  }

  const [events, policy] = await Promise.all([
    repo.listEvents(assay.id),
    loadPolicy({ repo, sessionId }),
  ]);
  const rerated = rerateStored(assay, policy, new Date().getFullYear());
  const replay = await verifyAssay({ repo, sessionId }, assay.id);

  const leaf = assay.tls.data.chain[0];
  const exposed = rerated.exposure.exposed;

  return (
    <div className="pt-10">
      <nav aria-label="Breadcrumb" className="mb-5 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-ink-400">
        <Link href="/ledger" className="underline underline-offset-4 hover:text-ultramarine-700">
          Ledger
        </Link>
        <span className="px-2">/</span>
        <span className="text-ink-700">{assay.host}</span>
      </nav>

      {assay.deletedAt ? (
        <div className="mb-6">
          <ErrorState
            title="This assay has been tombstoned"
            message={`Deleted ${assay.deletedAt.slice(0, 19).replace("T", " ")} UTC. The row and its audit chain are retained so verification still works, but the endpoint is no longer in the active ledger.`}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="ledger-head">Assay certificate</p>
          <h1 className="mt-2 break-all text-3xl text-ink-900">{assay.label}</h1>
          <p className="mt-2 font-mono text-sm text-ink-500">
            {assay.host}:{assay.port} · assayed {assay.createdAt.slice(0, 19).replace("T", " ")} UTC
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <SourceBadge meta={assay.tls.meta} />
            <SourceBadge meta={assay.ct.meta} />
            {replay.ok ? (
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-verdigris-500 bg-verdigris-100 px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-verdigris-700">
                Seal chain verified · {replay.eventsChecked} events
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-retort-500 bg-retort-100 px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-retort-700">
                Seal chain broken at seq {replay.firstBrokenSeq}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-start gap-3">
          <GradeMark grade={rerated.grade} score={rerated.score} size="lg" strike />
          <p className="max-w-56 text-xs leading-relaxed text-ink-500">{rerated.gradeLabel}</p>
          {assay.grade !== rerated.grade ? (
            <p className="font-mono text-[0.62rem] text-ultramarine-700">
              Stored grade was {assay.grade} ({assay.score})
            </p>
          ) : null}
        </div>
      </div>

      <div className="rule-double mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div
            className={`rounded-sm border px-5 py-4 ${
              exposed ? "border-retort-500 bg-retort-100" : "border-verdigris-500 bg-verdigris-100"
            }`}
          >
            <p className={`ledger-head ${exposed ? "text-retort-700" : "text-verdigris-700"}`}>
              {exposed ? "Harvest-now-decrypt-later exposure" : "Harvest exposure"}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-700">{rerated.exposure.statement}</p>
            <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <dt className="ledger-head">Break year</dt>
                <dd className="mt-0.5 font-mono text-lg tabular text-ink-900">
                  {rerated.exposure.breakYear ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="ledger-head">Horizon</dt>
                <dd className="mt-0.5 font-mono text-lg tabular text-ink-900">{policy.horizonYear}</dd>
              </div>
              <div>
                <dt className="ledger-head">Valid until</dt>
                <dd className="mt-0.5 font-mono text-lg tabular text-ink-900">
                  {rerated.exposure.expiryYear}
                </dd>
              </div>
              <div>
                <dt className="ledger-head">Years to read</dt>
                <dd className="mt-0.5 font-mono text-lg tabular text-ink-900">
                  {rerated.exposure.yearsUntilReadable ?? "—"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-6">
            <p className="ledger-head">Recommendation</p>
            <p className="mt-2 border-l-2 border-ultramarine-600 pl-4 text-sm leading-relaxed text-ink-700">
              {rerated.recommendation}
            </p>
          </div>

          <div className="mt-7">
            <p className="ledger-head mb-3">Itemised factors</p>
            <FactorLedger factors={rerated.factors} weakestFactor={rerated.weakestFactor} />
          </div>

          <div className="mt-7">
            <p className="ledger-head mb-3">Certificate chain ({assay.tls.data.chain.length} links)</p>
            <div className="overflow-x-auto rounded-sm border border-parchment-300">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-parchment-300 bg-parchment-200/70">
                    <th scope="col" className="ledger-head px-3 py-2">Subject</th>
                    <th scope="col" className="ledger-head px-3 py-2">Key</th>
                    <th scope="col" className="ledger-head px-3 py-2 text-right">Strength</th>
                    <th scope="col" className="ledger-head px-3 py-2 text-right">Logical qubits</th>
                    <th scope="col" className="ledger-head px-3 py-2 text-right">Break year</th>
                  </tr>
                </thead>
                <tbody>
                  {rerated.chain.map((link, index) => (
                    <tr key={`${link.subject}-${index}`} className="border-b border-parchment-200 last:border-b-0">
                      <td className="px-3 py-2">
                        <span className="block text-ink-900">{link.subject}</span>
                        <span className="block font-mono text-[0.66rem] text-ash-600">issued by {link.issuer}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-ink-700">
                        {link.algorithm.toUpperCase()}
                        {link.bits ? ` ${link.bits}` : ""}
                        {link.postQuantum ? " · PQC" : ""}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular text-ink-700">
                        {link.classicalSecurityBits || "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular text-ink-700">
                        {link.postQuantum ? "—" : link.logicalQubits.toLocaleString("en-US")}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular text-ink-700">
                        {link.harvestYear ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-7">
            <p className="ledger-head mb-3">Audit chain</p>
            <div className="rounded-sm border border-parchment-300 bg-parchment-50 p-4">
              <p className="font-mono text-[0.66rem] leading-relaxed text-ash-600">
                seal(n) = SHA-384(UTF-8(prevSeal) || canonicalJson(event(n))) · genesis keyassay/genesis/1
              </p>
              <ol className="mt-3 space-y-2">
                {events.map((event) => (
                  <li key={event.seq} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-parchment-200 pt-2">
                    <span className="font-mono text-xs tabular text-ink-300">#{event.seq}</span>
                    <span className="font-mono text-xs uppercase tracking-[0.1em] text-ink-700">
                      {event.eventType}
                    </span>
                    <span className="font-mono text-[0.66rem] text-ash-600">
                      {event.createdAt.slice(0, 19).replace("T", " ")} UTC
                    </span>
                    <span className="w-full font-mono text-[0.62rem] break-all text-ink-300">
                      {event.seal}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 border-t border-parchment-200 pt-2 font-mono text-[0.66rem] text-verdigris-700">
                Replay {replay.ok ? "succeeded" : `failed at seq ${replay.firstBrokenSeq}`} · head{" "}
                {replay.headSeal.slice(0, 32)}…
              </p>
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <section className="sheet rounded-sm p-5">
            <p className="ledger-head">Recorded decision</p>
            <DecisionControl assayId={assay.id} current={assay.decision} notes={assay.notes} />
          </section>

          <section className="sheet rounded-sm p-5">
            <p className="ledger-head">Take the certificate</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
              Self-contained HTML for a ticket, JSON for a machine, CSV for a spreadsheet.
            </p>
            <CertificateLinks assayId={assay.id} filenameBase={`keyassay-${assay.host}`} />
          </section>

          <section className="sheet rounded-sm p-5">
            <p className="ledger-head">Leaf certificate</p>
            <dl className="mt-2">
              <DataRow label="Algorithm" value={assay.keyAlgorithm.toUpperCase()} />
              <DataRow label="Bits" value={assay.keyBits ?? "—"} />
              <DataRow label="Curve" value={assay.curve ?? "—"} />
              <DataRow label="Issuer" value={assay.issuerCommonName ?? "—"} />
              <DataRow label="Valid from" value={leaf?.validFrom ? leaf.validFrom.slice(0, 10) : "—"} />
              <DataRow label="Valid to" value={leaf?.validTo ? leaf.validTo.slice(0, 10) : "—"} />
              <DataRow label="Transport" value={assay.protocol ?? "—"} />
              <DataRow label="Cipher" value={assay.cipher ?? "—"} />
              <DataRow label="Chain depth" value={assay.chainDepth} />
              <DataRow
                label="Names"
                value={assay.tls.data.subjectAlternativeNames.slice(0, 3).join(" ") || "—"}
                mono={false}
              />
            </dl>
          </section>

          <section className="sheet rounded-sm p-5">
            <p className="ledger-head">Certificate Transparency</p>
            <dl className="mt-2">
              <DataRow label="Certificates" value={assay.ct.data.certificateCount} />
              <DataRow label="Issued, last 90d" value={assay.ct.data.recentCount} />
              <DataRow label="Longest validity" value={`${assay.ct.data.longestValidityDays} days`} />
              <DataRow label="Past 2030 clock" value={assay.ct.data.certificatesBeyond2030} />
              <DataRow label="Past 2035 clock" value={assay.ct.data.certificatesBeyond2035} />
              <DataRow label="History span" value={`${assay.ct.data.historyDays} days`} />
            </dl>
            {assay.ct.data.distinctIssuers.length > 0 ? (
              <div className="mt-3 border-t border-parchment-200 pt-3">
                <p className="ledger-head">Issuers observed</p>
                <ul className="mt-1.5 space-y-1 text-xs text-ink-500">
                  {assay.ct.data.distinctIssuers.slice(0, 5).map((issuer) => (
                    <li key={issuer} className="truncate" title={issuer}>
                      {issuer}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="sheet rounded-sm p-5">
            <p className="ledger-head">Cost model in force</p>
            <dl className="mt-2">
              <DataRow label="Engine" value={assay.result.engineVersion} />
              <DataRow label="Cost model" value={policy.costModel} />
              <DataRow label="Qubit base" value={`${policy.capabilityBaseQubits.toLocaleString("en-US")} @ ${policy.capabilityBaseYear}`} />
              <DataRow label="Annual growth" value={`${(policy.capabilityGrowth * 100).toFixed(0)}%`} />
              <DataRow label="Classical floor" value={`${policy.minimumClassicalBits} bits`} />
            </dl>
            <p className="mt-3 border-t border-parchment-200 pt-3 text-xs leading-relaxed text-ash-600">
              Growth is your stated assumption, not a forecast.{" "}
              <Link href="/settings" className="underline underline-offset-4">
                Change it
              </Link>
              .
            </p>
          </section>
        </aside>
      </div>

      <p className="mt-10 border-t border-parchment-300 pt-4 font-mono text-[0.62rem] leading-relaxed text-ash-600">
        Sources: {assay.tls.meta.attribution} · {assay.ct.meta.attribution}
      </p>
    </div>
  );
}

export { SectionHeading };