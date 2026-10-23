-- Existing one-pass checkpoint rows retain the reserved empty round key.
-- Declared route rounds use explicit IDs from their immutable grant policy.
ALTER TABLE "mercury_guard"."ingested_checkpoints"
  DROP CONSTRAINT "ingested_checkpoints_pkey";

ALTER TABLE "mercury_guard"."ingested_checkpoints"
  ADD COLUMN "round_id" text NOT NULL DEFAULT ''::text;

ALTER TABLE "mercury_guard"."ingested_checkpoints"
  ADD CONSTRAINT "ingested_checkpoints_pkey" PRIMARY KEY (guard_id, assignment_id, route, revision, round_id, checkpoint);

ALTER TABLE "mercury_guard"."ingested_checkpoints"
  ADD CONSTRAINT "ingested_checkpoints_round_id_check" CHECK (((round_id = ''::text) OR (round_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text)));
