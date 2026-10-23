package ca.mercury.guard

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class DispatchInboxTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private val scope=DispatchScope(GrantBinding("guard-a","site-a","shift-a","a".repeat(64),1),"company-a")
 private fun message(id:String="message-a",version:Long=1,state:String="active")=JSONObject().put("message_id",id).put("version",version).put("state",state).put("title",if(state=="active")"Private title" else "").put("body",if(state=="active")"PRIVATE-DISPATCH-CONTENT" else "").put("issued_at",100).put("due_at",JSONObject.NULL)
 private fun page(cursor:String,vararg messages:JSONObject)=JSONObject().put("scope",scope.json()).put("changes",JSONArray(messages.toList())).put("next_cursor",cursor).put("has_more",false).put("server_time_ms",200)
 private fun rejected(block:()->Unit){var failed=false;try{block()}catch(_:Exception){failed=true};assertTrue("Expected rejection",failed)}
 private fun isolated(block:(DispatchInbox,String)->Unit){val name="inbox-${UUID.randomUUID()}.db";val db=DispatchInbox(context,name);try{block(db,name)}finally{db.close();context.deleteDatabase(name)}}

 @Test fun scopeIsolationEncryptionAndRestart(){isolated{db,name->
  db.apply(scope,null,page("cursor-a",message()))
  for(other in listOf(scope.copy(vendorId="other"),scope.copy(binding=scope.binding.copy(guardId="other")),scope.copy(binding=scope.binding.copy(siteId="other")),scope.copy(binding=scope.binding.copy(assignmentId="other")),scope.copy(binding=scope.binding.copy(deviceThumbprint="b".repeat(64))),scope.copy(binding=scope.binding.copy(revocationVersion=2)))){
   assertTrue(db.list(other).isEmpty());assertNull(db.cursor(other));rejected{db.apply(other,null,page("wrong",message()))}
  }
  db.readableDatabase.rawQuery("SELECT owner,lookup,body FROM messages",null).use{assertTrue(it.moveToFirst());for(i in 0..2){assertFalse(it.getString(i).contains("PRIVATE-DISPATCH-CONTENT"));assertFalse(it.getString(i).contains("guard-a"))}}
  db.markRead(scope,"message-a",1,250);db.close()
  DispatchInbox(context,name).use{assertEquals("cursor-a",it.cursor(scope));assertEquals(250L,it.list(scope).single().getLong("read_at"))}
 }}
 @Test fun lateConflictRollsBackMessagesAndCursor(){isolated{db,_->
  db.apply(scope,null,page("first",message()))
  rejected{db.apply(scope,"first",page("second",message("new"),message().put("body","conflict")))}
  assertEquals("first",db.cursor(scope));assertEquals(1,db.list(scope).size)
  rejected{db.apply(scope,null,page("racing",message("new")))}
  assertEquals("first",db.cursor(scope))
  val wrongType=page("bad",message());wrongType.getJSONObject("scope").put("revocation_version","1")
  rejected{db.apply(scope,"first",wrongType)}
 }}
 @Test fun versionsRetractionsAndResetPreserveIntegrity(){isolated{db,_->
  db.apply(scope,null,page("first",message()));db.markRead(scope,"message-a",1,250)
  db.apply(scope,"first",page("second",message()));assertEquals(250L,db.list(scope).single().getLong("read_at"))
  db.apply(scope,"second",page("third",message(version=2)));assertTrue(db.list(scope).single().isNull("read_at"))
  rejected{db.markRead(scope,"message-a",1,300)}
  rejected{db.apply(scope,"third",page("stale",message()))}
  db.resetCursor(scope,"third");assertNull(db.cursor(scope));assertTrue(db.list(scope).isEmpty())
  db.apply(scope,null,page("full",message(version=2)));assertEquals(1,db.list(scope).size)
  db.apply(scope,"full",page("withdrawn",message(version=3,state="retracted")));assertTrue(db.list(scope).isEmpty())
  rejected{db.markRead(scope,"message-a",3,300)}
  rejected{db.apply(scope,"withdrawn",page("resurrect",message(version=2)))}
  assertEquals("withdrawn",db.cursor(scope));assertTrue(db.list(scope).isEmpty())
 }}
}
