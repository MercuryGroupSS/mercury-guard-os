package ca.mercury.guard

import android.content.ContentValues
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Local confirmation ownership only. No HTTP request, attendance event or account is created. */
class ConnectedShiftTransitionOwnerTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private val scope=DispatchScope(GrantBinding("guard-a","site-a","shift-a","b".repeat(64),1),"company-a")
 private val owner=ConnectedDispatchOwner("a".repeat(64),"site-phone",UUID.randomUUID().toString(),scope)
 private val reason="Private original early exit — café 🚨"
 private fun isolated(action:(ShiftTransitionStore,String)->Unit){val name="connected-shifts-${UUID.randomUUID()}.db";val db=ShiftTransitionStore(context,name);try{action(db,name)}finally{db.close();context.deleteDatabase(name)}}
 private fun rejected(action:()->Unit){var denied=false;try{action()}catch(_:Exception){denied=true};assertTrue("Expected original confirmation rejection",denied)}
 private fun hash(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
 private fun key(owner:ConnectedDispatchOwner,action:String)=hash("mercury-connected-shift-transition-v1\n"+owner.json().toString()+"\n"+action)
 private fun raw(db:ShiftTransitionStore,key:String)=db.readableDatabase.rawQuery("SELECT body FROM transitions WHERE owner=?",arrayOf(key)).use{check(it.moveToFirst());it.getString(0)}
 private fun receipt(request:JSONObject,forScope:DispatchScope=scope):JSONObject {
  val start=request.getString("action")=="start"
  return JSONObject().put("request_id",request.getString("request_id")).put("scope",forScope.json().apply{remove("revocation_version")}).put("action",request.getString("action"))
   .put("recorded_at_ms",if(start)1000 else 2000).put("clocked_in_at_ms",1000).put("clocked_out_at_ms",if(start)JSONObject.NULL else 2000)
   .put("early_exit",!start).put("reason",if(start)JSONObject.NULL else request.getString("reason")).put("status","shift_recorded_local_only")
 }
 private fun refusal(request:JSONObject)=JSONObject().put("request_id",request.getString("request_id")).put("scope",scope.json().apply{remove("revocation_version")})
  .put("action",request.getString("action")).put("code","shift_cannot_end").put("server_time_ms",2000).put("status","shift_rejected_local_only")

 @Test fun legacyUnsentReasonAndConfirmationAreRetainedButNeverAdopted(){isolated{db,name->
  val legacy=db.prepare(scope,"end",reason);val legacyKey=hash(scope.json().toString()+"\nend");val original=raw(db,legacyKey)
  assertNull(db.saved(owner,"end"));rejected{db.accept(owner,"end",receipt(legacy))}
  val connected=db.prepare(owner,"end","New account's own explicit reason")
  assertNotEquals(legacy.getString("request_id"),connected.getString("request_id"));assertEquals(original,raw(db,legacyKey));assertEquals(legacy.toString(),db.saved(scope,"end")!!.getJSONObject("request").toString())
  db.close();ShiftTransitionStore(context,name).use{reopened->
   assertEquals(original,raw(reopened,legacyKey));assertEquals(connected.toString(),reopened.prepare(owner,"end","New account's own explicit reason").toString())
   assertFalse(reopened.saved(owner,"end")!!.toString().contains(reason))
  }
 }}

 @Test fun everyOriginalAccountAndAssignmentDimensionRejectsOldPendingIntentAndReceipt(){isolated{db,_->
  val original=db.prepare(owner,"end",reason);val originalBytes=raw(db,key(owner,"end"))
  val others=listOf(owner.copy(configuration="c".repeat(64)),owner.copy(deviceId="another-phone"),owner.copy(subject=UUID.randomUUID().toString()),
   owner.copy(scope=scope.copy(vendorId="another-company")),owner.copy(scope=scope.copy(binding=scope.binding.copy(guardId="another-guard"))),
   owner.copy(scope=scope.copy(binding=scope.binding.copy(siteId="another-site"))),owner.copy(scope=scope.copy(binding=scope.binding.copy(assignmentId="another-shift"))),
   owner.copy(scope=scope.copy(binding=scope.binding.copy(deviceThumbprint="d".repeat(64)))),owner.copy(scope=scope.copy(binding=scope.binding.copy(revocationVersion=2))))
  for(other in others){
   assertNull(db.saved(other,"end"));rejected{db.accept(other,"end",receipt(original))}
   val own=db.prepare(other,"end","Separately confirmed reason");assertNotEquals(original.getString("request_id"),own.getString("request_id"));assertFalse(db.saved(other,"end")!!.toString().contains(reason))
   rejected{db.accept(other,"end",receipt(original))};assertFalse(db.saved(other,"end")!!.has("receipt"))
  }
  assertEquals(originalBytes,raw(db,key(owner,"end")));assertEquals(original.toString(),db.prepare(owner,"end",reason).toString())
 }}

 @Test fun sameOwnerReopensExactOriginalRequestAndReceiptWithoutAddingWireFields(){isolated{db,name->
  val request=db.prepare(owner,"end",reason);val requestBytes=request.toString();val original=raw(db,key(owner,"end"))
  assertEquals(setOf("request_id","action","confirmed","reason"),request.keys().asSequence().toSet());assertTrue(request.getBoolean("confirmed"))
  for(privateValue in listOf(reason,owner.subject,owner.configuration,owner.deviceId,"guard-a"))assertFalse(original.contains(privateValue))
  val decoded=JSONObject(String(DeviceCipher().decrypt(original,"shift-transition:${key(owner,"end")}"),Charsets.UTF_8));assertEquals(owner.json().toString(),decoded.getJSONObject("connected_owner").toString())
  db.close();ShiftTransitionStore(context,name).use{reopened->
   assertEquals(requestBytes,reopened.prepare(owner,"end",reason).toString());assertEquals(original,raw(reopened,key(owner,"end")))
   rejected{reopened.prepare(owner,"end","Changed reason")};assertEquals(original,raw(reopened,key(owner,"end")))
   val accepted=receipt(request);assertTrue(reopened.accept(owner,"end",accepted));assertTrue(reopened.accept(owner,"end",accepted))
   assertEquals(requestBytes,reopened.prepare(owner,"end",reason).toString());assertEquals(accepted.toString(),reopened.saved(owner,"end")!!.getJSONObject("receipt").toString())
   rejected{reopened.accept(owner,"end",JSONObject(accepted.toString()).put("reason","Changed receipt"))}
   assertEquals(accepted.toString(),reopened.saved(owner,"end")!!.getJSONObject("receipt").toString())
  }
 }}

 @Test fun rejectedRequestHistoryKeepsOriginalOwnerAndNewIntentIsExplicitlySeparate(){isolated{db,_->
  val other=owner.copy(subject=UUID.randomUUID().toString());val separate=db.prepare(other,"end","Other original reason");val separateBytes=raw(db,key(other,"end"))
  val first=db.prepare(owner,"end",reason);val denied=refusal(first);assertFalse(db.accept(owner,"end",denied));assertFalse(db.accept(owner,"end",denied))
  val retained=db.saved(owner,"end")!!.toString();val second=db.prepare(owner,"end","Corrected explicit reason")
  assertNotEquals(first.getString("request_id"),second.getString("request_id"));assertFalse(db.saved(owner,"end")!!.has("rejection"))
  val archive=key(owner,"end")+":"+first.getString("request_id")
  db.readableDatabase.rawQuery("SELECT body FROM rejected_history WHERE owner=?",arrayOf(archive)).use{row->
   assertTrue(row.moveToFirst());val plaintext=String(DeviceCipher().decrypt(row.getString(0),"shift-rejected:$archive"),Charsets.UTF_8);assertEquals(retained,plaintext)
   assertEquals(owner.json().toString(),JSONObject(plaintext).getJSONObject("connected_owner").toString())
  }
  assertEquals(separateBytes,raw(db,key(other,"end")));assertEquals(separate.toString(),db.saved(other,"end")!!.getJSONObject("request").toString())
 }}

 @Test fun missingOrRelabelledEncryptedOwnerFailsClosedWithoutNewConfirmation(){isolated{db,_->
  val request=db.prepare(owner,"end",reason);val k=key(owner,"end");val aad="shift-transition:$k";val original=raw(db,k);val decoded=JSONObject(String(DeviceCipher().decrypt(original,aad),Charsets.UTF_8))
  val changes=listOf<(JSONObject)->Unit>({it.remove("connected_owner")},{it.getJSONObject("connected_owner").put("subject",UUID.randomUUID().toString())},{it.getJSONObject("connected_owner").put("version","1")})
  try{for(change in changes){
   val invalid=JSONObject(decoded.toString());change(invalid);val encrypted=DeviceCipher().encrypt(invalid.toString().toByteArray(Charsets.UTF_8),aad)
   db.writableDatabase.update("transitions",ContentValues().apply{put("body",encrypted)},"owner=?",arrayOf(k))
   rejected{db.saved(owner,"end")};rejected{db.prepare(owner,"end",reason)};rejected{db.accept(owner,"end",receipt(request))};assertEquals(encrypted,raw(db,k))
   db.readableDatabase.rawQuery("SELECT count(*) FROM transitions",null).use{assertTrue(it.moveToFirst());assertEquals(1,it.getInt(0))}
  }}finally{db.writableDatabase.update("transitions",ContentValues().apply{put("body",original)},"owner=?",arrayOf(k))}
  assertEquals(request.toString(),db.prepare(owner,"end",reason).toString())
 }}

 @Test fun independentHelpersPrepareOneOriginalIdAndHistoryFailureRollsBack(){isolated{db,name->
  db.writableDatabase
  ShiftTransitionStore(context,name).use{other->
   other.writableDatabase;val ready=CountDownLatch(2);val start=CountDownLatch(1);val done=CountDownLatch(2);val requests=ConcurrentLinkedQueue<String>();val failures=ConcurrentLinkedQueue<Throwable>()
   val threads=listOf(db,other).map{store->Thread{
    ready.countDown();try{check(start.await(5,TimeUnit.SECONDS));requests.add(store.prepare(owner,"end",reason).toString())}catch(error:Throwable){failures.add(error)}finally{done.countDown()}
   }.apply{start()}}
   try{assertTrue(ready.await(5,TimeUnit.SECONDS));start.countDown();assertTrue("Original intent workers did not finish",done.await(15,TimeUnit.SECONDS))}finally{start.countDown();for(thread in threads)thread.join(2000)}
   assertTrue("Unexpected original-intent race failure",failures.isEmpty());assertEquals(2,requests.size);assertEquals(1,requests.toSet().size)
  }
  val request=db.saved(owner,"end")!!.getJSONObject("request");assertFalse(db.accept(owner,"end",refusal(request)));val original=raw(db,key(owner,"end"))
  db.writableDatabase.execSQL("CREATE TEMP TRIGGER fail_connected_archive BEFORE INSERT ON rejected_history BEGIN SELECT RAISE(ABORT,'synthetic archive failure'); END")
  try{rejected{db.prepare(owner,"end","Corrected explicit reason")};assertEquals(original,raw(db,key(owner,"end")));db.readableDatabase.rawQuery("SELECT count(*) FROM rejected_history",null).use{assertTrue(it.moveToFirst());assertEquals(0,it.getInt(0))}}
  finally{db.writableDatabase.execSQL("DROP TRIGGER fail_connected_archive")}
  assertNotEquals(request.getString("request_id"),db.prepare(owner,"end","Corrected explicit reason").getString("request_id"))
 }}
}
