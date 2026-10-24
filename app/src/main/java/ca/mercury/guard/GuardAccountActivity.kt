package ca.mercury.guard

import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
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

/** Foreground identity locks on leaving; separately authorized short-lived upload work may continue. */
class GuardAccountActivity : Activity() {
 private var config: GuardServiceConfig? = null
 private var loginParticles:ParticleLoginView?=null
 private var session: GuardAccountClient.Session? = null
 private data class AccountIdentity(val subject:String,val guardId:String,val vendorId:String)
 private var accountIdentity:AccountIdentity?=null
 private var accountAnchor:ServerTimeAnchor?=null
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
 private var incidentDraftEditor:EditText?=null
 private var incidentDraftScope:ConnectedIncidentDraftScope?=null
 private var incidentDraftDirty=false
 private var incidentDraftSuppress=false
 private var visibleForLocation=false
 private lateinit var root: LinearLayout
 private lateinit var status: TextView
 private val cyan=Color.rgb(0,104,125)
 private fun dp(n:Int)=(n*resources.displayMetrics.density).toInt()
 override fun onCreate(state:Bundle?) {
  super.onCreate(state)
  window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
  // A recreated process has no verified capture authority. Discard abandoned temporary output.
  File(cacheDir,"capture/account").listFiles()?.forEach{it.delete()}
  try { AuthorizedReminders(this).refresh();config=GuardServiceConfig.load(this);UploadCoordinator(this).request(); startScreen() }
  catch(_:Exception){ config=null; screen("CONNECTION UNAVAILABLE","The packaged service configuration is invalid. Contact your administrator."); button("Escalate"){unverifiedEscalation()};button("Return"){finish()} }
  if(intent.getBooleanExtra("open_escalation",false)){intent.removeExtra("open_escalation");unverifiedEscalation()}
 }
 override fun onStop(){super.onStop();stopped=true;clearSession()}
 override fun onResume(){super.onResume();visibleForLocation=true;if(stopped){stopped=false;startScreen()};loginParticles?.startMotion()}
 override fun onPause(){visibleForLocation=false;persistIncidentDraft();loginParticles?.setSigningIn(false);loginParticles?.stopMotion();super.onPause()}
 override fun onDestroy(){loginParticles?.stopMotion();super.onDestroy()}
 private fun clearSession(){persistIncidentDraft();incidentDraftEditor=null;incidentDraftScope=null;accountIdentity=null;accountAnchor=null;captureGrant=null;captureBinding=null;captureAnchor=null;generation++;busy=false;locationPing?.cancel();locationPing=null;signal?.cancel();signal=null;password?.text?.clear();password=null;session?.clear();session=null}
 private fun screen(title:String,detail:String){
  persistIncidentDraft();incidentDraftEditor=null;incidentDraftScope=null;incidentDraftDirty=false
  loginParticles?.stopMotion();loginParticles=null
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
 private fun button(title:String,allowWhileBusy:Boolean=false,action:()->Unit){root.addView(Button(this).apply{text=title;isAllCaps=false;textSize=16f;minHeight=dp(56);setOnClickListener{if(allowWhileBusy||!busy){persistIncidentDraft();if(!incidentDraftDirty||allowWhileBusy)action()}}},LinearLayout.LayoutParams(-1,-2))}
 private fun startScreen(){
  clearSession()
  val c=config
  if(c==null){screen("ACCOUNT CONNECTION","No trusted service is configured for this build. Your local demo records remain on this phone.");button("Escalate"){unverifiedEscalation()};button("Return"){finish()};return}
  try{
   if(DeviceIdentity(this).publicIdentity()==null){
    screen("PHONE ENROLLMENT","Prepare this phone's signing identity, then have an administrator approve its public key. This does not enroll the phone or create a guard account.")
    button("Prepare phone identity"){
     try{DeviceIdentity(this).create();enrollmentDetails()}catch(_:Exception){status.text="Phone identity could not be prepared. Existing key material has not been replaced."}
    };button("Escalate"){unverifiedEscalation()};button("Set up or reset password"){openAccountPage()};button("Close"){finish()};return
   }
  }catch(_:Exception){screen("IDENTITY UNAVAILABLE","This phone's existing signing identity could not be opened. Contact your administrator; do not clear app data.");button("Escalate"){unverifiedEscalation()};button("Close"){finish()};return}
  screen("GUARD SIGN-IN","Verify on this device, then enter your individual guard ID and password. Device biometrics do not identify your guard account.\nService: ${c.endpoint}")
  loginParticles=ParticleLoginView(this).apply{
   contentDescription="Mercury One decorative particle face. Verify with biometrics to continue; this animation does not recognize your identity."
   importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_NO
   isClickable=false;isFocusable=false
  }
  root.addView(loginParticles,2,LinearLayout.LayoutParams(-1,dp(280)))
  loginParticles?.startMotion()
  button("Escalate"){unverifiedEscalation()};button("Verify with biometrics") { biometric() };button("Stop automatic uploads and sign out",true){signOut()};button("Set up or reset password"){openAccountPage()};button("Phone enrollment details"){enrollmentDetails()};button("Return"){finish()}
 }
 private fun signOut(){UploadCoordinator(this).stop(session,config);startScreen();status.text="Signed out on this phone. Automatic delivery stopped; encrypted records remain preserved. Service sign-out was requested and can remain unconfirmed while offline."}
 private fun openAccountPage(){
  val c=config?:return
  try{
   val uri=Uri.parse(GuardAccountClient(c.endpoint).accountPageUrl())
   UploadCoordinator(this).stop(session,config);clearSession()
   startActivity(Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE))
  }catch(_:Exception){status.text="The account page could not be opened. Use your configured Mercury One service in a browser or contact your administrator."}
 }
 private fun enrollmentDetails(){
  try{
   val identity=DeviceIdentity(this).publicIdentity()?:error("Identity required")
   screen("ENROLLMENT DETAILS","These are public enrollment details. The private signing key stays on this phone. Approval must bind this installation to the intended site or individual guard.")
   root.addView(TextView(this).apply{text="Device ID: ${config?.deviceId}\nKey fingerprint: ${identity.thumbprint}\nPublic key: ${identity.publicKeySpki}";textSize=14f;setTextIsSelectable(true)})
   button("Continue to sign-in"){startScreen()}
  }catch(_:Exception){status.text="Enrollment details could not be read. Existing identity remains preserved."}
 }
 private fun biometric(){
  if(signal!=null)return
  val stamp=generation
  try {
   check(DeviceIdentity(this).publicIdentity()!=null)
   val cancellation=CancellationSignal();signal=cancellation;loginParticles?.setSigningIn(true)
   val builder=BiometricPrompt.Builder(this).setTitle("Unlock guard sign-in").setNegativeButton("Cancel",mainExecutor){_,_->signal=null;loginParticles?.setSigningIn(false)}
   if(Build.VERSION.SDK_INT>=30)builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
   builder.build().authenticate(cancellation,mainExecutor,object:BiometricPrompt.AuthenticationCallback(){
    override fun onAuthenticationSucceeded(result:BiometricPrompt.AuthenticationResult){if(stamp==generation&&!isFinishing){signal=null;credentials()}}
    override fun onAuthenticationError(code:Int,message:CharSequence){if(stamp==generation){signal=null;loginParticles?.setSigningIn(false);status.text="Biometric verification was not completed. Try again when ready."}}
   })
  }catch(_:Exception){signal=null;loginParticles?.setSigningIn(false);status.text="This phone needs an initialized installation identity and an available secure biometric. Ask your administrator to complete setup."}
 }
 private fun credentials(){
  UploadCoordinator(this).stop() // A new account attempt may belong to the next guard on a shared phone.
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
  button("Set up or reset password"){openAccountPage()};button("Cancel"){startScreen()}
 }
 private fun loadAssignments(){
  val c=config?:return;val active=session?:return
  screen("YOUR ASSIGNMENTS","Verifying your account and registered device…")
  val stamp=generation;busy=true
  Thread{
   var profile:JSONObject?=null;var assignments:JSONObject?=null;var receivedElapsed=0L
   try{val client=GuardAccountClient(c.endpoint);profile=client.profile(active);assignments=client.assignments(active,c.deviceId,DeviceIdentity(this),c.audience);receivedElapsed=SystemClock.elapsedRealtime()}catch(_:Exception){}
   val p=profile;val a=assignments
   runOnUiThread{
    if(stamp!=generation||isFinishing||isDestroyed)return@runOnUiThread
    busy=false
    try{
     check(p!=null&&a!=null)
     val guard=p.getString("guard_id");val vendor=p.getString("vendor_id");val rows=a.getJSONArray("assignments");AuthorizedReminders(this).retainForAssignments(guard,(0 until rows.length()).map{rows.getJSONObject(it)}.filter{it.optBoolean("assignmentActive",true)&&(!it.has("shift_state")||it.getJSONObject("shift_state").getString("state")=="active")}.map{it.getString("assignmentId")}.toSet())
     val subject=p.getString("auth_subject");check(EscalationRules.uuid(subject))
     val epoch=a.getLong("server_time_ms");val boot=Settings.Global.getInt(contentResolver,Settings.Global.BOOT_COUNT,-1);check(epoch>0&&receivedElapsed>0&&boot>=0)
     accountIdentity=AccountIdentity(subject,guard,vendor);accountAnchor=ServerTimeAnchor(epoch,receivedElapsed,boot)
     UploadCoordinator(this).authorize(c,active,guard,vendor,subject)
     val activeIds=(0 until rows.length()).map{rows.getJSONObject(it)}.filter{it.optBoolean("assignmentActive",true)&&it.optJSONObject("shift_state")?.optString("state")=="active"}.map{it.getString("assignmentId")}.toSet()
     ConnectedLocationRuntime.stopIfUnavailable(this,subject,activeIds)
     val summary=ScopedEventStore(this).use{it.uploadSummary(guard)}
     status.text="Guard: $guard\nVendor: $vendor\n${rows.length()} assignment(s). Shift status comes from the service.\n$summary\nAutomatic delivery continues while the verified upload session is valid; Android may delay work. Sign out stops automatic delivery."
     button("Escalate"){escalationScreen()};button("My escalation requests"){escalationList()};button("My location consents"){locationHistory()};button("Send my queued records"){sendScoped(guard)}
     for(i in 0 until rows.length()){
      val item=rows.getJSONObject(i);check(item.getString("guardId")==guard&&item.getString("vendorId")==vendor)
      if(a.has("server_time_ms")){item.put("status_server_time_ms",a.getLong("server_time_ms"));item.put("status_elapsed_ms",SystemClock.elapsedRealtime())}
      button("${item.getString("siteId")} · ${item.getString("assignmentId")}"){assignmentOverview(item)}
     }
    }catch(_:Exception){status.text="Assignments could not be verified. Check connectivity or ask your administrator to review this phone's enrollment."}
    button("Refresh assignments"){loadAssignments()};button("Sign out",true){signOut()}
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
   val pending=ShiftTransitionStore(this).use{db->listOf("start","end").mapNotNull{action->db.saved(scope,action)?.takeIf{!it.has("receipt")&&!it.has("rejection")}}}
   for(saved in pending){val request=saved.getJSONObject("request");button("Resolve pending ${request.getString("action")}"){submitShift(item,scope,request.getString("action"),request.getString("reason"))}}
   if(pending.isEmpty()){
    when(state){
     "not_started"->if(item.getBoolean("canStart"))button("Clock in"){
      AlertDialog.Builder(this).setTitle("Confirm clock-in").setMessage("Record the start of your shift at this site?").setNegativeButton("Cancel",null).setPositiveButton("Confirm clock-in"){_,_->submitShift(item,scope,"start","")}.show()
     }else status.text="This assignment is outside its clock-in window. Refresh assignments when it begins."
     "active"->{
      val now=Math.addExact(item.getLong("status_server_time_ms"),Math.subtractExact(SystemClock.elapsedRealtime(),item.getLong("status_elapsed_ms")))
      if(now<item.getLong("endsAt")){
       if(item.optBoolean("assignmentActive",true))button("Continue shift"){verifyAssignment(item)} else status.text="Assignment cancelled. Capture is unavailable; confirm your shift end below."
       button("End shift early"){
        val reason=EditText(this).apply{hint="Reason for leaving early";isSaveEnabled=false;filters=arrayOf(android.text.InputFilter.LengthFilter(2000))}
        val dialog=AlertDialog.Builder(this).setTitle("End shift early").setMessage("Give a reason, then confirm. This records an early exit; it does not notify dispatch yet.").setView(reason).setNegativeButton("Cancel",null).setPositiveButton("Confirm early exit",null).create()
        dialog.setOnShowListener{dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener{val text=reason.text.toString();if(text.isBlank())reason.error="A reason is required" else if(!ShiftTransitionStore.validReason(text))reason.error="Please shorten the reason before confirming" else{dialog.dismiss();submitShift(item,scope,"end",text)}}};dialog.show()
       }
      }else button("Clock out"){
       AlertDialog.Builder(this).setTitle("Confirm clock-out").setMessage("Record the end of your shift now?").setNegativeButton("Cancel",null).setPositiveButton("Confirm clock-out"){_,_->submitShift(item,scope,"end","")}.show()
      }
     }
     "ended"->status.text=if(item.optBoolean("assignmentActive",true))"Shift ended. Saved records remain available for upload." else "Cancelled assignment closed. Saved records are preserved; upload requires administrator review."
     else->error("Unknown shift state")
    }
   }
  }catch(_:Exception){status.text="Shift status could not be opened. Refresh assignments; saved confirmation requests remain preserved."}
  button("Escalate"){escalationScreen(if(item.optBoolean("assignmentActive",true))item else null)}
  button("My escalation requests"){escalationList()};button("Shift location and consent"){locationScreen(item)}
  button("Send my queued records"){sendScoped(scope.binding.guardId)}
  button("Refresh assignments"){loadAssignments()};button("Sign out",true){signOut()}
 }
 private fun submitShift(item:JSONObject,scope:DispatchScope,action:String,reason:String){
  if(busy)return
  val c=config?:return;val active=session?:return;val stamp=generation
  if(action=="end")ConnectedLocationRuntime.stop(this,"Shift end requested")
  busy=true;captureGrant=null;captureBinding=null;captureAnchor=null
  status.text="Confirming shift $action with the service…"
  Thread{
   var success=false;var definitiveRejection=false
   try{
    active.bearer()
    ShiftTransitionStore(this).use{db->
     val request=db.prepare(scope,action,reason)
     val receipt=GuardAccountClient(c.endpoint).transition(active,c.deviceId,scope.binding.assignmentId,DeviceIdentity(this),c.audience,request)
     success=db.accept(scope,action,receipt);definitiveRejection=!success
    }
    if(success&&action=="end")AuthorizedReminders(this).stop()
   }catch(_:Exception){}
   val accepted=success;val declined=definitiveRejection
   runOnUiThread{
    if(stamp!=generation||isFinishing||isDestroyed)return@runOnUiThread
    busy=false
    if(accepted&&action=="end"){startScreen();status.text="Clock-out confirmed by the pilot service. This screen is locked. Queued records remain preserved and automatic delivery may continue until your upload session expires; Sign out stops it."}
    else if(accepted)loadAssignments()
    else if(declined){assignmentOverview(item);status.text="The service declined this request. No clock time was recorded. Refresh assignments before confirming a corrected request."}
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
  button("Escalate"){escalationScreen(item)};button("My escalation requests"){escalationList()};button("Shift location and consent"){locationScreen(item)}
  val draftScope=try{connectedDraftScope(item)}catch(_:Exception){status.text="Sign in and refresh this assignment before recovering its incident draft.";return}
  val retainedDraft=try{ConnectedIncidentDraftStore(this).use{it.read(draftScope)}}catch(_:Exception){status.text="Encrypted incident draft unavailable. Existing text is preserved; do not clear app data.";return}
  val note=EditText(this).apply{hint="Describe the incident";inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE;minLines=3;isSaveEnabled=false;filters=arrayOf(android.text.InputFilter.LengthFilter(8000))}
  note.setText(retainedDraft?:"");incidentDraftEditor=note;incidentDraftScope=draftScope;incidentDraftDirty=false
  note.addTextChangedListener(object:android.text.TextWatcher {
   override fun beforeTextChanged(s:CharSequence?,start:Int,count:Int,after:Int){}
   override fun onTextChanged(s:CharSequence?,start:Int,before:Int,count:Int){}
   override fun afterTextChanged(s:android.text.Editable?){if(!incidentDraftSuppress){incidentDraftDirty=true;persistIncidentDraft()}}
  })
  root.addView(note)
  if(!retainedDraft.isNullOrEmpty())root.addView(TextView(this).apply{text="Recovered encrypted unfinished incident for this account and assignment. It has not been submitted."})
  button("Discard unfinished incident"){
   AlertDialog.Builder(this).setTitle("Discard unfinished incident?").setMessage("Discard only the unfinished text shown here. Recorded incidents remain unchanged.").setNegativeButton("Keep draft",null).setPositiveButton("Discard"){_,_->
    try{
     val cleared=ConnectedIncidentDraftStore(this).use{it.clear(draftScope,note.text.toString())}
     if(cleared){incidentDraftSuppress=true;note.text.clear();incidentDraftSuppress=false;incidentDraftDirty=false;status.text="Unfinished incident discarded."}else status.text="A newer unfinished draft is retained. Reopen this assignment to recover it."
    }catch(_:Exception){status.text="Draft could not be discarded; encrypted text remains preserved."}
   }.show()
  }
  button("Save authorized incident"){
   try{
    check(note.text.toString().isNotBlank())
    val binding=captureBinding?:error("Sign in again");val grant=captureGrant?:error("Refresh authorization");val anchor=captureAnchor?:error("Refresh authorization")
    val observed=Math.addExact(anchor.epochMillis,Math.subtractExact(SystemClock.elapsedRealtime(),anchor.elapsedMillis))
    val db=ScopedEventStore(this)
    try{db.capture("incident",JSONObject().put("description",note.text.toString()),binding,grant,DeviceIdentity(this),observed)}finally{db.close()}
    val cleared=try{ConnectedIncidentDraftStore(this).use{it.clear(draftScope,note.text.toString())}}catch(_:Exception){false}
    incidentDraftSuppress=true;note.text.clear();incidentDraftSuppress=false;incidentDraftDirty=false
    UploadCoordinator(this).request();status.text=(if(!cleared)"Unfinished text remains preserved separately; review before submitting again. "else"")+"Incident saved encrypted on this phone. Automatic delivery is requested; a service receipt is still required."
   }catch(_:Exception){status.text="Incident not saved. Enter a description and refresh authorization if it has expired. Your text remains here."}
  }
  button("Capture authorized photo"){confirmPhoto()}
  button("Assignment messages"){loadDispatch(item,true)}
  if(item.has("checkInPolicy"))button("Check-in reminder settings"){reminderSettings(item)}
  if(item.has("checkInStatus"))button("Review check-in delivery"){checkInStatusScreen(item)}
  if(item.has("checkInPolicy"))button("Complete scheduled check-in"){beginCheckIn(item)}
  if(item.has("patrolRoute"))button("Open assigned patrol"){patrolScreen(item)}
  button("Send queued records"){captureBinding?.let{sendScoped(it.guardId)}}
  button("Refresh authorization"){verifyAssignment(item)}
  button("Back to assignments"){captureGrant=null;captureBinding=null;captureAnchor=null;loadAssignments()}
  button("Sign out",true){signOut()}
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
    button("Back to assignment"){captureScreen(item)};button("Sign out",true){signOut()}
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
     UploadCoordinator(this).request();viewDispatch(item,scope,current)
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
    UploadCoordinator(this).request();dialog.dismiss();status.text="Reason saved locally. Automatic delivery is requested; the original missed deadline remains recorded."
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
         .setMessage("Take a consented test photo to complete this pilot check-in. It will be encrypted locally and queued for automatic delivery while the verified upload session is valid. Opening the camera locks this screen.")
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
   .setMessage("Use a test subject for this pilot. The photo will be encrypted on this phone and linked to your guard and assignment. Automatic delivery requests upload to the configured pilot service while the verified upload session is valid. Camera use locks this screen; a service receipt confirms acceptance.")
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
    committed=true;AuthorizedReminders(this).refresh();UploadCoordinator(this).request();message=if(pending.checkIn==null) "Photo saved encrypted. Automatic delivery is requested; service acceptance is pending." else "Check-in and photo saved locally. Automatic delivery is requested; service acceptance is pending."
   }
  }catch(_:Exception){message="Photo not saved. Authorization may have expired or the camera output was invalid. Sign in and try again."}
  finally{
   if(!committed)retained?.let{EvidenceStore(this).remove(it)}
   revokeUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION);pending.file.delete()
  }
  startScreen();Toast.makeText(this,message,Toast.LENGTH_LONG).show()
 }
 private fun locationScope(item:JSONObject):LocationConsentScope {
  val account=escalationScope()
  check(item.getString("guardId")==account.guardId&&item.getString("vendorId")==account.vendorId&&item.getString("deviceThumbprint")==account.thumbprint)
  return LocationConsentScope(account,GrantBinding(account.guardId,item.getString("siteId"),item.getString("assignmentId"),account.thumbprint,item.getLong("revocationVersion")))
 }
 private fun locationHistory(){
  val account=try{escalationScope()}catch(_:Exception){startScreen();return}
  screen("MY LOCATION CONSENTS","Collection starts only from a visible app action with current shift authority. Withdrawal stops collection and blocks further queued upload for this and earlier matching account, assignment and policy consents; existing encrypted records remain preserved. A later explicit consent can authorize a new collection.")
  try{
   val rows=LocationConsentStore(this).use{it.list(account)}
   if(rows.isEmpty())root.addView(TextView(this).apply{text="No retained location consents for this individual account and phone configuration."})
   for(record in rows)showConsentControls(record)
  }catch(_:Exception){status.text="Encrypted consent history unavailable. Collection cannot be started; do not clear app data."}
  root.addView(TextView(this).apply{text=ConnectedLocationRuntime.description})
  button("Refresh local status"){locationHistory()};button("Back to assignments"){loadAssignments()};button("Sign out",true){signOut()}
 }
 private fun showConsentControls(record:LocationConsentRecord){
  root.addView(TextView(this).apply{text="Assignment ${record.scope.binding.assignmentId} · policy ${record.policy.revision} · "+when{record.withdrawalReceipt!=null->"withdrawal confirmed by service";record.withdrawn->"withdrawn on this phone; service confirmation pending";record.receipt!=null->"consent recorded; collection requires an explicit visible start";else->"consent request retained; service receipt pending"};textSize=15f})
  button(if(record.withdrawn)"Retry original withdrawal"else"Withdraw consent and stop sharing",true){withdrawLocation(record)}
 }
 private fun locationScreen(item:JSONObject){
  val scope=try{locationScope(item)}catch(_:Exception){status.text="Refresh the individually verified assignment before reviewing location consent.";return}
  val policy=try{AuthorizedLocationPolicy.parse(item.getString("locationPolicyPayload"),item.getString("locationPolicySha256"))}catch(_:Exception){null}
  screen("SHIFT LOCATION AND CONSENT",if(policy==null)"No approved location policy is available. Connected collection is disabled; no sampling cadence or notice is assumed."else"Approved policy ${policy.revision} · notice ${policy.noticeRevision}. Precise device-reported fixes do not prove physical presence. Android can delay or stop collection and delivery.")
  root.addView(TextView(this).apply{text=ConnectedLocationRuntime.description;textSize=15f})
  if(policy!=null){
   root.addView(TextView(this).apply{text=policy.notice;textSize=17f;setTextIsSelectable(true)})
   root.addView(TextView(this).apply{text="Approved sample interval: ${policy.interval} ms · minimum movement: ${policy.minDistance} m\nMaximum fix age: ${policy.maxAge} ms · maximum accuracy radius: ${policy.maxAccuracy} m\nMaximum capture lease: ${policy.maxLease} ms\n"+(if(policy.geofence==null)"No approved geofence geometry."else"Approved circle ${policy.geofence.getString("id")} · revision ${policy.geofence.getLong("revision")}. No automatic geofence alert is generated.")})
   val agree=CheckBox(this).apply{text="I have reviewed this exact notice and consent to this policy for this shift.";isChecked=false};root.addView(agree)
   button("Consent and start visible shift location"){
    if(!agree.isChecked){status.text="Review the approved notice and explicitly choose consent before starting.";return@button}
    if(!visibleForLocation){status.text="Return to the visible app before starting location.";return@button}
    val ready=DeviceReadiness(this)
    val nm=getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
    if(!ready.preciseLocationGranted()||!ready.gpsEnabled()||!ready.notificationPermissionGranted()||!nm.areNotificationsEnabled()||nm.getNotificationChannel(ConnectedLocationService.CHANNEL)?.importance==android.app.NotificationManager.IMPORTANCE_NONE){status.text="Enable precise location, device GPS and visible notifications, then review the notice and start again.";return@button}
    try{val record=LocationConsentStore(this).use{it.prepare(scope,policy)};sendLocationConsent(record,item)}catch(_:Exception){status.text="Consent could not be retained. No collection was started; encrypted originals remain preserved."}
   }
   button("Request precise location permission"){
    if(checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION,android.Manifest.permission.ACCESS_COARSE_LOCATION),406)
    else status.text="Precise permission is granted; it does not itself start collection or establish a fresh fix."
   }
   button("Request visible notifications"){
    if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),407)
    else status.text="Notification permission is granted. Check Android notification settings if the location channel is blocked."
   }
  }
  try{for(record in LocationConsentStore(this).use{it.list(scope.account)}.filter{it.scope.binding.assignmentId==scope.binding.assignmentId})showConsentControls(record)}catch(_:Exception){status.text="Consent history unavailable; no collection started."}
  button("Refresh consent and policy"){loadAssignments()};button("My location consents"){locationHistory()};button("Back to assignments"){loadAssignments()};button("Sign out",true){signOut()}
 }
 private fun withdrawLocation(record:LocationConsentRecord){
  try{
   check(escalationScope()==record.scope.account)
   generation++;busy=false;EscalationForeground.cancel()
   if(ConnectedLocationRuntime.activeConsent(record.id))ConnectedLocationRuntime.stop(this,"Consent withdrawn locally")
   LocationConsentStore(this).use{it.withdraw(record.id,record.scope)}
   UploadRuntime.cancel();UploadCoordinator(this).request();locationHistory()
   status.text="Consent withdrawn on this phone. Collection is stopped for this consent and further queued upload for this and earlier matching account, assignment and policy consents is blocked; an earlier in-flight request may already have been accepted. Service withdrawal confirmation may remain pending while offline."
  }catch(_:Exception){ConnectedLocationRuntime.stop(this,"Withdrawal storage unavailable");UploadCoordinator(this).stop(session,config);status.text="Collection and automatic delivery stopped. Withdrawal could not be retained; sign in again to retry. Original encrypted records remain preserved."}
 }
 private fun sendLocationConsent(record:LocationConsentRecord,item:JSONObject){
  val c=config?:return;val stamp=generation
  val authority=try{
   check(escalationScope()==record.scope.account)
   UploadAuthorityStore(this).load(c,record.scope.account.thumbprint)?.also{check(it.subject==record.scope.account.subject&&it.guardId==record.scope.account.guardId&&it.vendorId==record.scope.account.vendorId)}?:error("Sign in again")
  }catch(_:Exception){status.text="Consent remains retained. Sign in again before authorizing collection.";return}
  val cancellation=UploadCancellation();EscalationForeground.add(cancellation);busy=true;status.text="Recording exact notice consent and requesting a fresh signed shift lease. Location is not started yet."
  val timer=Handler(Looper.getMainLooper());val limit=Runnable{cancellation.cancel()};timer.postDelayed(limit,45000)
  Thread{
   var verified:VerifiedShiftGrant?=null;var anchor:ServerTimeAnchor?=null
   try{
    LocationConsentDelivery(applicationContext,c,authority,null,cancellation).use{it.one(record,"consent")}
    val client=GuardAccountClient(c.endpoint,null,cancellation);val started=SystemClock.elapsedRealtime();val boot=Settings.Global.getInt(contentResolver,Settings.Global.BOOT_COUNT,-1)
    val response=client.grant(authority.session(),c.deviceId,record.scope.binding.assignmentId,DeviceIdentity(this),c.audience)
    val received=SystemClock.elapsedRealtime()
    val time=ServerTimeAnchor(response.getLong("server_time_ms"),started,boot)
    val grant=ShiftGrantVerifier(c.issuer,c.audience,c.keys).verify(response.getString("key_id"),response.getString("payload"),response.getString("signature"),record.scope.binding,time,SystemClock.elapsedRealtime(),boot)?:error("Signed location lease unavailable")
    check(grant.location?.id==record.id&&grant.location?.policy?.sha256==record.policy.sha256&&grant.location?.policy?.payload==record.policy.payload)
    verified=grant;anchor=time.copy(elapsedMillis=received)
   }catch(_:Exception){}finally{timer.removeCallbacks(limit);EscalationForeground.remove(cancellation)}
   val lease=verified;val time=anchor
   runOnUiThread{
    if(stamp!=generation||isFinishing||isDestroyed)return@runOnUiThread
    busy=false
    if(lease==null||time==null){locationScreen(item);status.text="Consent or fresh capture authority is unconfirmed. Nothing was started. Retry after refreshing the same approved policy; the exact request remains retained.";return@runOnUiThread}
    try{
     check(visibleForLocation&&escalationScope()==record.scope.account)
     val original=LocationConsentStore(this).use{it.get(record.id,record.scope)}?:error("Original consent missing")
     check(original.accepted)
     val token=ConnectedLocationRuntime.prepare(this,c,original,authority,lease,time)
     startForegroundService(Intent(this,ConnectedLocationService::class.java).putExtra(ConnectedLocationService.TOKEN,token))
     locationScreen(item);status.text="Visible location start requested under the exact consent and signed lease. Check the ongoing notification and refresh local status; no physical presence is established."
    }catch(_:Exception){ConnectedLocationRuntime.stop(this,"Visible start unavailable");locationScreen(item);status.text="Consent is retained but collection did not start. Return to the visible app and check precise permission, GPS and notifications."}
   }
  }.start()
 }
 private fun connectedDraftScope(item:JSONObject):ConnectedIncidentDraftScope {
  session?.bearer()?:error("Verified session required")
  val c=config?:error("Trusted service required");val who=accountIdentity?:error("Individual account required");val b=captureBinding?:error("Verified assignment required")
  check(who.guardId==b.guardId&&item.getString("guardId")==who.guardId&&item.getString("vendorId")==who.vendorId&&item.getString("siteId")==b.siteId&&item.getString("assignmentId")==b.assignmentId)
  return ConnectedIncidentDraftScope(c.uploadBinding(),c.deviceId,b.deviceThumbprint,who.subject,who.guardId,who.vendorId,b.siteId,b.assignmentId)
 }
 private fun persistIncidentDraft(){
  if(!incidentDraftDirty||incidentDraftSuppress)return
  val scope=incidentDraftScope?:return;val editor=incidentDraftEditor?:return
  try{ConnectedIncidentDraftStore(this).use{it.write(scope,editor.text.toString())};incidentDraftDirty=false}catch(_:Exception){editor.error="Encrypted draft save unavailable. Keep this screen open; previously saved text is preserved."}
 }
 private fun openDialer(){
  try{startActivity(Intent(Intent.ACTION_DIAL,Uri.parse("tel:")))}catch(_:Exception){Toast.makeText(this,"No phone dialer is available on this device. Use your established emergency or dispatch channel.",Toast.LENGTH_LONG).show()}
 }
 private fun unverifiedEscalation(){
  screen("ESCALATE · NOT SIGNED IN","No verified guard account is active on this screen. Opening this screen does not submit a request. Sign in to send an attributed request. For immediate help, use your established emergency or dispatch channel.")
  button("Open phone dialer",true){openDialer()}
  root.addView(TextView(this).apply{text="Approved fallback contact is not configured. The dialer opens without a prefilled number or an automatic call.";textSize=14f})
  button("Return to sign-in"){startScreen()}
 }
 private fun escalationScope():EscalationScope {
  session?.bearer()?:error("Sign in again")
  val c=config?:error("Trusted service required");val who=accountIdentity?:error("Verified individual account required")
  val thumbprint=DeviceIdentity(this).publicIdentity()?.thumbprint?:error("Phone identity required")
  return EscalationScope(c.uploadBinding(),c.deviceId,thumbprint,who.subject,who.guardId,who.vendorId)
 }
 private fun escalationTime():Long {
  val anchor=accountAnchor?:error("Refresh assignments")
  val now=SystemClock.elapsedRealtime();check(now>=anchor.elapsedMillis&&anchor.bootCount==Settings.Global.getInt(contentResolver,Settings.Global.BOOT_COUNT,-1))
  return Math.addExact(anchor.epochMillis,now-anchor.elapsedMillis)
 }
 private fun recentEscalationLocation(at:Long):EscalationLocation? = EscalationLocationCapture.latest(this,at)

 private fun escalationScreen(item:JSONObject?=null){
  val scope=try{escalationScope()}catch(_:Exception){unverifiedEscalation();return}
  val assignment=try{if(item==null)null else{check(item.getString("guardId")==scope.guardId&&item.getString("vendorId")==scope.vendorId);item.getString("assignmentId")}}catch(_:Exception){status.text="Assignment context could not be verified. Refresh assignments before opening escalation.";return}
  screen("ESCALATE","Send an attributed request to the Mercury One operator inbox. Service receipt and operator acknowledgement are separate. This does not place an emergency call or confirm that anyone has been contacted.\n"+(if(assignment==null)"No assignment attached." else "Assignment: $assignment"))
  button("Open phone dialer",true){openDialer()}
  val urgency=RadioGroup(this);val assistance=RadioButton(this).apply{id=View.generateViewId();text="Assistance"};val urgent=RadioButton(this).apply{id=View.generateViewId();text="Urgent"};urgency.addView(assistance);urgency.addView(urgent);urgency.check(assistance.id);root.addView(urgency)
  val description=EditText(this).apply{hint="Describe the help you need";minLines=4;inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE;isSaveEnabled=false;importantForAutofill=View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS;filters=arrayOf(android.text.InputFilter.LengthFilter(4000))};root.addView(description)
  val includeLocation=CheckBox(this).apply{text="Include a recent device location if available";isChecked=true};root.addView(includeLocation)
  root.addView(TextView(this).apply{text="An unavailable, stale or simulated location is omitted. Location never blocks a request. Approved fallback contact is not configured; use your established channel or the dialer.";textSize=14f})
  button("Save and send request"){
   try{
    check(escalationScope()==scope);val at=escalationTime();val location=if(includeLocation.isChecked)recentEscalationLocation(at)else null
    val intent=EscalationIntent(UUID.randomUUID().toString(),scope.guardId,scope.vendorId,assignment,at,if(urgency.checkedRadioButtonId==urgent.id)"urgent"else"assistance",description.text.toString(),location)
    EscalationStore(this).use{it.save(scope,intent)};description.text.clear();UploadCoordinator(this).request();showEscalation(intent.id,scope);sendEscalation(intent.id,scope)
   }catch(_:Exception){description.error="Request not saved. Enter up to 2,000 characters and sign in or refresh assignments if your account has expired. Your text remains here."}
  }
  button("My escalation requests"){escalationList()};button("Back to assignments"){loadAssignments()};button("Sign out",true){signOut()}
 }
 private fun escalationList(){
  val scope=try{escalationScope()}catch(_:Exception){unverifiedEscalation();return}
  screen("MY ESCALATION REQUESTS","Saved locally, service received and operator acknowledged are distinct states. An acknowledgement does not establish that help has arrived or the issue is resolved.")
  try{
   val rows=EscalationStore(this).use{it.list(scope)}
   if(rows.isEmpty())root.addView(TextView(this).apply{text="No saved requests for this individual account and phone configuration.";textSize=16f})
   for(record in rows)button("${record.state} · ${java.util.Date(record.intent.occurredAt)}"){showEscalation(record.id,scope)}
   if(rows.size==50)root.addView(TextView(this).apply{text="Showing the latest 50 requests. Older records remain encrypted on this phone."})
  }catch(_:Exception){status.text="Saved requests could not be opened. Existing encrypted data remains preserved."}
  button("New escalation request"){escalationScreen()};button("Open phone dialer",true){openDialer()};button("Back to assignments"){loadAssignments()};button("Sign out",true){signOut()}
 }
 private fun showEscalation(id:String,scope:EscalationScope){
  try{
   check(escalationScope()==scope);val r=EscalationStore(this).use{it.get(id,scope)}?:error("Saved request unavailable")
   screen("ESCALATE · ${r.state.uppercase()}",when(r.state){"Operator acknowledged"->"An approved operator explicitly acknowledged this request. This does not establish that help arrived, external contacts were notified or the issue is resolved.";"Service received"->"The protected operator inbox received this exact request. No operator acknowledgement has been confirmed.";else->"Saved encrypted on this phone. Service receipt and operator acknowledgement are not confirmed. Use your established channel if you need immediate help."})
   root.addView(TextView(this).apply{text="${r.intent.urgency.uppercase()} · ${java.util.Date(r.intent.occurredAt)}\n${r.intent.description}\n"+(r.intent.assignmentId?.let{"Assignment: $it"}?:"No assignment attached.")+"\n"+(if(r.intent.location==null)"No location attached."else"Device-reported location attached; physical presence is not verified.");textSize=17f;setTextIsSelectable(true)})
   r.snapshot?.optJSONObject("acknowledgement")?.let{ack->root.addView(TextView(this).apply{text="Operator acknowledgement · ${java.util.Date(ack.getLong("acknowledged_at_ms"))}\n${ack.getString("note")}";textSize=17f;setTextIsSelectable(true)})}
   if(r.review!=null)root.addView(TextView(this).apply{text="Delivery or status needs review. The original request and any verified receipt are retained unchanged. A generic failure is not proof of permanent rejection.";textSize=15f})
   button(if(r.receipt==null)"Retry delivery and check status"else"Refresh operator status"){sendEscalation(id,scope)}
   button("Open phone dialer",true){openDialer()};button("My escalation requests"){escalationList()};button("Back to assignments"){loadAssignments()};button("Sign out",true){signOut()}
  }catch(_:Exception){status.text="This request could not be opened for the current account and phone configuration. Sign in again; encrypted records remain preserved."}
 }
 private fun sendEscalation(id:String,scope:EscalationScope){
  val c=config?:return;val stamp=generation
  val authority=try{
   check(escalationScope()==scope)
   UploadAuthorityStore(this).load(c,scope.thumbprint)?.also{check(it.subject==scope.subject&&it.guardId==scope.guardId&&it.vendorId==scope.vendorId)}?:error("Sign in again")
  }catch(_:Exception){status.text="Request remains saved. Sign in again to authorize delivery and status checks.";return}
  val cancellation=UploadCancellation();EscalationForeground.add(cancellation);busy=true
  status.text="Trying delivery and protected status for the saved request. No new operator acknowledgement has been confirmed."
  val timer=Handler(Looper.getMainLooper());val limit=Runnable{cancellation.cancel()};timer.postDelayed(limit,45000)
  Thread{
   try{EscalationDelivery(applicationContext,c,authority,null,cancellation).use{it.one(id)}}catch(_:Exception){}
   finally{timer.removeCallbacks(limit);EscalationForeground.remove(cancellation)}
   runOnUiThread{if(stamp==generation&&!isFinishing&&!isDestroyed){busy=false;showEscalation(id,scope)}}
  }.start()
 }
 private fun patrolScreen(item:JSONObject,selectedRoundId:String?=null){
  val binding=captureBinding?:return
  screen("ASSIGNED PATROL","Select checkpoints in any order. Each checkpoint is a manual observation; it does not prove physical presence.")
  try{
   check(binding.assignmentId==item.getString("assignmentId")&&binding.guardId==item.getString("guardId")&&binding.siteId==item.getString("siteId"))
   val plan=AuthorizedPatrolRoute.parse(item.getJSONObject("patrolRoute"))
   val db=ScopedEventStore(this)
   try{
    val recorded=db.checkpointProgress(binding,plan.routeId,plan.revision)
    if(plan.rounds!=null&&selectedRoundId==null){
     status.text="Choose an assigned patrol round. You can switch rounds without completing them in sequence. Saved checkpoints remain attached to their original round."
     for(round in plan.rounds){
      val count=plan.checkpoints.count{PatrolCheckpointKey(round.id,it.id) in recorded}
      button("${round.label} · $count/${plan.checkpoints.size} recorded"){patrolScreen(item,round.id)}
     }
    }else{
     val round=plan.round(selectedRoundId)
     if(round!=null){screen("PATROL · ${round.label}","Select checkpoints in any order for this assigned round. A saved checkpoint cannot be recorded twice in the same round.")}
     for(point in plan.checkpoints){
      if(PatrolCheckpointKey(selectedRoundId,point.id) in recorded)root.addView(TextView(this).apply{text="Recorded · ${point.label}";textSize=16f;setPadding(0,dp(12),0,dp(12))})
      else button("Record checkpoint: ${point.label}"){
       try{
        val choice=plan.choice(point.id,selectedRoundId)
        val grant=captureGrant?:error("Refresh authorization");val anchor=captureAnchor?:error("Refresh authorization")
        val observed=Math.addExact(anchor.epochMillis,Math.subtractExact(SystemClock.elapsedRealtime(),anchor.elapsedMillis))
        ScopedEventStore(this).use{current->current.captureCheckpoint(binding,grant,DeviceIdentity(this),choice.routeId,choice.revision,choice.checkpointId,observed,choice.roundId)}
        UploadCoordinator(this).request();patrolScreen(item,selectedRoundId);status.text="Checkpoint saved encrypted for ${round?.label?:"this patrol"}. Automatic delivery is requested; service acceptance is pending."
       }catch(_:Exception){status.text="Checkpoint not recorded. It may already be saved in this round, or authorization may have expired. Return to the assignment to refresh."}
      }
     }
     if(plan.rounds!=null)button("Choose another patrol round"){patrolScreen(item)}
    }
   }finally{db.close()}
  }catch(_:Exception){status.text="The assigned route or round could not be verified. Existing records were preserved; refresh assignment authorization."}
  button("Send my queued records"){sendScoped(binding.guardId)}
  button("Back to assignment"){captureScreen(item)}
  button("Sign out",true){signOut()}
 }
 private fun sendScoped(guardId:String){
  try{
   session?.bearer()?:error("Sign in again")
   val requested=UploadCoordinator(this).request()
   status.text=(if(requested)"Automatic upload requested. Android schedules network work and may delay it. " else "Sign in again to authorize automatic delivery. ")+ScopedEventStore(this).use{it.uploadSummary(guardId)}
  }catch(_:Exception){status.text="Upload authority is unavailable. Sign in again; encrypted records and receipts remain preserved."}
 }

}
