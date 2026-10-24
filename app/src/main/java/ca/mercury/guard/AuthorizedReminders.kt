package ca.mercury.guard

import android.app.*
import android.content.*
import android.media.AudioAttributes
import android.net.Uri
import android.os.*
import android.provider.Settings
import org.json.JSONObject
import java.util.UUID

/** Generic presentation only. A token conveys no account, assignment or capture authority. */
data class ConnectedAttentionSnapshot(val token:String?,val stage:CheckInAttentionTiming.Stage,val silenced:Boolean,
 val budgetExhausted:Boolean,val pulse:Boolean,val nextRefreshInMillis:Long)

/** One encrypted device reminder schedule. No account credential or capture grant is persisted. */
class AuthorizedReminders internal constructor(private val context:Context,private val prefsName:String="authorized_reminders",
 private val identity:DeviceIdentity=DeviceIdentity(context),private val elapsedNow:()->Long={SystemClock.elapsedRealtime()},
 private val bootNow:()->Int={Settings.Global.getInt(context.contentResolver,Settings.Global.BOOT_COUNT,-1)},
 private val notificationAccess:(()->Boolean)?=null,private val attentionStoreName:String="mercury_connected_attention.db",
 private val eventStoreName:String="mercury_scoped_events.db",private val notificationSink:((Notification)->Unit)?=null,private val alarmSink:((Long)->Unit)?=null,
 private val configurationNow:()->Pair<String,String>?={GuardServiceConfig.load(context)?.let{it.uploadBinding() to it.deviceId}}) {
 private val prefs=context.getSharedPreferences(prefsName,Context.MODE_PRIVATE)
 private val alarm=context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
 private val notes=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
 private val cipher=DeviceCipher()
 companion object {
  const val CHANNEL="mercury_authorized_checks"
  const val ATTENTION_CHANNEL="mercury_connected_attention_v1"
  const val NOTE=811
  const val EXTRA_TOKEN="mercury_attention_token"
  const val EXTRA_FULL_SCREEN="mercury_attention_full_screen"
  internal const val ACTION_SILENCE="ca.mercury.guard.CONNECTED_ATTENTION_SILENCE"
  private const val PURPOSE="mercury-authorized-reminders-v1"
  private val lock=Any()
 }
 private data class Current(val json:JSONObject,val policy:AuthorizedCheckInPolicy,val owner:ConnectedDispatchOwner?,val elapsed:Long,val now:Long)
 private fun intent()=PendingIntent.getBroadcast(context,NOTE,Intent(context,AuthorizedReminderReceiver::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
 private fun read():JSONObject? {
  val body=prefs.getString("schedule",null)?:return null
  val s=JSONObject(String(cipher.decrypt(body,PURPOSE),Charsets.UTF_8))
  val marker=s.opt("legacy_format")
  if(!s.has("owner")&&!((marker is Int||marker is Long)&&(marker as Number).toLong()==43L)){
   // Never adopt a pre-full-owner schedule or rewrite its original encrypted body.
   val id=java.security.MessageDigest.getInstance("SHA-256").digest(body.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
   alarm.cancel(intent());notes.cancel(NOTE)
   val key="legacy_quarantine_$id";check(!prefs.contains(key)||prefs.getString(key,null)==body)
   check(prefs.edit().putString(key,body).remove("schedule").commit());return null
  }
  return s
 }
 private fun write(value:JSONObject){check(prefs.edit().putString("schedule",cipher.encrypt(value.toString().toByteArray(Charsets.UTF_8),PURPOSE)).commit())}
 fun stop()=synchronized(lock){alarm.cancel(intent());notes.cancel(NOTE);check(prefs.edit().remove("schedule").commit())}
 /** A legacy binding cannot erase a connected account's differently owned schedule. */
 fun stopForAssignment(binding:GrantBinding):Boolean=synchronized(lock){
  try{val s=read()?:return@synchronized false;if(s.has("owner"))return@synchronized false
   if(scheduleBinding(s)!=binding)return@synchronized false;stop();true
  }catch(_:Exception){stop();true}
 }
 fun stopForAssignment(owner:ConnectedDispatchOwner):Boolean=synchronized(lock){
  try{val s=read()?:return@synchronized false;if(!s.has("owner")||ConnectedAttentionOwner.parse(s.getJSONObject("owner"))!=owner)return@synchronized false;stop();true}
  catch(_:Exception){stop();true}
 }
 fun exactAvailable()=Build.VERSION.SDK_INT<31||alarm.canScheduleExactAlarms()
 private fun ensureChannel(progressive:Boolean){
  val id=if(progressive)ATTENTION_CHANNEL else CHANNEL
  if(notes.getNotificationChannel(id)!=null)return
  val channel=NotificationChannel(id,if(progressive)"Mercury One calm check-in attention"else "Authorized check-in reminders",NotificationManager.IMPORTANCE_HIGH).apply{
   description=if(progressive)"Owner-approved calm cues; silence never completes a check"else "One reminder per assigned check-in window"
   enableVibration(true);lockscreenVisibility=Notification.VISIBILITY_PRIVATE
   if(progressive){vibrationPattern=longArrayOf(0,400,200,400);setSound(Uri.parse("android.resource://${context.packageName}/raw/duty_chime"),AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())}
  }
  notes.createNotificationChannel(channel)
 }
 private fun notificationsAvailable(progressive:Boolean):Boolean {
  ensureChannel(progressive)
  return notificationAccess?.invoke()?: (DeviceReadiness(context).notificationPermissionGranted()&&notes.areNotificationsEnabled()&&notes.getNotificationChannel(if(progressive)ATTENTION_CHANNEL else CHANNEL)?.importance!=NotificationManager.IMPORTANCE_NONE)
 }
 fun notificationsAvailable():Boolean=synchronized(lock){try{notificationsAvailable(read()?.getJSONObject("policy")?.has("attention")==true)}catch(_:Exception){false}}
 fun attentionNotificationsAvailable():Boolean=notificationsAvailable(true)
 private fun scheduleBinding(s:JSONObject)=GrantBinding(s.getString("guard"),s.getString("site"),s.getString("assignment"),s.getString("thumbprint"),s.getLong("revocation"))
 private fun current():Current? {
  val s=read()?:return null;val elapsed=elapsedNow();val boot=bootNow();val p=AuthorizedCheckInPolicy.parse(s.getJSONObject("policy"))
  val owner=if(s.has("owner"))ConnectedAttentionOwner.parse(s.getJSONObject("owner"))else null
  check(owner==null||owner.scope.binding==scheduleBinding(s)){"Original reminder binding mismatch"}
  check(owner==null||configurationNow()==(owner.configuration to owner.deviceId)){"Original reminder configuration changed"}
  check(p.attention==null||owner!=null){"Connected attention owner required"}
  if(boot<0||s.getInt("boot")!=boot||elapsed<s.getLong("elapsed")||identity.publicIdentity()?.thumbprint!=s.getString("thumbprint")){stop();return null}
  val now=Math.addExact(s.getLong("epoch"),elapsed-s.getLong("elapsed"))
  if(now>=p.endsAt||!notificationsAvailable(p.attention!=null)){stop();return null}
  return Current(s,p,owner,elapsed,now)
 }
 fun enable(policy:JSONObject,binding:GrantBinding,grant:VerifiedShiftGrant,anchor:ServerTimeAnchor)=synchronized(lock){
  check(AuthorizedCheckInPolicy.parse(policy).attention==null){"Progressive attention requires an original connected owner"}
  enableInternal(policy,binding,null,grant,anchor)
 }
 fun enable(policy:JSONObject,owner:ConnectedDispatchOwner,grant:VerifiedShiftGrant,anchor:ServerTimeAnchor)=synchronized(lock){enableInternal(policy,owner.scope.binding,owner,grant,anchor)}
 private fun enableInternal(policy:JSONObject,binding:GrantBinding,owner:ConnectedDispatchOwner?,grant:VerifiedShiftGrant,anchor:ServerTimeAnchor){
  val elapsed=elapsedNow();val boot=bootNow();val p=AuthorizedCheckInPolicy.parse(policy)
  if(owner!=null&&configurationNow()!=(owner.configuration to owner.deviceId)){stop();error("Original reminder configuration required")}
  check(grant.permits("check_in",binding,elapsed,boot));check(anchor.bootCount==boot&&elapsed>=anchor.elapsedMillis)
  check(identity.publicIdentity()?.thumbprint==binding.deviceThumbprint);check(notificationsAvailable(p.attention!=null))
  val now=Math.addExact(anchor.epochMillis,elapsed-anchor.elapsedMillis);check(now<p.endsAt)
  val prior=try{read()?.takeIf{owner!=null&&it.has("owner")&&ConnectedAttentionOwner.parse(it.getJSONObject("owner"))==owner&&AuthorizedCheckInPolicy.parse(it.getJSONObject("policy")).json().toString()==p.json().toString()}}catch(_:Exception){null}
  stop()
  val s=JSONObject().put("id",UUID.randomUUID().toString()).put("policy",p.json()).put("epoch",anchor.epochMillis).put("elapsed",anchor.elapsedMillis).put("boot",boot)
   .put("guard",binding.guardId).put("site",binding.siteId).put("assignment",binding.assignmentId).put("thumbprint",binding.deviceThumbprint).put("revocation",binding.revocationVersion).put("last_attempt",prior?.optLong("last_attempt",-1)?:-1)
  if(owner!=null)s.put("owner",owner.json())else s.put("legacy_format",43)
  write(s);refresh()
 }
 /** A connected account/configuration switch never inherits a legacy or another owner's schedule. */
 fun retainForAssignments(policies:Map<ConnectedDispatchOwner,JSONObject>)=synchronized(lock){
  try{val s=read()?:return@synchronized
   val owner=if(s.has("owner"))ConnectedAttentionOwner.parse(s.getJSONObject("owner"))else null
   val expected=owner?.let{policies[it]}
   if(expected==null||AuthorizedCheckInPolicy.parse(s.getJSONObject("policy")).json().toString()!=AuthorizedCheckInPolicy.parse(expected).json().toString())stop()
  }catch(_:Exception){stop()}
 }
 fun retainForAssignments(owners:Set<ConnectedDispatchOwner>)=synchronized(lock){try{val s=read()?:return@synchronized;if(!s.has("owner")||ConnectedAttentionOwner.parse(s.getJSONObject("owner")) !in owners)stop()}catch(_:Exception){stop()}}
 fun retainForAssignments(guardId:String,assignmentIds:Set<String>)=synchronized(lock){try{val s=read();if(s!=null&&(s.has("owner")||s.getString("guard")!=guardId||s.getString("assignment") !in assignmentIds))stop()}catch(_:Exception){stop()}}
 fun status():String=synchronized(lock){
  try{val s=read()?:return@synchronized if(prefs.all.keys.any{it.startsWith("legacy_quarantine_")})"Reminders off; sign in and explicitly enable this account’s reminders again"else "Reminders off";val p=AuthorizedCheckInPolicy.parse(s.getJSONObject("policy"))
   if(s.getInt("boot")!=bootNow()){stop();return@synchronized "Reminders off after restart; sign in and enable again"}
   if(!notificationsAvailable(p.attention!=null)){stop();return@synchronized "Reminders off; notification settings block delivery"}
   if(current()==null)return@synchronized "Reminders off"
   "Reminders enabled until ${java.util.Date(p.endsAt)} · ${if(p.attention==null)"one cue per window"else "approved calm attention"} · ${if(exactAvailable())"precise alarm access available"else "Android may delay reminders"}"
  }catch(_:Exception){stop();"Reminders unavailable; enable again after sign-in"}
 }
 /** A private panel must never reveal another owner's schedule or end time. */
 fun status(owner:ConnectedDispatchOwner,policy:JSONObject):String=synchronized(lock){
  try{val c=current()?:return@synchronized "Reminders off for this assignment"
   if(c.owner!=owner||c.policy.json().toString()!=AuthorizedCheckInPolicy.parse(policy).json().toString())return@synchronized "Reminders off for this assignment"
   status()
  }catch(_:Exception){stop();"Reminders off for this assignment"}
 }
 private fun completed(c:Current,slot:Long):Boolean {
  val db=ScopedEventStore(context,eventStoreName,elapsedNow,bootNow)
  return try{if(c.owner==null)db.checkInRecorded(scheduleBinding(c.json),c.policy.revision,slot)else db.checkInRecorded(c.owner,c.policy.revision,slot)}finally{db.close()}
 }
 private fun state(c:Current,slot:Long):CheckInAttentionStore.State {
  val db=CheckInAttentionStore(context,attentionStoreName);return try{db.read(c.owner!!,c.policy,slot)}finally{db.close()}
 }
 private fun token(c:Current,slot:Long):String {
  if(c.json.optLong("attention_slot",-1)!=slot||!EscalationRules.uuid(c.json.optString("attention_token"))){c.json.put("attention_slot",slot).put("attention_token",UUID.randomUUID().toString());write(c.json)}
  return c.json.getString("attention_token")
 }
 private fun clearToken(c:Current){if(c.json.has("attention_token")){c.json.remove("attention_token");c.json.remove("attention_slot");write(c.json)}}
 private fun attentionDecision(c:Current,st:CheckInAttentionStore.State,saved:Boolean)=CheckInAttentionTiming.evaluate(c.policy.startsAt,c.policy.endsAt,c.policy.interval,c.policy.window,c.now,st.lastAttempt,st.silenced,saved)
 private fun snapshot(c:Current):ConnectedAttentionSnapshot? {
  if(c.owner==null||c.policy.attention==null)return null
  val slot=if(c.now<c.policy.startsAt)-1 else c.policy.slotAt(c.now)
  val st=if(slot<0)CheckInAttentionStore.State()else state(c,slot);val saved=slot>=0&&completed(c,slot);val d=attentionDecision(c,st,saved)
  val open=d.stage in setOf(CheckInAttentionTiming.Stage.GREEN,CheckInAttentionTiming.Stage.YELLOW,CheckInAttentionTiming.Stage.RED)
  val value=if(open)token(c,slot)else null
  val pulse=open&&!st.silenced&&st.attemptAt!=null&&c.now>=st.attemptAt&&c.now-st.attemptAt<CheckInAttentionTiming.PULSE_MS
  val next=minOf(d.nextAt?:c.policy.endsAt,if(pulse)Math.addExact(st.attemptAt!!,CheckInAttentionTiming.PULSE_MS)else Long.MAX_VALUE)
  return ConnectedAttentionSnapshot(value,d.stage,st.silenced,d.budgetExhausted,pulse,(next-c.now).coerceIn(1,CheckInAttentionTiming.CUE_INTERVAL_MS))
 }
 fun attentionSnapshot(owner:ConnectedDispatchOwner,policy:JSONObject):ConnectedAttentionSnapshot?=synchronized(lock){
  try{refresh();val c=current()?:return@synchronized null;if(c.owner!=owner||c.policy.json().toString()!=AuthorizedCheckInPolicy.parse(policy).json().toString())return@synchronized null;snapshot(c)}catch(_:Exception){stop();null}
 }
 fun genericSnapshot(value:String):ConnectedAttentionSnapshot?=synchronized(lock){
  try{if(!EscalationRules.uuid(value))return@synchronized null;refresh();val c=current()?:return@synchronized null;val snap=snapshot(c)?:return@synchronized null;if(snap.token!=value)null else snap}catch(_:Exception){stop();null}
 }
 private fun silence(c:Current):Boolean {
  if(c.owner==null||c.policy.attention==null||c.now<c.policy.startsAt)return false
  val slot=c.policy.slotAt(c.now);if(completed(c,slot))return false
  val db=CheckInAttentionStore(context,attentionStoreName);val changed=try{db.silence(c.owner,c.policy,slot,c.now)}finally{db.close()}
  if(changed){notes.cancel(NOTE);refresh()};return changed
 }
 fun silenceCurrent(owner:ConnectedDispatchOwner,policy:JSONObject):Boolean=synchronized(lock){try{val c=current()?:return@synchronized false;if(c.owner!=owner||c.policy.json().toString()!=AuthorizedCheckInPolicy.parse(policy).json().toString())return@synchronized false;silence(c)}catch(_:Exception){stop();false}}
 fun silenceToken(value:String):Boolean=synchronized(lock){try{if(!EscalationRules.uuid(value))return@synchronized false;val c=current()?:return@synchronized false;val snap=snapshot(c)?:return@synchronized false;if(snap.token!=value)return@synchronized false;silence(c)}catch(_:Exception){stop();false}}
 fun fullScreenConsented()=prefs.getBoolean("connected_full_screen_opt_in",false)
 fun setFullScreenConsent(value:Boolean){check(prefs.edit().putBoolean("connected_full_screen_opt_in",value).commit());if(!value)notes.cancel(NOTE)}
 private fun fullScreenOsAllowed()=try{Build.VERSION.SDK_INT>=34&&notes.canUseFullScreenIntent()}catch(_:RuntimeException){false}
 fun fullScreenSettingsIntent():Intent?=if(Build.VERSION.SDK_INT>=34)Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,Uri.parse("package:${context.packageName}"))else null
 private fun fullScreenAccess():Boolean=fullScreenConsented()&&fullScreenOsAllowed()&&notificationsAvailable(true)&&(notes.getNotificationChannel(ATTENTION_CHANNEL)?.importance?:0)>=NotificationManager.IMPORTANCE_HIGH
 private fun screenEligible():Boolean {
  val power=context.getSystemService(Context.POWER_SERVICE) as PowerManager;val keyguard=context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
  return keyguard.isKeyguardLocked||!power.isInteractive
 }
 private fun fullScreenDeliveryEligible(st:CheckInAttentionStore.State):Boolean =!st.fullScreenAttempted&&fullScreenAccess()&&screenEligible()
 fun fullScreenAllowed(value:String):Boolean=synchronized(lock){
  try{val c=current()?:return@synchronized false;val snap=snapshot(c)?:return@synchronized false
   snap.token==value&&!snap.silenced&&!snap.budgetExhausted&&snap.stage in setOf(CheckInAttentionTiming.Stage.GREEN,CheckInAttentionTiming.Stage.YELLOW,CheckInAttentionTiming.Stage.RED)&&state(c,c.policy.slotAt(c.now)).fullScreenAttempted&&fullScreenAccess()&&screenEligible()
  }catch(_:Exception){stop();false}
 }
 fun fullScreenStatus()="Optional full-screen attention: local opt-in ${if(fullScreenConsented())"on"else "off"}; Android access ${if(fullScreenOsAllowed())"allowed"else "unavailable or denied"}. High-importance notifications are required; Android controls delivery."
 private fun alertIntent(value:String,fullscreen:Boolean):PendingIntent {
  val request=if(fullscreen)NOTE+2 else NOTE+1
  val i=Intent(context,ConnectedCheckInAlertActivity::class.java).setAction(if(fullscreen)"ca.mercury.guard.ATTENTION_FULLSCREEN"else "ca.mercury.guard.ATTENTION_OPEN")
   .setData(Uri.parse("mercury-attention://alert/$value")).putExtra(EXTRA_TOKEN,value).putExtra(EXTRA_FULL_SCREEN,fullscreen).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
  return PendingIntent.getActivity(context,request,i,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
 }
 private fun progressiveNote(c:Current,d:CheckInAttentionTiming.Decision,value:String,fullscreen:Boolean):Notification {
  val silence=PendingIntent.getBroadcast(context,NOTE+3,Intent(context,AuthorizedReminderReceiver::class.java).setAction(ACTION_SILENCE).setData(Uri.parse("mercury-attention://silence/$value")).putExtra(EXTRA_TOKEN,value),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  val builder=Notification.Builder(context,ATTENTION_CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Mercury One · check-in attention")
   .setContentText("Sign in to complete the assigned check. Silence only stops this window's cues.").setContentIntent(alertIntent(value,false)).setCategory(Notification.CATEGORY_REMINDER)
   .setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(false).setOnlyAlertOnce(false).setTimeoutAfter((d.deadlineAt!!-c.now).coerceAtLeast(1))
   .setDeleteIntent(silence).addAction(Notification.Action.Builder(null,"Silence this window",silence).build())
  if(fullscreen)builder.setFullScreenIntent(alertIntent(value,true),true)
  return builder.build()
 }
 private fun deliver(note:Notification){
  if(notificationSink!=null){notificationSink.invoke(note);return}
  if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)error("Notification permission unavailable")
  notes.notify(NOTE,note)
 }
 private fun schedule(c:Current,next:Long?){
  if(next==null){stop();return}
  val trigger=Math.addExact(c.elapsed,(next-c.now).coerceAtLeast(1))
  if(alarmSink!=null){alarmSink.invoke(trigger);return}
  if(exactAvailable())try{alarm.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,trigger,intent())}catch(_:SecurityException){alarm.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,trigger,intent())}
  else alarm.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,trigger,intent())
 }
 fun refresh()=synchronized(lock){
  try{
   val c=current()?:return@synchronized;val p=c.policy;val slot=if(c.now<p.startsAt)-1 else p.slotAt(c.now);val saved=slot>=0&&completed(c,slot)
   if(p.attention!=null){
    val st=if(slot<0)CheckInAttentionStore.State()else state(c,slot);val d=attentionDecision(c,st,saved)
    val open=d.stage in setOf(CheckInAttentionTiming.Stage.GREEN,CheckInAttentionTiming.Stage.YELLOW,CheckInAttentionTiming.Stage.RED)
    if(open){val value=token(c,slot)
     if(d.notify){val fullscreen=fullScreenDeliveryEligible(st);val db=CheckInAttentionStore(context,attentionStoreName)
      val claimed=try{db.claim(c.owner!!,p,slot,c.now,fullscreen)}finally{db.close()}
      if(claimed!=null)deliver(progressiveNote(c,d,value,fullscreen))
     }
    }else{clearToken(c);notes.cancel(NOTE)}
    if(saved||st.silenced)notes.cancel(NOTE)
    schedule(c,d.nextAt)
   }else{
    val d=ReminderTiming.evaluate(p.startsAt,p.endsAt,p.interval,p.window,c.now,c.json.getLong("last_attempt"),saved)
    if(d.notify){c.json.put("last_attempt",slot);write(c.json)
     val open=PendingIntent.getActivity(context,NOTE,Intent(context,GuardAccountActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
     deliver(Notification.Builder(context,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Mercury One · check-in due")
      .setContentText("Sign in to complete the assigned check. Opening this reminder does not complete it.").setContentIntent(open).setCategory(Notification.CATEGORY_REMINDER)
      .setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(true).setOnlyAlertOnce(false).setTimeoutAfter(d.expiresAt!!-c.now).build())
    }else if(saved||d.expiresAt?.let{c.now>=it}==true)notes.cancel(NOTE)
    schedule(c,d.nextAt)
   }
  }catch(_:Exception){stop()}
 }
}
class AuthorizedReminderReceiver:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){
 val reminders=AuthorizedReminders(context)
 if(intent.action==AuthorizedReminders.ACTION_SILENCE)reminders.silenceToken(intent.getStringExtra(AuthorizedReminders.EXTRA_TOKEN)?:return)
 else reminders.refresh()
}}
