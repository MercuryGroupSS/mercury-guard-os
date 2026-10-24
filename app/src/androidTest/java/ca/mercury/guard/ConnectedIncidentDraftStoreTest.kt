package ca.mercury.guard

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.io.Closeable
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Isolated synthetic drafts. No service, credentials, submission or hardware action. */
class ConnectedIncidentDraftStoreTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private class Fixture(private val context:Context):Closeable{
  private val name="connected-draft-test-${UUID.randomUUID()}.db"
  val store=open()
  fun open()=ConnectedIncidentDraftStore(context,name)
  override fun close(){store.close();context.deleteDatabase(name)}
 }
 private fun scope()=ConnectedIncidentDraftScope("a".repeat(64),"synthetic-phone","b".repeat(64),"11111111-1111-4111-8111-111111111111","synthetic-guard","synthetic-company","synthetic-site","synthetic-assignment")
 private fun rejected(action:()->Unit){var rejected=false;try{action()}catch(_:Exception){rejected=true};assertTrue("Draft mutation must fail closed",rejected)}

 @Test fun exactUnsubmittedTextIsEncryptedAndSurvivesHelperAndProcessStyleReopen(){Fixture(context).use{f->
  val scope=scope();val text="  Synthetic incident only — café 🚀\n  unfinished second line  "
  assertNull(f.store.read(scope));f.store.write(scope,text);assertEquals(text,f.store.read(scope))
  f.store.readableDatabase.rawQuery("SELECT owner,body FROM drafts",null).use{cursor->assertTrue(cursor.moveToFirst());assertEquals(scope.owner(),cursor.getString(0));for(secret in listOf("Synthetic incident",scope.guardId,scope.subject,scope.assignmentId))assertFalse(cursor.getString(1).contains(secret))}
  f.store.close();f.open().use{reopened->assertEquals(text,reopened.read(scope));assertEquals(1,reopened.readableDatabase.rawQuery("SELECT count(*) FROM drafts",null).use{it.moveToFirst();it.getInt(0)})}
 }}

 @Test fun everyOriginalAccountConfigurationInstallationAndAssignmentBoundaryIsIsolated(){Fixture(context).use{f->
  val original=scope();f.store.write(original,"Original individual draft")
  val others=listOf(original.copy(configuration="c".repeat(64)),original.copy(deviceId="another-phone"),original.copy(thumbprint="d".repeat(64)),original.copy(subject="22222222-2222-4222-8222-222222222222"),original.copy(guardId="another-guard"),original.copy(vendorId="another-company"),original.copy(siteId="another-site"),original.copy(assignmentId="another-assignment"))
  for((index,other)in others.withIndex()){
   assertNull(f.store.read(other));assertFalse(f.store.clear(other,"Original individual draft"));f.store.write(other,"Another scope $index");assertEquals("Another scope $index",f.store.read(other));assertEquals("Original individual draft",f.store.read(original))
  }
  // No grant ID, expiry or revocation field is added on renewal: the same original scope recovers.
  f.open().use{reopened->assertEquals("Original individual draft",reopened.read(original.copy()))}
 }}

 @Test fun explicitCompareAndClearNeverErasesANewerEditOrAnotherScope(){Fixture(context).use{f->
  val scope=scope();val other=scope.copy(guardId="another-guard");f.store.write(scope,"Submitted text");f.store.write(other,"Another guard draft")
  f.store.write(scope,"Newer unfinished text");assertFalse(f.store.clear(scope,"Submitted text"));assertEquals("Newer unfinished text",f.store.read(scope))
  assertTrue(f.store.clear(scope,"Newer unfinished text"));assertNull(f.store.read(scope));assertFalse(f.store.clear(scope,"Newer unfinished text"));assertEquals("Another guard draft",f.store.read(other))
  f.store.write(scope,"");assertEquals("",f.store.read(scope));assertTrue(f.store.clear(scope,""))
 }}

 @Test fun concurrentStaleClearAndNewEditKeepTheNewTextAcrossIndependentHelpers(){Fixture(context).use{f->
  val scope=scope();f.store.write(scope,"Old draft");val start=CountDownLatch(1);val workers=Executors.newFixedThreadPool(2)
  try{
   val write=workers.submit{start.await();f.open().use{it.write(scope,"New edit")}}
   val clear=workers.submit{start.await();f.open().use{it.clear(scope,"Old draft")}}
   start.countDown();write.get(20,TimeUnit.SECONDS);clear.get(20,TimeUnit.SECONDS);assertEquals("New edit",f.store.read(scope))
  }finally{workers.shutdownNow()}
 }}

 @Test fun invalidEditsPreserveTheOriginalAndNoWhitespaceIsSilentlyRelabelled(){Fixture(context).use{f->
  val scope=scope();val original="x".repeat(ConnectedIncidentDraftStore.MAX_LENGTH);f.store.write(scope,original)
  rejected{f.store.write(scope,original+"x")};rejected{f.store.write(scope,"unpaired\ud800")};assertEquals(original,f.store.read(scope))
  f.store.write(scope," \n ");assertEquals(" \n ",f.store.read(scope));assertFalse(f.store.clear(scope,""));assertEquals(" \n ",f.store.read(scope))
 }}

 @Test fun corruptedOriginalFailsClosedWithoutOverwriteOrClear(){Fixture(context).use{f->
  val scope=scope();f.store.write(scope,"Original retained text")
  f.store.writableDatabase.execSQL("UPDATE drafts SET body=? WHERE owner=?",arrayOf("damaged-ciphertext",scope.owner()))
  rejected{f.store.read(scope)};rejected{f.store.write(scope,"Replacement must not erase the original")};rejected{f.store.clear(scope,"Original retained text")}
  f.store.readableDatabase.rawQuery("SELECT body FROM drafts WHERE owner=?",arrayOf(scope.owner())).use{assertTrue(it.moveToFirst());assertEquals("damaged-ciphertext",it.getString(0))}
 }}
}
