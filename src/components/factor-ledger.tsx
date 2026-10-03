import type { Factor } from "@/lib/types";

/**
 * The factor ledger.
 *
 * An explainable score is only explainable if the reader can see the arithmetic,
 * so every factor is printed with its weight, its measured value, its normalised
 * score, the exact sentence describing what was measured, and the published
 * source behind the measurement. This component renders the engine's output; it
 * never computes anything of its own.
 */

function verdictLabel(normalised: number): { label: string; className: string } {
  if (normalised >= 0.75) return { label: "Strong", className: "text-verdigris-700" };
  if (normalised >= 0.5) return { label: "Adequate", className: "text-ultramarine-700" };
  if (normalised >= 0.25) return { label: "Weak", className: "text-retort-600" };
  return { label: "Critical", className: "text-retort-700" };
}

export function FactorLedger({
  factors,
  weakestFactor,
}: {
  factors: Factor[];
  weakestFactor?: string;
}) {
  return (
    <div className="overflow-hidden rounded-sm border border-parchment-300 bg-parchment-50">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Itemised factors contributing to the composite assay score, with weights, measured values
          and published citations.
        </caption>
        <thead>
          <tr className="border-b border-parchment-300 bg-parchment-200/70">
            <th scope="col" className="ledger-head px-3 py-2">Factor</th>
            <th scope="col" className="ledger-head px-3 py-2 text-right">Weight</th>
            <th scope="col" className="ledger-head px-3 py-2 text-right">Measured</th>
            <th scope="col" className="ledger-head px-3 py-2 text-right">Score</th>
            <th scope="col" className="ledger-head hidden px-3 py-2 sm:table-cell">Contribution</th>
          </tr>
        </thead>
        <tbody>
          {factors.map((factor) => {
            const verdict = verdictLabel(factor.normalised);
            const weakest = factor.id === weakestFactor;
            return (
              <tr
                key={factor.id}
                className={`border-b border-parchment-200 align-top last:border-b-0 ${
                  weakest ? "bg-retort-100/40" : ""
                }`}
              >
                <th scope="row" className="px-3 py-3 font-normal">
                  <span className="text-sm font-semibold text-ink-900">{factor.label}</span>
                  {weakest ? (
                    <span className="ml-2 rounded-sm border border-retort-500 px-1.5 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-retort-700">
                      Weakest
                    </span>
                  ) : null}
                  <span className="mt-1 block text-sm leading-relaxed text-ink-500">{factor.evidence}</span>
                  {factor.citation ? (
                    <span className="mt-1.5 block border-l-2 border-parchment-300 pl-2 font-mono text-[0.66rem] leading-relaxed text-ash-600">
                      {factor.citation}
                    </span>
                  ) : null}
                </th>
                <td className="px-3 py-3 text-right font-mono text-sm tabular text-ink-700">
                  {(factor.weight * 100).toFixed(0)}%
                </td>
                <td className="px-3 py-3 text-right font-mono text-sm tabular text-ink-700">
                  {formatRaw(factor.raw)}
                </td>
                <td className="px-3 py-3 text-right">
                  <span className={`font-mono text-sm tabular ${verdict.className}`}>
                    {(factor.normalised * 100).toFixed(0)}
                  </span>
                  <span className="mt-0.5 block font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-300">
                    {verdict.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className="mt-1.5 block h-1 w-16 overflow-hidden rounded-full bg-parchment-200"
                  >
                    <span
                      className="block h-full bg-ultramarine-500"
                      style={{ width: `${Math.round(factor.normalised * 100)}%` }}
                    />
                  </span>
                </td>
                <td className="hidden px-3 py-3 text-right font-mono text-sm tabular text-ink-700 sm:table-cell">
                  +{(factor.contribution * 100).toFixed(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-3 border-double border-ink-900 bg-parchment-200/50">
            <th scope="row" className="px-3 py-2 text-left text-sm font-semibold text-ink-900">
              Composite score
            </th>
            <td className="px-3 py-2 text-right font-mono text-sm tabular text-ink-500">100%</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right font-mono text-sm tabular text-ink-900" colSpan={2}>
              sum of contributions
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function formatRaw(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}