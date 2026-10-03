import Link from "next/link";
import { footerLinks, siteConfig } from "@/lib/config";
import { GitHubLink, GitHubMark } from "./github-link";

/**
 * Shared footer.
 *
 * Carries the repository link on every viewport alongside the product routes,
 * and states plainly what the product is and is not, which for a tool that
 * models a security risk is part of the interface rather than fine print.
 */

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-parchment-300 bg-parchment-200/60">
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="ledger-grid gap-8">
          <div>
            <p className="font-mono text-sm font-semibold tracking-tight text-ultramarine-700">
              {siteConfig.name}
            </p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-500">{siteConfig.tagline}</p>
            <p className="mt-3 text-xs leading-relaxed text-ash-600">
              An assay is an engineering measurement of public key material, not an audit.
            </p>
          </div>

          <nav aria-label="Footer">
            <p className="ledger-head">Product</p>
            <ul className="mt-3 space-y-2">
              {footerLinks.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-ink-700 underline-offset-4 hover:text-ultramarine-700 hover:underline"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <p className="ledger-head">Live surfaces</p>
            <ul className="mt-3 space-y-2 text-sm text-ink-700">
              <li>
                <a
                  href={`${siteConfig.liveUrl}/api/health`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-4 hover:text-ultramarine-700 hover:underline"
                >
                  Health check
                </a>
              </li>
              <li>
                <a
                  href={`${siteConfig.liveUrl}/api/tools`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-4 hover:text-ultramarine-700 hover:underline"
                >
                  Tool catalogue
                </a>
              </li>
              <li>
                <a
                  href={`${siteConfig.liveUrl}/mcp.json`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-4 hover:text-ultramarine-700 hover:underline"
                >
                  MCP manifest
                </a>
              </li>
              <li>
                <a
                  href={siteConfig.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 underline-offset-4 hover:text-ultramarine-700 hover:underline"
                >
                  <GitHubMark className="h-3.5 w-3.5" />
                  {siteConfig.repositoryOwner}/{siteConfig.repositorySlug}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="ledger-head">Sources</p>
            <ul className="mt-3 space-y-2 text-xs text-ash-600">
              <li>
                Live TLS handshake, performed by this server against the host you name.
              </li>
              <li>
                Certificate Transparency records via{" "}
                <a
                  href="https://crt.sh"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  crt.sh
                </a>
                .
              </li>
              <li>
                Citation metadata via{" "}
                <a
                  href="https://arxiv.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  arXiv
                </a>
                .
              </li>
            </ul>
          </div>
        </div>

        <div className="rule-double mt-10 flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-ash-600">
            {siteConfig.name} · {year} · MIT licensed
          </p>
          <GitHubLink variant="outline" />
        </div>

        <p className="mt-6 max-w-4xl text-xs leading-relaxed text-ash-600">
          <strong className="font-semibold text-ink-700">Safety and honest limits.</strong> Keyassay
          reports what can be measured from a public TLS handshake and published cost estimates. Break
          years are outputs of a stated growth assumption, not predictions, and a certificate says
          nothing about implementation bugs, traffic analysis or operational security. It is not a
          penetration test, an audit opinion or a compliance attestation. Verify independently before
          acting on it.
        </p>
      </div>
    </footer>
  );
}