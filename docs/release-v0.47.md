# Mercury One v0.47 verification scope

Retains v0.46 ownership/session protections and makes read-only running-shift continuity explicit.

With ops_refresh.history_fallback: true, a validated current-source read may retrieve only its missing approved IDs from the fixed public.shift_history table. The same origin, credential, five columns and strict response checks apply, under one five-second deadline. No history fallback occurs on a rejected primary read or for present primary rows. Failure preserves existing assignments; missing rows never imply cancellation. Both supported runtimes preserve the disabled default. See the [integration contract](ops-dashboard-integration.md).

Repeated shift receipt/rejection acceptance now tolerates object key ordering from PostgreSQL JSONB while preserving exact fields, types, values, original request identity and saved ciphertext. Five Android regressions exercise genuine reordered retries, reopen and changed-data rejection. The real-provider phone pilot that exposed this defect retained exactly one confirmed synthetic clock-in; its original request and key remain the recovery boundary.

An older Android connected-draft UI fixture now supplies its actual preserved installation key, satisfying the current owner check without changing production code or removing assertions. Version metadata advances to 0.47.

Local reader/configuration tests passed 23 focused cases. The broader suite passed 316 with one independently occupied fixed test port; isolated CI must run the complete suite. The predecessor v0.46 Fold test passed 108 isolated cases, including all 20 new owner cases, and both API suites passed those 20 cases but failed the corrected older fixture. Preserve that failure evidence. New source-specific CI, configured APK/signature and hardware results remain distinct gates. Actual guard sign-in requires human strong biometrics; generated test JPEGs and client-protocol fixtures do not establish camera, GPS or physical attendance. Existing operational applications and their records remain unchanged.
