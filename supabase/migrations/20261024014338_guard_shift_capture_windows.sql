-- Preserve unclosed attendance and original receipts; live conflicts use the
-- existing serialized shift transaction and the attempted service-time window.
DROP INDEX "mercury_guard"."one_active_guard";

DROP INDEX "mercury_guard"."one_active_phone";

CREATE INDEX unclosed_guard_window ON mercury_guard.shift_sessions USING btree (guard, ends_at)
  WHERE (clocked_out IS NULL);

CREATE INDEX unclosed_phone_window ON mercury_guard.shift_sessions USING btree (device, ends_at)
  WHERE (clocked_out IS NULL);

