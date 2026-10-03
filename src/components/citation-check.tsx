"use client";

import { useId, useState } from "react";
import type { CitationVerification } from "@/lib/types";

/**
 * Check any arXiv identifier against the record arXiv actually holds.
 *
 * The engine cites two papers, and the landing page checks those two. This is
 * the other half of the same idea: put any identifier in and see what arXiv
 * returns for it, so a reader can audit a citation the product made rather than
 * only the ones it chose.
 */

type State =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "done"; result: CitationVerification }
  | { phase: "failed"; message: string };

/** Mirrors the server's own rule, so the field can reject nonsense before a round trip. */
const ARXIV_ID = /^\d{4}\.\d{4,5}$/;

export function CitationCheck() {
  const fieldId = useId();
  const statusId = useId();
  const [value, setValue] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });

  const trimmed = value.trim().replace(/^arxiv:/i, "");
  const malformed = trimmed.length > 0 && !ARXIV_ID.test(trimmed);

  async function check(event: React.FormEvent) {
    event.preventDefault();
    if (!ARXIV_ID.test(trimmed)) {
      setState({ phase: "failed", message: "That does not look like an arXiv identifier." });
      return;
    }
    setState({ phase: "checking" });
    try {
      const response = await fetch("/api/standards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ arxivId: trimmed }),
      });
      const body = (await response.json()) as {
        data?: { verification?: CitationVerification };
        error?: { message?: string };
      };
      if (!response.ok || !body.data?.verification) {
        setState({
          phase: "failed",
          message: body.error?.message ?? "arXiv could not be reached for this request.",
        });
        return;
      }
      setState({ phase: "done", result: body.data.verification });
    } catch {
      setState({ phase: "failed", message: "The request could not be completed." });
    }
  }

  const result = state.phase === "done" ? state.result : null;

  return (
    <form onSubmit={check} className="mt-3" noValidate>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={fieldId} className="block font-mono text-xs uppercase tracking-[0.1em] text-ink-500">
            Any arXiv identifier
          </label>
          <input
            id={fieldId}
            name="arxivId"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder="2505.15917"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (state.phase !== "idle") setState({ phase: "idle" });
            }}
            aria-describedby={statusId}
            aria-invalid={malformed || undefined}
            className="mt-1.5 w-full rounded-sm border border-parchment-300 bg-parchment-50 px-3 py-2 font-mono text-sm text-ink-900 outline-none focus:border-ultramarine-700 focus:ring-2 focus:ring-ultramarine-700/30"
          />
        </div>
        <button
          type="submit"
          disabled={state.phase === "checking"}
          className="mt-6 rounded-sm bg-ultramarine-700 px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] text-parchment-50 transition-colors hover:bg-ultramarine-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.phase === "checking" ? "Checking" : "Check citation"}
        </button>
      </div>

      <p id={statusId} role="status" aria-live="polite" className="mt-2 min-h-5 font-mono text-xs text-ash-600">
        {malformed ? "Identifiers look like 2505.15917." : null}
        {state.phase === "failed" ? state.message : null}
        {state.phase === "done" && result
          ? result.found
            ? `arXiv holds ${result.arxivId}: ${result.title ?? "no title returned"}.`
            : `arXiv has no entry for ${result.arxivId}.`
          : null}
      </p>

      {result?.found ? (
        <div className="mt-3 border-t border-parchment-200 pt-3">
          <p className="text-sm leading-relaxed text-ink-900">{result.title}</p>
          {result.authors.length > 0 ? (
            <p className="mt-1 font-mono text-[0.68rem] text-ash-600">
              {result.authors.slice(0, 4).join(", ")}
              {result.authors.length > 4 ? " and others" : ""}
              {result.published ? ` · submitted ${result.published.slice(0, 10)}` : ""}
            </p>
          ) : null}
          {result.reason ? (
            <p className="mt-2 font-mono text-[0.66rem] text-retort-700">{result.reason}</p>
          ) : null}
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block font-mono text-xs text-ultramarine-700 underline underline-offset-4"
          >
            Open on arXiv
          </a>
        </div>
      ) : null}
    </form>
  );
}