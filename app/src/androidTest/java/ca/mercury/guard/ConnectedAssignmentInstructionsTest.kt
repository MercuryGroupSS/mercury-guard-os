package ca.mercury.guard

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class ConnectedAssignmentInstructionsTest {
 private val scope=DispatchScope(GrantBinding("guard-a","site-a","future-assignment","a".repeat(64),0),"company-a")
 private fun message()=JSONObject().put("message_id","instructions-a").put("version",1).put("state","active").put("title","Site instructions").put("body","Read before clock-in").put("issued_at",1000).put("due_at",JSONObject.NULL)
 private fun page()=JSONObject().put("scope",scope.json()).put("changes",JSONArray().put(message())).put("next_cursor",UUID.randomUUID().toString()).put("has_more",false).put("server_time_ms",2000)
 private fun rejects(value:JSONObject){try{ConnectedAssignmentInstructions.parse(scope,null,value);fail("Invalid page accepted")}catch(_:IllegalArgumentException){}catch(_:IllegalStateException){}catch(_:org.json.JSONException){}}
 @Test fun futureAssignmentReadHasNoCaptureGrantAttendanceOrAcknowledgementRequirement(){
  val parsed=ConnectedAssignmentInstructions.parse(scope,null,page());assertEquals("Read before clock-in",parsed.messages.single().body);assertFalse(parsed.hasMore)
  assertEquals("AssignmentInstructions(redacted)",parsed.toString());assertEquals("AssignmentInstruction(redacted)",parsed.messages.single().toString())
 }
 @Test fun everyOriginalAssignmentScopeFieldAndExactRevisionMustMatch(){
  for(key in listOf("guard_id","vendor_id","site_id","assignment_id","device_thumbprint","revocation_version")){
   val p=page();p.getJSONObject("scope").put(key,if(key=="revocation_version")1 else "different");rejects(p)
  }
  val p=page();p.getJSONObject("scope").put("revocation_version","0");rejects(p)
 }
 @Test fun malformedCursorPageFlagsNumbersAndOversizedMessageAreDenied(){
  rejects(page().put("next_cursor","not-a-cursor"));rejects(page().put("has_more","false"));rejects(page().put("server_time_ms",2000.0))
  val p=page();p.getJSONArray("changes").getJSONObject(0).put("body","x".repeat(8001));rejects(p)
  val q=page();q.getJSONArray("changes").put(message());rejects(q)
  val r=page();r.put("changes",JSONArray().apply{repeat(26){put(message().put("message_id","instruction-$it"))}});rejects(r)
 }
 @Test fun retractedContentHiddenAndCursorMustAdvanceWhenMore(){
  val p=page();p.getJSONArray("changes").getJSONObject(0).put("state","retracted").put("title","").put("body","")
  assertTrue(ConnectedAssignmentInstructions.parse(scope,null,p).messages.isEmpty())
  val q=page().put("has_more",true);try{ConnectedAssignmentInstructions.parse(scope,q.getString("next_cursor"),q);fail("Nonadvancing cursor accepted")}catch(_:IllegalArgumentException){}
  val r=page();r.getJSONArray("changes").getJSONObject(0).put("state","retracted");rejects(r)
 }
}
