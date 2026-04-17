-- Epic B — persist per-phase risk score breakdown so the review UI can show derivation.
ALTER TABLE prospect_applications ADD COLUMN IF NOT EXISTS risk_score_breakdown jsonb;
ALTER TABLE underwriting_runs ADD COLUMN IF NOT EXISTS risk_score_breakdown jsonb;
