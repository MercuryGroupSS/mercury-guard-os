package ca.mercury.guard

import android.app.AlertDialog
import android.content.Intent
import android.content.ClipData
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID
import android.app.Activity
import android.hardware.biometrics.BiometricPrompt
import android.hardware.biometrics.BiometricManager
import android.graphics.Color
import android.os.*
import android.provider.Settings
import android.text.InputType
import android.view.*
import android.widget.*
import org.json.JSONObject

/** Foreground-only account pilot. Leaving the activity discards the session. */
class GuardAccountActivity : Activity() {
 private var config: GuardServiceConfig? = null
 private var session: GuardAccountClient.Session? = null
 private var captureGrant: VerifiedShiftGrant? = null
 private var captureBinding: GrantBinding? = null
 private var captureAnchor: ServerTimeAnchor? = null
 private var signal: CancellationSignal? = null
 private var generation=0
 private var stopped=false
 private var busy=false
 // One-shot capture authority survives the external camera; account credentials never do.
 private data class PendingPhoto(val file:File,val binding:GrantBinding,val grant:VerifiedShiftGrant,val anchor:ServerTimeAnchor,val checkIn:AuthorizedCheckInEvidence?=null)
 private var pendingPhoto:PendingPhoto?=null
 private var locationPing:LocationPing?=null
 private var password: EditText?=null
 private lateinit var root: LinearLayout
 private lateinit var status: TextView
 private val cyan=Color.rgb(0,104,125)
 private fun dp(n:Int)=(n*resources.displayMetrics.density).toInt()
 override fun onCreate(state:Bundle?) {
  super.onCreate(state)
  window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
  // A recreated process has no verified capture authority. Discard abandoned temporary output.
  File(cacheDir,"capture/account").listFiles()?.forEach{it.delete()}
  try { AuthorizedReminders(this).refresh();config=GuardServiceConfig.load(this); startScreen() }
  catch(_:Exception){ config=null; screen("CONNECTION UNAVAILABLE","The packaged service configuration is invalid. Contact your administrator."); button("Return"){finish()} }
 }
 override fun onStop(){super.onStop();stopped=true;clearSession()}
 override fun onResume(){super.onResume();if(stopped){stopped=false;startScreen()}}
 private fun clearSession(){captureGrant=null;captureBinding=null;captureAnchor=null;generation++;busy=false;locationPing?.cancel();locationPing=null;signal?.cancel();signal=null;password?.text?.clear();password=null;session?.clear();session=null}
 private fun screen(title:String,detail:String){
  password=null
  val scroll=ScrollView(this).apply{isFillViewport=true;setBackgroundColor(Color.rgb(244,248,250))}
  root=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(24),dp(32),dp(24),dp(24))}
  fun text(value:String,size:Float)=TextView(this).apply{text=value;textSize=size;setTextColor(Color.rgb(25,42,54));setPadding(0,dp(10),0,dp(10))}
  root.addView(text("MERCURY ONE",14f).apply{setTextColor(cyan)})
  root.addView(text(title,26f).apply{isAccessibilityHeading=true})
  status=text(detail,16f).apply{accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE};root.addView(status)
  scroll.addView(root);setContentView(scroll)
  scroll.setOnApplyWindowInsetsListener{v,i->v.setPadding(i.systemWindowInsetLeft,i.systemWindowInsetTop,i.systemWindowInsetRight,i.systemWindowInsetBottom);i};scroll.requestApplyInsets()
 }
 private fun button(title:String,action:()->Unit){root.addView(Button(this).apply{text=title;isAllCaps=false;textSize=16f;minHeight=dp(56);setOnClickListener{if(!busy)action()}},LinearLayout.LayoutParams(-1,-2))}
 private fun startScreen(){
  clearSession()
  val c=config
  if(c==null){screen("ACCOUNT CONNECTION","No trusted service is configured for this build. Your local demo records remain on this phone.");button("Return"){finish()};return}
  screen("GUARD SIGN-IN","Verify on this device, then enter your individual guard ID and password. Device biometrics do not identify your guard account.\nService: ${c.endpoint}")
  button("Verify with biometrics") { biometric() };button("Return"){finish()}
 }
 private fun biometric(){
  val stamp=generation
  try {
   check(DeviceIdentity(this).publicIdentity()!=null)
   val cancellation=CancellationSignal();signal=cancellation
   val builder=BiometricPrompt.Builder(this).setTitle("Unlock guard sign-in").setNegativeButton("Cancel",mainExecutor){_,_->signal=null}
   if(Build.VERSION.SDK_INT>=30)builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
   builder.build().authenticate(cancellation,mainExecutor,object:BiometricPrompt.AuthenticationCallback(){
    override fun onAuthenticationSucceeded(result:BiometricPrompt.AuthenticationResult){if(stamp==generation&&!isFinishing){signal=null;credentials()}}
    override fun onAuthenticationError(code:Int,message:CharSequence){if(stamp==generation){signal=null;status.text="Biometric verification was not completed. Try again when ready."}}
   })
  }catch(_:Exception){status.text="This phone needs an initialized installation identity and an available secure biometric. Ask your administrator to complete setup."}
 }
 private fun credentials(){
  screen("YOUR GUARD ACCOUNT","Device verified. Enter your individual guard ID, not a company vendor ID.")
  val user=EditText(this).apply{hint="Guard ID";inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;isSingleLine=true;isSaveEnabled=false;importantForAutofill=View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS}
  val secret=EditText(this).apply{hint="Password";inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD;isSingleLine=true;isSaveEnabled=false;importantForAutofill=View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS}
  password=secret;root.addView(user);root.addView(secret)
  button("Sign in"){
   val id=user.text.toString().trim();val chars=secret.text.toString().toCharArray();secret.text.clear()
   val c=config?:return@button;val stamp=generation;busy=true;status.text="Checking your account…"
   Thread{
    var result:GuardAccountClient.Session?=null
    try{result=GuardAccountClient(c.endpoint).login(id,chars)}catch(_:Exception){}finally{chars.fill('\u0000')}
    val loggedIn=result
    runOnUiThread{
     if(stamp!=generation||isFinishing||isDestroyed){loggedIn?.clear();return@runOnUiThread}
     busy=false
     if(loggedIn==null){status.text="Sign-in failed or is temporarily unavailable. Check your ID and password, then try again."}
     else{session=loggedIn;loadAssignments()}
    }
   }.start()
  }
  button("Cancel"){startScreen()}
 }
 private fun loadAssignments(){
  val c=config?:return;val active=session?:return
  screen("YOUR ASSIGNMENTS","Verifying your account and registered device…")
  val stamp=generation;busy=true
  Thread{
   var profile:JSONObject?=null;var assignments:JSONObject?=null
   try{val client=GuardAccountClient(c.endpoint);profile=client.profile(active);assignments=client.assignments(active,c.deviceId,DeviceIdentity(this),c.audience)}catch(_:Exception){}
   val p=profile;val a=assignments
   runOnUiThread{
    if(stamp!=generation||isFinishing||isDestroyed)return@runOnUiThread
    busy=false
    try{
     check(p!=null&&a!=null)
     val guard=p.getString("guard_id");val vendor=p.getString("vendor_id");val rows=a.getJSONArray("assignments");AuthorizedReminders(this).retainForAssignments(guard,(0 until rows.length()).map{rows.getJSONObject(it)}.filter{!it.has("shift_state")||it.getJSONObject("shift_state").getString("state")=="active"}.map{it.getString("assignmentId")}.toSet())
     status.text="Guard: $guard\nVendor: $vendor\n${rows.length()} assignment(s). Shift status comes from the service."
     button("Send my queued records"){sendScoped(guard)}
     for(i in 0 until rows.length()){
      val item=rows.getJSONObject(i);check(item.getString("guardId")==guard&&item.getString("vendorId")==vendor)
      if(a.has("server_time_ms")){item.put("status_server_time_ms",a.getLong("server_time_ms"));item.put("status_elapsed_ms",SystemClock.elapsedRealtime())}
      button("${item.getString("siteId")} · ${item.getString("assignmentId")}"){assignmentOverview(item)}
     }
    }catch(_:Exception){status.text="Assignments could not be verified. Check connectivity or ask your administrator to review this phone's enrollment."}
    button("Refresh assignments"){loadAssignments()};button("Sign out"){startScreen()}
   }
  }.start()
 }
 private fun assignmentOverview(item:JSONObject){
  captureGrant=null;captureBinding=null;captureAnchor=null
  if(!item.has("shift_state")){verifyAssignment(item);return}
  val scope=DispatchScope(GrantBinding(item.getString("guardId"),item.getString("siteId"),item.getString("assignmentId"),item.getString("deviceThumbprint"),item.getLong("revocationVersion")),item.getString("vendorId"))
  val state=item.getJSONObject("shift_state").getString("state")
  screen("SHIFT · ${item.getString("siteId")}","Service status: ${state.replace('_',' ')}. Attendance records remain local to the pilot service; payroll is not connected.")
  try{
   val pending=ShiftTransitionStore(this).use{db->listOf("start","end").mapNotNull{action->db.saved(scope,action)?.takeIf{!it.has("receipt")}}}
   for(saved in pending){val request=saved.getJSONObject("request");button("Resolve pending ${request.getString("action")}"){submitShift(item,scope,request.getString("action"),request.getString("reason"))}}
   if(pending.isEmpty()){
    when(state){
     "not_started"->if(item.getBoolean("canStart"))button("Clock in"){
      AlertDialog.Builder(this).setTitle("Confirm clock-in").setMessage("Record the start of your shift at this site?").setNegativeButton("Cancel",null).setPositiveButton("Confirm clock-in"){_,_->submitShift(item,scope,"start","")}.show()
     }else status.text="This assignment is outside its clock-in window. Refresh assignments when it begins."
     "active"->{
      val now=Math.addExact(item.getLong("status_server_time_ms"),Math.subtractExact(SystemClock.elapsedRealtime(),item.getLong("status_elapsed_ms")))
      if(now<item.getLong("endsAt")){
       button("Continue shift"){verifyAssignment(item)}
       button("Escalate · end shift early"){
        val reason=EditText(this).apply{hint="Reason for leaving early";isSaveEnabled=false;filters=arrayOf(android.text.InputFilter.LengthFilter(2000))}
        val dialog=AlertDialog.Builder(this).setTitle("End shift early").setMessage("Give a reason, then confirm. This records an early exit; it does not notify dispatch yet.").setView(reason).setNegativeButton("Cancel",null).setPositiveButton("Confirm early exit",null).create()
        dialog.setOnShowListener{dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener{val text=reason.text.toString();if(text.isBlank())reason.error="A reason is required" else{dialog.dismiss();submitShift(item,scope,"end",text)}}};dialog.show()
       }
      }else button("Clock out"){
       AlertDialog.Builder(this).setTitle("Confirm clock-out").setMessage("Record the end of your shift now?").setNegativeButton("Cancel",null).setPositiveButton("Confirm clock-out"){_,_->submitShift(item,scope,"end","")}.show()
      }
     }
     "ended"->status.text="Shift ended. Saved records remain available for upload."
     else->error("Unknown shift state")
    }
   }
  }catch(_:Exception){status.text="Shift status could not be opened. Refresh assignments; saved confirmation requests remain preserved."}
  button("Send my queued records"){sendScoped(scope.binding.guardId)}
  button("Refresh assignments"){loadAssignments()};button("Sign out"){startScreen()}
 }
 private fun submitShift(item:JSONObject,scope:DispatchScope,action:String,reason:String){
  if(busy)return
  val c=config?:return;val active=session?:return;val stamp=generation
  busy=true;captureGrant=null;captureBinding=null;captureAnchor=null
  status.text="Confirming shift $action with the service…"
  Thread{
   var success=false
   try{
    active.bearer()
    ShiftTransitionStore(this).use{db->
     val request=db.prepare(scope,action,reason)
     val receipt=GuardAccountClient(c.endpoint).transition(active,c.deviceId,scope.binding.assignmentId,DeviceIdentity(this),c.audience,request)
     db.accept(scope,action,receipt);success=true
    }
    if(action=="end")AuthorizedReminders(this).stop()
   }catch(_:Exception){}
   val accepted=success
   runOnUiThread{
    if(stamp!=generation||isFinishing||isDestroyed)return@runOnUiThread
    busy=false
    if(accepted&&action=="end"){startScreen();status.text="Clock-out confirmed by the pilot service. You are signed out; queued records remain preserved."}
    else if(accepted)loadAssignments()
    else{assignmentOverview(item);status.text="Confirmation is unresolved. Use Resolve pending to retry the same request; no new clock time will be substituted."}
   }
  }.start()
 }
 private fun verifyAssignment(item:JSONObject){
  val c=config?:return;val active=session?:return;val stamp=generation;busy=true;status.text="Verifying shift authorization…"
  Thread{
   var verified:VerifiedShiftGrant?=null
   var verifiedBinding:GrantBinding?=null
   var verifiedAnchor:ServerTimeAnchor?=null
   var verifiedRoute:JSONObject?=null
   var verifiedCheckIn:JSONObject?=null
   var verifiedStatus:JSONObject?=null
   try{
    val identity=DeviceIdentity(this);val fingerprint=identity.publicIdentity()?.thumbprint?:error("Missing key")
    check(item.getString("deviceThumbprint")==fingerprint)
    val binding=GrantBinding(item.getString("guardId"),item.getString("siteId"),item.getString("assignmentId"),fingerprint,item.getLong("revocationVersion"))
    val elapsed=SystemClock.elapsedRealtime();val boot=Settings.Global.getInt(contentResolver,Settings.Global.BOOT_COUNT,-1)
    val response=GuardAccountClient(c.endpoint).grant(active,c.deviceId,binding.assignmentId,identity,c.audience)
    val anchor=ServerTimeAnchor(response.getLong("server_time_ms"),elapsed,boot)
    verified=ShiftGrantVerifier(c.issuer,c.audience,c.keys).verify(response.getString("key_id"),response.getString("payload"),response.getString("signature"),binding,anchor,SystemClock.elapsedRealtime(),boot)
    verifiedBinding=binding;verifiedAnchor=anchor.copy(elapsedMillis=SystemClock.elapsedRealtime());verifiedRoute=response.optJSONObject("patrol_route");verifiedCheckIn=response.optJSONObject("check_in_policy");verifiedStatus=response.optJSONObject("check_in_status")
   }catch(_:Exception){}
   val grant=verified;val binding=verifiedBinding;val anchor=verifiedAnchor
   runOnUiThread{if(stamp==generation&&!isFinishing&&!isDestroyed){
    busy=false
    if(grant!=null&&binding!=null&&anchor!=null){captureGrant=grant;captureBinding=binding;captureAnchor=anchor;val current=JSONObject(item.toString());current.remove("patrolRoute");verifiedRoute?.let{current.put("patrolRoute",it)};current.remove("checkInPolicy");verifiedCheckIn?.let{current.put("checkInPolicy",it)};current.remove("checkInStatus");verifiedStatus?.let{current.put("checkInStatus",it)};captureScreen(current)}
    else status.text="Shift authorization could not be verified. The assignment may not have started, may have changed, or the connection may be unavailable."
   }}
  }.start()
 }
 private fun captureScreen(item:JSONObject){
  screen("AUTHORIZED ASSIGNMENT","Site: ${item.getString("siteId")}\nAuthorized capture · encrypted local save. Sending records confirms pilot receipt only, not dashboard delivery or payroll clock-in.")
  val note=EditText(this).apply{hint="Describe the incident";inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE;minLines=3;isSaveEnabled=false;filters=arrayOf(android.text.InputFilter.LengthFilter(8000))}
  root.addView(note)
  button("Save authorized incident"){
   try{
    check(note.text.toString().isNotBlank())
    val binding=captureBinding?:error("Sign in again");val grant=captureGrant?:error("Refresh authorization");val anchor=captureAnchor?:error("Refresh authorization")
    val observed=Math.addExact(anchor.epochMillis,Math.subtractExact(SystemClock.elapsedRealtime(),anchor.elapsedMillis))
    val db=ScopedEventStore(this)
    try{db.capture("incident",JSONObject().put("description",note.text.toString()),binding,grant,DeviceIdentity(this),observed)}finally{db.close()}
    note.text.clear();status.text="Incident saved encrypted on this phone. It has not been sent."
   }catch(_:Exception){status.text="Incident not saved. Enter a description and refresh authorization if it has expired. Your text remains here."}
  }
  button("Capture authorized photo"){if(note.text.toString().isNotBlank())status.text="Save your incident description before opening the camera." else confirmPhoto()}
  button("Assignment messages"){if(note.text.toString().isNotBlank())status.text="Save your incident description before opening messages." else loadDispatch(item,true)}
  if(item.has("checkInPolicy"))button("Check-in reminder settings"){reminderSettings(item)}
  if(item.has("checkInStatus"))button("Review check-in delivery"){checkInStatusScreen(item)}
  if(item.has("checkInPolicy"))button("Complete scheduled check-in"){if(note.text.toString().isNotBlank())status.text="Save your incident description before starting a check-in." else beginCheckIn(item)}
  if(item.has("patrolRoute"))button("Open assigned patrol"){patrolScreen(item)}
  button("Send queued records"){captureBinding?.let{sendScoped(it.guardId)}}
  button("Refresh authorization"){verifyAssignment(item)}
  button("Back to assignments"){captureGrant=null;captureBinding=null;captureAnchor=null;loadAssignments()}
  button("Sign out"){startScreen()}
 }
 private fun loadDispatch(item:JSONObject,refresh:Boolean,offset:Int=0){
  val c=config?:return;val active=session?:return;val binding=captureBinding?:return
  if(binding.assignmentId!=item.getString("assignmentId"))return
  val scope=DispatchScope(binding,item.getString("vendorId"));val stamp=generation
  screen("ASSIGNMENT MESSAGES",if(refresh)"Checking assignment messages…" else "Opening encrypted inbox…");busy=true
  Thread{
   var rows:List<JSONObject>?=null;var message="Cached messages · reading does not acknowledge them.";var deny=false
   val db=DispatchInbox(this)
   try{
    active.bearer()
    if(refresh){
     val client=GuardAccountClient(c.endpoint);var more=true;var pages=0
     while(more&&pages<4){
      var cursor=db.cursor(scope)
      val page=try{client.dispatch(active,c.deviceId,binding.assignmentId,DeviceIdentity(this),c.audience,cursor)}catch(e:GuardAccountClient.HttpFailure){
       if(e.statusCode!=409)throw e
       db.resetCursor(scope,cursor);cursor=null
       client.dispatch(active,c.deviceId,binding.assignmentId,DeviceIdentity(this),c.audience,null)
      }
      more=db.apply(scope,cursor,page);pages++
     }
     message=if(more)"More updates remain. Refresh again to continue. These messages are not acknowledged." else "Inbox refreshed. Opening a message marks it viewed on this phone only."
    }
    rows=db.list(scope,offset)
   }catch(_:GuardAccountClient.HttpFailure){deny=true;message="Message access could not be authorized. Sign in again and refresh assignments."}
   catch(_:Exception){
    message="Refresh unavailable. Cached messages may be out of date; no acknowledgement was sent."
    try{active.bearer();rows=db.list(scope,offset)}catch(_:Exception){deny=true;message="Messages unavailable. Sign in again; encrypted records remain preserved."}
   }finally{db.close()}
   val result=rows;val summary=message;val blocked=deny
   runOnUiThread{
    if(stamp!=generation||isFinishing||isDestroyed)return@runOnUiThread
    busy=false;status.text=summary
    if(!blocked&&result!=null){
     if(result.isEmpty())root.addView(TextView(this).apply{text="No active messages on this page.";textSize=16f})
     for(wrapped in result){val m=wrapped.getJSONObject("message");button("${m.getString("title")} · v${m.getLong("version")}"){viewDispatch(item,scope,m)}}
     if(offset>0)button("Previous messages"){loadDispatch(item,false,maxOf(0,offset-30))}
     if(result.size==30)button("Next messages"){loadDispatch(item,false,offset+30)}
     button("Refresh messages"){loadDispatch(item,true)}
    }
    button("Back to assignment"){captureScreen(item)};button("Sign out"){startScreen()}
   }
  }.start()
 }
 private fun viewDispatch(item:JSONObject,scope:DispatchScope,message:JSONObject){
  try{
   session?.bearer()?:error("Sign in again");check(captureBinding==scope.binding)
   val anchor=captureAnchor?:error("Refresh authorization")
   val at=Math.addExact(anchor.epochMillis,Math.subtractExact(SystemClock.elapsedRealtime(),anchor.elapsedMillis))
   val db=DispatchInbox(this);val wrapped=try{db.markRead(scope,message.getString("message_id"),message.getLong("version"),at)}finally{db.close()}
   val current=wrapped.getJSONObject("message")
   screen(current.getString("title"),"Version ${current.getLong("version")} · viewed on this phone. No acknowledgement has been sent.")
   root.addView(TextView(this).apply{text=current.getString("body");textSize=18f;setPadding(0,dp(16),0,dp(16));setTextIsSelectable(true)})
   if(!current.isNull("due_at"))root.addView(TextView(this).apply{text="Due: ${java.util.Date(current.getLong("due_at"))}";textSize=16f})
   val events=ScopedEventStore(this)
   val acknowledged=try{events.dispatchAcknowledged(scope.binding,current.getString("message_id"),current.getLong("version"))}finally{events.close()}
   if(acknowledged)status.text="Version ${current.getLong("version")} · acknowledgement recorded on this phone. Check upload receipts for service acceptance."
   else button("Acknowledge version ${current.getLong("version")}"){
    try{
     session?.bearer()?:error("Sign in again");check(captureBinding==scope.binding)
     val grant=captureGrant?:error("Refresh authorization")
     val observed=Math.addExact(anchor.epochMillis,Math.subtractExact(SystemClock.elapsedRealtime(),anchor.elapsedMillis))
     DispatchInbox(this).use{it.markRead(scope,current.getString("message_id"),current.getLong("version"),observed)}
     ScopedEventStore(this).use{it.acknowledgeDispatch(scope.binding,grant,DeviceIdentity(this),current.getString("message_id"),current.getLong("version"),observed)}
     viewDispatch(item,scope,current)
    }catch(_:Exception){status.text="Acknowledgement not added. Refresh authorization and messages; existing records remain preserved."}
   }
   button("Back to messages"){loadDispatch(item,false)};button("Refresh messages"){loadDispatch(item,true)}
  }catch(_:Exception){status.text="This message changed or access expired. Refresh messages before opening it again."}
 }
 private fun reminderSettings(item:JSONObject){
  val reminders=AuthorizedReminders(this)
  reminders.refresh()
  screen("CHECK-IN REMINDERS",reminders.status()+"\nReminders on this phone contain no guard or site name. They do not sign you in or complete a check. Android power settings can delay delivery; enable again after a phone restart.")
  button("Enable for this assignment"){
   if(!reminders.notificationsAvailable()){
    if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),405)
    else startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,packageName))
    status.text="Allow notifications, then return and enable reminders.";return@button
   }
   try{reminders.enable(item.getJSONObject("checkInPolicy"),captureBinding?:error("Sign in"),captureGrant?:error("Refresh authorization"),captureAnchor?:error("Refresh authorization"));status.text=reminders.status()}
   catch(_:Exception){status.text="Reminders were not enabled. Refresh authorization and check notification settings."}
  }
  if(Build.VERSION.SDK_INT>=31&&!reminders.exactAvailable())button("Allow precise reminder timing"){
   startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,android.net.Uri.parse("package:$packageName")))
  }
  button("Stop this phone's reminders"){reminders.stop();status.text="Reminders stopped. Saved checks and service deadlines remain unchanged."}
  button("Back to assignment"){captureScreen(item)}
 }
 private fun checkInStatusScreen(item:JSONObject){
  screen("CHECK-IN DELIVERY","Service receipt is separate from local capture. A missed delivery deadline does not prove that an offline guard missed the check. Dispatch delivery is not connected.")
  try{
   val report=item.getJSONObject("checkInStatus");check(report.getString("assignment_id")==item.getString("assignmentId"))
   val slots=report.getJSONArray("slots")
   root.addView(TextView(this).apply{text="Service snapshot: ${java.util.Date(report.getLong("server_time_ms"))}\n${report.getInt("total_deadlines_missed")} delivery deadline(s) missed. Refresh authorization for current status.";textSize=16f;setPadding(0,dp(12),0,dp(12))})
   for(i in maxOf(0,slots.length()-10) until slots.length()){
    val slot=slots.getJSONObject(i)
    val label=when(slot.getString("status")){"due"->"Due · not received";"delivery_missing"->"Delivery missing";"photo_delivery_pending"->"Photo delivery pending";"evidence_received"->"Evidence received by pilot service";"evidence_received_after_deadline"->"Evidence received after deadline";else->"Status unavailable"}
    root.addView(TextView(this).apply{text="Check ${slot.getLong("slot")+1} · $label\nDue ${java.util.Date(slot.getLong("due_at"))}"+(if(slot.getBoolean("delivery_deadline_missed"))"\nOriginal missed deadline retained." else "");textSize=16f;setPadding(0,dp(12),0,dp(12))})
    if(slot.getBoolean("delivery_deadline_missed"))button("Add reason for check ${slot.getLong("slot")+1}"){missReason(item,report.getLong("policy_revision"),slot.getLong("slot"))}
    if(slot.optInt("reason_count")>0)root.addView(TextView(this).apply{text="${slot.getInt("reason_count")} reason note(s) received. Original deadline retained."})
   }
   if(slots.length()>10||report.optInt("earlier_slots_omitted")>0)root.addView(TextView(this).apply{text="Showing the latest 10 due checks. The service retains earlier deadlines."})
  }catch(_:Exception){status.text="Check-in delivery status could not be verified. Refresh authorization to retrieve it again."}
  button("Refresh authorization"){verifyAssignment(item)}
  button("Send my queued records"){captureBinding?.let{sendScoped(it.guardId)}}
  button("Back to assignment"){captureScreen(item)}
 }
 private fun missReason(item:JSONObject,revision:Long,slot:Long){
  val input=EditText(this).apply{hint="Explain the missed delivery";minLines=3;inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE;filters=arrayOf(android.text.InputFilter.LengthFilter(2000));isSaveEnabled=false}
  val dialog=AlertDialog.Builder(this).setTitle("Reason for check ${slot+1}").setMessage("This adds a note and keeps the original missed deadline. Dispatch has not been notified.").setView(input).setNegativeButton("Cancel",null).setPositiveButton("Save locally",null).create()
  dialog.setOnShowListener{dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener{
   try{
    val reason=input.text.toString().trim();require(reason.isNotEmpty())
    val binding=captureBinding?:error("Sign in again");val grant=captureGrant?:error("Refresh authorization");val anchor=captureAnchor?:error("Refresh authorization")
    val observed=Math.addExact(anchor.epochMillis,Math.subtractExact(SystemClock.elapsedRealtime(),anchor.elapsedMillis))
    val policy=AuthorizedCheckInPolicy.parse(item.getJSONObject("checkInPolicy"));check(policy.revision==revision)
    val due=Math.addExact(policy.startsAt,Math.multiplyExact(slot,policy.interval));check(slot>=0&&due<policy.endsAt&&observed>=minOf(due+policy.window,policy.endsAt))
    val db=ScopedEventStore(this);try{db.capture("check_in_miss_reason",JSONObject().put("policy_revision",revision).put("slot",slot).put("reason",reason),binding,grant,DeviceIdentity(this),observed)}finally{db.close()}
    dialog.dismiss();status.text="Reason saved locally. Send queued records to deliver it to the pilot service. The missed deadline remains recorded."
   }catch(_:Exception){input.error="Enter a reason and refresh authorization if it has expired."}
  }};dialog.show()
 }
 private fun beginCheckIn(item:JSONObject){
  val anchor=captureAnchor?:return;val binding=captureBinding?:return;val grant=captureGrant?:return
  fun observed()=Math.addExact(anchor.epochMillis,Math.subtractExact(SystemClock.elapsedRealtime(),anchor.elapsedMillis))
  val policy:AuthorizedCheckInPolicy;val slot:Long
  try{
   policy=AuthorizedCheckInPolicy.parse(item.getJSONObject("checkInPolicy"));slot=policy.slotAt(observed())
   val due=Math.addExact(policy.startsAt,Math.multiplyExact(slot,policy.interval))
   check(observed()<minOf(due+policy.window,policy.endsAt))
   val db=ScopedEventStore(this);try{check(!db.checkInRecorded(binding,policy.revision,slot))}finally{db.close()}
   check(grant.permits("check_in",binding,SystemClock.elapsedRealtime(),anchor.bootCount))
  }catch(_:Exception){status.text="No open check-in window, this check-in is already saved, or authorization needs refreshing.";return}
  if(checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)!=android.content.pm.PackageManager.PERMISSION_GRANTED){
   requestPermissions(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION,android.Manifest.permission.ACCESS_COARSE_LOCATION),404)
   status.text="Allow precise location, then tap Complete scheduled check-in again.";return
  }
  val stamp=generation;busy=true
  try{
   val cancellation=CancellationSignal();signal=cancellation
   val builder=BiometricPrompt.Builder(this).setTitle("Verify check-in").setNegativeButton("Cancel",mainExecutor){_,_->if(stamp==generation){busy=false;signal=null}}
   if(Build.VERSION.SDK_INT>=30)builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
   builder.build().authenticate(cancellation,mainExecutor,object:BiometricPrompt.AuthenticationCallback(){
    override fun onAuthenticationError(code:Int,message:CharSequence){if(stamp==generation){busy=false;signal=null;status.text="Check-in verification cancelled or unavailable."}}
    override fun onAuthenticationSucceeded(result:BiometricPrompt.AuthenticationResult){
     if(stamp!=generation)return
     signal=null;val biometricAt=observed();status.text="Getting a fresh GPS fix…"
     locationPing=LocationPing(this@GuardAccountActivity).also{ping->ping.request{fix->
      if(stamp==generation){
       busy=false;locationPing=null
       try{
        check(fix!=null)
        val fixAt=Math.addExact(anchor.epochMillis,Math.subtractExact(fix.getLong("fix_elapsed_nanos")/1000000,anchor.elapsedMillis))
        val location=JSONObject(fix.toString()).put("at",fixAt)
        policy.validate(slot,biometricAt,location,observed(),observed())
        val evidence=AuthorizedCheckInEvidence(policy,slot,biometricAt,location)
        AlertDialog.Builder(this@GuardAccountActivity).setTitle("Check-in photo")
         .setMessage("Take a consented test photo to complete this pilot check-in. It will be encrypted locally and uploaded when you send queued records. Opening the camera signs you out.")
         .setNegativeButton("Cancel",null).setPositiveButton("Open camera"){_,_->if(stamp==generation)openAuthorizedCamera(evidence)}.show()
       }catch(_:Exception){status.text="Check-in is incomplete. A fresh, non-mock GPS fix within the site's accuracy limit is required. Try again outdoors."}
      }
     }}
    }
   })
  }catch(_:Exception){busy=false;signal=null;status.text="Biometric check unavailable. No check-in was saved."}
 }
 private fun confirmPhoto(){
  AlertDialog.Builder(this).setTitle("Capture photo evidence")
   .setMessage("Use a test subject for this pilot. The photo will be encrypted on this phone and linked to your guard and assignment. Sending queued records uploads it to the configured pilot service. Camera use signs you out; sign in again to send it.")
   .setNegativeButton("Cancel",null).setPositiveButton("Open camera"){_,_->openAuthorizedCamera()}.show()
 }
 private fun openAuthorizedCamera(checkIn:AuthorizedCheckInEvidence?=null){
  if(pendingPhoto!=null)return
  val binding=captureBinding?:return;val grant=captureGrant?:return;val anchor=captureAnchor?:return
  val boot=Settings.Global.getInt(contentResolver,Settings.Global.BOOT_COUNT,-1)
  if(!grant.permits("photo",binding,SystemClock.elapsedRealtime(),boot)){status.text="Refresh assignment authorization before taking a photo.";return}
  val dir=File(cacheDir,"capture/account").apply{mkdirs()};val file=File(dir,"${UUID.randomUUID()}.jpg")
  val uri=FileProvider.getUriForFile(this,"$packageName.files",file)
  try{
   pendingPhoto=PendingPhoto(file,binding,grant,anchor,checkIn)
   clearSession() // Also clear credentials when a camera opens in multi-window without onStop.
   startActivityForResult(Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply{
    putExtra(MediaStore.EXTRA_OUTPUT,uri);clipData=ClipData.newRawUri("Camera output",uri)
    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
   },403)
  }catch(_:Exception){pendingPhoto=null;file.delete();revokeUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION);status.text="Camera unavailable. No photo was saved."}
 }
 override fun onActivityResult(requestCode:Int,resultCode:Int,data:Intent?){
  super.onActivityResult(requestCode,resultCode,data)
  if(requestCode!=403)return
  val pending=pendingPhoto?:return;pendingPhoto=null
  val uri=FileProvider.getUriForFile(this,"$packageName.files",pending.file)
  var retained:String?=null;var committed=false
  var message="Photo cancelled. Sign in again when ready."
  try{
   if(resultCode==RESULT_OK){
    val metadata=EvidenceStore(this).savePhoto(pending.file);retained=metadata.getString("evidence_id")
    val observed=Math.addExact(pending.anchor.epochMillis,Math.subtractExact(SystemClock.elapsedRealtime(),pending.anchor.elapsedMillis))
    val db=ScopedEventStore(this)
    try{if(pending.checkIn==null)db.capture("photo_evidence",metadata,pending.binding,pending.grant,DeviceIdentity(this),observed) else db.captureCheckIn(pending.binding,pending.grant,DeviceIdentity(this),pending.checkIn,metadata,observed)}finally{db.close()}
    committed=true;AuthorizedReminders(this).refresh();message=if(pending.checkIn==null) "Photo saved encrypted for ${pending.binding.guardId}. Sign in again to send queued records." else "Check-in and photo saved locally. Sign in again to send them; service delivery is pending."
   }
  }catch(_:Exception){message="Photo not saved. Authorization may have expired or the camera output was invalid. Sign in and try again."}
  finally{
   if(!committed)retained?.let{EvidenceStore(this).remove(it)}
   revokeUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION);pending.file.delete()
  }
  startScreen();Toast.makeText(this,message,Toast.LENGTH_LONG).show()
 }
 private fun patrolScreen(item:JSONObject){
  val binding=captureBinding?:return
  screen("ASSIGNED PATROL","Select checkpoints in any order. Each checkpoint is a manual observation; it does not prove physical presence.")
  try{
   val route=item.getJSONObject("patrolRoute");val routeId=route.getString("routeId");val revision=route.getLong("revision");val points=route.getJSONArray("checkpoints")
   require(points.length() in 1..100)
   val db=ScopedEventStore(this)
   try{for(i in 0 until points.length()){
    val point=points.getJSONObject(i);val pointId=point.getString("id")
    if(db.checkpointRecorded(binding,routeId,revision,pointId))root.addView(TextView(this).apply{text="Recorded · ${point.getString("label")}";textSize=16f;setPadding(0,dp(12),0,dp(12))})
    else button("Record checkpoint: ${point.getString("label")}"){
     try{
      val grant=captureGrant?:error("Refresh authorization");val anchor=captureAnchor?:error("Refresh authorization")
      val observed=Math.addExact(anchor.epochMillis,Math.subtractExact(SystemClock.elapsedRealtime(),anchor.elapsedMillis))
      val current=ScopedEventStore(this)
      try{current.captureCheckpoint(binding,grant,DeviceIdentity(this),routeId,revision,pointId,observed)}finally{current.close()}
      patrolScreen(item);status.text="Checkpoint saved encrypted on this phone. It has not been sent."
     }catch(_:Exception){status.text="Checkpoint not recorded. It may already be saved, or authorization may have expired. Return to the assignment to refresh."}
    }
   }}finally{db.close()}
  }catch(_:Exception){status.text="The assigned route could not be opened. Existing records were preserved."}
  button("Send my queued records"){sendScoped(binding.guardId)}
  button("Back to assignment"){captureScreen(item)}
  button("Sign out"){startScreen()}
 }
 private fun sendScoped(guardId:String){
  val active=session?:return;val c=config?:return;val stamp=generation
  busy=true;status.text="Checking queued records…"
  Thread{
   var message="Records remain queued. Check your connection and authorization, then try again."
   try{
    val db=ScopedEventStore(this)
    try{
     val proof=db.prepareSigned(DeviceIdentity(this),c.audience,guardId)
     if(proof==null)message="No records are waiting to be sent."
     else{
      val batch=JSONObject(String(java.util.Base64.getUrlDecoder().decode(proof.getString("payload")),Charsets.UTF_8))
      val scope=batch.getJSONObject("scope")
      if(scope.getString("guard_id")!=guardId)message="Earlier queued records belong to another guard. They remain preserved for their original account."
      else{
       val events=batch.getJSONArray("events");val ids=(0 until events.length()).map{events.getJSONObject(it).getString("event_id")}.toSet()
       val receipt=GuardTransport(c.endpoint).sendPilotBatch(active.bearer(),proof,batch.getString("batch_id"),ids)
       db.recordPilotReceipt(JSONObject().put("batch_id",receipt.batchId).put("event_ids",org.json.JSONArray(receipt.eventIds.toList())).put("status","accepted_local_only"),guardId)
       message="Pilot service accepted ${ids.size} record(s). Dashboard delivery is not yet connected. ${db.pendingCount(guardId)} of your record(s) remain queued."
      }
     }
     var mediaSent=0
     for(record in db.pendingPhotos(guardId)){
      val event=record.getJSONObject("event");val data=event.getJSONObject("data")
      val bytes=EvidenceStore(this).readPhoto(data.getString("evidence_id"))
      val mediaReceipt=GuardTransport(c.endpoint).sendPilotEvidence(active.bearer(),event.getString("event_id"),data,bytes)
      db.recordMediaReceipt(guardId,mediaReceipt);mediaSent++
     }
     if(mediaSent>0)message+=" $mediaSent photo file(s) accepted by the pilot service."
    }finally{db.close()}
   }catch(_:Exception){message="Some records or photo files remain queued. Existing receipts and local evidence were preserved; retry when authorized."}
   val result=message
   runOnUiThread{if(stamp==generation&&!isFinishing&&!isDestroyed){busy=false;status.text=result}}
  }.start()
 }

}
