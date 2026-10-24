package ca.mercury.guard

import android.app.*
import android.content.*
import android.os.*
import android.provider.Settings
import org.json.JSONObject
import java.util.UUID

/** One device reminder schedule. No account credentials or capture authority are persisted. */
class AuthorizedReminders internal constructor(private val context:Context,private val prefsName:String="authorized_reminders",
 private val identity:DeviceIdentity=DeviceIdentity(context),private val elapsedNow:()->Long={SystemClock.elapsedRealtime()},
 private val bootNow:()->Int={Settings.Global.getInt(context.contentResolver,Settings.Global.BOOT_COUNT,-1)},
 private val notificationAccess:(()->Boolean)?=null) {
 private val prefs=context.getSharedPreferences(prefsName,Context.MODE_PRIVATE)
 private val alarm=context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
 private val notes=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
 private val cipher=DeviceCipher()
 companion object {const val CHANNEL="mercury_authorized_checks";const val NOTE=811;private const val PURPOSE="mercury-authorized-reminders-v1";private val lock=Any()}
 private fun intent()=PendingIntent.getBroadcast(context,NOTE,Intent(context,AuthorizedReminderReceiver::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
 private fun read():JSONObject?=prefs.getString("schedule",null)?.let{JSONObject(String(cipher.decrypt(it,PURPOSE),Charsets.UTF_8))}
 private fun write(value:JSONObject){check(prefs.edit().putString("schedule",cipher.encrypt(value.toString().toByteArray(Charsets.UTF_8),PURPOSE)).commit())}
 fun stop()=synchronized(lock){alarm.cancel(intent());notes.cancel(NOTE);check(prefs.edit().remove("schedule").commit())}
 /** A clock-out applies only to the original assignment's reminder schedule. */
 fun stopForAssignment(binding:GrantBinding):Boolean=synchronized(lock){
  try{
   val s=read()?:return@synchronized false
   if(s.getString("guard")!=binding.guardId||s.getString("site")!=binding.siteId||s.getString("assignment")!=binding.assignmentId||s.getString("thumbprint")!=binding.deviceThumbprint||s.getLong("revocation")!=binding.revocationVersion)return@synchronized false
   stop();true
  }catch(_:Exception){stop();true}
 }
 fun exactAvailable()=Build.VERSION.SDK_INT<31||alarm.canScheduleExactAlarms()
 private fun ensureChannel(){if(notes.getNotificationChannel(CHANNEL)==null)notes.createNotificationChannel(NotificationChannel(CHANNEL,"Authorized check-in reminders",NotificationManager.IMPORTANCE_HIGH).apply{description="One reminder per assigned check-in window";enableVibration(true);lockscreenVisibility=Notification.VISIBILITY_PRIVATE})}
 fun notificationsAvailable():Boolean {ensureChannel();return notificationAccess?.invoke()?: (DeviceReadiness(context).notificationPermissionGranted()&&notes.areNotificationsEnabled()&&notes.getNotificationChannel(CHANNEL)?.importance!=NotificationManager.IMPORTANCE_NONE)}
 fun enable(policy:JSONObject,binding:GrantBinding,grant:VerifiedShiftGrant,anchor:ServerTimeAnchor)=synchronized(lock){
  val elapsed=elapsedNow();val boot=bootNow()
  check(grant.permits("check_in",binding,elapsed,boot));check(anchor.bootCount==boot&&elapsed>=anchor.elapsedMillis)
  check(identity.publicIdentity()?.thumbprint==binding.deviceThumbprint);check(notificationsAvailable())
  val parsed=AuthorizedCheckInPolicy.parse(policy);val now=Math.addExact(anchor.epochMillis,elapsed-anchor.elapsedMillis);check(now<parsed.endsAt)
  stop()
  write(JSONObject().put("id",UUID.randomUUID().toString()).put("policy",JSONObject(policy.toString())).put("epoch",anchor.epochMillis).put("elapsed",anchor.elapsedMillis).put("boot",boot)
   .put("guard",binding.guardId).put("site",binding.siteId).put("assignment",binding.assignmentId).put("thumbprint",binding.deviceThumbprint).put("revocation",binding.revocationVersion).put("last_attempt",-1))
  refresh()
 }
 /** A different signed-in guard must not inherit the previous guard's reminder schedule. */
 fun retainForAssignments(guardId:String,assignmentIds:Set<String>)=synchronized(lock){try{val s=read();if(s!=null&&(s.getString("guard")!=guardId||s.getString("assignment") !in assignmentIds))stop()}catch(_:Exception){stop()}}
 fun status():String=synchronized(lock){
  try{val s=read()?:return@synchronized "Reminders off";val p=AuthorizedCheckInPolicy.parse(s.getJSONObject("policy"));
   if(s.getInt("boot")!=bootNow()){stop();return@synchronized "Reminders off after restart; sign in and enable again"}
   "Reminders ${if(notificationsAvailable())"enabled" else "blocked by notification settings"} until ${java.util.Date(p.endsAt)} · ${if(exactAvailable())"precise alarm access available" else "Android may delay reminders"}"
  }catch(_:Exception){stop();"Reminders unavailable; enable again after sign-in"}
 }
 fun refresh()=synchronized(lock){
  try{
   val s=read()?:return@synchronized
   val elapsed=elapsedNow();val boot=bootNow()
   if(boot<0||s.getInt("boot")!=boot||elapsed<s.getLong("elapsed")||identity.publicIdentity()?.thumbprint!=s.getString("thumbprint")){stop();return@synchronized}
   val p=AuthorizedCheckInPolicy.parse(s.getJSONObject("policy"));val now=Math.addExact(s.getLong("epoch"),elapsed-s.getLong("elapsed"))
   if(now>=p.endsAt){stop();return@synchronized}
   val binding=GrantBinding(s.getString("guard"),s.getString("site"),s.getString("assignment"),s.getString("thumbprint"),s.getLong("revocation"))
   val slot=if(now<p.startsAt)-1 else p.slotAt(now)
   val due=if(slot>=0)Math.addExact(p.startsAt,Math.multiplyExact(slot,p.interval)) else p.startsAt
   var saved=false
   if(slot>=0){val db=ScopedEventStore(context);try{saved=db.checkInRecorded(binding,p.revision,slot)}finally{db.close()}}
   val decision=ReminderTiming.evaluate(p.startsAt,p.endsAt,p.interval,p.window,now,s.getLong("last_attempt"),saved)
   if(decision.notify&&notificationsAvailable()){
    // Persist before delivery; a crash may skip one cue, never replay a burst.
    s.put("last_attempt",slot);write(s)
    val open=PendingIntent.getActivity(context,NOTE,Intent(context,GuardAccountActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val note=Notification.Builder(context,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Mercury One · check-in due")
     .setContentText("Sign in to complete the assigned check. Opening this reminder does not complete it.").setContentIntent(open).setCategory(Notification.CATEGORY_REMINDER)
     .setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(true).setOnlyAlertOnce(false).setTimeoutAfter(decision.expiresAt!!-now).build()
    notes.notify(NOTE,note)
   }else if(saved||now>=due+p.window)notes.cancel(NOTE)
   val next=decision.nextAt?:run{stop();return@synchronized}
   val trigger=Math.addExact(elapsed,(next-now).coerceAtLeast(1))
   if(exactAvailable())try{alarm.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,trigger,intent())}catch(_:SecurityException){alarm.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,trigger,intent())}
   else alarm.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,trigger,intent())
  }catch(_:Exception){stop()}
 }
}
class AuthorizedReminderReceiver:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){AuthorizedReminders(context).refresh()}}
