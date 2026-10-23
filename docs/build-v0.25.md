# v0.25 — encrypted authorized capture queue

ScopedEventStore is a separate capture queue that requires a verified shift grant, matching binding and installation key, a supported permitted action, current monotonic time and matching boot. It stores the original guard/site/assignment/device/revocation scope and capture grant ID alongside the event in authenticated encryption. Capture inserts and sequence allocation are atomic.

Prepared v2 batches use only the stored original binding. FIFO batches stop at a scope change; retries reuse the saved batch after restart. No demo audit records are imported or relabelled. Full matching local-pilot receipts update only this queue; mismatched or partial receipts leave it intact. Local receipt status is not dashboard delivery.

New instrumentation tests cover assignment switching, restart/retry, original grant identity, sequence ordering, grant expiry, reboot mismatch, wrong scope, forbidden action, reserved metadata, altered receipts and encrypted at-rest payloads.

Limits: this queue is not yet wired to operational UI or a signed-grant endpoint. Existing demo behavior remains v0.23-compatible. The server still needs grant-ID/historical-upload policy and multi-assignment authorization before old-shift queued events can be uploaded after reassignment. FIFO intentionally blocks newer scopes rather than relabelling or dropping older events. A signature proves key possession, not truthful observation time or device integrity. No physical test performed.
