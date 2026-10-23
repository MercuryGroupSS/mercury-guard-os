package ca.mercury.guard

import android.os.SystemClock
import org.junit.Assert.*
import org.junit.Test

class GuardAccountClientTest {
 @Test fun rejectsUnsafeOriginsBeforeCredentialsCanBeSent() {
  for (origin in listOf("http://example.com", "https://user:password@example.com", "https://example.com/path", "https://example.com?key=value", "https://example.com#fragment")) {
   try { GuardAccountClient(origin); fail("Unsafe origin accepted") } catch (_: IllegalArgumentException) { }
  }
  GuardAccountClient("https://example.com")
 }
 @Test fun expiredAndClearedSessionsCannotAuthorizeRequestsOrLeakThroughToString() {
  val active = GuardAccountClient.Session("private-token", SystemClock.elapsedRealtime()+60000)
  assertEquals("private-token",active.bearer())
  assertFalse(active.toString().contains("private-token"))
  active.clear()
  try { active.bearer(); fail("Cleared session accepted") } catch (_: IllegalStateException) { }
  val expired = GuardAccountClient.Session("private-token",SystemClock.elapsedRealtime()-1)
  try { expired.bearer(); fail("Expired session accepted") } catch (_: IllegalStateException) { }
 }
}
