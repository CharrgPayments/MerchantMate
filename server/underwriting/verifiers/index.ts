// Registry of built-in verifiers used as fallbacks when no workflow_endpoint
// is configured for a given underwriting phase. Returning `null` means "no
// built-in available; orchestrator should fall back to the legacy skipped
// PhaseResult".

import type { PhaseResult } from "@shared/underwriting";
import type { ProspectApplication, ProspectOwner } from "@shared/schema";
import { verifyPhone } from "./phone";
import { verifyWebsite } from "./website";
import { verifyOfac } from "./ofac";
import { verifyGoogleKyb } from "./googleKyb";

export interface BuiltinContext {
  app: ProspectApplication;
  owners: ProspectOwner[];
}

function appData(app: ProspectApplication): Record<string, unknown> {
  return (app.applicationData as Record<string, unknown>) || {};
}

export const BUILTIN_VERIFIERS: Record<string, (ctx: BuiltinContext) => Promise<PhaseResult>> = {
  phone_verification: async (ctx) => {
    const d = appData(ctx.app);
    return verifyPhone({ phone: (d.businessPhone || d.phone) as string | undefined, name: d.companyName as string | undefined });
  },
  website_review: async (ctx) => {
    const d = appData(ctx.app);
    return verifyWebsite({ url: (d.websiteUrl || d.website) as string | undefined });
  },
  ofac_sanctions: async (ctx) => {
    const d = appData(ctx.app);
    return verifyOfac({ entity: d.companyName as string | undefined, owners: ctx.owners.map((o) => ({ name: o.name })) });
  },
  google_kyb: async (ctx) => {
    const d = appData(ctx.app);
    return verifyGoogleKyb({
      legalName: d.companyName as string | undefined,
      address: d.address as string | undefined,
      state: d.state as string | undefined,
    });
  },
};

export function hasBuiltin(phaseKey: string): boolean {
  return phaseKey in BUILTIN_VERIFIERS;
}
