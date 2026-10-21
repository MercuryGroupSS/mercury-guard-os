# Mercury Guard OS v0.7 — read-only local audit viewer

Adds local audit review from standby or an active demo shift. Records are paged newest-first in batches of 20 using an exclusive row cursor; new events do not shift older pages. Each row opens the encrypted event's details, stable event ID and local delivery flag. Device timestamps are explicitly unverified. Detail views survive Activity recreation. The viewer neither records new audit events nor acknowledges, edits or deletes records.

Drafts are not audit events and remain excluded until submitted. Photo records show metadata; retained images are not displayed. Detail text is limited to 16,000 characters with a visible truncation notice, preserving stored content. Failed authentication/decryption shows an error without erasing data. The page query decrypts at most 50 records per call. There is no server receipt authentication or immutable audit history.

The demo has no guard sign-in: anyone using this installation can review local records, as the screen states. Use synthetic data only. No backend/network, phone management, other repositories or existing apps are changed. The clean white Jarvis-inspired redesign remains deferred.

Validation pending: six unit tests and twenty-two device tests on each API 28 and 35, build, lint and signature verification. Physical Fold6 tests and stable release signing remain pending.
