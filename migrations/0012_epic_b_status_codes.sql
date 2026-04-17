-- Migrate legacy prospect_applications.status values to new Epic B taxonomy.
-- Old values:                       New code:
--   draft                       ->  draft
--   submitted, in_review        ->  CUW
--   pending_info                ->  P1
--   approved                    ->  APPROVED
--   rejected, declined          ->  D1
--   withdrawn                   ->  W1

UPDATE prospect_applications SET status = 'CUW'      WHERE status IN ('submitted', 'in_review');
UPDATE prospect_applications SET status = 'P1'       WHERE status = 'pending_info';
UPDATE prospect_applications SET status = 'APPROVED' WHERE status = 'approved';
UPDATE prospect_applications SET status = 'D1'       WHERE status IN ('rejected', 'declined');
UPDATE prospect_applications SET status = 'W1'       WHERE status = 'withdrawn';

-- Apps that have been submitted but never reviewed should sit in SUB
-- (the spec's "Submitted - awaiting first underwriting touch") rather than
-- jumping straight into review. We use submittedAt timestamp + status presence.
-- Anything still labelled with old "submitted" was rewritten to CUW above; if
-- there is no underwriting_run yet we move them back to SUB.
UPDATE prospect_applications pa SET status = 'SUB'
  WHERE pa.status = 'CUW'
    AND NOT EXISTS (SELECT 1 FROM underwriting_runs ur WHERE ur.application_id = pa.id);
