#!/usr/bin/env bash
set -euo pipefail
MERCURY_HTTPS_FIXTURE=synthetic-only node server/scripts/https-android-fixture.mjs > /tmp/mercury-https-fixture.log 2>&1 &
fixture_pid=$!
trap 'kill "$fixture_pid" 2>/dev/null || true' EXIT
ready=false
for attempt in $(seq 1 30); do
 if curl --silent --fail --cacert app/build/https-test/res/raw/https_fixture_ca.pem https://localhost:55443/test/health > /dev/null; then ready=true; break; fi
 if ! kill -0 "$fixture_pid" 2>/dev/null; then cat /tmp/mercury-https-fixture.log; exit 1; fi
 sleep 1
done
if [ "$ready" != true ]; then cat /tmp/mercury-https-fixture.log; exit 1; fi
adb reverse tcp:55443 tcp:55443
gradle --no-daemon -PhttpsTest=true -Pandroid.testInstrumentationRunnerArguments.httpsIntegration=true -Pandroid.testInstrumentationRunnerArguments.class=ca.mercury.guard.HttpsAccountIntegrationTest :app:connectedDebugAndroidTest
