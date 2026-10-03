"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The policy editor.
 *
 * Saving writes to the server and the response carries the re-rated result for
 * every stored assay, so the consequence of changing an assumption is shown
 * immediately rather than inferred. Stored measurements are never modified by
 * this: only the timeline they are read against.
 */

interface Policy {
  horizonYear: number;
  costModel: string;
  capabilityBaseQubits: number;
  capabilityGrowth: number;
  minimumClassicalBits: number;
}

interface Rerated {
  id: string;
  host: string;
  storedGrade: string;
  grade: string;
  score: number;
  exposed: boolean;
  breakYear: number | null;
}

const COST_MODEL_OPTIONS = [
  {
    value: "gidney-2025",
    label: "Gidney 2025 — under 1M physical qubits, under a week",
  },
  { value: "gidney-ekera-2019", label: "Gidney & Ekerå — 20M physical qubits, 8 hours" },
];

const HORIZON_PRESETS = [2032, 2035, 2040, 2045, 2050];

export function PolicyForm({
  current,
  defaults,
  costModels,
}: {
  current: Policy;
  defaults: Policy;
  costModels: Array<{ id: string; rsa2048PhysicalQubits: number }>;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Policy>(current);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [rerated, setRerated] = useState<Rerated[] | null>(null);

  const dirty =
    form.horizonYear !== current.horizonYear ||
    form.costModel !== current.costModel ||
    form.capabilityBaseQubits !== current.capabilityBaseQubits ||
    form.capabilityGrowth !== current.capabilityGrowth ||
    form.minimumClassicalBits !== current.minimumClassicalBits;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage(null);
    try {
      const response = await fetch("/api/policy", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          horizonYear: form.horizonYear,
          costModel: form.costModel,
          capabilityBaseQubits: form.capabilityBaseQubits,
          capabilityGrowth: form.capabilityGrowth,
          minimumClassicalBits: form.minimumClassicalBits,
        }),
      });
      const payload = (await response.json()) as {
        policy?: Policy;
        rerated?: Rerated[];
        error?: { message?: string };
      };
      if (!response.ok || !payload.policy) {
        setStatus("error");
        setMessage(payload.error?.message ?? `HTTP ${response.status}`);
        return;
      }
      setStatus("saved");
      setForm(payload.policy);
      setRerated(payload.rerated ?? []);
      const exposed = payload.rerated?.filter((entry) => entry.exposed).length ?? 0;
      setMessage(
        `Policy saved. ${exposed} of ${payload.rerated?.length ?? 0} assays now fall inside the horizon.`,
      );
      router.refresh();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "The request failed.");
    }
  }

  return (
    <form onSubmit={save} className="sheet rounded-sm p-5 sm:p-6">
      <div className="space-y-6">
        <div>
          <label htmlFor="horizon-year" className="ledger-head block">
            Confidentiality horizon
          </label>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            The year by which traffic captured today must still be unreadable.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              id="horizon-year"
              type="number"
              min={2026}
              max={2200}
              step={1}
              value={form.horizonYear}
              onChange={(event) =>
                setForm({ ...form, horizonYear: Number(event.target.value) })
              }
              className="w-28 rounded-sm border border-parchment-400 bg-parchment-50 px-3 py-2 font-mono text-sm focus:border-ultramarine-600 focus:outline-none"
            />
            {HORIZON_PRESETS.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => setForm({ ...form, horizonYear: year })}
                className={`rounded-sm border px-2.5 py-1.5 font-mono text-xs ${
                  form.horizonYear === year
                    ? "border-ultramarine-600 bg-ultramarine-100 text-ultramarine-700"
                    : "border-parchment-400 text-ink-500 hover:border-ink-400"
                }`}
              >
                {year}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="cost-model" className="ledger-head block">
            Published cost anchor
          </label>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            Both figures are published estimates for factoring RSA-2048. The lower one yields earlier
            break years.
          </p>
          <select
            id="cost-model"
            value={form.costModel}
            onChange={(event) => setForm({ ...form, costModel: event.target.value })}
            className="mt-2 w-full rounded-sm border border-parchment-400 bg-parchment-50 px-3 py-2 text-sm focus:border-ultramarine-600 focus:outline-none"
          >
            {COST_MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 font-mono text-[0.66rem] text-ash-600">
            {costModels.map((model) => `${model.id}: ${model.rsa2048PhysicalQubits.toLocaleString("en-US")} qubits`).join(" · ")}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="growth" className="ledger-head block">
              Annual qubit growth
            </label>
            <div className="mt-2 flex items-center gap-3">
              <input
                id="growth"
                type="range"
                min={5}
                max={150}
                step={1}
                value={Math.round(form.capabilityGrowth * 100)}
                onChange={(event) =>
                  setForm({ ...form, capabilityGrowth: Number(event.target.value) / 100 })
                }
                className="w-full accent-ultramarine-700"
              />
              <span className="w-16 shrink-0 font-mono text-sm tabular text-ink-900">
                {(form.capabilityGrowth * 100).toFixed(0)}%
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-400">Your assumption, not a forecast.</p>
          </div>

          <div>
            <label htmlFor="base-qubits" className="ledger-head block">
              Qubit capacity in 2026
            </label>
            <input
              id="base-qubits"
              type="number"
              min={1}
              max={100000000}
              step={100}
              value={form.capabilityBaseQubits}
              onChange={(event) =>
                setForm({ ...form, capabilityBaseQubits: Number(event.target.value) })
              }
              className="mt-2 w-full rounded-sm border border-parchment-400 bg-parchment-50 px-3 py-2 font-mono text-sm focus:border-ultramarine-600 focus:outline-none"
            />
            <p className="mt-1 text-xs text-ink-400">Error-corrected physical qubits available now.</p>
          </div>
        </div>

        <div>
          <label htmlFor="floor" className="ledger-head block">
            Classical security floor
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {[112, 128, 192].map((bits) => (
              <button
                key={bits}
                type="button"
                onClick={() => setForm({ ...form, minimumClassicalBits: bits })}
                className={`rounded-sm border px-3 py-1.5 font-mono text-xs ${
                  form.minimumClassicalBits === bits
                    ? "border-ultramarine-600 bg-ultramarine-100 text-ultramarine-700"
                    : "border-parchment-400 text-ink-500 hover:border-ink-400"
                }`}
              >
                {bits} bits
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-400">
            NIST IR 8547 deprecates 112-bit-strength public keys after 2030.
          </p>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-parchment-300 pt-5">
        <button
          type="submit"
          disabled={status === "saving" || !dirty}
          className="rounded-sm bg-ultramarine-700 px-5 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-parchment-50 hover:bg-ultramarine-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "saving" ? "Re-rating" : "Save and re-rate"}
        </button>
        <button
          type="button"
          onClick={() => {
            setForm(defaults);
            setStatus("idle");
            setMessage(null);
            setRerated(null);
          }}
          className="rounded-sm border border-parchment-400 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-ink-500 hover:border-ink-400 hover:text-ink-900"
        >
          Reset to defaults
        </button>
        {message ? (
          <p
            role="status"
            className={`text-sm ${status === "error" ? "text-retort-700" : "text-verdigris-700"}`}
          >
            {message}
          </p>
        ) : null}
      </div>

      {rerated && rerated.length > 0 ? (
        <div className="mt-6 border-t border-parchment-300 pt-5">
          <p className="ledger-head">Resulting grades</p>
          <ul className="mt-3 space-y-1.5">
            {rerated.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 font-mono text-xs">
                <span className="text-ink-700">{entry.host}</span>
                <span className="text-ink-400">
                  {entry.storedGrade} ({entry.score}) → {entry.grade} ({entry.score})
                </span>
                <span className={entry.exposed ? "text-retort-700" : "text-verdigris-700"}>
                  breaks {entry.breakYear ?? "never"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}