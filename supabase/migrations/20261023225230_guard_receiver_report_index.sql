CREATE INDEX receiver_observations_recent_idx ON mercury_guard_receiver.observations USING btree (received_at DESC, delivery_id DESC);

