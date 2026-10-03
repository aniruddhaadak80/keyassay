export default function Loading() {
  return (
    <div className="pt-16" role="status" aria-live="polite">
      <div className="h-4 w-32 animate-pulse rounded-sm bg-parchment-300" />
      <div className="mt-4 h-10 w-3/4 animate-pulse rounded-sm bg-parchment-200" />
      <div className="mt-3 h-4 w-1/2 animate-pulse rounded-sm bg-parchment-200" />
      <div className="sheet mt-8 h-48 animate-pulse rounded-sm bg-parchment-100" />
      <span className="sr-only">Loading the assay ledger</span>
    </div>
  );
}