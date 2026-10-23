package ca.mercury.guard

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
 private var password: EditText?=null
 private lateinit var root: LinearLayout
 private lateinit var status: TextView
 private val cyan=Color.rgb(0,104,125)
 private fun dp(n:Int)=(n*resources.displayMetrics.density).toInt()
 override fun onCreate(state:Bundle?) {
  super.onCreate(state)
  window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
  try { config=GuardServiceConfig.load(this); startScreen() }
  catch(_:Exception){ config=null; screen("CONNECTION UNAVAILABLE","The packaged service configuration is invalid. Contact your administrator."); button("Return"){finish()} }
 }
 override fun onStop(){super.onStop();stopped=true;clearSession()}
 override fun onResume(){super.onResume();if(stopped){stopped=false;startScreen()}}
 private fun clearSession(){captureGrant=null;captureBinding=null;captureAnchor=null;generation++;busy=false;signal?.cancel();signal=null;password?.text?.clear();password=null;session?.clear();session=null}
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
     val guard=p.getString("guard_id");val vendor=p.getString("vendor_id");val rows=a.getJSONArray("assignments")
     status.text="Guard: $guard\nVendor: $vendor\n${rows.length()} eligible assignment(s). No clock-in has been recorded."
     button("Send my queued records"){sendScoped(guard)}
     for(i in 0 until rows.length()){
      val item=rows.getJSONObject(i);check(item.getString("guardId")==guard&&item.getString("vendorId")==vendor)
      button("${item.getString("siteId")} · ${item.getString("assignmentId")}"){verifyAssignment(item)}
     }
    }catch(_:Exception){status.text="Assignments could not be verified. Check connectivity or ask your administrator to review this phone's enrollment."}
    button("Refresh assignments"){loadAssignments()};button("Sign out"){startScreen()}
   }
  }.start()
 }
 private fun verifyAssignment(item:JSONObject){
  val c=config?:return;val active=session?:return;val stamp=generation;busy=true;status.text="Verifying shift authorization…"
  Thread{
   var verified:VerifiedShiftGrant?=null
   var verifiedBinding:GrantBinding?=null
   var verifiedAnchor:ServerTimeAnchor?=null
   try{
    val identity=DeviceIdentity(this);val fingerprint=identity.publicIdentity()?.thumbprint?:error("Missing key")
    check(item.getString("deviceThumbprint")==fingerprint)
    val binding=GrantBinding(item.getString("guardId"),item.getString("siteId"),item.getString("assignmentId"),fingerprint,item.getLong("revocationVersion"))
    val elapsed=SystemClock.elapsedRealtime();val boot=Settings.Global.getInt(contentResolver,Settings.Global.BOOT_COUNT,-1)
    val response=GuardAccountClient(c.endpoint).grant(active,c.deviceId,binding.assignmentId,identity,c.audience)
    val anchor=ServerTimeAnchor(response.getLong("server_time_ms"),elapsed,boot)
    verified=ShiftGrantVerifier(c.issuer,c.audience,c.keys).verify(response.getString("key_id"),response.getString("payload"),response.getString("signature"),binding,anchor,SystemClock.elapsedRealtime(),boot)
    verifiedBinding=binding;verifiedAnchor=anchor.copy(elapsedMillis=SystemClock.elapsedRealtime())
   }catch(_:Exception){}
   val grant=verified;val binding=verifiedBinding;val anchor=verifiedAnchor
   runOnUiThread{if(stamp==generation&&!isFinishing&&!isDestroyed){
    busy=false
    if(grant!=null&&binding!=null&&anchor!=null){captureGrant=grant;captureBinding=binding;captureAnchor=anchor;captureScreen(item)}
    else status.text="Shift authorization could not be verified. The assignment may not have started, may have changed, or the connection may be unavailable."
   }}
  }.start()
 }
 private fun captureScreen(item:JSONObject){
  screen("AUTHORIZED ASSIGNMENT","Site: ${item.getString("siteId")}\nIncident pilot · encrypted local save. Sending records confirms pilot receipt only, not dashboard delivery or payroll clock-in.")
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
  button("Send queued records"){captureBinding?.let{sendScoped(it.guardId)}}
  button("Refresh authorization"){verifyAssignment(item)}
  button("Back to assignments"){captureGrant=null;captureBinding=null;captureAnchor=null;loadAssignments()}
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
    }finally{db.close()}
   }catch(_:Exception){}
   val result=message
   runOnUiThread{if(stamp==generation&&!isFinishing&&!isDestroyed){busy=false;status.text=result}}
  }.start()
 }

}
