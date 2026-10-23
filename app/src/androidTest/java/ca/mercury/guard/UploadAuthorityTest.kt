package ca.mercury.guard

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyPairGenerator
import java.util.Base64
import java.util.UUID

class UploadAuthorityTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private fun config(endpoint:String="https://example.test"):GuardServiceConfig {
  val key=KeyPairGenerator.getInstance("RSA").apply{initialize(2048)}.generateKeyPair().public
  return GuardServiceConfig.parse(JSONObject().put("endpoint",endpoint).put("issuer","test").put("audience","mercury-local").put("device_id","phone")
   .put("issuer_keys",JSONObject().put("test",Base64.getUrlEncoder().withoutPadding().encodeToString(key.encoded))).toString())
 }
 @Test fun encryptedAuthoritySurvivesReopenButNotExpiryRestartOrConfigurationChange(){
  val name="upload-test-${UUID.randomUUID()}";val config=config();var now=android.os.SystemClock.elapsedRealtime();val base=now;var boot=3
  val store=UploadAuthorityStore(context,name,{now},{boot});val token="synthetic-upload-token-never-a-real-session"
  try{
   val authority=store.authorize(config,GuardAccountClient.Session(token,base+60000),"guard-a","vendor-a","a".repeat(64))
   val raw=File(context.noBackupFilesDir,name).readText();assertFalse(raw.contains(token));assertFalse(raw.contains("guard-a"));assertFalse(raw.contains(config.endpoint))
   val reopened=UploadAuthorityStore(context,name,{now},{boot});assertEquals(authority.generation,reopened.load(config,"a".repeat(64))!!.generation)
   val touched=reopened.touch(config,"a".repeat(64))!!;assertEquals(authority.generation,touched.generation);assertEquals(authority.expiresElapsed,touched.expiresElapsed);assertEquals(1,touched.workVersion)
   now=base+60000;assertNull(reopened.load(config,"a".repeat(64)));assertFalse(File(context.noBackupFilesDir,name).exists())
   now=base;store.authorize(config,GuardAccountClient.Session(token,base+60000),"guard-a","vendor-a","a".repeat(64));boot++;assertNull(reopened.load(config,"a".repeat(64)))
   store.authorize(config,GuardAccountClient.Session(token,base+60000),"guard-a","vendor-a","a".repeat(64));assertNull(reopened.load(config("https://other.test"),"a".repeat(64)))
  }finally{store.clear()}
 }
 @Test fun switchAndExplicitSignOutFenceOldWorkWithoutClearingAnotherGeneration(){
  val name="upload-test-${UUID.randomUUID()}";val c=config();val now=android.os.SystemClock.elapsedRealtime();val store=UploadAuthorityStore(context,name,{now},{1})
  try{
   val a=store.authorize(c,GuardAccountClient.Session("synthetic-a",now+60000),"guard-a","vendor-company","a".repeat(64))
   val b=store.authorize(c,GuardAccountClient.Session("synthetic-b",now+60000),"guard-b","vendor-company","a".repeat(64))
   assertFalse(store.current(a,c));assertTrue(store.current(b,c));assertEquals("guard-b",store.load(c,"a".repeat(64))!!.guardId)
   store.clear(a.generation);assertTrue(store.current(b,c));store.clear();assertFalse(store.current(b,c));assertNull(store.load(c,"a".repeat(64)))
  }finally{store.clear()}
 }
 @Test fun corruptedOrWrongInstallationAuthorityFailsClosed(){
  val name="upload-test-${UUID.randomUUID()}";val c=config();val now=android.os.SystemClock.elapsedRealtime();val store=UploadAuthorityStore(context,name,{now},{1})
  try{
   store.authorize(c,GuardAccountClient.Session("synthetic",now+60000),"guard","vendor","a".repeat(64));assertNull(store.load(c,"b".repeat(64)))
   File(context.noBackupFilesDir,name).writeText("corrupt");assertNull(store.load(c,"a".repeat(64)))
  }finally{store.clear()}
 }
 @Test fun persistedNetworkJobHasNoCredentialsAndOnlySystemCanBind(){
  val coordinator=UploadCoordinator(context);val job=coordinator.job(context)
  assertTrue(job.isPersisted);assertEquals(android.app.job.JobInfo.NETWORK_TYPE_ANY,job.networkType);assertTrue(job.extras.isEmpty)
  assertEquals(android.app.job.JobInfo.BACKOFF_POLICY_EXPONENTIAL,job.backoffPolicy);assertEquals(30000L,job.initialBackoffMillis)
  val service=context.packageManager.getServiceInfo(android.content.ComponentName(context,UploadJobService::class.java),0)
  assertFalse(service.exported);assertEquals("android.permission.BIND_JOB_SERVICE",service.permission)
  for(permission in listOf(android.Manifest.permission.ACCESS_NETWORK_STATE,android.Manifest.permission.RECEIVE_BOOT_COMPLETED))assertEquals(android.content.pm.PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(permission))
 }
 @Test fun unconfiguredPreviewCannotScheduleAnyNetworkWork(){
  org.junit.Assume.assumeTrue(GuardServiceConfig.load(context)==null)
  assertFalse(UploadCoordinator(context).request())
 }
}
