package ca.mercury.guard

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.security.KeyFactory
import java.security.KeyStore
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.UUID

class SignedOutboxTest {
 private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
 private fun isolated(block: (GuardStore, DeviceIdentity, String) -> Unit) {
  val id = UUID.randomUUID().toString(); val alias = "mercury.test.batch.$id"; val marker = "test-batch-$id"; val name = "signed-$id.db"
  val store = GuardStore(context,name)
  try { block(store,DeviceIdentity(context,alias,marker),name) }
  finally {
   store.close(); context.deleteDatabase(name)
   KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
   File(context.noBackupFilesDir,marker).delete(); File(context.noBackupFilesDir,"$marker.bak").delete()
  }
 }
 private fun encoded(bytes: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
 private fun payload(proof: JSONObject) = JSONObject(String(Base64.getUrlDecoder().decode(proof.getString("payload")),Charsets.UTF_8))
 private fun verifies(proof: JSONObject, trusted: DeviceIdentity.PublicIdentity, audience: String = "mercury-staging"): Boolean {
  if (proof.getString("device_thumbprint") != trusted.thumbprint || proof.getString("public_key_spki") != trusted.publicKeySpki || proof.getString("audience") != audience) return false
  val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.getUrlDecoder().decode(trusted.publicKeySpki)))
  return Signature.getInstance("SHA256withECDSA").run {
   initVerify(key); update("mercury-event-batch-v1\n$audience\n${trusted.thumbprint}\n${proof.getString("payload")}".toByteArray(Charsets.US_ASCII))
   verify(Base64.getUrlDecoder().decode(proof.getString("signature_der")))
  }
 }
 private fun reject(block: () -> Unit) { var failed = false; try { block() } catch (_: Exception) { failed = true }; assertTrue(failed) }
 @Test fun signedRetriesKeepPayloadIdsAndPendingStateAcrossReopen() = isolated { store,identity,name ->
  val key = identity.create(); repeat(3) { store.record("test",JSONObject().put("n",it)) }
  val first = SignedOutbox(store,identity).prepare("mercury-staging",2)!!
  assertTrue(verifies(first,key)); val batch = payload(first)
  val reopened = GuardStore(context,name)
  try {
   val retry = SignedOutbox(reopened,identity).prepare("mercury-staging",1)!!
   assertTrue(verifies(retry,key)); assertEquals(first.getString("payload"),retry.getString("payload"))
   assertEquals(3,reopened.pendingCount()); assertEquals(3,reopened.count())
   reopened.acknowledgeBatch(batch.getString("batch_id"),setOf(batch.getJSONArray("events").getJSONObject(0).getString("event_id")))
   val remaining = SignedOutbox(reopened,identity).prepare("mercury-staging")!!
   assertTrue(verifies(remaining,key)); assertNotEquals(batch.getString("batch_id"),payload(remaining).getString("batch_id"))
   assertEquals(batch.getJSONArray("events").getJSONObject(1).getString("event_id"),payload(remaining).getJSONArray("events").getJSONObject(0).getString("event_id"))
   assertEquals(2,reopened.pendingCount()); assertEquals(3,reopened.count())
  } finally { reopened.close() }
 }
 @Test fun alteredContentAudienceAndKeyAreRejectedByIndependentVerification() = isolated { store,identity,_ ->
  val key = identity.create(); store.record("incident",JSONObject().put("description","SYNTHETIC NOTE"))
  val proof = SignedOutbox(store,identity).prepare("mercury-staging")!!
  val changed = JSONObject(proof.toString()); val batch = payload(changed)
  batch.getJSONArray("events").getJSONObject(0).getJSONObject("data").put("description","ALTERED")
  changed.put("payload",encoded(batch.toString().toByteArray(Charsets.UTF_8)))
  assertFalse(verifies(changed,key)); assertFalse(verifies(proof,key,"other-audience"))
  assertFalse(verifies(JSONObject(proof.toString()).put("device_thumbprint","b".repeat(64)),key))
  assertFalse(verifies(JSONObject(proof.toString()).put("public_key_spki","other-key"),key))
  assertEquals(1,store.pendingCount())
 }
 @Test fun missingIdentityCannotInitializeOrPrepareBatch() = isolated { store,identity,_ ->
  store.record("test")
  reject { SignedOutbox(store,identity).prepare("mercury-staging") }
  assertNull(identity.publicIdentity()); assertEquals(1,store.pendingCount())
  store.readableDatabase.rawQuery("SELECT count(*) FROM outbox",null).use { c -> c.moveToFirst(); assertEquals(0,c.getInt(0)) }
 }
 @Test fun malformedBatchesNeverAlterTheQueue() = isolated { store,identity,_ ->
  identity.create(); repeat(2) { store.record("test") }
  val original = store.prepareBatch()!!
  val duplicate = JSONObject(original.toString()).apply {
   getJSONArray("events").getJSONObject(1).put("event_id",getJSONArray("events").getJSONObject(0).getString("event_id"))
  }
  val reversed = JSONObject(original.toString()).apply { getJSONArray("events").getJSONObject(1).put("sequence",0) }
  for (invalid in listOf(duplicate,reversed,JSONObject(original.toString()).put("schema_version","1"),JSONObject(original.toString()).put("extra",true),JSONObject(original.toString()).put("events",JSONArray()),JSONObject(original.toString()).put("batch_id","bad"))) reject { identity.signEventBatch("mercury-staging",invalid) }
  reject { identity.signEventBatch("bad\naudience",original) }
  assertEquals(original.toString(),store.prepareBatch()!!.toString()); assertEquals(2,store.pendingCount())
 }
 @Test fun largeBatchSignsAndVerifiesWithoutLosingEvents() = isolated { store,identity,_ ->
  val key = identity.create(); store.record("test",JSONObject().put("description","x".repeat(200000)))
  val proof = SignedOutbox(store,identity).prepare("mercury-staging")!!
  assertTrue(verifies(proof,key)); assertEquals(200000,payload(proof).getJSONArray("events").getJSONObject(0).getJSONObject("data").getString("description").length)
  assertEquals(1,store.pendingCount()); assertEquals(1,store.count())
 }
}
