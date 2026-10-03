import { AlertTriangleIcon, InboxIcon, LoaderIcon } from "@/components/icons";
import Link from "next/link";

/**
 * Truthful state components.
 *
 * Loading, empty and error are first-class screens rather than spinners bolted
 * onto a component, and the error state always says what to do next and never
 * shows a stack trace.
 */

export function LoadingState({ label = "Assaying" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="sheet flex items-center gap-3 rounded-sm px-5 py-8 text-ink-500"
    >
      <LoaderIcon className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span className="font-mono text-xs uppercase tracking-[0.12em]">{label}…</span>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="sheet rounded-sm px-6 py-12 text-center">
      <InboxIcon className="mx-auto h-6 w-6 text-ink-300" aria-hidden="true" />
      <h3 className="mt-4 text-lg text-ink-900">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-500">{body}</p>
      {action ? (
        <Link
          href={action.href}
          className="mt-6 inline-block rounded-sm bg-ultramarine-700 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-parchment-50 hover:bg-ultramarine-600"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function ErrorState({
  title = "That assay could not be completed",
  message,
  detail,
  retryHref,
}: {
  title?: string;
  message: string;
  detail?: string | null;
  retryHref?: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-sm border border-retort-500 bg-retort-100 px-5 py-6"
    >
      <div className="flex items-start gap-3">
        <AlertTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-retort-700" aria-hidden="true" />
        <div>
          <h3 className="text-base text-retort-700">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-ink-700">{message}</p>
          {detail ? (
            <p className="mt-2 border-l-2 border-retort-500 pl-3 font-mono text-[0.68rem] leading-relaxed text-ash-600">
              {detail}
            </p>
          ) : null}
          {retryHref ? (
            <Link
              href={retryHref}
              className="mt-4 inline-block rounded-sm border border-retort-700 px-3 py-1.5 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-retort-700 hover:bg-retort-700 hover:text-parchment-50"
            >
              Try again
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The page title block.
 *
 * This renders an h1 because on every route that uses it, it *is* the page's
 * primary heading: skipping straight to h2 leaves assistive technology and search
 * engines without a top-level heading to orient by. Panels beneath it stay at
 * h2 and below.
 */
export function SectionHeading({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
}) {
  return (
    <div className="mb-6">
      <p className="ledger-head">{eyebrow}</p>
      <h1 className="mt-1.5 text-3xl text-ink-900">{title}</h1>
      {lede ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-500">{lede}</p> : null}
    </div>
  );
}