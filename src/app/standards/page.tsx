import type { Metadata } from "next";
import Link from "next/link";
import { COST_MODELS } from "@/lib/engine/constants";
import { siteConfig } from "@/lib/config";
import { DataRow } from "@/components/grade-mark";
import { SectionHeading } from "@/components/states";
import { LiteraturePanels } from "@/components/literature-panels";
import { CitationCheck } from "@/components/citation-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cost model and standards",
  description:
    "Every constant the assay engine uses, with its published source, plus live verification that the cited papers still say what the engine claims.",
  alternates: { canonical: `${siteConfig.liveUrl}/standards` },
};

/**
 * The method page.
 *
 * A security tool that says "this key breaks in 2049" owes the reader its
 * arithmetic and the authority for every number in it. So this page publishes
 * each constant, names its source, and re-checks the two papers against arXiv on
 * every load rather than trusting a hard-coded citation string.
 */
export default async function StandardsPage() {

  return (
    <div className="pt-10">
      <SectionHeading
        eyebrow="Method"
        title="The cost model, and where every number comes from"
        lede="Two classes of input go into a grade. Published constants are facts about cryptographic hardware and are cited. Risk assumptions are yours, and are labelled as such everywhere they appear."
      />

      <section className="mt-8">
        <h2 className="text-xl text-ink-900">Published constants</h2>
        <div className="mt-4 space-y-4">
          <article className="sheet rounded-sm p-5">
            <h3 className="text-base text-ink-900">Quantum break cost of factoring</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              For an n-bit RSA modulus, Gidney and Ekerå give the abstract-circuit cost as{" "}
              <code className="rounded-sm bg-parchment-200 px-1.5 py-0.5 font-mono text-xs text-ink-900">
                3n + 0.002·n·lg(n)
              </code>{" "}
              logical qubits and{" "}
              <code className="rounded-sm bg-parchment-200 px-1.5 py-0.5 font-mono text-xs text-ink-900">
                0.3n³ + 0.0005·n³·lg(n)
              </code>{" "}
              Toffoli gates. The engine evaluates exactly these formulas, which is why it reproduces their
              numbers at RSA-2048 rather than approximating them.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {COST_MODELS.map((model) => (
                <div key={model.id} className="rounded-sm border border-parchment-300 p-4">
                  <p className="font-mono text-sm text-ultramarine-700">{model.id}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-500">{model.label}</p>
                  <p className="mt-2 font-mono text-2xl tabular text-ink-900">
                    {model.rsa2048PhysicalQubits.toLocaleString("en-US")}
                  </p>
                  <p className="font-mono text-[0.66rem] text-ash-600">physical qubits for RSA-2048</p>
                  <a
                    href={`https://arxiv.org/abs/${model.arxivId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block font-mono text-xs text-ultramarine-700 underline underline-offset-4"
                  >
                    arXiv:{model.arxivId}
                  </a>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-ash-600">
              The engine scales between key sizes using the ratio of these circuit costs at the key&apos;s
              own equivalent modulus size, rather than multiplying a logical count by a guessed
              error-correction ratio. That is what makes the 2048-bit case reproduce both published
              figures exactly.
            </p>
          </article>

          <article className="sheet rounded-sm p-5">
            <h3 className="text-base text-ink-900">Classical security equivalences</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              NIST SP 800-57 Part 1 Rev. 5 gives the equivalence classes the engine maps keys onto. An
              elliptic-curve key is translated to the RSA modulus of equal classical strength, so P-256
              is assessed as though it were RSA-3072. That translation is a documented simplification:
              the true elliptic-curve circuit has a different constant factor than the RSA one.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-parchment-300">
                    <th scope="col" className="ledger-head px-2 py-2">Key</th>
                    <th scope="col" className="ledger-head px-2 py-2 text-right">Classical bits</th>
                    <th scope="col" className="ledger-head px-2 py-2 text-right">Assessed as RSA</th>
                    <th scope="col" className="ledger-head hidden px-2 py-2 sm:table-cell">Grover margin</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["RSA 1024", "80", "1024"],
                    ["RSA 2048", "112", "2048"],
                    ["RSA 3072", "128", "3072"],
                    ["RSA 4096", "≈152", "4096"],
                    ["ECDSA P-256 / Ed25519", "128", "3072"],
                    ["ECDSA P-384", "192", "7680"],
                    ["ECDSA P-521", "256", "15360"],
                  ].map((row) => (
                    <tr key={row[0]} className="border-b border-parchment-200 last:border-b-0">
                      <th scope="row" className="px-2 py-2 text-left font-normal text-ink-900">{row[0]}</th>
                      <td className="px-2 py-2 text-right font-mono tabular text-ink-700">{row[1]}</td>
                      <td className="px-2 py-2 text-right font-mono tabular text-ink-700">{row[2]}</td>
                      <td className="hidden px-2 py-2 text-right font-mono tabular text-ink-700 sm:table-cell">
                        {Number(row[1]) >= 112 ? `${Math.floor(Number(row[1]) / 2)} bits quantum` : "below floor"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="sheet rounded-sm p-5">
            <h3 className="text-base text-ink-900">The compliance clock</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              NIST IR 8547 sets two dates that the engine treats as hard reference points:{" "}
              <strong className="text-ink-900">112-bit-strength public keys are deprecated after 2030</strong>{" "}
              and{" "}
              <strong className="text-ink-900">
                all quantum-vulnerable public key algorithms are disallowed after 2035
              </strong>
              . A certificate whose validity window extends past its date cannot be re-issued unchanged
              once the standard lands, which is what the lifetime-compliance factor measures.
            </p>
          </article>
        </div>
      </section>

      <LiteraturePanels />
      <section className="mt-10">
        <h2 className="text-xl text-ink-900">What the seven factors weigh</h2>
        <div className="mt-4 space-y-3">
          {[
            ["harvest-window", 0.24, "Years between the modelled break and the confidentiality horizon. The decisive factor."],
            ["shor-cost", 0.22, "How much hardware the break needs, mapped onto the NIST disallow clock."],
            ["asymmetric-strength", 0.2, "Classical strength of the leaf key against your configured floor."],
            ["lifetime-compliance", 0.12, "Whether the certificate outlives the IR 8547 deprecation and disallow dates."],
            ["chain-exposure", 0.1, "How many issuing CA keys fall inside the horizon. Each is a harvest target."],
            ["protocol-cipher", 0.06, "Negotiated TLS version and cipher suite. Modern transport, long-lived key."],
            ["post-quantum-readiness", 0.06, "Share of the chain already signed post-quantum."],
          ].map(([id, weight, description]) => (
            <div key={String(id)} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-parchment-200 pb-2.5">
              <span className="w-44 font-mono text-xs text-ultramarine-700">{String(id)}</span>
              <span className="w-14 font-mono text-xs tabular text-ink-500">{Number(weight) * 100}%</span>
              <span className="min-w-0 flex-1 text-sm leading-relaxed text-ink-700">{String(description)}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-ash-600">
          Weights sum to 1.0. The composite score is the weighted sum of each factor&apos;s normalised
          value, scaled to 0–100. Grades: bullion at 80+, sterling at 62+, base at 42+, corroded below.
        </p>
      </section>

      <section className="mt-10">
        <div className="sheet rounded-sm p-5">
          <p className="ledger-head">Try the engine directly</p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
            Everything on this page is also a plain HTTP call, no key required.
          </p>
          <dl className="mt-3">
            <DataRow
              label="Break cost for one key"
              value={
                <a
                  href={`${siteConfig.liveUrl}/api/engine?key=rsa&bits=2048`}
                  className="underline underline-offset-4"
                >
                  /api/engine?key=rsa&amp;bits=2048
                </a>
              }
              mono={false}
            />
            <DataRow
              label="Full live assay"
              value={
                <a href={`${siteConfig.liveUrl}/api/engine`} className="underline underline-offset-4">
                  POST /api/engine {"{ host }"}
                </a>
              }
              mono={false}
            />
            <DataRow
              label="Citation check"
              value={
                <a href={`${siteConfig.liveUrl}/api/standards`} className="underline underline-offset-4">
                  /api/standards
                </a>
              }
              mono={false}
            />
          </dl>
          <p className="mt-4 border-t border-parchment-200 pt-3 text-xs leading-relaxed text-ash-600">
            Read the implementation on{" "}
            <Link href={siteConfig.repository} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
              GitHub
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="mt-10">
        <div className="sheet rounded-sm p-5">
          <p className="ledger-head">Audit any citation</p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
            The panel above checks the two papers this engine rests on. Put any other identifier in and
            the same code path reports what arXiv actually holds for it, so a reference can be checked
            rather than taken on trust.
          </p>
          <CitationCheck />
        </div>
      </section>
    </div>
  );
}
