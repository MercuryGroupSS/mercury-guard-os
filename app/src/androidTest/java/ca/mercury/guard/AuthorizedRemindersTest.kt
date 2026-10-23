package ca.mercury.guard
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyStore
import java.util.UUID

class AuthorizedRemindersTest {
 @Test fun encryptedScheduleSurvivesRecreationAndStopsForOtherGuardOrBoot(){
  val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
  val suffix=UUID.randomUUID().toString();val alias="test.reminders.$suffix";val marker="reminders-$suffix";val prefsName="reminders-$suffix"
  val identity=DeviceIdentity(context,alias,marker);var boot=1
  fun reminders()=AuthorizedReminders(context,prefsName,identity,{1000},{boot},{true})
  val r=reminders()
  try{
   val binding=GrantBinding("private-guard","private-site","assignment",identity.create().thumbprint,1)
   val grant=VerifiedShiftGrant("test-grant",binding,setOf("check_in"),100,10000,1)
   val policy=JSONObject().put("revision",1).put("starts_at",10000000).put("ends_at",11000000).put("interval_ms",60000).put("window_ms",10000).put("max_evidence_age_ms",5000).put("max_accuracy_m",100)
   r.enable(policy,binding,grant,ServerTimeAnchor(1000000,1000,1))
   val raw=context.getSharedPreferences(prefsName,0).getString("schedule",null)!!
   assertFalse(raw.contains("private-guard"));assertFalse(raw.contains("private-site"));assertFalse(raw.contains("test-grant"))
   assertTrue(reminders().status().contains("enabled"))
   reminders().retainForAssignments("other-guard",setOf("assignment"));assertEquals("Reminders off",r.status())
   r.enable(policy,binding,grant,ServerTimeAnchor(1000000,1000,1));boot=2
   assertTrue(reminders().status().contains("restart"));assertNull(context.getSharedPreferences(prefsName,0).getString("schedule",null))
  }finally{
   r.stop();context.deleteSharedPreferences(prefsName)
   KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)}
   File(context.noBackupFilesDir,marker).delete();File(context.noBackupFilesDir,"$marker.bak").delete()
  }
 }
}
