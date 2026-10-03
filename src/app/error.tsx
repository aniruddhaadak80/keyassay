"use client";

import Link from "next/link";
import { siteConfig } from "@/lib/config";
import { GitHubLink } from "@/components/github-link";

/** Root-level error boundary: never leak a stack trace to the visitor. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-4 py-16">
      <p className="ledger-head">Something went wrong</p>
      <h1 className="mt-3 text-3xl text-ink-900">This page could not be rendered.</h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-500">
        The error has been logged on the server. No stack trace or environment detail is shown here
        by design. Try again, or start from the ledger.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-sm bg-ultramarine-700 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-parchment-50 hover:bg-ultramarine-600"
        >
          Try again
        </button>
        <Link
          href="/ledger"
          className="rounded-sm border border-ink-900 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-ink-900 hover:bg-ink-900 hover:text-parchment-50"
        >
          Open the ledger
        </Link>
        <GitHubLink variant="quiet" label="Report an issue" />
      </div>
      <p className="mt-8 font-mono text-[0.66rem] text-ash-600">{siteConfig.repository}/issues</p>
    </main>
  );
}