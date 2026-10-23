# Local synthetic provisioning

Run `node server/scripts/provision-local.mjs --input manifest.json` to validate without writing databases. Add `--output /absolute/path/to/new-directory` to create an inactive snapshot. An existing directory is refused. No Auth accounts are created, no credentials are stored, no service is restarted, and no existing dashboard or Supabase project is changed.

Input has exactly six top-level fields: version (1), vendors, guards, devices, assignments, dashboardBindings. Lists are bounded to 1,000 entries each; the file is bounded to 2 MB. Unknown fields are rejected, including password fields.

- vendors: vendorId, kind (company or individual), active.
- guards: guardId, authSubject, vendorId, email, active. Guard ID, authenticated subject and case-normalized login email must each be unique. Several guards may share one vendor.
- devices: deviceId, mode (site or personal), active=true, revoked=false, publicKeySpki (base64url DER P-256 public key), and either siteId or guardId. The operator must separately verify possession/approval of the enrollment key; validating its encoding does not prove possession.
- assignments: assignmentId, guardId, vendorId, siteId, startsAt/endsAt (epoch milliseconds), active=true; optional patrolRoute and checkInPolicy use the existing validated formats. An eligible site/personal phone must exist.
- dashboardBindings: assignmentId, guardId, vendorId, siteId, dashboardShiftId, destination, revision, active. These are explicit approved mappings, never inferred from names or vendor IDs. Leave the list empty until mappings are reviewed.

An active guard requires an active vendor. Assignments require an active guard and matching vendor. Personal phones require an active individual guard. The validator also exercises the actual directory, enrollment, route/policy and mapping stores in memory before creating files.

A created directory has owner-only access; SQLite files and provisioning.json are owner-readable/writable only. The manifest is written last with validated_not_activated status. A filesystem failure can leave an incomplete new directory; absence of the completion manifest means it must not be activated. This tool never removes or overwrites existing configuration. Snapshots contain plaintext synthetic directory data and are not a production personnel store. Verification of real Auth subjects/emails, account enrollment/recovery, secure production persistence and approved activation remain separate requirements.

Vendor access can be suspended in the local directory through the administrative `setVendorActive(vendorId, active)` method. This disables login and trusted identity resolution for every linked guard, including previously authenticated sessions when the service resolves their identity again. It does not delete guards, assignments or audit records. Reactivation preserves each guard's own active/disabled status. Both company and individual vendors follow this rule. This is a local administrative API, not a deployed Ops Dashboard control or a phone-side offline revocation mechanism.
