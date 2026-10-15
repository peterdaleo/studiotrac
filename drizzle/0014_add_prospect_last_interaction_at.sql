-- Add an editable, date-only Last Interaction summary without synthesizing a timeline event.
-- Safe if application startup already added the column through ensureProspectsSchema.
SET @prospect_last_interaction_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'prospects'
    AND column_name = 'lastInteractionAt'
);
SET @prospect_last_interaction_ddl = IF(
  @prospect_last_interaction_column_exists = 0,
  'ALTER TABLE prospects ADD COLUMN lastInteractionAt DATE NULL',
  'SELECT 1'
);
PREPARE add_prospect_last_interaction_at FROM @prospect_last_interaction_ddl;
EXECUTE add_prospect_last_interaction_at;
DEALLOCATE PREPARE add_prospect_last_interaction_at;
