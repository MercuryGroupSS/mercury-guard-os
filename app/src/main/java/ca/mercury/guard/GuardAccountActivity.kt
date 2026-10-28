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
 private data class PendingPhoto(val file:File,val binding:GrantBinding,val grant:VerifiedShiftGrant,val anchor:ServerTimeAnchor,val checkIn:AuthorizedCheckInEvidence?,val owner:ConnectedDispatchOwner)
 private var pendingPhoto:PendingPhoto?=null
 private var locationPing:LocationPing?=null
 private var patrolPointLocation:PatrolPointLocation?=null
 private var password: EditText?=null
 private var incidentDraftEditor:EditText?=null
 private var incidentHistoryView:ConnectedIncidentHistoryView?=null
 private var connectedPrivatePanel:ConnectedPrivatePanel?=null
 private var connectedAttentionView:ConnectedCheckInAttentionView?=null
 private var connectedAttentionRefresh:Runnable?=null
 private val connectedAttentionHandler=Handler(Looper.getMainLooper())
 private var ownedDialog:AlertDialog?=null
 private var incidentDraftScope:ConnectedIncidentDraftScope?=null
 private var incidentDraftDirty=false
 private var incidentDraftSuppress=false
 private var visibleForLocation=false
 private val shiftDeadlineHandler=Handler(Looper.getMainLooper())
 private var shiftDeadlineRefresh:Runnable?=null
 private lateinit var root: LinearLayout
 private lateinit var status: TextView
 private val cyan=Color.rgb(0,104,125)
 private fun dp(n:Int)=(n*resources.displayMetrics.density).toInt()
 override fun onCreate(state:Bundle?) {
  super.onCreate(state)
  ConnectedAttentionAccountLock.register(this)
  window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
  // No authority is recovered, but a different live task can still own an authorized camera result.
  ConnectedAttentionAccountLock.cleanupAbandonedCameraOutput(this)
  try { AuthorizedReminders(this).refresh();config=GuardServiceConfig.load(this);UploadCoordinator(this).request(); startScreen() }
  catch(_:Exception){ config=null; screen("CONNECTION UNAVAILABLE","The packaged service configuration is invalid. Contact your administrator."); button("Escalate"){unverifiedEscalation()};button("Return"){finish()} }
  if(intent.getBooleanExtra("open_escalation",false)){intent.removeExtra("open_escalation");unverifiedEscalation()}
 }
 /** A notification returning to an existing instance never retains foreground account access. */
 override fun onNewIntent(incoming:Intent){
  super.onNewIntent(incoming);setIntent(incoming)
  lockForConnectedAttentionEntry()
 }
 /** Also covers a fast system full-screen interruption and another still-resumed app window. */
 internal fun lockForConnectedAttentionEntry(){
  check(Looper.myLooper()==Looper.getMainLooper())
  if(isDestroyed)return
  clearSession();if(::root.isInitialized)scrubDepartedView(root)
  stopped=!visibleForLocation
  if(!isFinishing){startScreen();if(!visibleForLocation)loginParticles?.stopMotion()} // Passive controls only; never starts a biometric prompt.
 }
 internal fun retainsPendingCameraOutput(file:File):Boolean {check(Looper.myLooper()==Looper.getMainLooper());return pendingPhoto?.file?.absoluteFile==file.absoluteFile}
 /** Home may return before onStop. Fence user-chosen departure before the pause and scrub now. */
 override fun onUserLeaveHint(){
  super.onUserLeaveHint();visibleForLocation=false;stopped=true;clearSession()
  if(::root.isInitialized)scrubDepartedView(root)
  if(!isFinishing&&!isDestroyed)screen("ACCOUNT LOCKED","Sign in again when you return to Mercury One.")
 }
 override fun onStop(){super.onStop();stopped=true;clearSession()}
 override fun onResume(){super.onResume();visibleForLocation=true;if(stopped){stopped=false;startScreen()}else shiftDeadlineRefresh?.run();loginParticles?.startMotion()}
 override fun onPause(){visibleForLocation=false;if(incidentHistoryView!=null||connectedPrivatePanel!=null){stopped=true;clearSession()};cancelPatrolPoint();cancelShiftDeadline(true);persistIncidentDraft();loginParticles?.setSigningIn(false);loginParticles?.stopMotion();super.onPause()}
 override fun onDestroy(){ConnectedAttentionAccountLock.unregister(this);dismissOwnedDialog();closeIncidentHistory();closeConnectedPanel();cancelShiftDeadline();loginParticles?.stopMotion();super.onDestroy()}
 private fun clearSession(){dismissOwnedDialog();closeIncidentHistory();closeConnectedPanel();cancelPatrolPoint();cancelShiftDeadline();persistIncidentDraft();incidentDraftEditor=null;incidentDraftScope=null;accountIdentity=null;accountAnchor=null;captureGrant=null;captureBinding=null;captureAnchor=null;generation++;busy=false;locationPing?.cancel();locationPing=null;signal?.cancel();signal=null;password?.text?.clear();password=null;session?.clear();session=null}
 private fun showOwnedDialog(dialog:AlertDialog):AlertDialog {
  dismissOwnedDialog();ownedDialog=dialog
  dialog.setOnDismissListener{if(ownedDialog===dialog)ownedDialog=null};dialog.show();return dialog
 }
 private fun AlertDialog.Builder.showOwned()=showOwnedDialog(create())
 private fun dismissOwnedDialog(){val dialog=ownedDialog;ownedDialog=null;dialog?.setOnDismissListener(null);dialog?.dismiss();dialog?.window?.decorView?.let{scrubDepartedView(it)}}
 private fun scrubDepartedView(view:View){
  view.setOnClickListener(null)
  if(view is TextView){val suppressed=incidentDraftSuppress;incidentDraftSuppress=true;try{view.text=""}finally{incidentDraftSuppress=suppressed}}
  if(view is ViewGroup)for(i in 0 until view.childCount)scrubDepartedView(view.getChildAt(i))
 }
 private fun closeIncidentHistory(){incidentHistoryView?.close();incidentHistoryView=null}
 private fun closeConnectedPanel(){connectedAttentionRefresh?.let{connectedAttentionHandler.removeCallbacks(it)};connectedAttentionRefresh=null;connectedAttentionView?.close();connectedAttentionView=null;connectedPrivatePanel?.close();connectedPrivatePanel=null}
 private fun screen(title:String,detail:String){
  closeIncidentHistory();closeConnectedPanel();cancelPatrolPoint();cancelShiftDeadline()
  persistIncidentDraft();incidentDraftEditor=null;incidentDraftScope=null;incidentDraftDirty=false
  loginParticles?.stopMotion();loginParticles=null
  password=null
  val scroll=ScrollView(this).apply{isFillViewport=true;setBackgroundColor(Color.rgb(244,248,250))}
  root=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(24),dp(32),dp(24),dp(24))}
  fun text(value:String,size:Float)=TextView(this).apply{text=value;textSize=size;setTextColor(Color.rgb(25,42,54));setPadding(0,dp(10),0,dp(10))}
  root.addView(text("MERCURY ONE",14f).apply{setTextColor(cyan)})
  root.addView(text(title,26f).apply{isAccessibilityHeading=true})
  status=text(detail,16f).apply{accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE};root.addView(status)
  // Insets must reduce the measured viewport, not clip its nominal scrolling area.
  val viewport=FrameLayout(this).apply{setBackgroundColor(Color.rgb(244,248,250));addView(scroll,FrameLayout.LayoutParams(-1,-1))}
  scroll.addView(root);setContentView(viewport)
  viewport.setOnApplyWindowInsetsListener{v,i->v.setPadding(i.systemWindowInsetLeft,i.systemWindowInsetTop,i.systemWindowInsetRight,i.systemWindowInsetBottom);i};viewport.requestApplyInsets()
 }
 private fun button(title:String,allowWhileBusy:Boolean=false,action:()->Unit):Button=Button(this).apply{text=title;isAllCaps=false;textSize=16f;minHeight=dp(56);setOnClickListener{if(allowWhileBusy||!busy){persistIncidentDraft();if(!incidentDraftDirty||allowWhileBusy)action()}}}.also{root.addView(it,LinearLayout.LayoutParams(-1,-2))}
 private fun cancelPatrolPoint(){val current=patrolPointLocation;patrolPointLocation=null;current?.cancel();if(current!=null)busy=false}
 private fun cancelShiftDeadline(retainForResume:Boolean=false){shiftDeadlineRefresh?.let{shiftDeadlineHandler.removeCallbacks(it)};if(!retainForResume)shiftDeadlineRefresh=null}
 private fun shiftScope(item:JSONObject)=DispatchScope(GrantBinding(item.getString("guardId"),item.getString("siteId"),item.getString("assignmentId"),item.getString("deviceThumbprint"),item.getLong("revocationVersion")),item.getString("vendorId"))
 private fun shiftObserved(item:JSONObject)=ConnectedLocationTiming.observationAt(item.getLong("status_server_time_ms"),item.getLong("status_elapsed_ms"),SystemClock.elapsedRealtime())
 private fun connectedShiftOwner(item:JSONObject):ConnectedDispatchOwner?=try{val read=assignmentReadContext(item);ConnectedDispatchOwner(read.owner.configuration,read.owner.deviceId,read.owner.subject,read.scope)}catch(_:Exception){null}
 private fun pendingShift(item:JSONObject):Boolean {
  val owner=connectedShiftOwner(item)?:return false
  return ShiftTransitionStore(this).use{db->listOf("start","end").any{action->db.saved(owner,action)?.let{!it.has("receipt")&&!it.has("rejection")}==true}}
 }
 /** Presentation only. The service still decides whether an explicit end request is accepted. */
 private fun watchShiftEnd(item:JSONObject,reached:()->Unit){
  cancelShiftDeadline()
  if(item.optJSONObject("shift_state")?.optString("state")!="active"||!item.has("status_server_time_ms")||!item.has("status_elapsed_ms")||!item.has("endsAt"))return
  val displayedRoot=root;val stamp=generation
  val refresh=object:Runnable {override fun run(){
   shiftDeadlineHandler.removeCallbacks(this)
   if(shiftDeadlineRefresh!==this)return
   if(stamp!=generation||displayedRoot!==root||isFinishing||isDestroyed){cancelShiftDeadline();return}
   if(!visibleForLocation||stopped)return
   try{
    if(pendingShift(item)){cancelShiftDeadline();return}
    val remaining=ShiftScreenTiming.remaining(item.getLong("status_server_time_ms"),item.getLong("status_elapsed_ms"),SystemClock.elapsedRealtime(),item.getLong("endsAt"))
    if(remaining==0L){cancelShiftDeadline();reached()}else shiftDeadlineHandler.postDelayed(this,remaining)
   }catch(_:Exception){cancelShiftDeadline();status.text="Shift timing could not be verified. Refresh assignments before confirming clock-out."}
  }}
  shiftDeadlineRefresh=refresh;refresh.run()
 }
 private fun confirmClockOut(item:JSONObject,scope:DispatchScope)=confirmClockOut(item,scope,connectedShiftOwner(item))
 private fun confirmClockOut(item:JSONObject,scope:DispatchScope,owner:ConnectedDispatchOwner?){
  try{check(shiftObserved(item)>=item.getLong("endsAt"))}catch(_:Exception){status.text="Refresh assignments before confirming scheduled clock-out.";return}
  val stamp=generation;val displayedRoot=root
  AlertDialog.Builder(this).setTitle("Confirm clock-out").setMessage("Record the end of your shift now?").setNegativeButton("Cancel",null).setPositiveButton("Confirm clock-out"){_,_->if(stamp==generation&&root===displayedRoot&&visibleForLocation&&!stopped&&owner?.scope==scope)submitShift(item,owner,"end","")}.showOwned()
 }
 private fun earlyExit(item:JSONObject,scope:DispatchScope)=earlyExit(item,scope,connectedShiftOwner(item))
 private fun earlyExit(item:JSONObject,scope:DispatchScope,owner:ConnectedDispatchOwner?){
  try{if(shiftObserved(item)>=item.getLong("endsAt")){confirmClockOut(item,scope,owner);return}}catch(_:Exception){status.text="Refresh assignments before requesting an early exit.";return}
  val reason=EditText(this).apply{hint="Reason for leaving early";isSaveEnabled=false;filters=arrayOf(android.text.InputFilter.LengthFilter(2000))}
  val stamp=generation;val displayedRoot=root
  val dialog=AlertDialog.Builder(this).setTitle("End shift early").setMessage("Give a reason, then confirm. This records an early exit; it does not notify dispatch yet.").setView(reason).setNegativeButton("Cancel",null).setPositiveButton("Confirm early exit",null).create()
  dialog.setOnShowListener{dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener{
   if(stamp!=generation||root!==displayedRoot||!visibleForLocation||stopped){dialog.dismiss();return@setOnClickListener}
   try{if(shiftObserved(item)>=item.getLong("endsAt")){dialog.dismiss();confirmClockOut(item,scope,owner);return@setOnClickListener}}catch(_:Exception){reason.error="Refresh assignment timing before confirming";return@setOnClickListener}
   val text=reason.text.toString();if(text.isBlank())reason.error="A reason is required" else if(!ShiftTransitionStore.validReason(text))reason.error="Please shorten the reason before confirming" else if(owner?.scope!=scope)reason.error="Sign in and refresh this assignment before confirming" else{dialog.dismiss();submitShift(item,owner,"end",text)}
  }};showOwnedDialog(dialog)
 }
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
   val builder=BiometricPrompt.Builder(this).setTitle("Unlock guard sign-in").setNegativeButton("Cancel",mainExecutor){_,_->if(stamp==generation){signal=null;loginParticles?.setSigningIn(false)}}
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
     val guard=p.getString("guard_id");val vendor=p.getString("vendor_id");val rows=a.getJSONArray("assignments")
     val subject=p.getString("auth_subject");check(EscalationRules.uuid(subject))
     val epoch=a.getLong("server_time_ms");val boot=Settings.Global.getInt(contentResolver,Settings.Global.BOOT_COUNT,-1);check(epoch>0&&receivedElapsed>0&&boot>=0)
     accountIdentity=AccountIdentity(subject,guard,vendor);accountAnchor=ServerTimeAnchor(epoch,receivedElapsed,boot)
     UploadCoordinator(this).authorize(c,active,guard,vendor,subject)
     val observed=Math.addExact(epoch,Math.subtractExact(SystemClock.elapsedRealtime(),receivedElapsed))
     val activeRows=(0 until rows.length()).map{rows.getJSONObject(it)}.filter{it.optBoolean("assignmentActive",true)&&it.optJSONObject("shift_state")?.optString("state")=="active"&&observed>=it.getLong("startsAt")&&observed<it.getLong("endsAt")}
     val activeIds=activeRows.map{it.getString("assignmentId")}.toSet()
     val reminderRows=activeRows.filter{it.has("checkInPolicy")&&!it.isNull("checkInPolicy")}
     val reminderPolicies=reminderRows.associate{row->val scope=shiftScope(row);check(scope.binding.guardId==guard&&scope.vendorId==vendor&&scope.binding.deviceThumbprint==DeviceIdentity(this).publicIdentity()?.thumbprint);val policy=JSONObject(row.getJSONObject("checkInPolicy").toString());AuthorizedCheckInPolicy.parse(policy);ConnectedDispatchOwner(c.uploadBinding(),c.deviceId,subject,scope) to policy}
     check(reminderPolicies.size==reminderRows.size);AuthorizedReminders(this).retainForAssignments(reminderPolicies)
     ConnectedLocationRuntime.stopIfUnavailable(this,subject,activeIds)
     val summary=ScopedEventStore(this).use{it.uploadSummary(escalationScope())}
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
  val scope=shiftScope(item)
  val owner=connectedShiftOwner(item)
  val state=item.getJSONObject("shift_state").getString("state")
  val observed=shiftObserved(item)
  val windowElapsed=state=="active"&&observed>=item.getLong("endsAt")
  screen("SHIFT · ${item.getString("siteId")}",if(windowElapsed)"Scheduled window elapsed · clock-out unconfirmed. New capture is unavailable. Confirm the actual clock-out separately; no end time has been recorded automatically.\nAttendance records remain local to the pilot service; payroll is not connected." else "Service status: ${state.replace('_',' ')}. Attendance records remain local to the pilot service; payroll is not connected.")
  try{
   val pending=if(owner==null)emptyList()else ShiftTransitionStore(this).use{db->listOf("start","end").mapNotNull{action->db.saved(owner,action)?.takeIf{!it.has("receipt")&&!it.has("rejection")}}}
   for(saved in pending){val request=saved.getJSONObject("request");button("Resolve pending ${request.getString("action")}"){submitShift(item,owner,request.getString("action"),request.getString("reason"))}}
   if(pending.isEmpty()){
    when(state){
     "not_started"->if(item.getBoolean("canStart"))button("Clock in"){
      val stamp=generation;val displayedRoot=root
      AlertDialog.Builder(this).setTitle("Confirm clock-in").setMessage("Record the start of your shift at this site?").setNegativeButton("Cancel",null).setPositiveButton("Confirm clock-in"){_,_->if(stamp==generation&&root===displayedRoot&&visibleForLocation&&!stopped)submitShift(item,owner,"start","")}.showOwned()
     }else status.text="This assignment is outside its clock-in window. Refresh assignments when it begins."
     "active"->{
      val continuing=if(observed<item.getLong("endsAt")&&item.optBoolean("assignmentActive",true))button("Continue shift"){verifyAssignment(item)}else null
      if(observed<item.getLong("endsAt")&&!item.optBoolean("assignmentActive",true))status.text="Assignment cancelled. Capture is unavailable; use Escalate to request an early closeout."
      watchShiftEnd(item){
       continuing?.let{root.removeView(it)}
       status.text="Scheduled window elapsed · clock-out unconfirmed. New capture is unavailable. Confirm the actual clock-out separately; no end time has been recorded automatically.\nAttendance records remain local to the pilot service; payroll is not connected."
       button("Clock out"){confirmClockOut(item,scope,owner)}
      }
     }
     "ended"->status.text=if(item.optBoolean("assignmentActive",true))"Shift ended. Saved records remain available for upload." else "Cancelled assignment closed. Saved records are preserved; upload requires administrator review."
     else->error("Unknown shift state")
    }
   }
  }catch(_:Exception){status.text="Shift status could not be opened. Refresh assignments; saved confirmation requests remain preserved."}
  button("Escalate"){escalationScreen(item)}
  button("My escalation requests"){escalationList()};button("Shift location and consent"){locationScreen(item)}
  button("Read assignment instructions"){readAssignmentInstructions(item)}
  button("Connected device readiness"){connectedReadiness(item)}
  button("My recorded incidents"){loadIncidentHistory(item)}
  button("Send my queued records"){sendScoped(scope.binding.guardId)}
  button("Refresh assignments"){loadAssignments()};button("Sign out",true){signOut()}
 }
 private fun submitShift(item:JSONObject,owner:ConnectedDispatchOwner?,action:String,reason:String){
  if(busy)return
  val read=try{assignmentReadContext(item)}catch(_:Exception){status.text="Sign in and refresh this assignment before confirming.";return}
  if(owner==null||owner!=ConnectedDispatchOwner(read.owner.configuration,read.owner.deviceId,read.owner.subject,read.scope)){status.text="This confirmation belongs to another account or phone configuration. Refresh assignments.";return}
  val c=read.config;val active=read.session;val scope=owner.scope;val stamp=generation;val displayedRoot=root
  cancelShiftDeadline()
  if(action=="end")ConnectedLocationRuntime.stopForAssignment(this,scope,"End requested for assignment ${scope.binding.assignmentId}")
  busy=true;captureGrant=null;captureBinding=null;captureAnchor=null
  status.text="Confirming shift $action with the service…"
  Thread{
   var success=false;var definitiveRejection=false
   try{
    active.bearer()
    ShiftTransitionStore(this).use{db->
     val request=db.prepare(owner,action,reason)
     val receipt=GuardAccountClient(c.endpoint).transition(active,c.deviceId,scope.binding.assignmentId,DeviceIdentity(this),c.audience,request)
     success=db.accept(owner,action,receipt);definitiveRejection=!success
    }
    if(success&&action=="end")AuthorizedReminders(this).stopForAssignment(owner)
   }catch(_:Exception){}
   val accepted=success;val declined=definitiveRejection
   runOnUiThread{
    if(!assignmentReadAuthorized(read,displayedRoot,stamp,true))return@runOnUiThread
    busy=false
    if(!visibleForLocation){status.text="Shift confirmation processing finished. Refresh assignments when you return to check the recorded result.";return@runOnUiThread}
    if(accepted&&action=="end"){startScreen();status.text="Clock-out confirmed for assignment ${scope.binding.assignmentId}. This screen is locked. Other current assignment resources and queued records remain preserved; automatic delivery may continue until your upload session expires. Sign out stops it."}
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
  val closeoutOwner=connectedShiftOwner(item)
  screen("AUTHORIZED ASSIGNMENT","Site: ${item.getString("siteId")}\nAuthorized capture · encrypted local save. Sending records confirms pilot receipt only, not dashboard delivery or payroll clock-in.")
  button("Escalate"){escalationScreen(item)};button("My escalation requests"){escalationList()};button("Shift location and consent"){locationScreen(item)}
  button("Connected device readiness"){connectedReadiness(item)}
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
   val stamp=generation;val displayedRoot=root
   AlertDialog.Builder(this).setTitle("Discard unfinished incident?").setMessage("Discard only the unfinished text shown here. Recorded incidents remain unchanged.").setNegativeButton("Keep draft",null).setPositiveButton("Discard"){_,_->
    if(stamp!=generation||root!==displayedRoot||!visibleForLocation||stopped)return@setPositiveButton
    try{
     val cleared=ConnectedIncidentDraftStore(this).use{it.clear(draftScope,note.text.toString())}
     if(cleared){incidentDraftSuppress=true;note.text.clear();incidentDraftSuppress=false;incidentDraftDirty=false;status.text="Unfinished incident discarded."}else status.text="A newer unfinished draft is retained. Reopen this assignment to recover it."
    }catch(_:Exception){status.text="Draft could not be discarded; encrypted text remains preserved."}
   }.showOwned()
  }
  button("Save authorized incident"){
   try{
    check(note.text.toString().isNotBlank())
    val binding=captureBinding?:error("Sign in again");val grant=captureGrant?:error("Refresh authorization");val anchor=captureAnchor?:error("Refresh authorization")
    val observed=Math.addExact(anchor.epochMillis,Math.subtractExact(SystemClock.elapsedRealtime(),anchor.elapsedMillis))
    val db=ScopedEventStore(this)
    try{db.captureIncident(draftScope,note.text.toString(),binding,grant,DeviceIdentity(this),observed)}finally{db.close()}
    val cleared=try{ConnectedIncidentDraftStore(this).use{it.clear(draftScope,note.text.toString())}}catch(_:Exception){false}
    incidentDraftSuppress=true;note.text.clear();incidentDraftSuppress=false;incidentDraftDirty=false
    UploadCoordinator(this).request();status.text=(if(!cleared)"Unfinished text remains preserved separately; review before submitting again. "else"")+"Incident saved encrypted on this phone. Automatic delivery is requested; a service receipt is still required."
   }catch(_:Exception){status.text="Incident not saved. Enter a description and refresh authorization if it has expired. Your text remains here."}
  }
  button("My recorded incidents"){loadIncidentHistory(item)}
  button("Capture authorized photo"){confirmPhoto()}
  button("Assignment messages"){loadDispatch(item,true)}
  if(item.has("checkInPolicy"))button("Check-in reminder settings"){reminderSettings(item)}
  if(item.optJSONObject("checkInPolicy")?.has("attention")==true)button("Review check-in attention"){connectedAttention(item)}
  if(item.has("checkInStatus"))button("Review check-in delivery"){checkInStatusScreen(item)}
  if(item.has("checkInPolicy"))button("Complete scheduled check-in"){beginCheckIn(item)}
  if(item.has("patrolRoute"))button("Open assigned patrol"){patrolScreen(item)}
  button("Send queued records"){captureBinding?.let{sendScoped(it.guardId)}}
  button("Refresh authorization"){verifyAssignment(item)}
  button("Back to assignments"){captureGrant=null;captureBinding=null;captureAnchor=null;loadAssignments()}
  button("Sign out",true){signOut()}
  watchShiftEnd(item){
   captureGrant=null
   status.text="Scheduled window elapsed · clock-out unconfirmed. New capture is unavailable. Your unfinished incident remains preserved; confirm clock-out separately."
   button("Clock out"){confirmClockOut(item,shiftScope(item),closeoutOwner)}
  }
 }
 private data class AssignmentReadContext(val config:GuardServiceConfig,val session:GuardAccountClient.Session,val account:AccountIdentity,val owner:ConnectedIncidentDraftScope,val scope:DispatchScope)
 private fun connectedCaptureOwner():ConnectedDispatchOwner {
  val c=config?:error("Trusted service required");val active=session?:error("Sign in again");val who=accountIdentity?:error("Individual account required");active.bearer()
  val binding=captureBinding?:error("Refresh assignment authorization")
  check(binding.guardId==who.guardId&&binding.deviceThumbprint==DeviceIdentity(this).publicIdentity()?.thumbprint)
  return ConnectedDispatchOwner(c.uploadBinding(),c.deviceId,who.subject,DispatchScope(binding,who.vendorId))
 }
 private class AssignmentReadDenied:IllegalStateException()
 private fun assignmentReadContext(item:JSONObject):AssignmentReadContext {
  val c=config?:error("Trusted service required");val active=session?:error("Sign in again");val who=accountIdentity?:error("Individual account required")
  active.bearer();val thumb=DeviceIdentity(this).publicIdentity()?.thumbprint?:error("Phone identity required");val scope=shiftScope(item)
  check(scope.binding.guardId==who.guardId&&scope.vendorId==who.vendorId&&scope.binding.deviceThumbprint==thumb)
  return AssignmentReadContext(c,active,who,ConnectedIncidentDraftScope(c.uploadBinding(),c.deviceId,thumb,who.subject,who.guardId,who.vendorId,scope.binding.siteId,scope.binding.assignmentId),scope)
 }
 private fun assignmentReadAuthorized(read:AssignmentReadContext,displayedRoot:LinearLayout,stamp:Int,allowPaused:Boolean=false):Boolean=try{
  check((allowPaused||visibleForLocation)&&!stopped&&!isFinishing&&!isDestroyed&&root===displayedRoot&&generation==stamp&&config===read.config&&session===read.session&&accountIdentity==read.account)
  read.session.bearer();check(read.owner.configuration==read.config.uploadBinding()&&read.owner.deviceId==read.config.deviceId&&DeviceIdentity(this).publicIdentity()?.thumbprint==read.owner.thumbprint);true
 }catch(_:Exception){false}
 /** Current profile and possession-verified assignment; this never requests a grant or changes attendance. */
 private fun verifyAssignmentRead(read:AssignmentReadContext):JSONObject {
  val client=GuardAccountClient(read.config.endpoint);val profile=client.profile(read.session)
  if(profile.getString("auth_subject")!=read.owner.subject||profile.getString("guard_id")!=read.owner.guardId||profile.getString("vendor_id")!=read.owner.vendorId)throw AssignmentReadDenied()
  val response=client.assignments(read.session,read.config.deviceId,DeviceIdentity(this),read.config.audience);val rows=response.getJSONArray("assignments")
  val matches=(0 until rows.length()).map{rows.getJSONObject(it)}.filter{shiftScope(it)==read.scope}
  if(matches.size!=1)throw AssignmentReadDenied();val epoch=response.getLong("server_time_ms");check(epoch>0)
  return JSONObject(matches.single().toString()).put("status_server_time_ms",epoch).put("status_elapsed_ms",SystemClock.elapsedRealtime())
 }
 private fun newAssignmentPanel(item:JSONObject,title:String)=newAssignmentPanel(item,title,false)
 private fun newAssignmentPanel(item:JSONObject,title:String,activeDispatch:Boolean):Pair<AssignmentReadContext,ConnectedPrivatePanel>? {
  val read=try{assignmentReadContext(item)}catch(_:Exception){startScreen();return null}
  val originalAnchor=captureAnchor
  if(activeDispatch&&(captureBinding!=read.scope.binding||originalAnchor==null)){status.text="Refresh this assignment's authorization before opening its messages.";return null}
  screen(title,"Private information for your individually signed-in account and this phone's assignment. Leaving this panel locks it.")
  val displayedRoot=root;val stamp=generation
  fun authorized()=assignmentReadAuthorized(read,displayedRoot,stamp)&&(!activeDispatch||(captureBinding==read.scope.binding&&captureAnchor===originalAnchor))
  val panel=ConnectedPrivatePanel(this,::authorized,{startScreen()})
  connectedPrivatePanel=panel;root.addView(panel)
  button("Back to assignment"){if(authorized()){if(activeDispatch)captureScreen(item)else assignmentOverview(item)}else startScreen()}
  button("Sign out",true){signOut()}
  return read to panel
 }
 private fun readAssignmentInstructions(item:JSONObject){
  val (read,panel)=newAssignmentPanel(item,"ASSIGNMENT INSTRUCTIONS")?:return
  panel.startWhenAttached{fetchAssignmentInstructions(read,panel,null)}
 }
 private fun fetchAssignmentInstructions(read:AssignmentReadContext,panel:ConnectedPrivatePanel,cursor:String?){
  val ticket=panel.begin("Checking your account and assignment, then loading instructions… Reading does not acknowledge an instruction.")?:return
  Thread{
   var item:JSONObject?=null;var page:ConnectedAssignmentInstructions?=null;var denied=false
   try{
    item=verifyAssignmentRead(read)
    page=ConnectedAssignmentInstructions.parse(read.scope,cursor,GuardAccountClient(read.config.endpoint).dispatch(read.session,read.config.deviceId,read.owner.assignmentId,DeviceIdentity(this),read.config.audience,cursor))
   }catch(_:AssignmentReadDenied){denied=true}catch(e:GuardAccountClient.HttpFailure){denied=e.statusCode==401||e.statusCode==403}catch(_:Exception){}
   val fresh=item;val result=page;val unauthorized=denied
   runOnUiThread{
    panel.render(ticket){
     if(unauthorized){startScreen();return@render}
     if(result==null||fresh==null){text("Instructions could not be verified. Previously received instructions are not shown and no acknowledgement was sent.");action("Retry instruction verification"){fetchAssignmentInstructions(read,panel,null)}}
     else showReadOnlyInstructions(read,panel,fresh,result)
    }
   }
  }.start()
 }
 private fun showReadOnlyInstructions(read:AssignmentReadContext,panel:ConnectedPrivatePanel,item:JSONObject,page:ConnectedAssignmentInstructions){
  panel.text("Service checked: ${java.util.Date(page.checkedAt)}\nGuard: ${read.owner.guardId}\nSite: ${read.owner.siteId}\nAssignment: ${read.owner.assignmentId}\nInstructions are not saved on this phone. Reading here does not acknowledge them. Acknowledge instructions from an authorized shift.")
  if(page.messages.isEmpty())panel.text("No active instructions on this page.")
  for(message in page.messages)panel.action("${message.title} · v${message.version}"){
   val ticket=panel.begin("Opening the received instruction version…")?:return@action
   panel.render(ticket){
    text("${message.title}\nVersion ${message.version} · issued ${java.util.Date(message.issuedAt)}")
    text(message.body);message.dueAt?.let{text("Due: ${java.util.Date(it)}")}
    text("Viewed on screen only. No acknowledgement was recorded or sent.")
    action("Back to this received page"){val back=panel.begin("Opening received page…")?:return@action;panel.render(back){showReadOnlyInstructions(read,panel,item,page)}}
    action("Refresh instructions"){fetchAssignmentInstructions(read,panel,null)}
   }
  }
  if(page.hasMore)panel.action("More instructions"){fetchAssignmentInstructions(read,panel,page.nextCursor)}
  panel.action("Refresh instructions"){fetchAssignmentInstructions(read,panel,null)}
 }
 private fun readinessSnapshot(read:AssignmentReadContext,item:JSONObject?):ConnectedReadiness.Snapshot {
  fun access(readState:()->Boolean)=try{if(readState())ConnectedReadiness.Access.AVAILABLE else ConnectedReadiness.Access.BLOCKED}catch(_:Exception){ConnectedReadiness.Access.UNAVAILABLE}
  val device=DeviceReadiness(this)
  fun channel(id:String)=try{val manager=getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager;val value=manager.getNotificationChannel(id);when{!device.notificationPermissionGranted()||!manager.areNotificationsEnabled()->ConnectedReadiness.Channel.BLOCKED;value==null->ConnectedReadiness.Channel.NOT_CREATED;value.importance==android.app.NotificationManager.IMPORTANCE_NONE->ConnectedReadiness.Channel.BLOCKED;else->ConnectedReadiness.Channel.AVAILABLE}}catch(_:Exception){ConnectedReadiness.Channel.UNAVAILABLE}
  var consent=ConnectedReadiness.Consent.UNAVAILABLE;var collecting:Boolean?=null
  if(item!=null)try{
   if(!item.has("locationPolicyPayload")||item.isNull("locationPolicyPayload"))consent=ConnectedReadiness.Consent.NO_POLICY
   else {
    val policy=AuthorizedLocationPolicy.parse(item.getString("locationPolicyPayload"),item.getString("locationPolicySha256"))
    val account=EscalationScope(read.owner.configuration,read.owner.deviceId,read.owner.thumbprint,read.owner.subject,read.owner.guardId,read.owner.vendorId)
    val scope=LocationConsentScope(account,read.scope.binding)
    val record=LocationConsentStore(this).use{it.list(account).firstOrNull{r->r.scope==scope&&r.policy.sha256==policy.sha256}}
    consent=when{record==null->ConnectedReadiness.Consent.NONE;record.withdrawalReceipt!=null->ConnectedReadiness.Consent.WITHDRAWN;record.withdrawn->ConnectedReadiness.Consent.WITHDRAWAL_PENDING;record.receipt!=null->ConnectedReadiness.Consent.ACCEPTED;else->ConnectedReadiness.Consent.PENDING}
    collecting=record?.let{ConnectedLocationRuntime.activeConsent(it.id)}
   }
  }catch(_:Exception){consent=ConnectedReadiness.Consent.UNAVAILABLE;collecting=null}
  val reminderChannel=if(item?.optJSONObject("checkInPolicy")?.has("attention")==true)AuthorizedReminders.ATTENTION_CHANNEL else AuthorizedReminders.CHANNEL
  return ConnectedReadiness.Snapshot(access{device.preciseLocationGranted()},access{(getSystemService(LOCATION_SERVICE) as android.location.LocationManager).isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)},access{device.notificationPermissionGranted()&&(getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager).areNotificationsEnabled()},channel(reminderChannel),channel(ConnectedLocationService.CHANNEL),access{Build.VERSION.SDK_INT<31||(getSystemService(ALARM_SERVICE) as android.app.AlarmManager).canScheduleExactAlarms()},consent,collecting)
 }
 private fun connectedReadiness(item:JSONObject){
  val (read,panel)=newAssignmentPanel(item,"CONNECTED DEVICE READINESS")?:return
  panel.startWhenAttached{refreshConnectedReadiness(read,panel)}
 }
 private fun refreshConnectedReadiness(read:AssignmentReadContext,panel:ConnectedPrivatePanel){
  val ticket=panel.begin("Refresh requested. Reconnecting to verify your account and assignment… This does not request a location, start sharing or enable a reminder.")?:return
  Thread{
   var verified:JSONObject?=null;var denied=false
   try{verified=verifyAssignmentRead(read)}catch(_:AssignmentReadDenied){denied=true}catch(e:GuardAccountClient.HttpFailure){denied=e.statusCode==401||e.statusCode==403}catch(_:Exception){}
   val fresh=verified;val unauthorized=denied
   runOnUiThread{panel.render(ticket){
    if(unauthorized){startScreen();return@render}
    if(fresh==null)text("Could not reconnect to verify this account and assignment. Device settings are shown below; consent could not be checked. Retry when connected.")
    else {
     val attendance=when(fresh.optJSONObject("shift_state")?.optString("state")){"not_started"->"clock-in not recorded";"active"->"start recorded; clock-out unconfirmed";"ended"->"clock-out recorded";else->"not supplied"}
     val window=try{val at=shiftObserved(fresh);when{at<fresh.getLong("startsAt")->"not started";at>=fresh.getLong("endsAt")->"elapsed";else->"within scheduled window"}}catch(_:Exception){"not verified"}
     text("Account and phone assignment confirmed at ${java.util.Date(fresh.getLong("status_server_time_ms"))}.\nAssignment: ${read.owner.assignmentId}\nScheduled window: $window\nAttendance: $attendance. Checking readiness does not clock in or allow new records.")
    }
    readinessSnapshot(read,fresh).lines().forEach{ text(it) }
    action(if(fresh==null)"Retry service and readiness check"else"Refresh readiness"){refreshConnectedReadiness(read,panel)}
    if(fresh!=null)action("Review approved location policy and consent"){locationScreen(fresh)}
    action("Open device location settings"){try{startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))}catch(_:Exception){Toast.makeText(this@GuardAccountActivity,"Device location settings are unavailable.",Toast.LENGTH_LONG).show()}}
    action("Open app notification settings"){try{startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,packageName))}catch(_:Exception){Toast.makeText(this@GuardAccountActivity,"App notification settings are unavailable.",Toast.LENGTH_LONG).show()}}
   }}
  }.start()
 }
 private fun loadDispatch(item:JSONObject,refresh:Boolean,offset:Int=0){
  val (read,panel)=newAssignmentPanel(item,"ASSIGNMENT MESSAGES",true)?:return
  val owner=ConnectedDispatchOwner(read.owner.configuration,read.owner.deviceId,read.owner.subject,read.scope)
  panel.startWhenAttached{fetchDispatch(read,panel,owner,item,refresh,offset)}
 }
 private fun fetchDispatch(read:AssignmentReadContext,panel:ConnectedPrivatePanel,owner:ConnectedDispatchOwner,item:JSONObject,refresh:Boolean,offset:Int){
  if(owner!=ConnectedDispatchOwner(read.owner.configuration,read.owner.deviceId,read.owner.subject,read.scope)){startScreen();return}
  val ticket=panel.begin(if(refresh)"Checking your current account and assignment messages…"else"Opening this account's encrypted messages…")?:return
  Thread{
   var rows:List<JSONObject>?=null;var summary="Cached messages may be out of date. Reading does not acknowledge them.";var denied=false
   try{
    read.session.bearer()
    DispatchInbox(this).use{db->
     if(refresh){
      verifyAssignmentRead(read)
      val client=GuardAccountClient(read.config.endpoint);var more=true;var pages=0
      while(more&&pages<4){
       var cursor=db.cursor(owner)
       val page=try{client.dispatch(read.session,read.config.deviceId,owner.scope.binding.assignmentId,DeviceIdentity(this),read.config.audience,cursor)}catch(e:GuardAccountClient.HttpFailure){
        if(e.statusCode!=409)throw e
        read.session.bearer();db.resetCursor(owner,cursor);cursor=null
        client.dispatch(read.session,read.config.deviceId,owner.scope.binding.assignmentId,DeviceIdentity(this),read.config.audience,null)
       }
       read.session.bearer();more=db.apply(owner,cursor,page);pages++
      }
      summary=if(more)"More updates remain. Refresh again to continue. No acknowledgement was sent."else"Messages refreshed. Opening a message marks it viewed on this phone only."
     }
     read.session.bearer();rows=db.list(owner,offset)
    }
   }catch(_:AssignmentReadDenied){denied=true;summary="The current individual account or assignment could not be confirmed. Sign in again."}
   catch(_:GuardAccountClient.HttpFailure){denied=true;summary="Message access could not be authorized. Sign in again and refresh assignments."}
   catch(_:Exception){
    summary="Refresh unavailable. These are only this account's cached messages and may be out of date. No acknowledgement was sent."
    try{read.session.bearer();rows=DispatchInbox(this).use{it.list(owner,offset)}}catch(_:Exception){denied=true;summary="Messages unavailable. Sign in again; encrypted originals remain preserved."}
   }
   val result=rows;val detail=summary;val blocked=denied
   runOnUiThread{panel.render(ticket){
    if(blocked){startScreen();status.text=detail;return@render}
    text(detail)
    if(result!=null){
     if(result.isEmpty())text("No active messages for this original account and assignment on this page.")
     for(wrapped in result){val message=wrapped.getJSONObject("message");action("${message.getString("title")} · v${message.getLong("version")}"){viewDispatch(read,panel,owner,item,message,offset)}}
     if(offset>0)action("Previous messages"){fetchDispatch(read,panel,owner,item,false,maxOf(0,offset-30))}
     if(result.size==30)action("Next messages"){fetchDispatch(read,panel,owner,item,false,offset+30)}
    }
    action("Refresh messages"){fetchDispatch(read,panel,owner,item,true,offset)}
   }}
  }.start()
 }
 private fun viewDispatch(read:AssignmentReadContext,panel:ConnectedPrivatePanel,owner:ConnectedDispatchOwner,item:JSONObject,message:JSONObject,offset:Int){
  val ticket=panel.begin("Opening the original encrypted message version…")?:return
  try{
   check(owner==ConnectedDispatchOwner(read.owner.configuration,read.owner.deviceId,read.owner.subject,read.scope))
   read.session.bearer();check(captureBinding==owner.scope.binding)
   val anchor=captureAnchor?:error("Refresh authorization")
   val at=Math.addExact(anchor.epochMillis,Math.subtractExact(SystemClock.elapsedRealtime(),anchor.elapsedMillis))
   val wrapped=DispatchInbox(this).use{it.markRead(owner,message.getString("message_id"),message.getLong("version"),at)}
   val current=wrapped.getJSONObject("message")
   val acknowledged=ScopedEventStore(this).use{it.dispatchAcknowledged(owner,current.getString("message_id"),current.getLong("version"))}
   panel.render(ticket){
    text(current.getString("title"))
    text(if(acknowledged)"Version ${current.getLong("version")} · acknowledgement recorded on this phone for this account. Check upload receipts for service acceptance."else"Version ${current.getLong("version")} · viewed on this phone. No acknowledgement has been sent.")
    text(current.getString("body"));if(!current.isNull("due_at"))text("Due: ${java.util.Date(current.getLong("due_at"))}")
    if(!acknowledged)action("Acknowledge version ${current.getLong("version")}"){
     try{
      read.session.bearer();check(captureBinding==owner.scope.binding&&captureAnchor===anchor)
      val grant=captureGrant?:error("Refresh authorization")
      val observed=Math.addExact(anchor.epochMillis,Math.subtractExact(SystemClock.elapsedRealtime(),anchor.elapsedMillis))
      DispatchInbox(this@GuardAccountActivity).use{it.markRead(owner,current.getString("message_id"),current.getLong("version"),observed)}
      ScopedEventStore(this@GuardAccountActivity).use{it.acknowledgeDispatch(owner,grant,DeviceIdentity(this@GuardAccountActivity),current.getString("message_id"),current.getLong("version"),observed)}
      UploadCoordinator(this@GuardAccountActivity).request();viewDispatch(read,panel,owner,item,current,offset)
     }catch(_:Exception){val failure=panel.begin("Acknowledgement not added. Refresh authorization and messages; existing records remain preserved.")?:return@action;panel.render(failure){action("Return to messages"){fetchDispatch(read,panel,owner,item,false,offset)}}}
    }
    action("Back to messages"){fetchDispatch(read,panel,owner,item,false,offset)}
    action("Refresh messages"){fetchDispatch(read,panel,owner,item,true,offset)}
   }
  }catch(_:Exception){panel.render(ticket){text("This message changed or access expired. Refresh messages before opening it again.");action("Refresh messages"){fetchDispatch(read,panel,owner,item,true,offset)}}}
 }
 private fun reminderSettings(item:JSONObject){
  val (read,panel)=newAssignmentPanel(item,"CHECK-IN REMINDERS",true)?:return
  val owner=ConnectedDispatchOwner(read.owner.configuration,read.owner.deviceId,read.owner.subject,read.scope)
  val policy=try{JSONObject(item.getJSONObject("checkInPolicy").toString()).also{AuthorizedCheckInPolicy.parse(it)}}catch(_:Exception){panel.text("Refresh authorization to verify this assignment's check-in schedule.");return}
  val reminders=AuthorizedReminders(this);val displayedRoot=root;val stamp=generation
  fun allowed()=assignmentReadAuthorized(read,displayedRoot,stamp)&&captureBinding==owner.scope.binding
  panel.startWhenAttached{
   val ticket=panel.begin("Loading reminder settings for this account and assignment…")?:return@startWhenAttached
   panel.render(ticket){
    val state=TextView(this@GuardAccountActivity).apply{text=reminders.status(owner,policy);textSize=16f;isSaveEnabled=false};addView(state)
    text("Reminders contain no guard or site name. They do not sign you in or complete a check. Android can delay delivery; enable again after a phone restart.")
    action("Enable for this assignment"){
     try{reminders.enable(policy,owner,captureGrant?:error("Refresh authorization"),captureAnchor?:error("Refresh authorization"));state.text=reminders.status(owner,policy)}
     catch(_:Exception){state.text="Reminders were not enabled. Refresh authorization and check notification settings."}
    }
    action("Notification settings"){
     if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),405)
     else startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,packageName))
    }
    if(Build.VERSION.SDK_INT>=31&&!reminders.exactAvailable())action("Allow precise reminder timing"){startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,android.net.Uri.parse("package:$packageName")))}
    action("Stop reminders for this assignment"){reminders.stopForAssignment(owner);state.text="Reminders stopped for this assignment. Saved checks and original deadlines remain unchanged."}
    if(AuthorizedCheckInPolicy.parse(policy).attention!=null){
     text(reminders.fullScreenStatus())
     action("Enable optional full-screen attention"){
      AlertDialog.Builder(this@GuardAccountActivity).setTitle("Optional full-screen attention")
       .setMessage("Allow a generic check-in reminder to use Android's full-screen notification option on this phone? It shows no guard or site details, never unlocks the phone, and does not complete a check. Android access and notification settings must also allow it; delivery is not guaranteed.")
       .setNegativeButton("Keep off",null).setPositiveButton("Allow on this phone"){_,_->if(allowed()){reminders.setFullScreenConsent(true);state.text=reminders.fullScreenStatus()}}.showOwned()
     }
     action("Turn off full-screen attention"){reminders.setFullScreenConsent(false);state.text=reminders.fullScreenStatus()}
     reminders.fullScreenSettingsIntent()?.let{settings->action("Review Android full-screen access"){startActivity(settings)}}
     action("Review calm attention"){connectedAttention(item)}
    }else text("This assignment uses one reminder per check-in window.")
   }
  }
 }
 private fun connectedAttention(item:JSONObject){
  val (read,panel)=newAssignmentPanel(item,"CHECK-IN ATTENTION",true)?:return
  val owner=ConnectedDispatchOwner(read.owner.configuration,read.owner.deviceId,read.owner.subject,read.scope)
  val policy=try{JSONObject(item.getJSONObject("checkInPolicy").toString()).also{check(AuthorizedCheckInPolicy.parse(it).attention!=null)}}catch(_:Exception){panel.text("This assignment does not have calm attention enabled. Its existing check-in schedule is unchanged.");return}
  val reminders=AuthorizedReminders(this);val displayedRoot=root;val stamp=generation;val originalAnchor=captureAnchor
  panel.startWhenAttached{
   val ticket=panel.begin("Loading this assignment's attention state…")?:return@startWhenAttached
   panel.render(ticket){
    val visual=ConnectedCheckInAttentionView(this@GuardAccountActivity);connectedAttentionView=visual;addView(visual)
    val state=TextView(this@GuardAccountActivity).apply{textSize=16f;isSaveEnabled=false};addView(state)
    text("Colors and cues do not record a check. Complete it with the required biometric, fresh location and consented photo. A service receipt confirms delivery separately.")
    action("Enable reminders for this assignment"){
     try{reminders.enable(policy,owner,captureGrant?:error("Refresh authorization"),captureAnchor?:error("Refresh authorization"));connectedAttentionRefresh?.run()}
     catch(_:Exception){state.text="Reminders were not enabled. Refresh authorization and check notification settings."}
    }
    action("Complete scheduled check-in"){captureScreen(item);beginCheckIn(item)}
    action("Silence this check"){
     state.text=if(reminders.silenceCurrent(owner,policy))"Silenced on this phone. No check was completed."else "This reminder changed or ended. No check was completed."
     connectedAttentionRefresh?.run()
    }
    action("Use steady colors"){
     check(getSharedPreferences("mercury_connected_attention_ui",MODE_PRIVATE).edit().putBoolean("steady_colors",true).commit());visual.stopMotion();connectedAttentionRefresh?.run()
    }
    action("Allow calm color pulses"){
     check(getSharedPreferences("mercury_connected_attention_ui",MODE_PRIVATE).edit().putBoolean("steady_colors",false).commit());connectedAttentionRefresh?.run()
    }
    action("Reminder and full-screen settings"){reminderSettings(item)}
    if(item.has("checkInStatus"))action("Review delivery and missed-window reasons"){checkInStatusScreen(item)}else action("Refresh delivery status"){verifyAssignment(item)}
    val refresh=object:Runnable{override fun run(){
     connectedAttentionHandler.removeCallbacks(this)
     if(connectedAttentionRefresh!==this)return
     if(!assignmentReadAuthorized(read,displayedRoot,stamp)||captureBinding!=owner.scope.binding||captureAnchor!==originalAnchor){closeConnectedPanel();if(root===displayedRoot)startScreen();return}
     val snapshot=reminders.attentionSnapshot(owner,policy)
     if(snapshot==null)visual.unavailable()else visual.present(snapshot.stage,snapshot.token,snapshot.pulse,snapshot.silenced,snapshot.budgetExhausted,getSharedPreferences("mercury_connected_attention_ui",MODE_PRIVATE).getBoolean("steady_colors",false))
     state.text=reminders.status(owner,policy)
     connectedAttentionHandler.postDelayed(this,(snapshot?.nextRefreshInMillis?:1000).coerceIn(50,1000))
    }}
    connectedAttentionRefresh=refresh;refresh.run()
   }
  }
 }
 private fun checkInStatusScreen(item:JSONObject){
  val (read,panel)=newAssignmentPanel(item,"CHECK-IN DELIVERY",true)?:return
  val owner=ConnectedDispatchOwner(read.owner.configuration,read.owner.deviceId,read.owner.subject,read.scope)
  panel.startWhenAttached{
   val ticket=panel.begin("Opening the received delivery status…")?:return@startWhenAttached
   panel.render(ticket){
    text("Service receipt is separate from local capture. A missed delivery deadline does not prove that an offline guard missed the check. Dispatch delivery is not connected.")
    try{
     val report=item.getJSONObject("checkInStatus");check(report.getString("assignment_id")==owner.scope.binding.assignmentId)
     check(report.getLong("policy_revision")==AuthorizedCheckInPolicy.parse(item.getJSONObject("checkInPolicy")).revision)
     val slots=report.getJSONArray("slots")
     text("Service snapshot: ${java.util.Date(report.getLong("server_time_ms"))}\n${report.getInt("total_deadlines_missed")} delivery deadline(s) missed. Refresh authorization for current status.")
     for(i in maxOf(0,slots.length()-10) until slots.length()){
      val slot=slots.getJSONObject(i)
      val label=when(slot.getString("status")){"due"->"Due · not received";"delivery_missing"->"Delivery missing";"photo_delivery_pending"->"Photo delivery pending";"evidence_received"->"Evidence received by pilot service";"evidence_received_after_deadline"->"Evidence received after deadline";else->"Status unavailable"}
      text("Check ${slot.getLong("slot")+1} · $label\nDue ${java.util.Date(slot.getLong("due_at"))}"+(if(slot.getBoolean("delivery_deadline_missed"))"\nOriginal missed deadline retained." else ""))
      if(slot.getBoolean("delivery_deadline_missed"))action("Add reason for check ${slot.getLong("slot")+1}"){missReason(item,report.getLong("policy_revision"),slot.getLong("slot"),owner)}
      if(slot.optInt("reason_count")>0)text("${slot.getInt("reason_count")} reason note(s) received. Original deadline retained.")
     }
     if(slots.length()>10||report.optInt("earlier_slots_omitted")>0)text("Showing the latest 10 due checks. The service retains earlier deadlines.")
    }catch(_:Exception){text("Check-in delivery status could not be verified. Refresh authorization to retrieve it again.")}
    action("Refresh authorization"){verifyAssignment(item)}
    action("Send my queued records"){sendScoped(owner.scope.binding.guardId)}
   }
  }
 }
 private fun missReason(item:JSONObject,revision:Long,slot:Long,owner:ConnectedDispatchOwner){
  try{check(connectedCaptureOwner()==owner&&owner.scope==shiftScope(item))}catch(_:Exception){status.text="Sign in and refresh this assignment before adding a reason.";return}
  val stamp=generation;val displayedRoot=root
  val input=EditText(this).apply{hint="Explain the missed delivery";minLines=3;inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE;filters=arrayOf(android.text.InputFilter.LengthFilter(2000));isSaveEnabled=false}
  val dialog=AlertDialog.Builder(this).setTitle("Reason for check ${slot+1}").setMessage("This adds a note and keeps the original missed deadline. Dispatch has not been notified.").setView(input).setNegativeButton("Cancel",null).setPositiveButton("Save locally",null).create()
  dialog.setOnShowListener{dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener{
   if(stamp!=generation||root!==displayedRoot||!visibleForLocation||stopped){dialog.dismiss();return@setOnClickListener}
   try{
    val reason=input.text.toString().trim();require(reason.isNotEmpty())
    check(connectedCaptureOwner()==owner);val grant=captureGrant?:error("Refresh authorization");val anchor=captureAnchor?:error("Refresh authorization")
    val observed=Math.addExact(anchor.epochMillis,Math.subtractExact(SystemClock.elapsedRealtime(),anchor.elapsedMillis))
    val policy=AuthorizedCheckInPolicy.parse(item.getJSONObject("checkInPolicy"));check(policy.revision==revision)
    val due=Math.addExact(policy.startsAt,Math.multiplyExact(slot,policy.interval));check(slot>=0&&due<policy.endsAt&&observed>=minOf(due+policy.window,policy.endsAt))
    val db=ScopedEventStore(this);try{db.captureCheckInMissReason(owner,grant,DeviceIdentity(this),revision,slot,reason,observed)}finally{db.close()}
    UploadCoordinator(this).request();dialog.dismiss();status.text="Reason saved locally. Automatic delivery is requested; the original missed deadline remains recorded."
   }catch(_:Exception){input.error="Enter a reason and refresh authorization if it has expired."}
  }};showOwnedDialog(dialog)
 }
 private fun beginCheckIn(item:JSONObject){
  val anchor=captureAnchor?:return;val binding=captureBinding?:return;val grant=captureGrant?:return
  val read=try{assignmentReadContext(item)}catch(_:Exception){status.text="Sign in and refresh this assignment before completing a check.";return}
  val owner=ConnectedDispatchOwner(read.owner.configuration,read.owner.deviceId,read.owner.subject,read.scope)
  val stamp=generation;val displayedRoot=root
  fun permitted()=assignmentReadAuthorized(read,displayedRoot,stamp,true)&&captureBinding==owner.scope.binding&&captureBinding==binding&&captureGrant===grant&&captureAnchor===anchor
  fun observed()=Math.addExact(anchor.epochMillis,Math.subtractExact(SystemClock.elapsedRealtime(),anchor.elapsedMillis))
  val policy:AuthorizedCheckInPolicy;val slot:Long
  try{
   policy=AuthorizedCheckInPolicy.parse(item.getJSONObject("checkInPolicy"));slot=policy.slotAt(observed())
   val due=Math.addExact(policy.startsAt,Math.multiplyExact(slot,policy.interval))
   check(observed()<minOf(due+policy.window,policy.endsAt))
   val db=ScopedEventStore(this);try{check(!db.checkInRecorded(owner,policy.revision,slot))}finally{db.close()}
   check(grant.permits("check_in",binding,SystemClock.elapsedRealtime(),anchor.bootCount))
  }catch(_:Exception){status.text="No open check-in window, this check-in is already saved, or authorization needs refreshing.";return}
  if(checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)!=android.content.pm.PackageManager.PERMISSION_GRANTED){
   requestPermissions(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION,android.Manifest.permission.ACCESS_COARSE_LOCATION),404)
   status.text="Allow precise location, then tap Complete scheduled check-in again.";return
  }
  busy=true
  try{
   val cancellation=CancellationSignal();signal=cancellation
   val builder=BiometricPrompt.Builder(this).setTitle("Verify check-in").setNegativeButton("Cancel",mainExecutor){_,_->if(permitted()){busy=false;signal=null}}
   if(Build.VERSION.SDK_INT>=30)builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
   builder.build().authenticate(cancellation,mainExecutor,object:BiometricPrompt.AuthenticationCallback(){
    override fun onAuthenticationError(code:Int,message:CharSequence){if(permitted()){busy=false;signal=null;status.text="Check-in verification cancelled or unavailable."}}
    override fun onAuthenticationSucceeded(result:BiometricPrompt.AuthenticationResult){
     if(!permitted())return
     signal=null;val biometricAt=observed();status.text="Getting a fresh GPS fix…"
     locationPing=LocationPing(this@GuardAccountActivity).also{ping->ping.request{fix->
      if(permitted()){
       busy=false;locationPing=null
       try{
        check(fix!=null)
        val fixAt=Math.addExact(anchor.epochMillis,Math.subtractExact(fix.getLong("fix_elapsed_nanos")/1000000,anchor.elapsedMillis))
        val location=JSONObject(fix.toString()).put("at",fixAt)
        policy.validate(slot,biometricAt,location,observed(),observed())
        val evidence=AuthorizedCheckInEvidence(policy,slot,biometricAt,location)
        AlertDialog.Builder(this@GuardAccountActivity).setTitle("Check-in photo")
         .setMessage("Take a consented test photo to complete this pilot check-in. It will be encrypted locally and queued for automatic delivery while the verified upload session is valid. Opening the camera locks this screen.")
         .setNegativeButton("Cancel",null).setPositiveButton("Open camera"){_,_->if(permitted()&&visibleForLocation)openAuthorizedCamera(evidence,owner)}.showOwned()
       }catch(_:Exception){status.text="Check-in is incomplete. A fresh, non-mock GPS fix within the site's accuracy limit is required. Try again outdoors."}
      }
     }}
    }
   })
  }catch(_:Exception){busy=false;signal=null;status.text="Biometric check unavailable. No check-in was saved."}
 }
 private fun confirmPhoto(){
  val owner=try{connectedCaptureOwner()}catch(_:Exception){status.text="Sign in and refresh this assignment before taking a photo.";return}
  val stamp=generation;val displayedRoot=root
  AlertDialog.Builder(this).setTitle("Capture photo evidence")
   .setMessage("Use a test subject for this pilot. The photo will be encrypted on this phone and linked to your guard and assignment. Automatic delivery requests upload to the configured pilot service while the verified upload session is valid. Camera use locks this screen; a service receipt confirms acceptance.")
   .setNegativeButton("Cancel",null).setPositiveButton("Open camera"){_,_->if(stamp==generation&&root===displayedRoot&&visibleForLocation&&!stopped)openAuthorizedCamera(null,owner)}.showOwned()
 }
 private fun openAuthorizedCamera(checkIn:AuthorizedCheckInEvidence?,owner:ConnectedDispatchOwner){
  if(pendingPhoto!=null)return
  val binding=captureBinding?:return;val grant=captureGrant?:return;val anchor=captureAnchor?:return
  try{check(connectedCaptureOwner()==owner&&owner.scope.binding==binding)}catch(_:Exception){status.text="The photo belongs to another account or assignment. Sign in and refresh before trying again.";return}
  val boot=Settings.Global.getInt(contentResolver,Settings.Global.BOOT_COUNT,-1)
  if(!grant.permits("photo",binding,SystemClock.elapsedRealtime(),boot)){status.text="Refresh assignment authorization before taking a photo.";return}
  val dir=File(cacheDir,"capture/account").apply{mkdirs()};val file=File(dir,"${UUID.randomUUID()}.jpg")
  val uri=FileProvider.getUriForFile(this,"$packageName.files",file)
  try{
   pendingPhoto=PendingPhoto(file,binding,grant,anchor,checkIn,owner)
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
    try{check(pending.owner.scope.binding==pending.binding);if(pending.checkIn==null)db.capturePhoto(pending.owner,pending.grant,DeviceIdentity(this),metadata,observed) else db.captureCheckIn(pending.owner,pending.grant,DeviceIdentity(this),pending.checkIn,metadata,observed)}finally{db.close()}
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
 private fun sendLocationConsent(record:LocationConsentRecord,item:JSONObject,startContinuous:Boolean=true,patrolRound:String?=null){
  val c=config?:return;val stamp=generation
  val authority=try{
   check(escalationScope()==record.scope.account)
   UploadAuthorityStore(this).load(c,record.scope.account.thumbprint)?.also{check(it.subject==record.scope.account.subject&&it.guardId==record.scope.account.guardId&&it.vendorId==record.scope.account.vendorId)}?:error("Sign in again")
  }catch(_:Exception){status.text="Consent remains retained. Sign in again before authorizing location capture.";return}
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
    if(lease==null||time==null){if(startContinuous)locationScreen(item)else patrolConsentScreen(item,patrolRound);status.text="Consent or fresh capture authority is unconfirmed. Nothing was started. Retry after refreshing the same approved policy; the exact request remains retained.";return@runOnUiThread}
    try{
     check(visibleForLocation&&escalationScope()==record.scope.account)
     val original=LocationConsentStore(this).use{it.get(record.id,record.scope)}?:error("Original consent missing")
     check(original.accepted)
     if(!startContinuous){
      captureGrant=lease;captureBinding=record.scope.binding;captureAnchor=time
      patrolScreen(item,patrolRound);status.text="Exact notice consent recorded. Select a checkpoint to request one fresh GPS fix; continuous location was not started."
      return@runOnUiThread
     }
     val token=ConnectedLocationRuntime.prepare(this,c,original,authority,lease,time)
     startForegroundService(Intent(this,ConnectedLocationService::class.java).putExtra(ConnectedLocationService.TOKEN,token))
     locationScreen(item);status.text="Visible location start requested under the exact consent and signed lease. Check the ongoing notification and refresh local status; no physical presence is established."
    }catch(_:Exception){if(startContinuous){ConnectedLocationRuntime.stop(this,"Visible start unavailable");locationScreen(item)}else patrolConsentScreen(item,patrolRound);status.text="Consent is retained but location capture did not start. Return to the visible app and check permission, GPS and current assignment authority."}
   }
  }.start()
 }
 private fun loadIncidentHistory(item:JSONObject){
  val c=config?:return;val active=session?:return;val who=accountIdentity?:return
  val owner=try{
   active.bearer();val thumb=DeviceIdentity(this).publicIdentity()?.thumbprint?:error("Phone identity required")
   check(item.getString("guardId")==who.guardId&&item.getString("vendorId")==who.vendorId&&item.getString("deviceThumbprint")==thumb)
   ConnectedIncidentDraftScope(c.uploadBinding(),c.deviceId,thumb,who.subject,who.guardId,who.vendorId,item.getString("siteId"),item.getString("assignmentId"))
  }catch(_:Exception){status.text="Sign in and refresh this assignment before opening its recorded incidents.";return}
  screen("MY RECORDED INCIDENTS","Verifying your individual account and this phone's current assignment before opening encrypted history…")
  val displayedRoot=root;val stamp=generation;busy=true
  Thread{
   var verified:JSONObject?=null
   try{
    val client=GuardAccountClient(c.endpoint);val profile=client.profile(active)
    check(profile.getString("auth_subject")==who.subject&&profile.getString("guard_id")==who.guardId&&profile.getString("vendor_id")==who.vendorId)
    val response=client.assignments(active,c.deviceId,DeviceIdentity(this),c.audience);val rows=response.getJSONArray("assignments")
    val matches=(0 until rows.length()).map{rows.getJSONObject(it)}.filter{it.getString("guardId")==owner.guardId&&it.getString("vendorId")==owner.vendorId&&it.getString("siteId")==owner.siteId&&it.getString("assignmentId")==owner.assignmentId&&it.getString("deviceThumbprint")==owner.thumbprint}
    check(matches.size==1)
    val epoch=response.getLong("server_time_ms");check(epoch>0)
    verified=JSONObject(matches.single().toString()).put("status_server_time_ms",epoch).put("status_elapsed_ms",SystemClock.elapsedRealtime())
   }catch(_:Exception){}
   val fresh=verified
   runOnUiThread{
    if(stamp!=generation||root!==displayedRoot||isFinishing||isDestroyed)return@runOnUiThread
    busy=false
    try{
     check(fresh!=null&&visibleForLocation&&!stopped&&session===active&&config===c&&accountIdentity==who)
     active.bearer();check(DeviceIdentity(this).publicIdentity()?.thumbprint==owner.thumbprint)
     showIncidentHistory(fresh,owner)
    }catch(_:Exception){startScreen();status.text="Recorded incidents remain encrypted. Current individual account or phone assignment could not be confirmed; sign in again to retry."}
   }
  }.start()
 }
 /** Called only after fresh service verification; the view independently gates every render/navigation. */
 private fun showIncidentHistory(item:JSONObject,owner:ConnectedIncidentDraftScope){
  val active=session?:return;val c=config?:return;val who=accountIdentity?:return
  screen("MY RECORDED INCIDENTS","Original records and service receipt states for this account and assignment.")
  val displayedRoot=root;val stamp=generation
  fun authorized():Boolean=try{
   check(visibleForLocation&&!stopped&&!isFinishing&&!isDestroyed&&root===displayedRoot&&stamp==generation&&session===active&&config===c&&accountIdentity==who)
   active.bearer()
   check(owner.configuration==c.uploadBinding()&&owner.deviceId==c.deviceId&&owner.subject==who.subject&&owner.guardId==who.guardId&&owner.vendorId==who.vendorId&&DeviceIdentity(this).publicIdentity()?.thumbprint==owner.thumbprint)
   check(item.getString("guardId")==owner.guardId&&item.getString("vendorId")==owner.vendorId&&item.getString("siteId")==owner.siteId&&item.getString("assignmentId")==owner.assignmentId&&item.getString("deviceThumbprint")==owner.thumbprint)
   true
  }catch(_:Exception){false}
  if(!authorized()){startScreen();return}
  val history=ConnectedIncidentHistoryView(this,owner,::authorized,{assignmentOverview(item)},{startScreen()})
  incidentHistoryView=history;root.addView(history)
  button("Sign out",true){signOut()}
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
  val assignment=try{if(item==null)null else{check(item.getString("guardId")==scope.guardId&&item.getString("vendorId")==scope.vendorId);if(item.optBoolean("assignmentActive",true))item.getString("assignmentId")else null}}catch(_:Exception){status.text="Assignment context could not be verified. Refresh assignments before opening escalation.";return}
  screen("ESCALATE","Send an attributed request to the Mercury One operator inbox. Service receipt and operator acknowledgement are separate. This does not place an emergency call or confirm that anyone has been contacted.\n"+(if(assignment==null)"No assignment attached." else "Assignment: $assignment"))
  button("Open phone dialer",true){openDialer()}
  if(item?.optJSONObject("shift_state")?.optString("state")=="active")try{
   check(!pendingShift(item))
   val closeout=shiftScope(item);val closeoutOwner=connectedShiftOwner(item);check(closeoutOwner?.scope==closeout&&closeout.binding.deviceThumbprint==scope.thumbprint)
   val early=if(shiftObserved(item)<item.getLong("endsAt"))button("End shift early"){earlyExit(item,closeout,closeoutOwner)}else null
   watchShiftEnd(item){
    early?.let{root.removeView(it)}
    button("Clock out"){confirmClockOut(item,closeout,closeoutOwner)}
   }
  }catch(_:Exception){root.addView(TextView(this).apply{text="Refresh assignments to verify shift closeout timing."})}
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
 private fun patrolConsentScreen(item:JSONObject,roundId:String?){
  val scope=try{locationScope(item)}catch(_:Exception){status.text="Refresh your individually verified assignment before reviewing patrol GPS consent.";return}
  val policy=try{AuthorizedLocationPolicy.parse(item.getString("locationPolicyPayload"),item.getString("locationPolicySha256"))}catch(_:Exception){null}
  screen("PATROL GPS NOTICE",if(policy==null)"This required-GPS route has no verifiable approved policy. Checkpoints cannot be recorded."else"Review the exact approved notice for point fixes at this assignment. Consent does not start continuous collection; every checkpoint needs its own visible GPS request.")
  if(policy!=null){
   root.addView(TextView(this).apply{text=policy.notice;textSize=17f;setTextIsSelectable(true)})
   root.addView(TextView(this).apply{text="Policy ${policy.revision} · notice ${policy.noticeRevision} · maximum fix age ${policy.maxAge} ms · maximum accuracy radius ${policy.maxAccuracy} m. Device-reported coordinates alone do not establish physical presence."})
   val agree=CheckBox(this).apply{text="I have reviewed this exact notice and consent to this policy for this shift.";isChecked=false};root.addView(agree)
   button("Consent for patrol point fixes"){
    if(!agree.isChecked){status.text="Review this notice and explicitly choose consent before continuing.";return@button}
    if(!visibleForLocation||!DeviceReadiness(this).preciseLocationGranted()||!DeviceReadiness(this).gpsEnabled()){status.text="Enable precise location and device GPS, then return to this visible notice and consent again.";return@button}
    try{val record=LocationConsentStore(this).use{it.prepare(scope,policy)};sendLocationConsent(record,item,false,roundId)}catch(_:Exception){status.text="Consent could not be retained. No checkpoint or collection was started."}
   }
   button("Request precise location permission"){
    if(checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION,android.Manifest.permission.ACCESS_COARSE_LOCATION),406)
    else status.text="Precise permission is granted; it does not itself supply a fresh fix or record a checkpoint."
   }
  }
  button("Back to patrol"){patrolScreen(item,roundId)};button("Sign out",true){signOut()}
 }
 private fun patrolConsent(item:JSONObject,grant:VerifiedShiftGrant):LocationConsentRecord {
  val scope=locationScope(item);check(scope.binding==captureBinding)
  val approved=grant.location?:error("GPS consent unavailable")
  check(item.getString("locationPolicyPayload")==approved.policy.payload&&item.getString("locationPolicySha256")==approved.policy.sha256)
  return LocationConsentStore(this).use{db->
   val current=db.current(scope,approved.policy.sha256)?:error("Consent unavailable")
   check(current.id==approved.id&&current.policy.payload==approved.policy.payload&&current.accepted&&db.canUpload(current.id,scope,approved.policy.sha256))
   current
  }
 }
 private fun capturePatrolPoint(item:JSONObject,owner:ConnectedDispatchOwner,plan:PatrolPlan,choice:PatrolChoice){
  val binding=captureBinding;val grant=captureGrant;val anchor=captureAnchor
  if(binding==null||grant==null||anchor==null){status.text="Checkpoint not recorded. Return to this assignment and refresh current GPS capture authorization.";return}
  val record=try{patrolConsent(item,grant)}catch(_:Exception){status.text="Review the approved patrol GPS notice and current consent before requesting a checkpoint fix.";return}
  val stamp=generation;val displayedRoot=root;val activeConfig=config;val activeAccount=accountIdentity
  val point=PatrolPointLocation(this);patrolPointLocation=point;busy=true
  status.text="Requesting one fresh GPS fix for this checkpoint. No checkpoint is recorded while a valid fix is unavailable."
  val cancelControl=button("Cancel checkpoint GPS request",true){cancelPatrolPoint();patrolScreen(item,choice.roundId);status.text="GPS request cancelled. No checkpoint was recorded."}
  fun authorized():Boolean=try{
   check(visibleForLocation&&!stopped&&!isFinishing&&!isDestroyed&&stamp==generation&&root===displayedRoot&&captureGrant===grant&&captureBinding==binding&&config===activeConfig&&accountIdentity==activeAccount)
   session?.bearer()?:error("Session unavailable");check(connectedCaptureOwner()==owner)
   val current=patrolConsent(item,grant);check(current.id==record.id&&current.scope==record.scope)
   true
  }catch(_:Exception){false}
  point.request(grant,binding,anchor,::authorized){sample->
   if(patrolPointLocation!==point)return@request
   patrolPointLocation=null;busy=false;root.removeView(cancelControl)
   if(!authorized())return@request
   if(sample==null){status.text="Checkpoint not recorded. A fresh non-simulated precise fix was unavailable, permission changed, or the request expired. You can retry this checkpoint.";return@request}
   try{
    check(plan.gpsRequired&&plan.choice(choice.checkpointId,choice.roundId)==choice)
    ScopedEventStore(this).use{it.capturePatrolCheckpoint(owner,plan,choice,grant,DeviceIdentity(this),sample.at,record,sample.data())}
    UploadCoordinator(this).request();patrolScreen(item,choice.roundId);status.text="GPS checkpoint saved encrypted with its original consent and policy. Service acceptance is pending; device-reported coordinates alone do not establish presence."
   }catch(_:Exception){status.text="Checkpoint not recorded. Its consent, assignment or capture authorization changed, or this checkpoint was already saved. Original records remain preserved."}
  }
 }
 private fun patrolScreen(item:JSONObject,selectedRoundId:String?=null){
  val closeoutOwner=connectedShiftOwner(item)
  val binding=captureBinding?:return
  val owner=try{connectedCaptureOwner()}catch(_:Exception){status.text="Sign in and refresh this patrol before viewing its progress.";return}
  screen("ASSIGNED PATROL","Select checkpoints in any order. The approved route determines whether each checkpoint requires a fresh GPS fix.")
  try{
   check(binding.assignmentId==item.getString("assignmentId")&&binding.guardId==item.getString("guardId")&&binding.siteId==item.getString("siteId"))
   val plan=AuthorizedPatrolRoute.parse(item.getJSONObject("patrolRoute"))
   val instructions=if(plan.gpsRequired)"A fresh non-simulated precise GPS fix under the current approved notice and consent is required for every checkpoint. There is no manual fallback. Device-reported fixes do not alone prove physical presence."else"Each checkpoint is a manual observation; it does not prove physical presence."
   status.text=instructions
   val db=ScopedEventStore(this)
   try{
    val recorded=db.checkpointProgress(owner,plan.routeId,plan.revision)
    if(plan.rounds!=null&&selectedRoundId==null){
     status.text="Choose an assigned patrol round. You can switch rounds without completing them in sequence. Saved checkpoints remain attached to their original round.\n"+instructions
     for(round in plan.rounds){
      val count=plan.checkpoints.count{PatrolCheckpointKey(round.id,it.id) in recorded}
      button("${round.label} · $count/${plan.checkpoints.size} recorded"){patrolScreen(item,round.id)}
     }
    }else{
     val round=plan.round(selectedRoundId)
     if(round!=null)screen("PATROL · ${round.label}","Select checkpoints in any order for this assigned round. A saved checkpoint cannot be recorded twice in the same round.\n"+instructions)
     if(plan.gpsRequired)button("Review patrol GPS notice and consent"){patrolConsentScreen(item,selectedRoundId)}
     for(point in plan.checkpoints){
      if(PatrolCheckpointKey(selectedRoundId,point.id) in recorded)root.addView(TextView(this).apply{text="Recorded · ${point.label}";textSize=16f;setPadding(0,dp(12),0,dp(12))})
      else button("Record checkpoint: ${point.label}"){
       try{
        check(connectedCaptureOwner()==owner);val choice=plan.choice(point.id,selectedRoundId)
        if(plan.gpsRequired){capturePatrolPoint(item,owner,plan,choice);return@button}
        val grant=captureGrant?:error("Refresh authorization");val anchor=captureAnchor?:error("Refresh authorization")
        val observed=Math.addExact(anchor.epochMillis,Math.subtractExact(SystemClock.elapsedRealtime(),anchor.elapsedMillis))
        ScopedEventStore(this).use{current->current.capturePatrolCheckpoint(owner,plan,choice,grant,DeviceIdentity(this),observed)}
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
  watchShiftEnd(item){cancelPatrolPoint();captureGrant=null;status.text="Scheduled window elapsed · clock-out unconfirmed. Checkpoint capture is unavailable; no clock-out was recorded automatically.";button("Clock out"){confirmClockOut(item,shiftScope(item),closeoutOwner)}}
 }
 private fun sendScoped(guardId:String){
  try{
   session?.bearer()?:error("Sign in again")
   val requested=UploadCoordinator(this).request()
   status.text=(if(requested)"Automatic upload requested. Android schedules network work and may delay it. " else "Sign in again to authorize automatic delivery. ")+ScopedEventStore(this).use{it.uploadSummary(escalationScope().also{owner->check(owner.guardId==guardId)})}
  }catch(_:Exception){status.text="Upload authority is unavailable. Sign in again; encrypted records and receipts remain preserved."}
 }

}
