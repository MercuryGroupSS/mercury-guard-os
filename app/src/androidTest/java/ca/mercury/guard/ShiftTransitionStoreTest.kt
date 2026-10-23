package ca.mercury.guard
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID
class ShiftTransitionStoreTest{
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private val scope=DispatchScope(GrantBinding("guard","site","assignment","a".repeat(64),1),"vendor")
 private fun rejected(block:()->Unit){var failed=false;try{block()}catch(_:Exception){failed=true};assertTrue(failed)}
 private fun receipt(request:JSONObject)=JSONObject().put("request_id",request.getString("request_id")).put("scope",scope.json().apply{remove("revocation_version")}).put("action","start").put("recorded_at_ms",1000).put("clocked_in_at_ms",1000).put("clocked_out_at_ms",JSONObject.NULL).put("early_exit",false).put("reason",JSONObject.NULL).put("status","shift_recorded_local_only")
 @Test fun restartRetainsExactIntentAndOnlyMatchingReceiptCompletes(){
  val name="shift-test-${UUID.randomUUID()}.db"
  try{
   val request=ShiftTransitionStore(context,name).use{it.prepare(scope,"start","")}
   ShiftTransitionStore(context,name).use{db->
    assertEquals(request.toString(),db.prepare(scope,"start","").toString());assertNull(db.saved(scope.copy(vendorId="other"),"start"))
    rejected{db.accept(scope,"start",receipt(request).put("request_id","other"))}
    rejected{db.accept(scope,"start",receipt(request).put("clocked_in_at_ms","1000"))}
    val wrongScope=receipt(request);wrongScope.getJSONObject("scope").put("guard_id","other");rejected{db.accept(scope,"start",wrongScope)}
    assertFalse(db.saved(scope,"start")!!.has("receipt"));db.accept(scope,"start",receipt(request));db.accept(scope,"start",receipt(request))
    val end=db.prepare(scope,"end","PRIVATE-EARLY-EXIT-REASON");assertNotEquals(request.getString("request_id"),end.getString("request_id"))
    rejected{db.prepare(scope,"end","changed reason")}
    db.readableDatabase.rawQuery("SELECT body FROM transitions",null).use{c->while(c.moveToNext()){assertFalse(c.getString(0).contains("PRIVATE-EARLY-EXIT-REASON"));assertFalse(c.getString(0).contains("guard"))}}
   }
   ShiftTransitionStore(context,name).use{assertTrue(it.saved(scope,"start")!!.has("receipt"));assertFalse(it.saved(scope,"end")!!.has("receipt"))}
  }finally{context.deleteDatabase(name)}
 }
}
