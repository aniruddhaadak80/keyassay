"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ScanIcon } from "@/components/icons";
import type { Assay } from "@/lib/types";

/**
 * The primary action: assay a host.
 *
 * This form performs a real server-side TLS handshake and a Certificate
 * Transparency lookup, runs the engine and persists the result. It reports the
 * four states honestly: idle, working, failed with the reason, and succeeded
 * with a link to the stored assay.
 */

interface FormState {
  status: "idle" | "working" | "error" | "done";
  message: string | null;
  detail: string | null;
  assay: Assay | null;
}

const EXAMPLES = ["github.com", "cloudflare.com", "vercel.com", "letsencrypt.org"];

export function AssayForm({
  defaultHost = "",
  showExamples = true,
  compact = false,
}: {
  defaultHost?: string;
  showExamples?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [host, setHost] = useState(defaultHost);
  const [label, setLabel] = useState("");
  const [state, setState] = useState<FormState>({
    status: "idle",
    message: null,
    detail: null,
    assay: null,
  });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = host.trim();
    if (trimmed.length === 0) {
      setState({ status: "error", message: "Enter a hostname first.", detail: null, assay: null });
      return;
    }

    setState({ status: "working", message: null, detail: null, assay: null });

    try {
      const response = await fetch("/api/assays", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          host: trimmed,
          label: label.trim() || undefined,
        }),
      });

      const payload = (await response.json()) as {
        assay?: Assay;
        degraded?: boolean;
        warning?: string | null;
        error?: { message?: string; code?: string; details?: { field?: string } };
      };

      if (!response.ok || !payload.assay) {
        setState({
          status: "error",
          message: payload.error?.message ?? `The scan failed with HTTP ${response.status}.`,
          detail: payload.error?.code ? `error code: ${payload.error.code}` : null,
          assay: null,
        });
        return;
      }

      setState({
        status: "done",
        message: `${payload.assay.host} graded ${payload.assay.grade}, score ${payload.assay.score}.`,
        detail: payload.warning ?? (payload.degraded ? "One or more sources fell back to sealed samples." : null),
        assay: payload.assay,
      });

      // Keep the ledger view consistent without a full navigation.
      router.refresh();
    } catch (error) {
      setState({
        status: "error",
        message: "The request could not reach the server.",
        detail: error instanceof Error ? error.message : "unknown transport error",
        assay: null,
      });
    }
  }

  const working = state.status === "working";

  return (
    <div>
      <form onSubmit={submit} className="sheet rounded-sm p-5 sm:p-6" noValidate>
        <label htmlFor="host" className="ledger-head block">
          Hostname to assay
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            id="host"
            name="host"
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="example.com"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            disabled={working}
            aria-describedby="host-help"
            className="w-full rounded-sm border border-parchment-400 bg-parchment-50 px-3 py-2.5 font-mono text-sm text-ink-900 placeholder:text-ink-300 focus:border-ultramarine-600 focus:outline-none disabled:opacity-60"
          />
          {!compact ? (
            <input
              id="label"
              name="label"
              type="text"
              placeholder="Label (optional)"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              disabled={working}
              aria-label="Label for this endpoint in the ledger"
              className="w-full rounded-sm border border-parchment-400 bg-parchment-50 px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-300 focus:border-ultramarine-600 focus:outline-none disabled:opacity-60 sm:max-w-48"
            />
          ) : null}
          <button
            type="submit"
            disabled={working}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-sm bg-ultramarine-700 px-5 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-parchment-50 transition-colors hover:bg-ultramarine-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ScanIcon className="h-4 w-4" aria-hidden="true" />
            {working ? "Assaying" : "Run assay"}
          </button>
        </div>

        <p id="host-help" className="mt-2 text-xs leading-relaxed text-ink-400">
          A bare hostname. The server opens a real TLS connection to port 443, reads the certificate
          chain the endpoint presents, looks up its Certificate Transparency history, then rates the
          key material against the quantum break model.
        </p>

        {showExamples ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="ledger-head">Try</span>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setHost(example)}
                disabled={working}
                className="rounded-sm border border-parchment-300 px-2 py-1 font-mono text-[0.68rem] text-ink-500 hover:border-ultramarine-500 hover:text-ultramarine-700 disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}
      </form>

      {state.status === "working" ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-4 rounded-sm border border-parchment-300 bg-parchment-200 px-4 py-3 font-mono text-xs uppercase tracking-[0.1em] text-ink-500"
        >
          Performing handshake and Certificate Transparency lookup…
        </p>
      ) : null}

      {state.status === "error" ? (
        <div
          role="alert"
          className="mt-4 rounded-sm border border-retort-500 bg-retort-100 px-4 py-3 text-sm text-ink-700"
        >
          <p className="font-semibold text-retort-700">The assay failed.</p>
          <p className="mt-1 leading-relaxed">{state.message}</p>
          {state.detail ? (
            <p className="mt-1.5 font-mono text-[0.68rem] text-ash-600">{state.detail}</p>
          ) : null}
        </div>
      ) : null}

      {state.status === "done" && state.assay ? (
        <div className="mt-4 rounded-sm border border-verdigris-500 bg-verdigris-100 px-4 py-3">
          <p className="text-sm text-verdigris-700">{state.message}</p>
          {state.detail ? <p className="mt-1 text-xs text-ink-500">{state.detail}</p> : null}
          <a
            href={`/ledger/${state.assay.id}`}
            className="mt-3 inline-block rounded-sm border border-verdigris-700 px-3 py-1.5 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-verdigris-700 hover:bg-verdigris-700 hover:text-parchment-50"
          >
            Open the assay
          </a>
        </div>
      ) : null}
    </div>
  );
}