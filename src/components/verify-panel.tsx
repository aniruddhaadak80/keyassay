"use client";

import Link from "next/link";
import { useState } from "react";
import { ShieldCheckIcon, ShieldAlertIcon, RefreshIcon } from "@/components/icons";

export interface ChainSummary {
  id: string;
  host: string;
  ok: boolean;
  eventsChecked: number;
  headSeal: string;
  firstBrokenSeq: number | null;
  reason: string | null;
}

/**
 * On-demand replay.
 *
 * The server already replayed every chain for this page. This panel re-checks a
 * single chain from the browser so a reader can confirm the result rather than
 * take it on trust, and shows the exact first broken sequence number when
 * something has been tampered with.
 */
export function VerifyPanel({
  initialId,
  chains,
}: {
  initialId: string;
  chains: ChainSummary[];
}) {
  const [id, setId] = useState(initialId);
  const [result, setResult] = useState<ChainSummary | { error: string } | null>(
    chains.find((chain) => chain.id === initialId) ?? null,
  );
  const [working, setWorking] = useState(false);

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = id.trim();
    if (!trimmed) return;
    setWorking(true);
    try {
      const response = await fetch(`/api/verify?assay=${encodeURIComponent(trimmed)}`);
      const payload = (await response.json()) as {
        replay?: ChainSummary & { eventsChecked: number };
        error?: { message?: string };
      };
      if (!response.ok || !payload.replay) {
        setResult({ error: payload.error?.message ?? `HTTP ${response.status}` });
        return;
      }
      setResult(payload.replay);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "The request failed." });
    } finally {
      setWorking(false);
    }
  }

  const tone = (entry: ChainSummary): string =>
    entry.ok ? "border-verdigris-500 bg-verdigris-100 text-verdigris-700" : "border-retort-500 bg-retort-100 text-retort-700";

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
      <section>
        <form onSubmit={verify} className="sheet rounded-sm p-5">
          <label htmlFor="verify-id" className="ledger-head block">
            Assay id to replay
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="verify-id"
              type="text"
              value={id}
              onChange={(event) => setId(event.target.value)}
              placeholder="paste a UUID"
              className="w-full rounded-sm border border-parchment-400 bg-parchment-50 px-3 py-2 font-mono text-xs focus:border-ultramarine-600 focus:outline-none"
            />
            <button
              type="submit"
              disabled={working || !id.trim()}
              className="inline-flex shrink-0 items-center gap-2 rounded-sm bg-ultramarine-700 px-4 py-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-parchment-50 hover:bg-ultramarine-600 disabled:opacity-50"
            >
              <RefreshIcon className={`h-3.5 w-3.5 ${working ? "animate-spin" : ""}`} aria-hidden="true" />
              {working ? "Replaying" : "Replay"}
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-400">
            Replays the chain from the stored events and recomputes every digest. Finds an id in the{" "}
            <Link href="/ledger" className="underline underline-offset-4">
              ledger
            </Link>
            .
          </p>
        </form>

        {result ? (
          "error" in result ? (
            <div role="alert" className="mt-4 rounded-sm border border-retort-500 bg-retort-100 px-4 py-3 text-sm text-ink-700">
              {result.error}
            </div>
          ) : (
            <div className={`mt-4 rounded-sm border px-4 py-4 ${tone(result)}`}>
              <p className="flex items-center gap-2 font-semibold">
                {result.ok ? (
                  <ShieldCheckIcon className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ShieldAlertIcon className="h-4 w-4" aria-hidden="true" />
                )}
                {result.ok ? "Chain replays clean" : `Chain broken at sequence ${result.firstBrokenSeq}`}
              </p>
              <p className="mt-1.5 font-mono text-xs text-ink-700">
                {result.eventsChecked} events checked · head {result.headSeal.slice(0, 32)}…
              </p>
              {result.reason ? (
                <p className="mt-2 border-t border-retort-500/40 pt-2 font-mono text-[0.68rem] text-ink-700">
                  {result.reason}
                </p>
              ) : null}
            </div>
          )
        ) : null}
      </section>

      <section>
        <p className="ledger-head">Every chain in this session</p>
        {chains.length === 0 ? (
          <p className="mt-3 text-sm text-ink-400">
            No assays yet, so there is nothing to replay. Run one and it appears here.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {chains.map((chain) => (
              <li key={chain.id} className="rounded-sm border border-parchment-300 bg-parchment-50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/ledger/${chain.id}`}
                    className="text-sm text-ink-900 underline-offset-4 hover:text-ultramarine-700 hover:underline"
                  >
                    {chain.host}
                  </Link>
                  <span
                    className={`rounded-sm border px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] ${tone(chain)}`}
                  >
                    {chain.ok ? "verified" : `broken at #${chain.firstBrokenSeq}`}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[0.66rem] text-ash-600">
                  {chain.eventsChecked} events · {chain.headSeal.slice(0, 24)}…
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}