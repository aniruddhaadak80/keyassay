import Link from "next/link";
import type { Metadata } from "next";
import { getRepository } from "@/lib/db";
import { getSessionId } from "@/lib/session";
import { loadPolicy, rerateStored } from "@/lib/service";
import { siteConfig } from "@/lib/config";
import { GradeMark } from "@/components/grade-mark";
import { EmptyState, SectionHeading } from "@/components/states";
import { LedgerFilters } from "@/components/ledger-filters";
import type { Assay } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Assay ledger",
  description:
    "Every endpoint you have assayed, re-rated against your current confidentiality horizon, with grade, break year, decision and seal.",
  alternates: { canonical: `${siteConfig.liveUrl}/ledger` },
};

/**
 * The workspace.
 *
 * Filters, sort and page live in the URL so a particular view can be shared or
 * survives a refresh, and every row shows both the grade that was stored at scan
 * time and the grade under the policy currently in force — because those two
 * diverging is exactly the thing worth noticing.
 */
export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const grade = firstParam(params.grade);
  const decision = firstParam(params.decision);
  const search = firstParam(params.search);
  const sort = firstParam(params.sort) ?? "recent";
  const page = Math.max(1, Number(firstParam(params.page) ?? "1") || 1);

  const perPage = 12;
  const sessionId = await getSessionId();
  const repo = await getRepository();

  const query = {
    limit: perPage,
    offset: (page - 1) * perPage,
    grade: grade as never,
    decision: decision as never,
    search,
    includeDeleted: firstParam(params.deleted) === "true",
  };

  // One round trip for the page and its total, plus the policy needed to re-rate.
  // No health probe here: /api/health already reports store health, and running a
  // third set of queries on a list page is what exhausts a small connection pool
  // under serverless concurrency.
  const [pageResult, policy] = await Promise.all([
    repo.listAssaysPage(sessionId, query),
    loadPolicy({ repo, sessionId }),
  ]);

  const total = pageResult.total;
  const currentYear = new Date().getFullYear();

  const complete = pageResult.items.map((assay) => ({
    assay,
    rerated: rerateStored(assay, policy, currentYear),
  }));

  const sorted = [...complete].sort((a, b) => {
    if (sort === "exposure") {
      return (a.rerated.exposure.breakYear ?? 9999) - (b.rerated.exposure.breakYear ?? 9999);
    }
    if (sort === "score") return b.rerated.score - a.rerated.score;
    if (sort === "host") return a.assay.host.localeCompare(b.assay.host);
    return b.assay.createdAt.localeCompare(a.assay.createdAt);
  });

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="pt-10">
      <SectionHeading
        eyebrow="Workspace"
        title="The assay ledger"
        lede="Every endpoint you have assayed in this session. The stored grade is what the engine returned at scan time; the current grade is what it returns under the horizon you have set now."
      />

      <LedgerFilters
        grade={grade ?? ""}
        decision={decision ?? ""}
        search={search ?? ""}
        sort={sort}
        page={page}
        totalPages={totalPages}
        total={total}
      />

      {complete.length === 0 ? (
        <EmptyState
          title={total === 0 && !grade && !decision && !search ? "No assays yet" : "Nothing matches those filters"}
          body={
            total === 0 && !grade && !decision && !search
              ? "Submit a hostname to perform a real TLS handshake and grade its key material. It takes about two seconds."
              : "Loosen the grade, decision or search filters to see the rest of the ledger."
          }
          action={{ href: "/#assay", label: "Run the first assay" }}
        />
      ) : (
        <>
          <ul className="mt-6 space-y-4">
            {sorted.map(({ assay, rerated }) => {
              const drifted = assay.grade !== rerated.grade;
              const exposed = rerated.exposure.exposed;
              return (
                <li key={assay.id} className="sheet rounded-sm p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Link
                          href={`/ledger/${assay.id}`}
                          className="truncate text-lg text-ink-900 underline-offset-4 hover:text-ultramarine-700 hover:underline"
                        >
                          {assay.label}
                        </Link>
                        {assay.deletedAt ? (
                          <span className="rounded-sm border border-ash-400 px-1.5 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-ash-600">
                            Tombstoned
                          </span>
                        ) : null}
                        {drifted ? (
                          <span className="rounded-sm border border-ultramarine-500 px-1.5 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-ultramarine-700">
                            Re-rated
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 font-mono text-xs text-ink-400">
                        {assay.host}:{assay.port} ·{" "}
                        {assay.keyAlgorithm.toUpperCase()}
                        {assay.keyBits ? ` ${assay.keyBits}` : ""}
                        {assay.curve ? ` (${assay.curve})` : ""} · {assay.protocol ?? "unknown transport"}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      {drifted ? (
                        <span className="flex flex-col items-end gap-1">
                          <span className="ledger-head">Stored</span>
                          <GradeMark grade={assay.grade} size="sm" />
                        </span>
                      ) : null}
                      <span className="flex flex-col items-end gap-1">
                        <span className="ledger-head">Now</span>
                        <GradeMark grade={rerated.grade} score={rerated.score} size="sm" />
                      </span>
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-parchment-200 pt-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="ledger-head">Modelled break</dt>
                      <dd
                        className={`mt-0.5 font-mono text-sm tabular ${
                          exposed ? "text-retort-700" : "text-verdigris-700"
                        }`}
                      >
                        {rerated.exposure.breakYear === null ? "already PQC" : rerated.exposure.breakYear}
                      </dd>
                    </div>
                    <div>
                      <dt className="ledger-head">Exposure</dt>
                      <dd
                        className={`mt-0.5 text-sm ${exposed ? "text-retort-700" : "text-ink-700"}`}
                      >
                        {rerated.exposure.postQuantum
                          ? "Not modelled"
                          : exposed
                            ? "Inside horizon"
                            : "Beyond horizon"}
                      </dd>
                    </div>
                    <div>
                      <dt className="ledger-head">Decision</dt>
                      <dd className="mt-0.5 text-sm text-ink-700">
                        {assay.decision ? assay.decision.replace("-", " ") : "Not recorded"}
                      </dd>
                    </div>
                    <div>
                      <dt className="ledger-head">Sources</dt>
                      <dd className="mt-0.5 font-mono text-xs text-ink-500">
                        {assay.tls.meta.status} / {assay.ct.meta.status} ·{" "}
                        {assay.ctCertificateCount ?? 0} CT certs
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-3 truncate border-t border-parchment-200 pt-3 font-mono text-[0.66rem] text-ink-300">
                    seal {assay.seal.slice(0, 32)}… · assayed {assay.createdAt.slice(0, 19).replace("T", " ")} UTC
                  </p>
                </li>
              );
            })}
          </ul>

          {totalPages > 1 ? (
            <nav aria-label="Pagination" className="mt-8 flex items-center justify-between border-t border-parchment-300 pt-4">
              {page > 1 ? (
                <Link
                  href={pageHref({ page: page - 1, grade, decision, search, sort })}
                  className="rounded-sm border border-parchment-400 px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-ink-700 hover:border-ink-900"
                >
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <p className="font-mono text-xs tabular text-ink-500">
                Page {page} of {totalPages}
              </p>
              {page < totalPages ? (
                <Link
                  href={pageHref({ page: page + 1, grade, decision, search, sort })}
                  className="rounded-sm border border-parchment-400 px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-ink-700 hover:border-ink-900"
                >
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}

      <p className="mt-10 border-t border-parchment-300 pt-4 font-mono text-[0.66rem] text-ash-600">
        Store: {repo.kind} · horizon {policy.horizonYear} · cost model {policy.costModel} ·{" "}
        <a href="/api/health" className="underline underline-offset-4">
          store health
        </a>
      </p>
    </div>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function pageHref(state: {
  page: number;
  grade?: string;
  decision?: string;
  search?: string;
  sort: string;
}): string {
  const query = new URLSearchParams();
  query.set("page", String(state.page));
  query.set("sort", state.sort);
  if (state.grade) query.set("grade", state.grade);
  if (state.decision) query.set("decision", state.decision);
  if (state.search) query.set("search", state.search);
  return `/ledger?${query.toString()}`;
}

export type { Assay };