import Link from "next/link";
import { siteConfig } from "@/lib/config";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col justify-center py-16">
      <p className="ledger-head">404</p>
      <h1 className="mt-3 text-3xl text-ink-900">No such page.</h1>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-500">
        If you followed a link to an assay, remember that records belong to the browser session that
        created them. A different session cannot see them, by design.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/"
          className="rounded-sm bg-ultramarine-700 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-parchment-50 hover:bg-ultramarine-600"
        >
          Back to the assay office
        </Link>
        <Link
          href="/ledger"
          className="rounded-sm border border-ink-900 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-ink-900 hover:bg-ink-900 hover:text-parchment-50"
        >
          Open the ledger
        </Link>
      </div>
      <p className="mt-8 font-mono text-[0.66rem] text-ash-600">{siteConfig.repository}</p>
    </div>
  );
}