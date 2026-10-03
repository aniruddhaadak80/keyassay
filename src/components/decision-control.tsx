"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TrashIcon } from "@/components/icons";
import { DECISIONS } from "@/lib/types";

/**
 * Record a migration verdict, update the note, or tombstone the assay.
 *
 * Every action here is a real PATCH or DELETE against the same service layer the
 * MCP tools use, and each one appends to the seal chain, which is why the seal
 * shown after saving is different from the one before.
 */

const DECISION_LABELS: Record<string, string> = {
  "migrate-first": "Migrate first",
  "plan-hybrid": "Plan hybrid",
  monitor: "Monitor",
  accepted: "Accepted",
};

const DECISION_NOTES: Record<string, string> = {
  "migrate-first":
    "Stand up a hybrid ML-KEM key exchange before the modelled break year. Rotating the certificate alone does not protect captured traffic.",
  "plan-hybrid":
    "Add a post-quantum hybrid alongside the classical handshake so the migration is an increment rather than a rebuild.",
  monitor: "Key is adequate for the stated horizon. Re-assay whenever the horizon or the growth assumption changes.",
  accepted:
    "Residual risk accepted with the reason recorded. This does not weaken the seal: the decision and its grade are both sealed.",
};

export function DecisionControl({
  assayId,
  current,
  notes,
}: {
  assayId: string;
  current: string | null;
  notes: string | null;
}) {
  const router = useRouter();
  const [decision, setDecision] = useState(current ?? "");
  const [note, setNote] = useState(notes ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function patch(payload: Record<string, unknown>, successMessage: string) {
    setStatus("saving");
    setMessage(null);
    try {
      const response = await fetch(`/api/assays/${assayId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { seal?: string; error?: { message?: string } };
      if (!response.ok) {
        setStatus("error");
        setMessage(body.error?.message ?? `HTTP ${response.status}`);
        return false;
      }
      setStatus("saved");
      setMessage(successMessage);
      router.refresh();
      return true;
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "The request failed.");
      return false;
    }
  }

  async function saveDecision() {
    if (!decision) return;
    await patch({ decision }, `Decision "${DECISION_LABELS[decision]}" sealed to the audit chain.`);
  }

  async function saveNotes() {
    await patch({ notes: note }, "Note stored and sealed.");
  }

  async function remove() {
    setStatus("saving");
    setMessage(null);
    try {
      const response = await fetch(`/api/assays/${assayId}`, { method: "DELETE" });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setStatus("error");
        setMessage(body.error?.message ?? `HTTP ${response.status}`);
        setConfirming(false);
        return;
      }
      router.push("/ledger?deleted=true");
      router.refresh();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "The request failed.");
    }
  }

  return (
    <div className="mt-3">
      <fieldset>
        <legend className="sr-only">Migration decision</legend>
        <div className="space-y-1.5">
          {DECISIONS.map((entry) => (
            <label
              key={entry}
              className={`flex cursor-pointer items-start gap-2.5 rounded-sm border px-3 py-2 text-sm transition-colors ${
                decision === entry
                  ? "border-ultramarine-600 bg-ultramarine-100 text-ink-900"
                  : "border-parchment-300 text-ink-700 hover:border-parchment-400"
              }`}
            >
              <input
                type="radio"
                name="decision"
                value={entry}
                checked={decision === entry}
                onChange={() => setDecision(entry)}
                className="mt-1 accent-ultramarine-700"
              />
              <span>
                <span className="block">{DECISION_LABELS[entry]}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">
                  {DECISION_NOTES[entry]}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="button"
        onClick={saveDecision}
        disabled={!decision || status === "saving"}
        className="mt-3 w-full rounded-sm bg-ultramarine-700 px-4 py-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-parchment-50 hover:bg-ultramarine-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "saving" ? "Sealing" : "Seal this decision"}
      </button>

      <div className="mt-5 border-t border-parchment-200 pt-4">
        <label htmlFor="assay-notes" className="ledger-head block">
          Note
        </label>
        <textarea
          id="assay-notes"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={600}
          placeholder="Why this verdict? Who agreed it?"
          className="mt-1.5 w-full rounded-sm border border-parchment-400 bg-parchment-50 px-2.5 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:border-ultramarine-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={saveNotes}
          disabled={status === "saving"}
          className="mt-2 w-full rounded-sm border border-ink-900 px-4 py-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-ink-900 hover:bg-ink-900 hover:text-parchment-50 disabled:opacity-50"
        >
          Save note
        </button>
      </div>

      {message ? (
        <p
          role="status"
          className={`mt-3 text-sm ${status === "error" ? "text-retort-700" : "text-verdigris-700"}`}
        >
          {message}
        </p>
      ) : null}

      <div className="mt-5 border-t border-parchment-200 pt-4">
        {confirming ? (
          <div className="rounded-sm border border-retort-500 bg-retort-100 p-3">
            <p className="text-sm text-ink-700">
              Tombstone this assay? The row is retained so the audit chain still replays, but it leaves
              the active ledger.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={remove}
                disabled={status === "saving"}
                className="rounded-sm bg-retort-700 px-3 py-1.5 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-parchment-50 hover:bg-retort-600 disabled:opacity-50"
              >
                Confirm delete
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-sm border border-parchment-400 px-3 py-1.5 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-ink-700"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-2 rounded-sm border border-parchment-400 px-3 py-1.5 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-ink-500 hover:border-retort-500 hover:text-retort-700"
          >
            <TrashIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Delete assay
          </button>
        )}
      </div>
    </div>
  );
}