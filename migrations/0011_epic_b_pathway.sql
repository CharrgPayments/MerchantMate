-- Epic B rev 2 — pathway, payfac SLA, pipeline halt tracking
ALTER TABLE prospect_applications
  ADD COLUMN IF NOT EXISTS pathway text NOT NULL DEFAULT 'traditional',
  ADD COLUMN IF NOT EXISTS sla_deadline timestamp,
  ADD COLUMN IF NOT EXISTS pipeline_halted_at_phase text;
