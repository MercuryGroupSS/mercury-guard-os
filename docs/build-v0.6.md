# Mercury Guard OS v0.6 — durable encrypted incident drafts

Adds a single per-device encrypted incident draft, stored in schema v4 independently of submitted audit events. It autosaves changes with an 8,000-character limit. Closing/reopening the app and ending a demo shift preserve the saved draft. During an active demo shift, Incident report resumes it; Cancel keeps it. Discard requires a confirmation. Draft text is not written into Activity saved-instance state or audit export.

Submitting reads the saved draft, inserts one encrypted incident event and deletes the draft in one database transaction. If event insertion fails, the draft remains. Empty submission creates no event. Previously unreadable drafts fail closed and are not overwritten by autosave. The editor reports write errors; an unsuccessful write is not a guarantee that the latest keystrokes survived a process kill. Draft text is sensitive in app memory and on screen. Draft retention is local and manual, with no guard identity separation in this demo; use synthetic data only.

Migration creates the draft table without replacing existing events/outbox batches. No network transport, credentials, production backend, phone management, other repositories or existing applications are changed. White Jarvis-inspired styling remains deferred.

Validation passed: six unit tests and nineteen device tests on each API 28 and 35, build, lint and APK signature verification. Physical Fold6 testing remains pending. Stable release signing is still required for predictable in-place updates.

Source commit `4a0891fe291089c3c5593c540e26fda4917d3cc0`, [run 39623542785](https://github.com/MercuryGroupSS/mercury-guard-os/actions/runs/39623542785). APK SHA-256: `4090a1fc79e7ae1d58bae900b2b1a51b6f2ec904fee5d704dfe40166f10b3784`. Downloaded artifact digest and APK checksum were compared locally.
