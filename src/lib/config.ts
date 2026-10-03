/**
 * Single source of truth for site identity.
 *
 * The repository URL lives here and nowhere else. The shared header, the mobile
 * menu, the landing CTA and the shared footer all read it from this module, so
 * there is no way for them to drift apart or to point somewhere that does not
 * exist.
 *
 * NEXT_PUBLIC_SITE_URL is injected at build time by Vercel and falls back to
 * http://localhost:3000 for local development and tests.
 */

function normaliseBase(value: string | undefined, fallback: string): string {
  const candidate = (value ?? "").trim();
  if (!candidate) return fallback;
  return candidate.replace(/\/+$/, "");
}

export const siteConfig = {
  name: "Keyassay",
  /** One-line outcome, used in metadata, the README header and the footer. */
  tagline: "Know the year your TLS stops being secret.",
  description:
    "Keyassay performs a real TLS handshake with a public endpoint, pulls its Certificate Transparency history, and certifies how long the harvested traffic stays unreadable to a cryptographically relevant quantum computer.",
  liveUrl: normaliseBase(
    process.env.NEXT_PUBLIC_SITE_URL,
    "http://localhost:3000",
  ),
  repository: "https://github.com/aniruddhaadak80/keyassay",
  repositoryOwner: "aniruddhaadak80",
  repositorySlug: "keyassay",
  license: "MIT",
} as const;

export type NavItem = { href: string; label: string; external?: boolean };

export const navItems: readonly NavItem[] = [
  { href: "/ledger", label: "Ledger" },
  { href: "/horizon", label: "Horizon" },
  { href: "/standards", label: "Standards" },
  { href: "/agent", label: "Agent" },
  { href: "/export", label: "Export" },
  { href: "/settings", label: "Settings" },
] as const;

export const footerLinks: readonly NavItem[] = [
  { href: "/ledger", label: "Assay ledger" },
  { href: "/horizon", label: "Horizon dial" },
  { href: "/standards", label: "Cost model" },
  { href: "/agent", label: "Agent console" },
  { href: "/export", label: "Export centre" },
  { href: "/verify", label: "Verify a seal" },
  { href: "/settings", label: "Settings" },
] as const;

export function absoluteUrl(path: string): string {
  return `${siteConfig.liveUrl}${path.startsWith("/") ? path : `/${path}`}`;
}