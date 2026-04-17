-- Epic D — Campaign Linkage & Auto-Assignment
-- Adds agents.default_campaign_id and campaign_assignment_rules.

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS default_campaign_id integer
  REFERENCES campaigns(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS campaign_assignment_rules (
  id            serial PRIMARY KEY,
  mcc           text,
  acquirer_id   integer REFERENCES acquirers(id) ON DELETE SET NULL,
  agent_id      integer REFERENCES agents(id)    ON DELETE SET NULL,
  campaign_id   integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  priority      integer NOT NULL DEFAULT 100,
  is_active     boolean NOT NULL DEFAULT true,
  notes         text,
  created_by    varchar REFERENCES users(id),
  created_at    timestamp DEFAULT now() NOT NULL,
  updated_at    timestamp DEFAULT now() NOT NULL
);

-- Indexes to speed up rule lookup (most-specific match wins, ordered by priority).
CREATE INDEX IF NOT EXISTS idx_car_active     ON campaign_assignment_rules (is_active);
CREATE INDEX IF NOT EXISTS idx_car_priority   ON campaign_assignment_rules (priority);
CREATE INDEX IF NOT EXISTS idx_car_mcc        ON campaign_assignment_rules (mcc);
CREATE INDEX IF NOT EXISTS idx_car_acquirer   ON campaign_assignment_rules (acquirer_id);
CREATE INDEX IF NOT EXISTS idx_car_agent      ON campaign_assignment_rules (agent_id);
CREATE INDEX IF NOT EXISTS idx_car_campaign   ON campaign_assignment_rules (campaign_id);
