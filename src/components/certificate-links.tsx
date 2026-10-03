import { DownloadIcon } from "@/components/icons";

const FORMATS = [
  { value: "html", label: "HTML certificate", hint: "Self-contained, no scripts" },
  { value: "json", label: "JSON", hint: "Full result with every factor" },
  { value: "csv", label: "CSV", hint: "One row, for a spreadsheet" },
] as const;

/**
 * Certificate downloads.
 *
 * These are plain links to the export endpoint rather than a client-side blob
 * builder, so the browser downloads exactly what the server renders, and the
 * same URL can be pasted into a ticket.
 */
export function CertificateLinks({
  assayId,
  filenameBase,
}: {
  assayId: string;
  filenameBase: string;
}) {
  return (
    <ul className="mt-3 space-y-2">
      {FORMATS.map((format) => (
        <li key={format.value}>
          <a
            href={`/api/assays/${assayId}/certificate?format=${format.value}`}
            download={`${filenameBase}.${format.value}`}
            className="flex items-center justify-between gap-3 rounded-sm border border-parchment-300 px-3 py-2 text-sm text-ink-700 transition-colors hover:border-ultramarine-500 hover:text-ultramarine-700"
          >
            <span className="flex items-center gap-2">
              <DownloadIcon className="h-4 w-4" aria-hidden="true" />
              {format.label}
            </span>
            <span className="font-mono text-[0.62rem] text-ink-300">{format.hint}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}