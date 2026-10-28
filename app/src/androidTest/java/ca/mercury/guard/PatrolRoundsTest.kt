package ca.mercury.guard

import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PatrolRoundsTest {
 private fun route(rounds:Boolean=true)=JSONObject().put("routeId","assigned-route").put("revision",2)
  .put("checkpoints",JSONArray().put(JSONObject().put("id","entrance").put("label","Entrance")).put(JSONObject().put("id","perimeter").put("label","Perimeter")))
  .apply{if(rounds)put("rounds",JSONArray().put(JSONObject().put("id","opening").put("label","Opening patrol")).put(JSONObject().put("id","closing").put("label","Closing patrol")))}
 private fun rejected(action:()->Unit){try{action();fail("Invalid route accepted")}catch(_:IllegalArgumentException){}catch(_:IllegalStateException){}catch(_:org.json.JSONException){}}
 @Test fun parserRejectsOmittedOrMalformedRoundChoicesAndPreservesLegacyShape(){
  val plan=AuthorizedPatrolRoute.parse(route());assertEquals("closing",plan.choice("perimeter","closing").roundId)
  rejected{plan.choice("entrance")};rejected{AuthorizedPatrolRoute.parse(route().put("rounds",JSONObject.NULL))}
  rejected{AuthorizedPatrolRoute.parse(route().put("rounds",JSONArray()))}
  rejected{AuthorizedPatrolRoute.parse(route().put("revision","2"))}
  rejected{AuthorizedPatrolRoute.parse(route().put("rounds",JSONArray().put(JSONObject().put("id",2).put("label","Numeric ID"))))}
  val legacy=AuthorizedPatrolRoute.parse(route(false));assertNull(legacy.choice("entrance").roundId)
 }
 @Test fun realAccountScreenOffersExplicitRoundsAndSwitchesWithoutForcedCompletion(){
  ConnectedPatrolUiFixture(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext).use{fixture->ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   scenario.onActivity{activity->
    val binding=fixture.prepare(activity,GrantBinding("synthetic-round-ui","synthetic-site","synthetic-assignment","a".repeat(64),1))
    val field=GuardAccountActivity::class.java.getDeclaredField("captureBinding");field.isAccessible=true;field.set(activity,binding)
    val item=JSONObject().put("guardId",binding.guardId).put("siteId",binding.siteId).put("assignmentId",binding.assignmentId).put("patrolRoute",route())
    // Instrumentation injects only a synthetic presentation snapshot, never service/capture authority.
    val open=GuardAccountActivity::class.java.getDeclaredMethod("patrolScreen",JSONObject::class.java,String::class.java);open.isAccessible=true;open.invoke(activity,item,null)
   }
   onView(withText("Closing patrol · 0/2 recorded")).perform(scrollTo(),click())
   onView(withText("PATROL · Closing patrol")).check(matches(isDisplayed()))
   onView(withText("Record checkpoint: Perimeter")).perform(scrollTo()).check(matches(isDisplayed()))
   onView(withText("Record checkpoint: Entrance")).perform(scrollTo()).check(matches(isDisplayed()))
   onView(withText("Choose another patrol round")).perform(scrollTo(),click())
   onView(withText("Opening patrol · 0/2 recorded")).perform(scrollTo(),click())
   onView(withText("PATROL · Opening patrol")).check(matches(isDisplayed()))
  }}
 }
}
