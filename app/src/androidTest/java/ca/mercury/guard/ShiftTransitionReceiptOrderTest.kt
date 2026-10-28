package ca.mercury.guard

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.util.UUID

/** No HTTP, guard account or attendance mutation: only a uniquely named local DB. */
class ShiftTransitionReceiptOrderTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private val scope=DispatchScope(GrantBinding("order-guard","order-site","order-shift","b".repeat(64),1),"order-vendor")
 private val owner=ConnectedDispatchOwner("a".repeat(64),"order-phone",UUID.randomUUID().toString(),scope)
 private fun key(action:String)=MessageDigest.getInstance("SHA-256").digest(("mercury-connected-shift-transition-v1\n"+owner.json().toString()+"\n"+action).toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
 private fun raw(db:ShiftTransitionStore,action:String)=db.readableDatabase.rawQuery("SELECT body FROM transitions WHERE owner=?",arrayOf(key(action))).use{check(it.moveToFirst());it.getString(0)}
 private fun isolated(test:(String)->Unit){val name="receipt-order-${UUID.randomUUID()}.db";try{test(name)}finally{context.deleteDatabase(name)}}
 private fun denied(block:()->Unit){var rejected=false;try{block()}catch(_:Exception){rejected=true};assertTrue("Changed receipt must be rejected",rejected)}
 private fun reordered(value:Any?):Any?=when(value){
  is JSONObject->JSONObject().also{result->value.keys().asSequence().toList().reversed().forEach{key->result.put(key,reordered(value.get(key)))}}
  is JSONArray->JSONArray().also{result->for(index in 0 until value.length())result.put(reordered(value.get(index)))}
  else->value
 }
 private fun receipt(request:JSONObject):JSONObject {
  val start=request.getString("action")=="start"
  return JSONObject().put("request_id",request.getString("request_id")).put("scope",scope.json().apply{remove("revocation_version")})
   .put("action",request.getString("action")).put("recorded_at_ms",if(start)1000L else 2000L).put("clocked_in_at_ms",1000L)
   .put("clocked_out_at_ms",if(start)JSONObject.NULL else 2000L).put("early_exit",!start)
   .put("reason",if(start)JSONObject.NULL else request.getString("reason")).put("status","shift_recorded_local_only")
 }
 private fun rejection(request:JSONObject)=JSONObject().put("request_id",request.getString("request_id"))
  .put("scope",scope.json().apply{remove("revocation_version")}).put("action",request.getString("action"))
  .put("code","shift_cannot_start").put("server_time_ms",900L).put("status","shift_rejected_local_only")

 @Test fun reorderedStartReceiptAndScopeRetainOriginalCiphertextAcrossReopen(){isolated{name->
  lateinit var original:JSONObject;lateinit var request:String;lateinit var encrypted:String
  ShiftTransitionStore(context,name).use{db->
   val intent=db.prepare(owner,"start","");request=intent.toString();original=receipt(intent)
   assertTrue(db.accept(owner,"start",original));encrypted=raw(db,"start")
   val retry=reordered(original) as JSONObject
   assertNotEquals(original.toString(),retry.toString());assertNotEquals(original.getJSONObject("scope").toString(),retry.getJSONObject("scope").toString())
   assertTrue(db.accept(owner,"start",retry));assertEquals(encrypted,raw(db,"start"))
   assertEquals(request,db.prepare(owner,"start","").toString());assertEquals(original.toString(),db.saved(owner,"start")!!.getJSONObject("receipt").toString())
  }
  ShiftTransitionStore(context,name).use{db->
   assertTrue(db.accept(owner,"start",reordered(original) as JSONObject));assertTrue(db.accept(owner,"start",original))
   assertEquals(encrypted,raw(db,"start"));assertEquals(request,db.saved(owner,"start")!!.getJSONObject("request").toString())
  }
 }}

 @Test fun reorderedEndReceiptRetainsUnicodeReasonAndExactOriginalCiphertext(){isolated{name->
  lateinit var accepted:JSONObject;lateinit var encrypted:String
  val reason="Original reason — café 🚨"
  ShiftTransitionStore(context,name).use{db->
   accepted=receipt(db.prepare(owner,"end",reason));assertTrue(db.accept(owner,"end",accepted));encrypted=raw(db,"end")
  }
  ShiftTransitionStore(context,name).use{db->
   assertTrue(db.accept(owner,"end",reordered(accepted) as JSONObject));assertEquals(encrypted,raw(db,"end"))
   assertEquals(reason,db.saved(owner,"end")!!.getJSONObject("request").getString("reason"))
   val later=JSONObject(accepted.toString()).put("recorded_at_ms",2001L).put("clocked_out_at_ms",2001L)
   denied{db.accept(owner,"end",later)};assertEquals(encrypted,raw(db,"end"))
  }
 }}

 @Test fun changedReceiptKeysTypesValuesOrNullPresenceNeverRewriteOriginal(){isolated{name->
  ShiftTransitionStore(context,name).use{db->
   val accepted=receipt(db.prepare(owner,"start",""));assertTrue(db.accept(owner,"start",accepted));val encrypted=raw(db,"start")
   val changes=listOf<(JSONObject)->Unit>(
    {it.remove("reason")},{it.remove("clocked_out_at_ms")},{it.put("extra",JSONObject.NULL)},
    {it.put("reason","null")},{it.put("reason","")},{it.put("clocked_out_at_ms","null")},
    {it.put("clocked_in_at_ms","1000")},{it.put("recorded_at_ms",1000.0)},{it.put("recorded_at_ms",JSONObject.NULL)},
    {it.put("early_exit","false")},{it.put("early_exit",0)},
    {it.put("request_id",UUID.randomUUID().toString())},{it.put("status","accepted")},
    {it.put("recorded_at_ms",1001L);it.put("clocked_in_at_ms",1001L)},
    {it.getJSONObject("scope").put("guard_id","other-guard")},
    {it.getJSONObject("scope").put("site_id",true)},
    {it.getJSONObject("scope").remove("device_thumbprint")},
    {it.getJSONObject("scope").put("extra",JSONArray().put("unexpected"))}
   )
   for(change in changes){val invalid=reordered(accepted) as JSONObject;change(invalid);denied{db.accept(owner,"start",invalid)};assertEquals(encrypted,raw(db,"start"))}
   assertTrue(db.accept(owner,"start",reordered(accepted) as JSONObject));assertEquals(encrypted,raw(db,"start"))
  }
 }}

 @Test fun reorderedRejectionAndScopeRetainOriginalCiphertextAndRequestAcrossReopen(){isolated{name->
  lateinit var refused:JSONObject;lateinit var encrypted:String;lateinit var request:String
  ShiftTransitionStore(context,name).use{db->
   val intent=db.prepare(owner,"start","");request=intent.toString();refused=rejection(intent)
   assertFalse(db.accept(owner,"start",refused));encrypted=raw(db,"start")
   assertFalse(db.accept(owner,"start",reordered(refused) as JSONObject));assertEquals(encrypted,raw(db,"start"))
  }
  ShiftTransitionStore(context,name).use{db->
   assertFalse(db.accept(owner,"start",reordered(refused) as JSONObject));assertEquals(encrypted,raw(db,"start"))
   assertEquals(request,db.saved(owner,"start")!!.getJSONObject("request").toString())
   assertEquals(refused.toString(),db.saved(owner,"start")!!.getJSONObject("rejection").toString())
  }
 }}

 @Test fun changedRejectionKeysTypesValuesOrNullNeverRewriteOriginal(){isolated{name->
  ShiftTransitionStore(context,name).use{db->
   val intent=db.prepare(owner,"start","");val refused=rejection(intent);assertFalse(db.accept(owner,"start",refused));val encrypted=raw(db,"start")
   val changes=listOf<(JSONObject)->Unit>(
    {it.put("code","active_shift_conflict")},{it.put("server_time_ms",901L)},
    {it.put("server_time_ms","900")},{it.put("server_time_ms",900.0)},{it.put("server_time_ms",JSONObject.NULL)},
    {it.remove("code")},{it.put("extra",JSONObject.NULL)},{it.put("request_id",UUID.randomUUID().toString())},
    {it.getJSONObject("scope").remove("site_id")},{it.getJSONObject("scope").put("vendor_id","other-vendor")}
   )
   for(change in changes){val invalid=reordered(refused) as JSONObject;change(invalid);denied{db.accept(owner,"start",invalid)};assertEquals(encrypted,raw(db,"start"))}
   denied{db.accept(owner,"start",receipt(intent))};assertEquals(encrypted,raw(db,"start"))
  }
 }}
}
