package ca.mercury.guard

import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

class GuardAccountScreenTest {
 @Test fun unconfiguredBuildNeverRequestsCredentials() {
  ActivityScenario.launch(GuardAccountActivity::class.java).use { scenario ->
   onView(withText("ACCOUNT CONNECTION")).check(matches(isDisplayed()))
   onView(withText(org.hamcrest.Matchers.startsWith("No trusted service is configured"))).check(matches(isDisplayed()))
   scenario.recreate()
   onView(withText("ACCOUNT CONNECTION")).check(matches(isDisplayed()))
  }
 }
 @Test fun configurationRequiresPinnedKeysAndHttps() {
  val base=JSONObject().put("endpoint","https://example.com").put("issuer","test").put("audience","test").put("device_id","phone").put("issuer_keys",JSONObject())
  try{GuardServiceConfig.parse(base.toString());fail("Empty trust accepted")}catch(_:IllegalArgumentException){}
  base.put("endpoint","http://example.com")
  try{GuardServiceConfig.parse(base.toString());fail("Cleartext accepted")}catch(_:IllegalArgumentException){}
 }
}
