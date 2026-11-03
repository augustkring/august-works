-- Older import failures could follow partial domain writes or startup recovery
-- of an interrupted apply. Their status alone never proved non-application.
-- Preserve their identity and spooled evidence; do not authorize an upgrade-time
-- replay. New known pre-dispatch failures use the original guarded owner.
UPDATE company_transfer_runs
SET status = 'needs_reconciliation',
    error = 'Earlier import outcome is unconfirmed; reconcile the existing transfer before another apply.',
    finished_at = NULL,
    updated_at = clock_timestamp()
WHERE direction = 'import' AND status = 'failed';
