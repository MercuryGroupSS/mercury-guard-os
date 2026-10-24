package ca.mercury.guard

import android.content.ContentValues
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.util.UUID

/** Original local ownership only. No account, network, attendance or acknowledgement is created. */
class ConnectedDispatchInboxTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private val scope=DispatchScope(GrantBinding("guard-a","site-a","shift-a","b".repeat(64),1),"company-a")
 private val owner=ConnectedDispatchOwner("a".repeat(64),"site-phone",UUID.randomUUID().toString(),scope)
 private val privateText="Private original instruction — café 🚨"
 private fun message(id:String="message-a",version:Long=1,state:String="active")=JSONObject().put("message_id",id).put("version",version).put("state",state)
  .put("title",if(state=="active")"Site instruction" else "").put("body",if(state=="active")privateText else "").put("issued_at",100).put("due_at",JSONObject.NULL)
 private fun page(cursor:String,vararg messages:JSONObject,forScope:DispatchScope=scope)=JSONObject().put("scope",forScope.json()).put("changes",JSONArray(messages.toList()))
  .put("next_cursor",cursor).put("has_more",false).put("server_time_ms",200)
 private fun rejected(action:()->Unit){var denied=false;try{action()}catch(_:Exception){denied=true};assertTrue("Expected original-owner rejection",denied)}
 private fun isolated(action:(DispatchInbox,String)->Unit){val name="connected-inbox-${UUID.randomUUID()}.db";val db=DispatchInbox(context,name);try{action(db,name)}finally{db.close();context.deleteDatabase(name)}}
 private fun legacyOwner()=MessageDigest.getInstance("SHA-256").digest(scope.json().toString().toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
 private fun storedMessage(db:DispatchInbox,key:String)=db.readableDatabase.rawQuery("SELECT body FROM messages WHERE owner=?",arrayOf(key)).use{check(it.moveToFirst());it.getString(0)}
 private fun storedCursor(db:DispatchInbox,key:String)=db.readableDatabase.rawQuery("SELECT body FROM cursors WHERE owner=?",arrayOf(key)).use{check(it.moveToFirst());it.getString(0)}

 @Test fun everyOriginalAccountAndAssignmentFieldHasAnIndependentCacheAndCursor(){isolated{db,_->
  db.apply(owner,null,page("first",message()));db.markRead(owner,"message-a",1,250)
  val others=listOf(owner.copy(configuration="c".repeat(64)),owner.copy(deviceId="different-phone"),owner.copy(subject=UUID.randomUUID().toString()),
   owner.copy(scope=scope.copy(vendorId="different-company")),owner.copy(scope=scope.copy(binding=scope.binding.copy(guardId="different-guard"))),
   owner.copy(scope=scope.copy(binding=scope.binding.copy(siteId="different-site"))),owner.copy(scope=scope.copy(binding=scope.binding.copy(assignmentId="different-shift"))),
   owner.copy(scope=scope.copy(binding=scope.binding.copy(deviceThumbprint="d".repeat(64)))),owner.copy(scope=scope.copy(binding=scope.binding.copy(revocationVersion=2))))
  for(other in others){
   assertNotEquals(owner.owner(),other.owner());assertNull(db.cursor(other));assertTrue(db.list(other).isEmpty());rejected{db.markRead(other,"message-a",1,300)}
   if(other.scope!=scope)rejected{db.apply(other,null,page("wrong",message()))}
   db.apply(other,null,page("own-first",message(),forScope=other.scope))
   assertTrue(db.list(other).single().isNull("read_at"));assertEquals(250L,db.list(owner).single().getLong("read_at"))
  }
  assertEquals("ConnectedDispatchOwner(redacted)",owner.toString());assertEquals("first",db.cursor(owner))
 }}

 @Test fun legacyCiphertextAndViewedStateArePreservedButNeverAdoptedByConnectedOwners(){isolated{db,name->
  db.apply(scope,null,page("legacy",message()));db.markRead(scope,"message-a",1,250)
  val legacyMessage=storedMessage(db,legacyOwner());val legacyCursor=storedCursor(db,legacyOwner())
  assertNull(db.cursor(owner));assertTrue(db.list(owner).isEmpty());rejected{db.markRead(owner,"message-a",1,300)}
  db.resetCursor(owner,null);db.apply(owner,null,page("connected",message()));assertTrue(db.list(owner).single().isNull("read_at"))
  assertEquals(legacyMessage,storedMessage(db,legacyOwner()));assertEquals(legacyCursor,storedCursor(db,legacyOwner()));assertEquals(250L,db.list(scope).single().getLong("read_at"))
  db.close();DispatchInbox(context,name).use{reopened->
   assertEquals("connected",reopened.cursor(owner));assertTrue(reopened.list(owner).single().isNull("read_at"));assertEquals(legacyMessage,storedMessage(reopened,legacyOwner()))
  }
 }}

 @Test fun fullOwnerUnicodeAndReadReceiptSurviveRestartWithoutPlaintextMetadata(){isolated{db,name->
  db.apply(owner,null,page("original",message()));val viewed=db.markRead(owner,"message-a",1,250)
  assertEquals(privateText,viewed.getJSONObject("message").getString("body"));assertEquals(owner.json().toString(),viewed.getJSONObject("connected_owner").toString())
  for(table in listOf("messages","cursors"))db.readableDatabase.rawQuery("SELECT owner,body FROM $table WHERE owner=?",arrayOf(owner.owner())).use{row->
   assertTrue(row.moveToFirst());for(i in 0..1)for(value in listOf(privateText,owner.subject,owner.configuration,owner.deviceId,"guard-a","company-a"))assertFalse(row.getString(i).contains(value))
  }
  db.close();DispatchInbox(context,name).use{reopened->
   assertEquals("original",reopened.cursor(owner));assertEquals(privateText,reopened.list(owner).single().getJSONObject("message").getString("body"))
   reopened.apply(owner,"original",page("retry",message()));assertEquals(250L,reopened.list(owner).single().getLong("read_at"))
   val before=storedMessage(reopened,owner.owner());rejected{reopened.markRead(owner,"message-a",2,300)};assertEquals(before,storedMessage(reopened,owner.owner()))
  }
 }}

 @Test fun connectedMetadataCannotBeRemovedRelabelledOrReplacedOnConflict(){isolated{db,_->
  db.apply(owner,null,page("first",message()));val cipher=DeviceCipher();val key=owner.owner()
  val originalCursor=storedCursor(db,key);val cursorAad="dispatch-cursor:$key"
  val unowned=JSONObject(String(cipher.decrypt(originalCursor,cursorAad),Charsets.UTF_8)).apply{remove("connected_owner")}
  val corruptCursor=cipher.encrypt(unowned.toString().toByteArray(Charsets.UTF_8),cursorAad)
  db.writableDatabase.update("cursors",ContentValues().apply{put("body",corruptCursor)},"owner=?",arrayOf(key))
  rejected{db.cursor(owner)};rejected{db.resetCursor(owner,"first")};rejected{db.apply(owner,"first",page("replacement",message()))};assertEquals(corruptCursor,storedCursor(db,key))
  db.writableDatabase.update("cursors",ContentValues().apply{put("body",originalCursor)},"owner=?",arrayOf(key))
  val lookup=MessageDigest.getInstance("SHA-256").digest("message-a".toByteArray()).joinToString(""){"%02x".format(it.toInt() and 255)}
  val aad="dispatch-message:$key:$lookup";val originalMessage=storedMessage(db,key)
  val relabelled=JSONObject(String(cipher.decrypt(originalMessage,aad),Charsets.UTF_8)).apply{getJSONObject("connected_owner").put("subject",UUID.randomUUID().toString())}
  val corruptMessage=cipher.encrypt(relabelled.toString().toByteArray(Charsets.UTF_8),aad)
  db.writableDatabase.update("messages",ContentValues().apply{put("body",corruptMessage)},"owner=?",arrayOf(key))
  rejected{db.list(owner)};rejected{db.markRead(owner,"message-a",1,250)}
  rejected{db.apply(owner,"first",page("not-committed",message("new-before-conflict"),message()))}
  assertEquals("first",db.cursor(owner));assertEquals(corruptMessage,storedMessage(db,key))
  db.readableDatabase.rawQuery("SELECT count(*) FROM messages WHERE owner=?",arrayOf(key)).use{assertTrue(it.moveToFirst());assertEquals(1,it.getInt(0))}
 }}

 @Test fun versionsRetractionsResetAndLateRollbackStayWithinOriginalOwner(){isolated{db,_->
  val second=owner.copy(subject=UUID.randomUUID().toString())
  db.apply(owner,null,page("first",message()));db.markRead(owner,"message-a",1,250);db.apply(second,null,page("separate",message()))
  val separateBytes=storedMessage(db,second.owner());val separateCursor=storedCursor(db,second.owner())
  rejected{db.apply(owner,"first",page("bad",message("new-before-conflict"),message().put("body","changed at same version")))}
  assertEquals("first",db.cursor(owner));assertEquals(1,db.list(owner).size);assertEquals(250L,db.list(owner).single().getLong("read_at"))
  db.apply(owner,"first",page("v2",message(version=2)));assertTrue(db.list(owner).single().isNull("read_at"));db.markRead(owner,"message-a",2,350)
  db.resetCursor(owner,"v2");assertNull(db.cursor(owner));assertTrue(db.list(owner).isEmpty())
  db.apply(owner,null,page("full",message(version=2)));assertEquals(350L,db.list(owner).single().getLong("read_at"))
  db.apply(owner,"full",page("retracted",message(version=3,state="retracted")));assertTrue(db.list(owner).isEmpty());rejected{db.markRead(owner,"message-a",3,400)}
  rejected{db.apply(owner,"retracted",page("old-version",message(version=2)))}
  assertEquals(separateBytes,storedMessage(db,second.owner()));assertEquals(separateCursor,storedCursor(db,second.owner()));assertEquals("retracted",db.cursor(owner))
 }}

 @Test fun connectedPagesStayBoundedAndInvalidOwnersCannotNameAnExistingPartition(){isolated{db,_->
  val first=(0 until 25).map{message("instruction-$it")}.toTypedArray();val rest=(25 until 31).map{message("instruction-$it")}.toTypedArray()
  db.apply(owner,null,page("page1",*first));db.apply(owner,"page1",page("page2",*rest));assertEquals(30,db.list(owner).size);assertEquals(1,db.list(owner,30).size)
  rejected{db.list(owner,-1)};rejected{owner.copy(subject="not-a-subject")};rejected{owner.copy(configuration="https://wrong.invalid")};rejected{owner.copy(deviceId="")}
  rejected{owner.copy(scope=scope.copy(binding=scope.binding.copy(deviceThumbprint="not-a-key")))}
  rejected{owner.copy(scope=scope.copy(binding=scope.binding.copy(revocationVersion=-1)))}
  assertEquals("page2",db.cursor(owner));assertEquals(30,db.list(owner).size)
 }}
}
