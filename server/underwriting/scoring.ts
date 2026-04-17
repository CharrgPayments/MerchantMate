import { PHASES, tierFromScore, type PhaseStatus } from "@shared/underwriting";

export interface PhaseOutcome {
  key: string;
  status: PhaseStatus;
  score: number; // 0-100 phase-local
}

// Aggregate phase scores into a single 0-100 application risk score using the
// per-phase weights from PHASES. Failed phases contribute 0; skipped phases are
// excluded from the denominator.
export interface ScoreComponent {
  key: string;
  weight: number;
  status: PhaseStatus;
  rawScore: number;
  weightedScore: number;
}

export interface RiskScoreBreakdown {
  components: ScoreComponent[];
  totalWeight: number;
  weightedSum: number;
}

export function computeRiskScore(outcomes: PhaseOutcome[]): {
  score: number;
  tier: "low" | "medium" | "high";
  breakdown: RiskScoreBreakdown;
} {
  let weightedSum = 0;
  let totalWeight = 0;
  const components: ScoreComponent[] = [];
  for (const out of outcomes) {
    const phase = PHASES.find(p => p.key === out.key);
    if (!phase) continue;
    if (out.status === "skipped") {
      components.push({ key: out.key, weight: phase.weight, status: out.status, rawScore: 0, weightedScore: 0 });
      continue;
    }
    const rawScore = out.status === "fail" || out.status === "error" ? 0 : Math.max(0, Math.min(100, out.score));
    const weightedScore = rawScore * phase.weight;
    totalWeight += phase.weight;
    weightedSum += weightedScore;
    components.push({ key: out.key, weight: phase.weight, status: out.status, rawScore, weightedScore });
  }
  const score = totalWeight === 0 ? 0 : Math.round(weightedSum / totalWeight);
  return { score, tier: tierFromScore(score), breakdown: { components, totalWeight, weightedSum } };
}
