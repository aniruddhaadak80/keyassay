import { Suspense } from "react";
import { verifyEngineCitations, fetchResearchSignals } from "@/lib/sources/arxiv";
import { SourceBadge } from "@/components/grade-mark";

/**
 * The live citation and research panel.
 *
 * arXiv is a third party on the critical path of a page that should not wait for
 * it. Both blocks are therefore streamed in behind a Suspense boundary, so the
 * page paints and becomes usable immediately and the literature fills in when it
 * arrives. If arXiv is slow or rate-limited the panel says so instead of holding
 * the whole page hostage.
 */

function CitationSkeleton() {
  return (
    <div className="mt-4 space-y-3" aria-hidden="true">
      <div className="h-20 animate-pulse rounded-sm bg-parchment-200" />
      <div className="h-20 animate-pulse rounded-sm bg-parchment-200" />
      <span className="sr-only">Checking the cited papers against arXiv</span>
    </div>
  );
}

async function CitationPanel() {
  const citations = await verifyEngineCitations().catch(() => []);
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

async function ResearchPanel() {
  const research = await fetchResearchSignals(6).catch(() => null);

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

export function LiteraturePanels() {
  return (
    <>
      <Suspense fallback={<CitationSkeleton />}>
        <CitationPanel />
      </Suspense>
      <Suspense
        fallback={
          <div className="mt-10 h-40 animate-pulse rounded-sm bg-parchment-200" aria-hidden="true" />
        }
      >
        <ResearchPanel />
      </Suspense>
    </>
  );
}

/** The same streamed panel, rendered compactly for the landing page. */
export function LandingResearchPanel() {
  return (
    <Suspense
      fallback={
        <div className="mt-8 h-32 animate-pulse rounded-sm bg-parchment-200" aria-hidden="true" />
      }
    >
      <ResearchPanel />
    </Suspense>
  );
}