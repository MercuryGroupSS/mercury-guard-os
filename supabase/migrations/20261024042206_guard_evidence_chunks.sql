-- Temporary original-scope fragments only. Accepted originals stay in ingested_media.
CREATE TABLE mercury_guard.evidence_chunks (
 device text NOT NULL,
 event_id uuid NOT NULL,
 chunk_index integer NOT NULL CHECK(chunk_index BETWEEN 0 AND 19),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 1048576),
 received_at bigint NOT NULL CHECK(received_at BETWEEN 1 AND 9007199254740991),
 expires_at bigint NOT NULL CHECK(expires_at BETWEEN received_at AND 9007199254740991),
 PRIMARY KEY(device,event_id,chunk_index),
 FOREIGN KEY(device,event_id) REFERENCES mercury_guard.ingested_events(device,id)
);
ALTER TABLE mercury_guard.evidence_chunks ENABLE ROW LEVEL SECURITY;
CREATE INDEX evidence_chunks_expiry_idx ON mercury_guard.evidence_chunks(expires_at);
REVOKE ALL ON mercury_guard.evidence_chunks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,DELETE ON mercury_guard.evidence_chunks TO service_role;

CREATE TABLE mercury_guard_receiver.media_chunks (
 delivery_id text NOT NULL REFERENCES mercury_guard_receiver.observations(delivery_id),
 chunk_index integer NOT NULL CHECK(chunk_index BETWEEN 0 AND 19),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 1048576),
 received_at bigint NOT NULL CHECK(received_at BETWEEN 1 AND 9007199254740991),
 expires_at bigint NOT NULL CHECK(expires_at BETWEEN received_at AND 9007199254740991),
 PRIMARY KEY(delivery_id,chunk_index)
);
ALTER TABLE mercury_guard_receiver.media_chunks ENABLE ROW LEVEL SECURITY;
CREATE INDEX receiver_media_chunks_expiry_idx ON mercury_guard_receiver.media_chunks(expires_at);
REVOKE ALL ON mercury_guard_receiver.media_chunks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,DELETE ON mercury_guard_receiver.media_chunks TO service_role;
