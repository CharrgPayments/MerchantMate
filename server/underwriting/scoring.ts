import { PHASES, tierFromScore, type PhaseStatus } from "@shared/underwriting";

export interface PhaseOutcome {
  key: string;
  status: PhaseStatus;
  score: number; // 0-100 phase-local
}

// Aggregate phase scores into a single 0-100 application risk score using the
// per-phase weights from PHASES. Failed phases contribute 0; skipped phases are
// excluded from the denominator.
export function computeRiskScore(outcomes: PhaseOutcome[]): { score: number; tier: "low" | "medium" | "high" } {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const out of outcomes) {
    if (out.status === "skipped") continue;
    const phase = PHASES.find(p => p.key === out.key);
    if (!phase) continue;
    totalWeight += phase.weight;
    const phaseScore = out.status === "fail" || out.status === "error" ? 0 : Math.max(0, Math.min(100, out.score));
    weightedSum += phaseScore * phase.weight;
  }
  const score = totalWeight === 0 ? 0 : Math.round(weightedSum / totalWeight);
  return { score, tier: tierFromScore(score) };
}
