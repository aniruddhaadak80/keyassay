import type { Grade, SourceMeta } from "@/lib/types";

/**
 * The struck grade mark.
 *
 * An assay certificate is graded the way metal is: bullion, sterling, base,
 * corroded. The mark is the product's signature object, and it is struck by the
 * same word that the engine returned, so it can never disagree with the score.
 */

export const GRADE_STAMP: Record<Grade, string> = {
  bullion: "Fine",
  sterling: "Sterling",
  base: "Base",
  corroded: "Corroded",
};

export const GRADE_MEANING: Record<Grade, string> = {
  bullion: "Quantum-resistant for the stated horizon.",
  sterling: "Strong; migration can follow the normal cycle.",
  base: "Exposed inside the planning horizon.",
  corroded: "Harvest-now-decrypt-later exposure is live.",
};

export function GradeMark({
  grade,
  score,
  size = "md",
  strike = false,
}: {
  grade: Grade;
  score?: number;
  size?: "sm" | "md" | "lg";
  strike?: boolean;
}) {
  const sizing =
    size === "lg"
      ? "text-base px-5 py-3 tracking-[0.2em]"
      : size === "sm"
        ? "text-[0.6rem] px-2 py-1"
        : "text-[0.78rem] px-3 py-1.5";

  return (
    <span
      className={`mark mark-${grade} ${sizing} ${strike ? "animate-strike" : ""}`}
      role="img"
      aria-label={`Grade ${GRADE_STAMP[grade]}${score === undefined ? "" : `, score ${score} out of 100`}. ${GRADE_MEANING[grade]}`}
    >
      {GRADE_STAMP[grade]}
      {score === undefined ? "" : ` · ${score}`}
    </span>
  );
}

export function GradeLegend({ grade }: { grade: Grade }) {
  return (
    <div className="flex items-baseline gap-3">
      <GradeMark grade={grade} size="sm" />
      <p className="text-sm text-ink-500">{GRADE_MEANING[grade]}</p>
    </div>
  );
}

/**
 * Provenance badge.
 *
 * Every external payload carries whether it was live or a sealed fallback. This
 * makes that state impossible to miss: a fallback is amber and says so in words,
 * because presenting an offline sample as a current measurement is the one thing
 * this product must never do.
 */
export function SourceBadge({ meta, compact = false }: { meta: SourceMeta; compact?: boolean }) {
  const live = meta.status === "live";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.1em] ${
        live
          ? "border-verdigris-500 bg-verdigris-100 text-verdigris-700"
          : "border-retort-500 bg-retort-100 text-retort-700"
      }`}
      title={meta.attribution}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${live ? "bg-verdigris-600" : "bg-retort-600"}`}
      />
      {live ? "Live" : "Fallback"}
      {compact ? null : <span className="hidden sm:inline">· {meta.source}</span>}
    </span>
  );
}

export function DataRow({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-parchment-200 py-2 last:border-b-0">
      <dt className="ledger-head shrink-0">{label}</dt>
      <dd className={`text-right text-sm text-ink-900 ${mono ? "font-mono tabular" : ""}`}>{value}</dd>
    </div>
  );
}