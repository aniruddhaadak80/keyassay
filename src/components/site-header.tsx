"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MenuIcon, CloseIcon } from "@/components/icons";
import { navItems, siteConfig } from "@/lib/config";
import { GitHubLink } from "./github-link";

/**
 * Shared navigation.
 *
 * The repository link is present in the desktop bar and in the mobile MenuIcon,
 * which is the requirement that matters: the source is reachable on any
 * viewport, from the same single configuration value.
 */

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile MenuIcon on navigation so a tap never leaves it covering the page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-parchment-300 bg-parchment-100/95 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="group flex items-baseline gap-2"
          aria-label={`${siteConfig.name} home`}
        >
          <span className="font-mono text-base font-semibold tracking-tight text-ultramarine-700">
            {siteConfig.name}
          </span>
          <span className="hidden font-mono text-[0.62rem] uppercase tracking-[0.18em] text-ink-300 sm:inline">
            assay office
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {navItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-sm px-3 py-2 font-mono text-[0.72rem] uppercase tracking-[0.12em] transition-colors ${
                  active
                    ? "bg-ultramarine-100 text-ultramarine-700"
                    : "text-ink-500 hover:bg-parchment-200 hover:text-ink-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <GitHubLink variant="quiet" className="ml-2" />
        </nav>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="inline-flex items-center gap-2 rounded-sm border border-ink-200 px-3 py-2 font-mono text-[0.72rem] uppercase tracking-[0.12em] text-ink-700 lg:hidden"
        >
          {open ? <CloseIcon className="h-4 w-4" aria-hidden="true" /> : <MenuIcon className="h-4 w-4" aria-hidden="true" />}
          {open ? "Close" : "Menu"}
        </button>
      </div>

      {open ? (
        <div id="mobile-nav" className="border-t border-parchment-300 bg-parchment-50 lg:hidden">
          <nav aria-label="Mobile" className="mx-auto flex w-full max-w-6xl flex-col px-4 py-3 sm:px-6">
            {navItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`border-b border-parchment-200 py-3 font-mono text-sm uppercase tracking-[0.12em] ${
                    active ? "text-ultramarine-700" : "text-ink-700"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <GitHubLink variant="outline" className="my-4 justify-center" />
          </nav>
        </div>
      ) : null}
    </header>
  );
}