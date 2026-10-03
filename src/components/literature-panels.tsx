"use client";

import { useEffect, useState } from "react";
import { SourceBadge } from "@/components/grade-mark";
import type { CitationVerification, LivePayload } from "@/lib/types";
import type { ResearchSignal } from "@/lib/sources/arxiv";

/**
 * The live citation and research panel.
 *
 * arXiv is a third party, and it used to be on the critical path of the landing
 * page: both blocks were async server components streamed in behind a Suspense
 * boundary. That works right up until a request hangs, and when it did, React's
 * RSC client failed the stream with an internal "Expected static flag was
 * missing" error and the page never became interactive.
 *
 * So nothing here suspends. The server renders the panel immediately and the
 * browser fetches /api/standards, which already performs the arXiv lookup. A slow
 * or rate-limited arXiv now costs a late panel and a truthful label, never a
 * broken page.
 */

interface StandardsPayload {
  verification?: CitationVerification[];
  research?: LivePayload<ResearchSignal[]> | null;
}

function CitationSkeleton() {
  return (
    <div className="mt-5 space-y-3" aria-hidden="true">
      <div className="h-20 animate-pulse rounded-sm bg-parchment-200" />
      <div className="h-20 animate-pulse rounded-sm bg-parchment-200" />
      <span className="sr-only">Checking the cited papers against arXiv</span>
    </div>
  );
}

function ResearchSkeleton() {
  return <div className="mt-10 h-40 animate-pulse rounded-sm bg-parchment-200" aria-hidden="true" />;
}

function CitationPanel({ citations }: { citations: CitationVerification[] }) {
  const allVerified = citations.length > 0 && citations.every((entry) => entry.found && entry.titleMatches);

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl text-ink-900">Live citation check</h2>
        <span
          className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.1em] ${
            allVerified
              ? "border-verdigris-500 bg-verdigris-100 text-verdigris-700"
              : "border-retort-500 bg-retort-100 text-retort-700"
          }`}
        >
          {citations.length === 0
            ? "arXiv not reachable"
            : allVerified
              ? "All citations verified against arXiv"
              : "A citation could not be verified"}
        </span>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-500">
        The engine names two specific papers. Rather than hard-coding those references as
        uncheckable strings, the product fetches their metadata from the arXiv API and compares the
        returned title against the one the engine cites.
      </p>

      {citations.length === 0 ? (
        <p className="mt-4 rounded-sm border border-retort-500 bg-retort-100 px-4 py-3 text-sm text-ink-700">
          arXiv could not be reached for this request. The citations printed elsewhere on this page
          are unverified right now, and the page says so rather than claiming otherwise.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {citations.map((entry) => (
            <li key={entry.arxivId} className="sheet rounded-sm p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-ultramarine-700">arXiv:{entry.arxivId}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-900">
                    {entry.title ?? "No entry returned for this identifier."}
                  </p>
                  {entry.authors.length > 0 ? (
                    <p className="mt-1 font-mono text-[0.68rem] text-ash-600">
                      {entry.authors.slice(0, 3).join(", ")} · submitted{" "}
                      {entry.published?.slice(0, 10)}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <SourceBadge
                    meta={{
                      status: entry.status,
                      source: "arXiv API",
                      upstreamId: entry.arxivId,
                      attribution: `Metadata retrieved from arXiv at ${entry.checkedAt}.`,
                      fetchedAt: entry.checkedAt,
                    }}
                  />
                  <span
                    className={`font-mono text-[0.62rem] uppercase tracking-[0.1em] ${
                      entry.titleMatches ? "text-verdigris-700" : "text-retort-700"
                    }`}
                  >
                    {entry.titleMatches ? "Title matches engine" : "Unverified"}
                  </span>
                </div>
              </div>
              {entry.reason ? (
                <p className="mt-2 border-t border-parchment-200 pt-2 font-mono text-[0.66rem] text-ash-600">
                  {entry.reason}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResearchPanel({
  research,
}: {
  research: StandardsPayload["research"];
}) {
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl text-ink-900">Current literature</h2>
        {research ? <SourceBadge meta={research.meta} /> : null}
      </div>

      {research?.status === "live" && research.data.length > 0 ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            Recent arXiv submissions mentioning post-quantum cryptography, retrieved live. A published
            break cost is a lower bound that keeps falling, which is the honest reason the growth rate
            is yours to set rather than the product&apos;s to assert.
          </p>
          <ul className="mt-4 space-y-3">
            {research.data.map((paper) => (
              <li key={paper.id} className="border-b border-parchment-200 pb-3">
                <a
                  href={paper.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm leading-snug text-ink-900 underline-offset-4 hover:text-ultramarine-700 hover:underline"
                >
                  {paper.title}
                </a>
                <p className="mt-1 font-mono text-[0.66rem] text-ash-600">
                  arXiv:{paper.id} · {paper.published.slice(0, 10)} · {paper.categories.join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-400">
          arXiv could not be reached on this request, so no current listing is shown. The citation
          check above reports the same failure rather than hiding it.
        </p>
      )}
    </section>
  );
}

/**
 * Fetches the standards payload once and hands it to both blocks. A failure is
 * reported as an empty citation list, which the panel renders as "arXiv not
 * reachable" rather than as a passing check.
 */
function useStandards(): StandardsPayload | null {
  const [payload, setPayload] = useState<StandardsPayload | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/standards?limit=6", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: { data?: StandardsPayload }) => setPayload(body.data ?? null))
      .catch(() => {
        if (!controller.signal.aborted) setPayload({ verification: [], research: null });
      });
    return () => controller.abort();
  }, []);

  return payload;
}

export function LiteraturePanels() {
  const payload = useStandards();

  return (
    <>
      {payload === null ? <CitationSkeleton /> : <CitationPanel citations={payload.verification ?? []} />}
      {payload === null ? <ResearchSkeleton /> : <ResearchPanel research={payload.research ?? null} />}
    </>
  );
}

/** The same panel, rendered compactly for the landing page. */
export function LandingResearchPanel() {
  const payload = useStandards();

  if (payload === null) return <ResearchSkeleton />;
  return <ResearchPanel research={payload.research ?? null} />;
}