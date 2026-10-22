package ca.mercury.guard

import android.app.*
import android.content.*
import android.graphics.Bitmap
import android.os.*
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import java.io.File

class AttentionCaptureTest {
 @Test fun captureNotificationAndUserOpenedAlert() {
  val ins=InstrumentationRegistry.getInstrumentation();val c=ins.targetContext
  assumeTrue(InstrumentationRegistry.getArguments().getString("captureAttention")=="true")
  assumeTrue(android.os.Build.MODEL.contains("sdk",ignoreCase=true)); assumeTrue(Build.VERSION.SDK_INT==28)
  fun shell(cmd:String)=ins.uiAutomation.executeShellCommand(cmd).use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).bufferedReader().readText() }
  val dir=File(c.getExternalFilesDir(null),"attention-preview").apply{mkdirs()}
  fun shot(name:String) { val bitmap=ins.uiAutomation.takeScreenshot();File(dir,"$name.png").outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle() }
  val previous=shell("settings get global animator_duration_scale").trim()
  val store=GuardStore(c)
  try {
   shell("wm size reset");shell("wm density reset");SystemClock.sleep(2000);shell("settings put global animator_duration_scale 1")
   DemoSession(c).end();DemoSession(c).start();val session=DemoSession(c).identity()
   val id="$session:attention-fixture";val due=SystemClock.elapsedRealtime()
   store.recordOnce("duty_due",id,JSONObject().put("session",session).put("kind","readiness").put("due_elapsed",due).put("synthetic_test",true))
   val p=DutyPrompt(id,"readiness",due);val delivery=DutyAlertDelivery(c,store)
   shell("input keyevent 223");SystemClock.sleep(1000)
   delivery.update(listOf(p))
   val manager=c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
   assertTrue(manager.activeNotifications.any{it.id==DutyAlertDelivery.NOTE})
   val power=c.getSystemService(Context.POWER_SERVICE) as PowerManager
   val screenOff=!power.isInteractive
   shell("input keyevent 224");SystemClock.sleep(2000);shot("01-notification-after-screen-wake")
   val keyguard=c.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
   val before=keyguard.isKeyguardLocked
   // Explicit synthetic user-open action, never an automatic background launch in production.
   manager.activeNotifications.first{it.id==DutyAlertDelivery.NOTE}.notification.contentIntent.send()
   SystemClock.sleep(6000)
   val after=keyguard.isKeyguardLocked
   val recording=ins.uiAutomation.executeShellCommand("screenrecord --size 928x1200 --bit-rate 5000000 --time-limit 8 /sdcard/mercury-attention.mp4")
   SystemClock.sleep(1000);shot("02-user-opened-alert")
   SystemClock.sleep(8000);recording.close()
   c.getSharedPreferences("mercury_local",0).edit().putBoolean("steady_alert",true).commit()
   shell("input keyevent 223");shell("input keyevent 224");SystemClock.sleep(2000);shot("03-steady-alert")
   File(dir,"capture-evidence.json").writeText(JSONObject().put("screen_off_when_posted",screenOff).put("keyguard_before_open",before).put("keyguard_after_open",after).put("secure_keyguard",keyguard.isDeviceSecure).put("biometric_completed",DutyPrompts(store).has("duty_completed",id)).put("channel_vibration",manager.getNotificationChannel(DutyAlertDelivery.CHANNEL).shouldVibrate()).toString(2))
   assertFalse(DutyPrompts(store).has("duty_completed",id))
   delivery.silence(p); assertFalse(manager.activeNotifications.any{it.id==DutyAlertDelivery.NOTE})
  } finally {
   DutyAlertDelivery(c,store).stop();store.close();DemoSession(c).end()
   c.getSharedPreferences("mercury_local",0).edit().remove("steady_alert").commit()
   shell("settings put global animator_duration_scale $previous");shell("wm size reset");shell("wm density reset");shell("input keyevent 224")
  }
 }
}
