import type { Metadata } from "next";
import { getRepository } from "@/lib/db";
import { getSessionId } from "@/lib/session";
import { loadPolicy } from "@/lib/service";
import { DEFAULT_POLICY } from "@/lib/engine/assay";
import { COST_MODELS } from "@/lib/engine/constants";
import { SectionHeading } from "@/components/states";
import { PolicyForm } from "@/components/policy-form";
import { ASSAY_ENGINE_CITATIONS } from "@/lib/engine/assay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
  description:
    "Set your confidentiality horizon, the published cost anchor, and the qubit growth assumption the engine rates every assay against.",
};

export default async function SettingsPage() {
  const sessionId = await getSessionId();
  const repo = await getRepository();
  const policy = await loadPolicy({ repo, sessionId });

  return (
    <div className="pt-10">
      <SectionHeading
        eyebrow="Configuration"
        title="Your risk position"
        lede="Four assumptions decide every grade in this ledger. They are stored against your session, applied by the server, and printed on every certificate so a reader knows what produced the number."
      />

      <PolicyForm
        current={{
          horizonYear: policy.horizonYear,
          costModel: policy.costModel,
          capabilityBaseQubits: policy.capabilityBaseQubits,
          capabilityGrowth: policy.capabilityGrowth,
          minimumClassicalBits: policy.minimumClassicalBits,
        }}
        defaults={DEFAULT_POLICY}
        costModels={COST_MODELS.map((model) => ({
          id: model.id,
          rsa2048PhysicalQubits: model.rsa2048PhysicalQubits,
        }))}
      />

      <section className="mt-10 grid gap-5 lg:grid-cols-2">
        <div className="sheet rounded-sm p-5">
          <p className="ledger-head">Choosing a horizon</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            Set the horizon to the year by which anything captured today must have become unreadable.
            For infrastructure whose secrets must outlive several hardware refresh cycles, or for
            data whose confidentiality has to survive a decade, that year is further out than a
            certificate&apos;s expiry. Ten years is a common starting point; regulatory obligations
            for long-lived infrastructure often push it much further.
          </p>
        </div>
        <div className="sheet rounded-sm p-5">
          <p className="ledger-head">Choosing the growth rate</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            No one can defend a single growth rate, which is why this is your input and not the
            product&apos;s. Lower it if you think hardware scales slowly, raise it if you expect a
            step change. The engine solves for the year capacity reaches the required qubit count
            rather than asserting a date, so the arithmetic stays inspectable either way.
          </p>
          <p className="mt-3 border-t border-parchment-200 pt-3 font-mono text-[0.66rem] leading-relaxed text-ash-600">
            {ASSAY_ENGINE_CITATIONS.capability}
          </p>
        </div>
        <div className="sheet rounded-sm p-5">
          <p className="ledger-head">Choosing the cost anchor</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            Two published estimates exist for factoring RSA-2048, and they differ by a factor of
            twenty. The newer one is lower, which means earlier break years. Using the newer figure
            and calling the older one optimistic would not be honest, so both are selectable and the
            chosen one is recorded on every certificate.
          </p>
        </div>
        <div className="sheet rounded-sm p-5">
          <p className="ledger-head">What is not configurable</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            The Shor circuit costs, the NIST SP 800-57 equivalences and the NIST IR 8547 dates are
            published constants and stay fixed. Making them adjustable would let a reader tune the
            model until it produced the answer they wanted, which would make the grade meaningless.
          </p>
        </div>
      </section>

      <p className="mt-10 border-t border-parchment-300 pt-4 font-mono text-[0.66rem] text-ash-600">
        Policy is scoped to this session&apos;s anonymous cookie. Clearing cookies resets it to the
        defaults above.
      </p>
    </div>
  );
}