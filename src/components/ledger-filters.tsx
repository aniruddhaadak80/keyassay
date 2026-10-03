"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FilterIcon } from "@/components/icons";

const GRADES = [
  { value: "", label: "All grades" },
  { value: "bullion", label: "Bullion" },
  { value: "sterling", label: "Sterling" },
  { value: "base", label: "Base" },
  { value: "corroded", label: "Corroded" },
] as const;

const DECISIONS = [
  { value: "", label: "Any decision" },
  { value: "migrate-first", label: "Migrate first" },
  { value: "plan-hybrid", label: "Plan hybrid" },
  { value: "monitor", label: "Monitor" },
  { value: "accepted", label: "Accepted" },
] as const;

const SORTS = [
  { value: "recent", label: "Newest first" },
  { value: "exposure", label: "Soonest break" },
  { value: "score", label: "Highest score" },
  { value: "host", label: "Host A–Z" },
] as const;

/**
 * Ledger filters.
 *
 * Every control writes to the URL rather than to component state, so the view is
 * shareable, survives a refresh, and is what the server renders from. Typing in
 * the search box debounces into the URL so a search does not fire a request per
 * keystroke.
 */
export function LedgerFilters({
  grade,
  decision,
  search,
  sort,
  page,
  totalPages,
  total,
}: {
  grade: string;
  decision: string;
  search: string;
  sort: string;
  page: number;
  totalPages: number;
  total: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [term, setTerm] = useState(search);

  useEffect(() => {
    setTerm(search);
  }, [search]);

  const push = useCallback(
    (changes: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      // Any FilterIcon change resets to the first page, otherwise a FilterIcon can land
      // the reader on an empty page three.
      next.delete("page");
      router.push(`/ledger?${next.toString()}`);
    },
    [params, router],
  );

  useEffect(() => {
    if (term === search) return;
    const timer = setTimeout(() => {
      push({ search: term.trim() });
    }, 350);
    return () => clearTimeout(timer);
  }, [term, search, push]);

  return (
    <div className="sheet rounded-sm p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 pb-2.5">
          <FilterIcon className="h-4 w-4 text-ink-400" aria-hidden="true" />
          <span className="ledger-head">Filter</span>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="filter-grade" className="ledger-head">
            Grade
          </label>
          <select
            id="filter-grade"
            value={grade}
            onChange={(event) => push({ grade: event.target.value })}
            className="rounded-sm border border-parchment-400 bg-parchment-50 px-2.5 py-1.5 text-sm text-ink-900 focus:border-ultramarine-600 focus:outline-none"
          >
            {GRADES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="filter-decision" className="ledger-head">
            Decision
          </label>
          <select
            id="filter-decision"
            value={decision}
            onChange={(event) => push({ decision: event.target.value })}
            className="rounded-sm border border-parchment-400 bg-parchment-50 px-2.5 py-1.5 text-sm text-ink-900 focus:border-ultramarine-600 focus:outline-none"
          >
            {DECISIONS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-1 flex-col gap-1 sm:min-w-48">
          <label htmlFor="filter-search" className="ledger-head">
            Search
          </label>
          <input
            id="filter-search"
            type="search"
            value={term}
            placeholder="host, label or issuer"
            onChange={(event) => setTerm(event.target.value)}
            className="rounded-sm border border-parchment-400 bg-parchment-50 px-2.5 py-1.5 text-sm text-ink-900 placeholder:text-ink-300 focus:border-ultramarine-600 focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="filter-sort" className="ledger-head">
            Sort
          </label>
          <select
            id="filter-sort"
            value={sort}
            onChange={(event) => push({ sort: event.target.value })}
            className="rounded-sm border border-parchment-400 bg-parchment-50 px-2.5 py-1.5 text-sm text-ink-900 focus:border-ultramarine-600 focus:outline-none"
          >
            {SORTS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>

        <p className="ml-auto pb-2.5 font-mono text-xs tabular text-ink-500">
          {total} result{total === 1 ? "" : "s"}
          {totalPages > 1 ? ` · page ${page}/${totalPages}` : ""}
        </p>
      </div>
    </div>
  );
}