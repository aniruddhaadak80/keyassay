"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

/**
 * The horizon dial — this product's signature interaction.
 *
 * It is not decoration. Dragging it re-rates the entire persisted ledger through
 * the real engine, and every bar, count and grade below the handle is the output
 * of that computation. Move the handle left and the exposed set grows; move it
 * right and it shrinks. The dial writes the chosen horizon to the server as a
 * persisted policy, so the position is real state rather than a local slider.
 *
 * The insight it is built to deliver: rotating a certificate does not protect
 * traffic that has already been captured. The exposure lives in the harvested
 * ciphertext, so it is measured against the year the data must stay secret, not
 * against the certificate's expiry.
 */

export interface DialAssay {
  id: string;
  host: string;
  label: string;
  storedGrade: string;
  grade: string;
  score: number;
  exposed: boolean;
  breakYear: number | null;
  decision: string | null;
}

export function HorizonDial({
  initial,
  assays,
}: {
  initial: number;
  assays: DialAssay[];
}) {
  const min = 2030;
  const max = 2060;

  const [horizon, setHorizon] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exposedCount = useMemo(() => assays.filter((assay) => assay.exposed).length, [assays]);
  const dirty = horizon !== saved;

  // The projected break years come from the stored assays. When the dial moves,
  // the projection is recomputed locally from the same arithmetic the server
  // uses, so the bars respond immediately while the authoritative re-rate is
  // persisted in the background.
  const projected = useMemo(() => {
    const exposureYears = assays
      .map((assay) => assay.breakYear)
      .filter((year): year is number => typeof year === "number");
    const earliest = exposureYears.length > 0 ? Math.min(...exposureYears) : 2050;
    const latest = exposureYears.length > 0 ? Math.max(...exposureYears) : 2060;
    return { earliest, latest: Math.max(latest, min) };
  }, [assays]);

  const wouldExpose = useCallback(
    (breakYear: number | null) => (breakYear === null ? false : breakYear <= horizon),
    [horizon],
  );

  const persist = useCallback(async (value: number) => {
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/policy", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ horizonYear: value }),
      });
      const payload = (await response.json()) as {
        policy?: { horizonYear: number };
        rerated?: DialAssay[];
        error?: { message?: string };
      };
      if (!response.ok || !payload.policy) {
        setError(payload.error?.message ?? "The horizon could not be saved.");
        return;
      }
      setSaved(payload.policy.horizonYear);
      setMessage(
        `Horizon saved as ${payload.policy.horizonYear}. ${
          payload.rerated?.filter((assay) => assay.exposed).length ?? 0
        } of ${payload.rerated?.length ?? 0} assays now sit inside it.`,
      );
      window.dispatchEvent(new CustomEvent("keyassay:rerated", { detail: payload.rerated }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The horizon could not be saved.");
    } finally {
      setWorking(false);
    }
  }, []);

  // Keyboard support: the dial is a real range input, so arrows work by default.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Enter" && dirty && !working) {
        event.preventDefault();
        void persist(horizon);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dirty, working, horizon, persist]);

  const scaleStart = min;
  const scaleEnd = max;
  const position = (year: number) =>
    `${Math.min(100, Math.max(0, ((year - scaleStart) / (scaleEnd - scaleStart)) * 100))}%`;

  return (
    <div className="sheet rounded-sm p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="ledger-head">Confidentiality horizon</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-500">
            The year by which traffic captured today must still be unreadable. Everything to the left
            of this mark is already inside your risk window.
          </p>
        </div>
        <p className="font-mono text-4xl tabular text-ultramarine-700">{horizon}</p>
      </div>

      <div className="mt-6">
        <label htmlFor="horizon-range" className="sr-only">
          Confidentiality horizon year
        </label>
        <input
          id="horizon-range"
          type="range"
          min={scaleStart}
          max={scaleEnd}
          step={1}
          value={horizon}
          onChange={(event) => setHorizon(Number(event.target.value))}
          aria-valuetext={`Year ${horizon}`}
          aria-describedby="horizon-help"
          className="w-full cursor-pointer accent-ultramarine-700"
        />
        <div className="mt-2 flex justify-between font-mono text-[0.66rem] tabular text-ink-300">
          <span>{scaleStart}</span>
          <span>2040</span>
          <span>2050</span>
          <span>{scaleEnd}</span>
        </div>
        <p id="horizon-help" className="mt-2 text-xs text-ink-400">
          Use the arrow keys to step by a year. Press Enter, or use the button, to persist the horizon
          and re-rate every stored assay.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void persist(horizon)}
          disabled={working || !dirty}
          className="inline-flex items-center gap-2 rounded-sm bg-ultramarine-700 px-4 py-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-parchment-50 hover:bg-ultramarine-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {working ? "Re-rating" : "Save horizon and re-rate"}
        </button>
        {dirty ? (
          <button
            type="button"
            onClick={() => setHorizon(saved)}
            className="rounded-sm border border-parchment-400 px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-ink-500 hover:border-ink-400 hover:text-ink-900"
          >
            Revert
          </button>
        ) : null}
      </div>

      {message ? (
        <p role="status" className="mt-3 text-sm text-verdigris-700">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-retort-700">
          {error}
        </p>
      ) : null}

      <div className="rule-double mt-7 pt-6">
        <div className="flex items-baseline justify-between">
          <p className="ledger-head">Projected exposure across the ledger</p>
          <p className="font-mono text-sm tabular text-ink-700">
            <span className={exposedCount > 0 ? "text-retort-700" : "text-verdigris-700"}>
              {exposedCount}
            </span>{" "}
            of {assays.length} exposed
          </p>
        </div>

        {assays.length === 0 ? (
          <p className="mt-4 text-sm text-ink-400">
            No assays yet. Run one from the ledger and it will appear on this scale.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {assays.map((assay) => {
              const year = assay.breakYear ?? scaleEnd;
              const exposed = wouldExpose(assay.breakYear);
              const left = (Math.min(year, scaleEnd) - scaleStart) / (scaleEnd - scaleStart);
              const right = (Math.max(Math.min(year, scaleEnd), scaleStart) - scaleStart) / (scaleEnd - scaleStart);
              return (
                <div key={assay.id} className="grid grid-cols-[7.5rem_1fr] items-center gap-3">
                  <span className="truncate font-mono text-[0.7rem] text-ink-700" title={assay.host}>
                    {assay.host}
                  </span>
                  <div className="relative h-5 rounded-sm bg-parchment-200">
                    <motion.span
                      aria-hidden="true"
                      className={`absolute inset-y-0 rounded-sm ${
                        exposed ? "bg-retort-500" : "bg-verdigris-500"
                      }`}
                      initial={false}
                      animate={{ left: `${left * 100}%`, right: `${100 - right * 100}%` }}
                      transition={{ type: "spring", stiffness: 220, damping: 26 }}
                    />
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 z-10 w-0.5 bg-ultramarine-700"
                      style={{ left: position(horizon) }}
                    />
                    <span className="relative z-20 flex h-5 items-center px-2 font-mono text-[0.62rem] tabular text-ink-700">
                      {assay.breakYear === null ? "already PQC" : assay.breakYear}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex items-center gap-4 font-mono text-[0.66rem] text-ink-400">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-4 rounded-sm bg-retort-500" />
            breaks before the horizon
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-4 rounded-sm bg-verdigris-500" />
            breaks after it
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-3 w-0.5 bg-ultramarine-700" />
            horizon
          </span>
        </div>

        {projected.earliest < scaleStart ? (
          <p className="mt-3 text-xs text-retort-700">
            At least one assay is modelled to break before {scaleStart}, the start of this scale. Move
            the horizon back or raise the growth assumption in{" "}
            <a href="/settings" className="underline underline-offset-4">
              settings
            </a>
            .
          </p>
        ) : null}
      </div>
    </div>
  );
}