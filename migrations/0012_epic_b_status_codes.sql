-- Intentionally a no-op.
-- Epic B intentionally preserves the legacy status taxonomy on existing
-- prospect_applications rows; only newly-submitted applications use the
-- new SUB/CUW/P*/W*/D*/APPROVED codes. The previous version of this
-- migration backfilled historical rows and has been removed.
SELECT 1;
