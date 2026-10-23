package ca.mercury.guard

import android.location.Location
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.action.ViewActions.scrollTo
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyFactory
import java.security.KeyStore
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.UUID

class EscalationDeviceTest {
 @Test fun optionalLocationRejectsMockStaleFutureMissingAndPoorFixes(){
  val at=1700000000000L;val now=900000000000L
  fun fix()=Location("gps").apply{latitude=45.0;longitude=-73.0;accuracy=5f;elapsedRealtimeNanos=now-1000000000L}
  assertEquals(at-1000,EscalationLocationCapture.fromLocation(fix(),at,now)!!.atMillis)
  assertNull(EscalationLocationCapture.fromLocation(null,at,now))
  if(android.os.Build.VERSION.SDK_INT>=31)assertNull(EscalationLocationCapture.fromLocation(fix().apply{isMock=true},at,now))
  assertNull(EscalationLocationCapture.fromLocation(fix().apply{elapsedRealtimeNanos=now-300001000000L},at,now))
  assertNull(EscalationLocationCapture.fromLocation(fix().apply{elapsedRealtimeNanos=now+1},at,now))
  assertNull(EscalationLocationCapture.fromLocation(fix().apply{elapsedRealtimeNanos=0},at,now))
  assertNull(EscalationLocationCapture.fromLocation(fix().apply{removeAccuracy()},at,now))
  assertNull(EscalationLocationCapture.fromLocation(fix().apply{accuracy=1001f},at,now))
 }
 @Test fun keystoreProofBindsExactUtf8BytesOperationAudienceNonceAndInstallation(){
  val context=InstrumentationRegistry.getInstrumentation().targetContext;val suffix=UUID.randomUUID().toString();val alias="escalation-proof-$suffix";val marker="escalation-proof-$suffix"
  try{
   val identity=DeviceIdentity(context,alias,marker);val public=identity.create();val raw="{\"description\":\"Café 🚨\"}";val hash=EscalationProtocol.hash(raw)
   val nonce=Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32){it.toByte()});val request=UUID.randomUUID().toString();val proof=identity.signEscalationChallenge("mercury-local","create",request,nonce,hash)
   val key=KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.getUrlDecoder().decode(proof.getString("public_key_spki"))))
   fun verifies(message:String)=Signature.getInstance("SHA256withECDSA").run{initVerify(key);update(message.toByteArray(Charsets.UTF_8));verify(Base64.getUrlDecoder().decode(proof.getString("signature_der")))}
   val message="mercury-escalation-proof-v1\nmercury-local\ncreate\n$request\n$nonce\n${public.thumbprint}\n$hash"
   assertTrue(verifies(message));assertFalse(verifies(message.replace("\ncreate\n","\nstatus\n")));assertFalse(verifies(message.replace(hash,EscalationProtocol.hash(raw+" "))))
   assertFalse(verifies(message.replace("mercury-local","other-audience")));assertFalse(verifies(message.replace(public.thumbprint,"a".repeat(64))))
   for(op in listOf("dispatch","CREATE")){try{identity.signEscalationChallenge("mercury-local",op,request,nonce,hash);fail("Operation accepted")}catch(_:IllegalArgumentException){}}
  }finally{KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)};File(context.noBackupFilesDir,marker).delete()}
 }
 @Test fun launcherEscalationOffersTheConnectedAccountRouteWithoutImportingDemoData(){
  ActivityScenario.launch(MainActivity::class.java).use{scenario->
   scenario.onActivity{activity->
    val open=MainActivity::class.java.getDeclaredMethod("showEscalation");open.isAccessible=true;open.invoke(activity)
   }
   onView(withText("Guard service escalation")).perform(scrollTo(),click())
   onView(withText("ESCALATE · NOT SIGNED IN")).check(matches(isDisplayed()))
  }
 }
 @Test fun unverifiedAccountOffersEscalateWithoutSavingOrClaimingAnOperatorWasContacted(){
  val context=InstrumentationRegistry.getInstrumentation().targetContext
  val intent=android.content.Intent(context,GuardAccountActivity::class.java).putExtra("open_escalation",true)
  ActivityScenario.launch<GuardAccountActivity>(intent).use{scenario->
   onView(withText("ESCALATE · NOT SIGNED IN")).check(matches(isDisplayed()))
   onView(withText("Open phone dialer")).perform(scrollTo()).check(matches(isDisplayed()))
   onView(withText("Return to sign-in")).perform(scrollTo(),click())
  }
 }
}
