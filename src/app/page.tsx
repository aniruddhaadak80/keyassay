import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRightIcon, ShieldQuestionIcon, ClockIcon, ScrollIcon } from "@/components/icons";
import { getRepository } from "@/lib/db";
import { getSessionId } from "@/lib/session";
import { loadPolicy, rerateStored } from "@/lib/service";
import { ASSAY_ENGINE_CITATIONS, DEFAULT_POLICY, ENGINE_VERSION } from "@/lib/engine/assay";
import { siteConfig } from "@/lib/config";
import { AssayForm } from "@/components/assay-form";
import { GitHubLink } from "@/components/github-link";
import { GradeMark } from "@/components/grade-mark";
import { LandingResearchPanel } from "@/components/literature-panels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Keyassay â€” know the year your TLS stops being secret",
  description:
    "Submit a hostname. Keyassay performs a real TLS handshake, reads the certificate chain and Certificate Transparency history, then certifies how long the harvested traffic stays unreadable to a quantum computer.",
  alternates: { canonical: `${siteConfig.liveUrl}/` },
};

/**
 * The landing page.
 *
 * The first screen is the tool itself, not a marketing hero: the assay form is
 * above the fold and the struck grade explanation sits directly underneath it,
 * so the product's value is legible before any scrolling.
 */
export default async function LandingPage() {
  const ledgerSummary = await summariseLedger().catch(() => null);

  return (
    <div className="pt-10 sm:pt-14">
      <section className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
        <div>
          <p className="ledger-head">Post-quantum migration triage</p>
          <h1 className="mt-3 text-4xl leading-[1.08] text-ink-900 sm:text-5xl">
            Harvest now, decrypt later is not a future problem.
            <span className="block text-ultramarine-700">It is a logging decision you already made.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-500">
            Every TLS session an adversary records today becomes readable the day a
            cryptographically relevant quantum computer exists â€” if the key it protects has not been
            replaced by then. Rotating the certificate does not help, because the captured traffic is
            already in their hands. Keyassay names the year each of your public endpoints stops being
            secret, and certifies the answer with a sealed, replayable record.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a
              href="#assay"
              className="inline-flex items-center gap-2 rounded-sm bg-ultramarine-700 px-5 py-3 font-mono text-xs uppercase tracking-[0.12em] text-parchment-50 hover:bg-ultramarine-600"
            >
              Assay an endpoint
              <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
            </a>
            <GitHubLink variant="outline" label="View source" />
          </div>

          <dl className="mt-8 grid gap-x-8 gap-y-4 sm:grid-cols-3">
            <div>
              <dt className="ledger-head">Cost model</dt>
              <dd className="mt-1 text-sm leading-relaxed text-ink-700">
                Gidney &amp; EkerÃ¥ {`arXiv:1905.09749`}, revised by Gidney {`arXiv:2505.15917`}. Both
                verified against arXiv at runtime.
              </dd>
            </div>
            <div>
              <dt className="ledger-head">Compliance clock</dt>
              <dd className="mt-1 text-sm leading-relaxed text-ink-700">
                NIST IR 8547: 112-bit public keys deprecated after 2030, all quantum-vulnerable public
                key algorithms disallowed after 2035.
              </dd>
            </div>
            <div>
              <dt className="ledger-head">Engine</dt>
              <dd className="mt-1 font-mono text-sm text-ink-700">
                {ENGINE_VERSION} Â· seven weighted factors, every one cited
              </dd>
            </div>
          </dl>
        </div>

        <div id="assay" className="scroll-mt-24">
          <AssayForm />
          {ledgerSummary ? (
            <p className="mt-3 text-xs text-ink-400">
              {ledgerSummary.count} assay{ledgerSummary.count === 1 ? "" : "s"} in this session Â·{" "}
              <Link href="/ledger" className="underline underline-offset-4">
                open the ledger
              </Link>
            </p>
          ) : null}
        </div>
      </section>

      <section className="rule-double mt-16 pt-10">
        <p className="ledger-head">How a grade is struck</p>
        <h2 className="mt-2 max-w-3xl text-2xl text-ink-900">
          Four marks, assigned by a deterministic engine, each one showing its arithmetic.
        </h2>
        <div className="ledger-grid mt-7 gap-5">
          {(
            [
              {
                grade: "bullion",
                head: "Quantum-resistant",
                body: "A post-quantum signature is already deployed, or the key cannot plausibly be broken before your data must expire.",
              },
              {
                grade: "sterling",
                head: "Strong",
                body: "Adequate strength with margin. Migration fits the normal replacement cycle rather than an emergency.",
              },
              {
                grade: "base",
                head: "Exposed in horizon",
                body: "A CRQC is modelled to break the key inside the confidentiality horizon you set. Start planning the hybrid migration.",
              },
              {
                grade: "corroded",
                head: "Exposure is live",
                body: "Traffic captured today is assumed to be readable before it must expire. Treat it as a harvest-now-decrypt-later incident.",
              },
            ] as const
          ).map((entry) => (
            <div key={entry.grade} className="sheet rounded-sm p-5">
              <GradeMark grade={entry.grade} size="md" strike />
              <h3 className="mt-4 text-base text-ink-900">{entry.head}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{entry.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-14">
        <div className="grid gap-5 lg:grid-cols-3">
          <article className="sheet rounded-sm p-5">
            <ScanIcon />
            <h3 className="mt-3 text-base text-ink-900">A real handshake, not a lookup</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
              The server opens a TCP connection to port 443 and reads the certificate chain the
              endpoint actually presents, then walks its issuerCertificate links. If a host is down,
              the assay fails and says so.
            </p>
          </article>
          <article className="sheet rounded-sm p-5">
            <ClockIcon />
            <h3 className="mt-3 text-base text-ink-900">The horizon, not the expiry</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
              Exposure is measured against the year your data must stay secret. A certificate that
              expires in ninety days does not protect a session captured today from being decrypted
              in twenty years.
            </p>
          </article>
          <article className="sheet rounded-sm p-5">
            <ScrollIcon />
            <h3 className="mt-3 text-base text-ink-900">A certificate you can defend</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
              Every mutation appends to a SHA-384 hash chain. Download the certificate, replay the
              chain months later, and prove the grade was never quietly edited.
            </p>
          </article>
        </div>
      </section>

      <LandingResearchPanel />

      <section className="mt-14">
        <div className="sheet rounded-sm p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-xl">
              <p className="ledger-head">Everything runs in the open</p>
              <h2 className="mt-2 text-2xl text-ink-900">
                The engine, the seals and the agent tools are all in the repository.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-500">
                Nine MCP tools over one service layer: read the ledger, assay a live host, re-rate
                against a different risk position, seal a decision, verify a chain, export a
                certificate. No API keys, no accounts, no third party to sign up for.
              </p>
              <ul className="mt-4 space-y-1.5 text-sm text-ink-700">
                <li>
                  <a href="/agent" className="underline underline-offset-4">
                    Try the agent console
                  </a>{" "}
                  â€” preloaded calls against the live deployment
                </li>
                <li>
                  <a href="/horizon" className="underline underline-offset-4">
                    Move the horizon dial
                  </a>{" "}
                  â€” re-rate the whole ledger
                </li>
                <li>
                  <a href="/standards" className="underline underline-offset-4">
                    Read the cost model
                  </a>{" "}
                  â€” every constant, with its citation verified live
                </li>
              </ul>
            </div>
            <div className="flex flex-col gap-3">
              <GitHubLink variant="solid" label="Star on GitHub" />
              <a
                href={`${siteConfig.liveUrl}/api/tools`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-sm border border-ink-900 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-ink-900 hover:bg-ink-900 hover:text-parchment-50"
              >
                <ShieldQuestionIcon className="h-4 w-4" aria-hidden="true" />
                Tool catalogue
              </a>
            </div>
          </div>
          <p className="mt-6 border-t border-parchment-300 pt-4 font-mono text-[0.66rem] leading-relaxed text-ash-600">
            {ASSAY_ENGINE_CITATIONS.ir8547} Â· default horizon {DEFAULT_POLICY.horizonYear} Â·{" "}
            {ASSayCitationsNote()}
          </p>
        </div>
      </section>
    </div>
  );
}

function ASSayCitationsNote() {
  return `cost anchor ${ASSAY_ENGINE_CITATIONS.capability}`;
}

function ScanIcon() {
  return <ShieldQuestionIcon className="h-5 w-5 text-ultramarine-600" aria-hidden="true" />;
}

async function summariseLedger(): Promise<{ count: number } | null> {
  try {
    const sessionId = await getSessionId();
    const repo = await getRepository();
    const count = await repo.countAssays(sessionId, { limit: 1, offset: 0, includeDeleted: false });
    // Touch the policy so a cold start warms both adapters before first use.
    await loadPolicy({ repo, sessionId });
    void rerateStored;
    return { count };
  } catch {
    return null;
  }
}
