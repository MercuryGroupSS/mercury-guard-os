package ca.mercury.guard

import android.Manifest
import android.app.Activity
import android.hardware.biometrics.BiometricPrompt
import android.hardware.biometrics.BiometricManager
import android.app.AlertDialog
import android.app.admin.DevicePolicyManager
import android.content.*
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.content.res.ColorStateList
import android.os.*
import android.view.*
import android.widget.*
import android.text.Editable
import android.text.TextWatcher
import android.text.InputFilter
import org.json.JSONObject
import androidx.core.content.FileProvider
import android.provider.MediaStore
import java.io.File
import java.util.UUID

/** Phase 1 field prototype: standalone, with clearly marked local DEMO assignment. */
class MainActivity : Activity() {
 private lateinit var root: LinearLayout
 private lateinit var store: GuardStore
 private val session by lazy { DemoSession(this) }
 private val shiftActive get() = session.active()
 private val ink = Color.rgb(25, 42, 54)
 private val cyan = Color.rgb(0, 104, 125)
 private val bright = ink
 private val muted = Color.rgb(80, 100, 114)
 private val pearl = Color.rgb(244, 248, 250)
 private val line = Color.rgb(195, 215, 224)
 private val assignment by lazy { DemoAssignment(this) }
 private var authentication: CancellationSignal? = null
 private var hud: HudMarkView? = null
 private var loginParticles: ParticleLoginView? = null
 private val duty by lazy { DutyPrompts(store) }
 private val locationPing by lazy { LocationPing(this) }
 private var promptedDuty: String? = null
 private var currentDuty: DutyPrompt? = null
 private var dutyStatus: TextView? = null
 private var dutySurface: View? = null
 private var dutyStage: String? = null
 private var pulse: android.animation.ValueAnimator? = null
 private var gpsBusy = false
 private var resumed = false
 private var clockOutVisible = false
 private var currentPage = "dashboard"
 private var identityCreating = false
 private var auditBefore = Long.MAX_VALUE
 private var auditSequence = 0L
 private var incidentInput: EditText? = null
 private var challengeExpected: String? = null
 private val localPrefs by lazy { getSharedPreferences("mercury_local", MODE_PRIVATE) }
 private val expiryHandler = Handler(Looper.getMainLooper())
 private val expiryCheck = object : Runnable {
  override fun run() {
   if (!shiftActive && currentPage in listOf("readiness", "active", "patrol")) {
    stopService(Intent(this@MainActivity, PatrolService::class.java)); showDashboard()
   }
   if (shiftActive && currentPage == "active" && clockOutVisible != assignment.canClockOut()) showDashboard()
   if (shiftActive) {
    try {
     val pending = duty.pending(session.identity())
     DutyAlertDelivery(this@MainActivity,store).update(pending)
     if (currentPage == "readiness") {
      val p = currentDuty
      if (p == null || pending.none { it.id == p.id }) showDashboard()
      else updateDutyColor(p)
     } else if (currentPage in listOf("active", "patrol") && !gpsBusy && pending.isNotEmpty()) showDuty(pending.first())
    } catch (_: Exception) { /* Storage failure never completes a verification. */ }
   }
   expiryHandler.postDelayed(this, 1000)
  }
 }
 override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState); store = GuardStore(this)
  promptedDuty = savedInstanceState?.getString("prompted_duty")
  window.statusBarColor = pearl; window.navigationBarColor = pearl
  window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
  try {
   showDashboard()
   auditBefore = savedInstanceState?.getLong("audit_before", Long.MAX_VALUE) ?: Long.MAX_VALUE
   if (savedInstanceState?.getString("page") == "issue_map") showIssueMap()
   if (savedInstanceState?.getString("page") == "escalate") showEscalation()
   if (savedInstanceState?.getString("page") == "tools") showTools()
   if (savedInstanceState?.getString("page") == "info") showInfo()
   if (savedInstanceState?.getString("page") == "device_readiness") showDeviceReadiness()
   if (savedInstanceState?.getString("page") == "audit") showAudit(auditBefore)
   if (savedInstanceState?.getString("page") == "audit_detail") showAuditDetail(savedInstanceState.getLong("audit_sequence"))
   if (shiftActive && savedInstanceState?.getString("page") == "patrol") showPatrol()
   if (savedInstanceState?.getString("page") == "incident") showIncident()
   if (shiftActive && savedInstanceState?.getString("page") == "readiness") showReadiness(savedInstanceState?.getString("challenge"))
  } catch (_: Exception) {
   currentPage = "storage_error"
   heading("LOCAL STORAGE UNAVAILABLE", "Encrypted data could not be opened. No records were erased.")
   root.addView(label("Restart the app or contact your administrator. Do not uninstall if you need to preserve records."))
  }
  if (savedInstanceState == null && currentPage == "dashboard" && assignment.available()) {
   window.decorView.post { if (!isFinishing && !isDestroyed && currentPage == "dashboard") authenticateForShift() }
  }
  val pending = localPrefs.getString("camera_pending", null)
  if (pending != null && !shiftActive) {
   File(File(cacheDir, "capture"), pending).takeIf { it.parentFile == File(cacheDir, "capture") }?.delete()
   localPrefs.edit().remove("camera_pending").remove("camera_session").remove("duty_camera_id").commit()
  }
  File(cacheDir, "capture").listFiles()?.filter { it.name != pending && System.currentTimeMillis() - it.lastModified() > 86400000L }?.forEach { it.delete() }
 }
 override fun onSaveInstanceState(outState: Bundle) {
  outState.putString("prompted_duty", promptedDuty)
  outState.putString("page", currentPage)
  outState.putLong("audit_before", auditBefore)
  outState.putLong("audit_sequence", auditSequence)
  outState.putString("challenge", challengeExpected)
  super.onSaveInstanceState(outState)
 }
 override fun onResume() {
  super.onResume(); resumed = true; expiryHandler.post(expiryCheck); hud?.startMotion(); loginParticles?.startMotion()
  if (currentPage == "device_readiness") showDeviceReadiness()
  File(cacheDir, "exports").listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 3600000L }?.forEach { it.delete() }
 }
 override fun onPause() { resumed = false; pulse?.cancel(); locationPing.cancel(); authentication?.cancel(); authentication = null; loginParticles?.setSigningIn(false); loginParticles?.stopMotion(); hud?.stopMotion(); expiryHandler.removeCallbacksAndMessages(null); super.onPause() }
 private fun dp(value: Int) = (value * resources.displayMetrics.density + 0.5f).toInt()
 private fun surface(fill: Int, border: Int = line, radius: Int = 18) = GradientDrawable().apply {
  setColor(fill); cornerRadius = dp(radius).toFloat(); setStroke(dp(1), border)
 }
 private fun label(value: String, size: Float = 16f, color: Int = bright): TextView = TextView(this).apply {
  text = value; textSize = size.coerceAtLeast(14f); setTextColor(color)
  typeface = Typeface.create("sans-serif", Typeface.NORMAL)
  setLineSpacing(dp(3).toFloat(), 1f); setPadding(0, dp(8), 0, dp(8))
 }
 private fun action(title: String, block: () -> Unit) {
  val primary = title == "Sign in with biometrics" || title == "Save incident" || title.startsWith("Record checkpoint:")
  val destructive = title == "End shift early" || title == "Clock out" || title == "Discard draft"
  val foreground = if (primary) Color.WHITE else if (destructive) Color.rgb(156, 45, 48) else ink
  val fill = if (primary) cyan else Color.WHITE
  val b = Button(this).apply {
   text = title; textSize = 16f; isAllCaps = false; setTextColor(foreground)
   typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
   gravity = Gravity.CENTER_VERTICAL or Gravity.START
   minHeight = dp(56); minimumHeight = dp(56)
   setPadding(dp(20), dp(14), dp(20), dp(14))
   background = RippleDrawable(ColorStateList.valueOf(0x2600687D), surface(fill), null)
   // Keyboard focus has an explicit outline; ripple retains native reduced-motion behavior.
   setOnFocusChangeListener { _, focused ->
    background = RippleDrawable(ColorStateList.valueOf(0x2600687D), surface(fill, if (focused) cyan else line), null)
    if (focused) (background as RippleDrawable).getDrawable(0).let { (it as GradientDrawable).setStroke(dp(3), cyan) }
   }
   setOnClickListener { block() }
  }
  root.addView(b, LinearLayout.LayoutParams(-1,-2).apply { topMargin = dp(4); bottomMargin = dp(8) })
 }
 private fun heading(title: String, subtitle: String) {
  pulse?.cancel(); dutySurface = null; dutyStage = null
  hud?.stopMotion(); loginParticles?.stopMotion(); loginParticles = null
  window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
  val wide = resources.configuration.screenWidthDp >= 720 && resources.configuration.fontScale <= 1.3f
  val scroll = ScrollView(this).apply { setBackgroundColor(pearl); isFillViewport = true }
  val layout = LinearLayout(this).apply {
   orientation = if (wide) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
   setPadding(dp(20), dp(24), dp(20), dp(24))
  }
  val header = LinearLayout(this).apply {
   orientation = LinearLayout.VERTICAL
   if (wide) setPadding(0, 0, dp(28), 0)
  }
  header.addView(label("M E R C U R Y  O N E", 14f, cyan).apply {
   typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
  })
  hud = HudMarkView(this).apply { importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO }
  header.addView(hud, LinearLayout.LayoutParams(-1, dp(if (wide) 240 else 160)))
  hud?.startMotion()
  header.addView(label(title, 28f).apply {
   typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
   isAccessibilityHeading = true
  })
  header.addView(label(subtitle, 14f, muted))
  header.addView(label("OFFLINE PROTOTYPE", 14f, cyan).apply {
   typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
   setPadding(dp(12), dp(10), dp(12), dp(10))
   background = surface(Color.rgb(230, 244, 248))
  }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8); bottomMargin = dp(20) })
  root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
  if (wide) {
   layout.addView(header, LinearLayout.LayoutParams(0, -2, 0.38f))
   layout.addView(root, LinearLayout.LayoutParams(0, -2, 0.62f))
  } else {
   layout.addView(header); layout.addView(root)
  }
  // Centre a bounded reading area on unfolded screens and large windows.
  val content = FrameLayout(this).apply {
   addView(layout, FrameLayout.LayoutParams(
    if (resources.configuration.screenWidthDp > 1100) dp(1100) else -1, -2, Gravity.TOP or Gravity.CENTER_HORIZONTAL))
  }
  scroll.addView(content)
  val frame = FrameLayout(this).apply {
   setBackgroundColor(pearl)
   addView(scroll, FrameLayout.LayoutParams(-1, -1))
  }
  setContentView(frame)
  frame.setOnApplyWindowInsetsListener { view, insets ->
   view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
   insets
  }
  frame.requestApplyInsets()
 }
 private fun log(kind: String, details: JSONObject = JSONObject()): Boolean = try {
  store.record(kind, details); Toast.makeText(this, "Recorded: $kind", Toast.LENGTH_SHORT).show(); true
 } catch (_: Exception) {
  Toast.makeText(this, "Could not save encrypted record. Please try again; data was not sent.", Toast.LENGTH_LONG).show(); false
 }
 private fun showDashboard() {
  val active = shiftActive
  currentPage = if (active) "active" else "dashboard"
  incidentInput = null
  clockOutVisible = assignment.canClockOut()
  if (!active) { showLogin(); return }
  heading(if (active) "ACTIVE SHIFT" else "SIGN IN", "Mercury One · LOCAL DEMO ONLY · No real clock-in or dispatch")
  if (!active) {
   root.addView(label(if (assignment.available()) "Simulated assignment ready. Secure biometric sign-in starts this local demo after device checks." else if (assignment.consumed()) "This simulated assignment has already been used. No new shift is assigned." else "No assigned shift. Clock-in is unavailable. Your real schedule is not connected.", 17f))
   if (assignment.available()) action("Sign in with biometrics") { authenticateForShift() }
   root.addView(label("Uses a supported secure biometric. Face unlock availability depends on your phone; Mercury One does not collect face images.", 14f, muted))
  } else {
   root.addView(label("SIMULATED SHIFT · local clock-in only", 17f, cyan))
   if (assignment.end() > 0) root.addView(label("Scheduled end: ${java.text.DateFormat.getDateTimeInstance().format(java.util.Date(assignment.end()))}", 14f, muted))
   root.addView(label("Your next prompts", 20f))
   action("Patrol · Open demo route") { showPatrol() }
   root.addView(label("Readiness arrives automatically. Demo cadence: readiness every 15 minutes; check-in every 30 minutes. Real scheduling is not connected.",14f,muted))
   action("Shift check-in") { showDuty(duty.requestCheckIn(session.identity())) }
   if (duty.missed().isNotEmpty()) root.addView(label("Missed verification: reason required in Escalate → Dispatch acknowledge. No alert has been sent.",16f,Color.rgb(155,45,45)))
   if (clockOutVisible) action("Clock out") { confirmClockOut() }
  }
  action("Escalate") { showEscalation() }
  action("Prototype tools") { showTools() }
 }
 private fun showLogin() {
  hud?.stopMotion(); hud = null; loginParticles?.stopMotion()
  window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
   View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
   View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
  val frame = FrameLayout(this).apply { setBackgroundColor(Color.WHITE) }
  root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
  val brand = TextView(this).apply {
   text = "Mercury One"; textSize = 20f; setTextColor(Color.rgb(156,165,170))
   typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
   gravity = Gravity.CENTER; letterSpacing = .12f; isAccessibilityHeading = true
   setPadding(dp(16), dp(32), dp(16), dp(16))
  }
  frame.addView(brand, FrameLayout.LayoutParams(-1,dp(96),Gravity.TOP))
  loginParticles = ParticleLoginView(this).apply {
   contentDescription = if (assignment.available()) "Sign in with secure biometrics. Local demo only; no real clock-in. Generic decorative face, not identity recognition."
    else "Sign in unavailable: no assigned shift. Offline prototype. Activate to review status."
   isClickable=true; isFocusable=true
   setOnClickListener {
    if (assignment.available()) authenticateForShift()
    else AlertDialog.Builder(this@MainActivity).setTitle("No assigned shift")
     .setMessage("Clock-in is unavailable. This offline prototype is not connected to your real schedule. Escalate remains available; prototype tools can create a local test assignment.")
     .setPositiveButton("OK", null).show()
   }
  }
  frame.addView(loginParticles,FrameLayout.LayoutParams(-1,-1).apply { topMargin=dp(104); bottomMargin=dp(112) })
  val controls=LinearLayout(this).apply { gravity=Gravity.CENTER }
  fun icon(symbol: String, description: String, action: () -> Unit) = Button(this).apply {
   text=symbol; textSize=22f; contentDescription=description; isAllCaps=false
   setTextColor(cyan); minHeight=dp(56); minimumHeight=dp(56)
   background=RippleDrawable(ColorStateList.valueOf(0x1600687D),surface(Color.WHITE),null)
   setOnClickListener { action() }
  }
  controls.addView(icon("!", "Escalate") { showEscalation() },LinearLayout.LayoutParams(dp(56),dp(56)).apply { marginEnd=dp(28) })
  controls.addView(icon("⋯", "Prototype tools") { showTools() },LinearLayout.LayoutParams(dp(56),dp(56)))
  frame.addView(controls,FrameLayout.LayoutParams(-1,dp(96),Gravity.BOTTOM))
  val scroll = ScrollView(this).apply { isFillViewport=true; addView(frame,FrameLayout.LayoutParams(-1,-1)) }
  setContentView(scroll)
  frame.setOnApplyWindowInsetsListener { view, insets ->
   view.setPadding(insets.systemWindowInsetLeft,insets.systemWindowInsetTop,insets.systemWindowInsetRight,insets.systemWindowInsetBottom); insets
  }
  frame.requestApplyInsets()
 }
 private fun showTools() {
  currentPage = "tools"
  heading("PROTOTYPE TOOLS", "Local testing and records · no production connection")
  if (!shiftActive) action("Create 8-hour demo assignment") {
   AlertDialog.Builder(this).setTitle("Create a simulated assignment?")
    .setMessage("Creates an eight-hour test schedule starting now on this phone. It is not a real assigned shift or payroll record. Biometrics, precise location, enabled GPS and notifications are required to start the demo; location accuracy and real schedule eligibility are not verified.")
    .setNegativeButton("Cancel", null).setPositiveButton("Create demo") { _, _ -> assignment.create(); showDashboard(); authenticateForShift() }.show()
  }
  action("Device readiness") { showDeviceReadiness() }
  action("Device information") { showInfo() }
  action("Review local audit events") { showAudit() }
  action("Export local audit events") { shareEvents() }
  action("Return") { showDashboard() }
 }
 private fun authenticateForShift() {
  if (shiftActive || !assignment.available()) { showDashboard(); return }
  loginParticles?.setSigningIn(true)
  val readiness = DeviceReadiness(this)
  if (!readiness.preciseLocationGranted()) {
   requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 404)
   return
  }
  if (!readiness.notificationPermissionGranted() && Build.VERSION.SDK_INT >= 33) {
   requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 405); return
  }
  if (!readiness.gpsEnabled() || !readiness.notificationsEnabled()) {
   AlertDialog.Builder(this).setTitle("Device checks need attention")
    .setMessage("Enable device GPS and shift notifications before starting this simulated shift. No clock-in has been recorded. Escalate remains available.")
    .setPositiveButton("Review checks") { _, _ -> showDeviceReadiness() }.setNegativeButton("Cancel", null).show(); return
  }
  authentication?.cancel()
  val signal = CancellationSignal()
  authentication = signal
  val builder = BiometricPrompt.Builder(this).setTitle("Mercury One")
   .setNegativeButton("Cancel", mainExecutor) { _, _ -> authentication = null; loginParticles?.setSigningIn(false) }
  if (Build.VERSION.SDK_INT >= 30) builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
  builder.build().authenticate(signal, mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
   override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
    if (authentication !== signal || signal.isCanceled || isFinishing || isDestroyed) return
    authentication = null
    beginShift()
   }
   override fun onAuthenticationFailed() {
    loginParticles?.setSigningIn(false)
    Toast.makeText(this@MainActivity, "Not recognized. No clock-in recorded.", Toast.LENGTH_SHORT).show()
   }
   override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
    if (authentication !== signal) return
    authentication = null; loginParticles?.setSigningIn(false)
    Toast.makeText(this@MainActivity, "$errString · No clock-in recorded.", Toast.LENGTH_LONG).show()
   }
  })
 }
 private fun beginShift() {
  val ready = DeviceReadiness(this)
  if (shiftActive || !ShiftTiming.mayClockIn(assignment.available(), true,
    ready.preciseLocationGranted() && ready.gpsEnabled() && ready.notificationsEnabled(), assignment.consumed())) {
   showDashboard(); return
  }
  // Consume before logging: interruption can block this demo, but cannot duplicate its clock-in.
  if (!assignment.consume()) { Toast.makeText(this, "Assignment could not be saved. No clock-in recorded.", Toast.LENGTH_LONG).show(); return }
  if (!log("shift_started_demo", JSONObject().put("actual_clock_in", System.currentTimeMillis()).put("scheduled_start", assignment.start()).put("scheduled_end", assignment.end()).put("delivery", "local_only_pending_no_transport"))) { showDashboard(); return }
  session.start(); startTracking(); showDashboard()
 }
 private fun showEscalation() {
  currentPage = "escalate"
  heading("ESCALATE", "Available before sign-in · no alert is dispatched by this prototype")
  root.addView(label("For immediate danger, use your phone's emergency calling or your established dispatch channel. This app cannot contact emergency services or a supervisor.", 16f))
  action("Pinpoint issue · demo property") { showIssueMap() }
  action("Incident report") { showIncident() }
  if (shiftActive) {
   action("Capture photo evidence") { captureEvidence() }
   action("Dispatch · Acknowledge missed check") { showMissedReason() }
   if (!assignment.canClockOut()) action("End shift early") { showEarlyEnd() }
   else action("Clock out") { confirmClockOut() }
  }
  action("Device readiness") { showDeviceReadiness() }
  action("Return") { showDashboard() }
 }
 private fun showIssueMap() {
  currentPage = "issue_map"
  heading("PINPOINT ISSUE", "DEMO PROPERTY · schematic only · not your actual site")
  root.addView(label("No authorized site geometry or GPS-to-property registration is configured. Phone GPS cannot establish an exact indoor position.", 14f, muted))
  val fix = TrackingStatus.lastLocation
  val permitted = shiftActive && DeviceReadiness(this).preciseLocationGranted()
  val age = if (fix == null) Long.MAX_VALUE else ((SystemClock.elapsedRealtimeNanos() - fix.elapsedRealtimeNanos) / 1000000000L).coerceAtLeast(0)
  val fresh = permitted && fix != null && age <= 60
  root.addView(label(if (permitted && fix != null) {
   "${if (fresh) "● GPS fix" else "○ Stale GPS fix"}: ${fix.latitude}, ${fix.longitude}\nAccuracy radius: ${fix.accuracy.toInt()} m · ${age}s old\nLast fix: ${java.text.DateFormat.getDateTimeInstance().format(java.util.Date(fix.time))}\n${if (fix.isFromMockProvider) "Simulated location provider. " else ""}Position cannot be placed on this unregistered demo property."
  } else "○ Guard position unavailable · ${if (!shiftActive) "no active shift" else "precise permission or GPS fix missing"}", 14f, if (fresh) Color.rgb(0, 108, 65) else muted))
  root.addView(label("Foreground-service tracking only while on shift; no guaranteed continuous/background or indoor tracking.", 14f, muted))
  val pin = label("Issue pin: demo grid ${localPrefs.getInt("issue_x", 50)}%, ${localPrefs.getInt("issue_y", 50)}%", 16f, cyan)
  val map = DemoPropertyView(this, localPrefs.getInt("issue_x", 50), localPrefs.getInt("issue_y", 50)) { x, y ->
   localPrefs.edit().putInt("issue_x", x).putInt("issue_y", y).putString("issue_source","map_touch_or_controls").commit()
   pin.text = "Issue pin: demo grid $x%, $y%"
  }
  root.addView(map, LinearLayout.LayoutParams(-1, dp(220)))
  root.addView(pin)
  root.addView(label("Tap the map, select a patrol point, or use the coordinate controls below. This amber pin is not the guard's GPS position.", 14f, muted))
  listOf("Issue pin east–west", "Issue pin north–south").forEachIndexed { index, title ->
   root.addView(label(title))
   root.addView(SeekBar(this).apply {
    max = 100; progress = localPrefs.getInt(if (index == 0) "issue_x" else "issue_y", 50)
    contentDescription = title; minimumHeight = dp(48)
    setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
     override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) {
      if (fromUser) map.movePin(if (index == 0) value else map.pinX, if (index == 1) value else map.pinY)
     }
     override fun onStartTrackingTouch(bar: SeekBar?) {}
     override fun onStopTrackingTouch(bar: SeekBar?) {}
    })
   }, LinearLayout.LayoutParams(-1, dp(48)))
  }
  DemoRoute.checkpoints.forEachIndexed { index, name ->
   action("Use patrol point: $name") {
    val coords = listOf(50 to 85, 15 to 50, 70 to 30)[index]
    map.movePin(coords.first, coords.second)
    localPrefs.edit().putString("issue_source", "patrol_point:$index").commit()
    pin.text = "Issue pin: $name · demo route location"
   }
  }
  action("Record demo issue pin") {
   log("issue_pin_demo", JSONObject().put("demo_grid_x_percent", map.pinX).put("demo_grid_y_percent", map.pinY)
    .put("source",localPrefs.getString("issue_source","map_touch_or_controls")).put("property", "unregistered_demo_schematic").put("delivery", "local_only_pending_no_transport"))
  }
  action("Incident report") { showIncident() }
  action("Refresh location status") { showIssueMap() }
  action("Back to escalation") { showEscalation() }
 }
 private fun showEarlyEnd() {
  if (!shiftActive) { showDashboard(); return }
  val reason = EditText(this).apply {
   hint = "Reason for ending early"; minLines = 2
   inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE
   filters = arrayOf(InputFilter.LengthFilter(1000))
  }
  val dialog = AlertDialog.Builder(this).setTitle("End shift early")
   .setMessage("Explain why you need to leave. The actual end time and reason stay local and pending; no supervisor is notified.")
   .setView(reason).setNegativeButton("Keep working", null).setPositiveButton("Review", null).create()
  dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
   if (reason.text.toString().isBlank()) reason.error = "Enter a reason"
   else { val value = reason.text.toString().trim(); dialog.dismiss()
    AlertDialog.Builder(this).setTitle("Confirm early clock-out?").setMessage("Reason: $value\n\nThis stops local shift tracking now. No alert or payroll record is sent.")
     .setNegativeButton("Keep working", null).setPositiveButton("End shift now") { _, _ -> endShift(value) }.show()
   }
  } }
  dialog.show()
 }
 private fun confirmClockOut() {
  if (!shiftActive || !assignment.canClockOut()) { showDashboard(); return }
  AlertDialog.Builder(this).setTitle("Clock out?").setMessage("Record your actual end time locally and stop GPS. No server or payroll confirmation is available.")
   .setNegativeButton("Keep working", null).setPositiveButton("Clock out now") { _, _ -> endShift() }.show()
 }
 private fun startTracking(retry: Boolean = false) {
  if (!shiftActive || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return
  try { startForegroundService(Intent(this,PatrolService::class.java).putExtra("retry_gps",retry)) }
  catch (e: Exception) { log("location_start_failed", JSONObject().put("reason",e.javaClass.simpleName)) }
 }
 override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
  super.onRequestPermissionsResult(requestCode,permissions,grantResults)
  if (requestCode in listOf(404, 405)) {
   if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) authenticateForShift()
   else Toast.makeText(this, "Required permission was not granted. No clock-in recorded; Escalate is available.", Toast.LENGTH_LONG).show()
  }
  if(requestCode==101 && grantResults.isNotEmpty() && grantResults[0]==PackageManager.PERMISSION_GRANTED) startTracking()
  if (currentPage == "device_readiness" && requestCode in listOf(101,303)) showDeviceReadiness()
 }
 private fun endShift(reason: String? = null) {
  if (!shiftActive) { showDashboard(); return }
  if (reason == null && !assignment.canClockOut()) { showEscalation(); return }
  try { duty.pending(session.identity()) } catch (_: Exception) { Toast.makeText(this,"Duty history could not be recovered; retain your records.",Toast.LENGTH_LONG).show() }
  val saved = log(if (reason == null) "shift_ended_demo" else "shift_ended_early_demo", JSONObject()
   .put("actual_clock_out", System.currentTimeMillis()).put("scheduled_end", assignment.end())
   .put("reason", reason ?: "scheduled end").put("delivery", "local_only_pending_no_transport"))
  DutyAlertDelivery(this,store).stop()
  session.end(); stopService(Intent(this, PatrolService::class.java)); showDashboard()
  if (!saved) AlertDialog.Builder(this).setTitle("Tracking stopped; record not saved")
   .setMessage("Local storage failed. Your clock-out was not recorded or sent. Contact your supervisor through your established channel.")
   .setPositiveButton("OK", null).show()
 }
 private fun showPatrol() {
  if (!shiftActive) { showDashboard(); return }
  currentPage = "patrol"
  val sessionId = session.identity()
  val completed = store.completedPoints(sessionId)
  heading("PATROL POINTS", "Visit in any order · demo route · no physical presence verification")
  root.addView(label("${completed.size} / ${DemoRoute.checkpoints.size} recorded",20f,cyan))
  root.addView(label("Each checkbox requests a fresh GPS fix. Accuracy and time are saved; GPS cannot prove an exact indoor position. Failed fixes leave the point unchecked.",14f,muted))
  DemoRoute.checkpoints.forEachIndexed { index, name ->
   root.addView(CheckBox(this).apply {
    text = name; textSize = 18f; setTextColor(ink); minHeight = dp(56)
    isChecked = index in completed; isEnabled = !isChecked && !gpsBusy
    setOnClickListener {
     isChecked = false
     if (gpsBusy) return@setOnClickListener
     gpsBusy = true; isEnabled = false
     Toast.makeText(this@MainActivity,"Requesting GPS · up to 20 seconds",Toast.LENGTH_LONG).show()
     locationPing.request { gps ->
      gpsBusy = false
      if (gps != null && shiftActive && session.identity() == sessionId) {
       try { store.completePoint(sessionId,index,gps) } catch (_: Exception) { Toast.makeText(this@MainActivity,"Checkpoint not saved",Toast.LENGTH_LONG).show() }
      } else if (resumed) Toast.makeText(this@MainActivity,"No fresh GPS fix. Point remains unchecked; check location permission and retry.",Toast.LENGTH_LONG).show()
      if (resumed && currentPage == "patrol") showPatrol()
     }
    }
   })
  }
  action("Return") { locationPing.cancel(); showDashboard() }
 }
 private fun showReadiness(restored: String? = null) {
  if (!shiftActive) { showDashboard(); return }
  val pending = duty.pending(session.identity()).firstOrNull()
  if (pending == null) showDashboard() else showDuty(pending)
 }
 private fun showDuty(p: DutyPrompt) {
  currentPage = "readiness"; currentDuty = p
  heading(if (p.kind == "readiness") "READINESS CHECK" else "SHIFT CHECK-IN", "Timed local demo · no live dispatch")
  dutySurface = findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
  dutyStatus = label("",20f).also { root.addView(it) }
  root.addView(label("Secure biometric verification required. Android selects a supported secure face or fingerprint sensor; this is not face-only identification.",16f))
  root.addView(label("0–2 min green · 2–5 yellow · 5–10 red. At 10 minutes the miss remains recorded and requires a reason. Sound/vibration follow system settings. Optional full-screen alerts require app consent and Android special access in Device readiness. Otherwise tap the notification to open the alert.",14f,muted))
  if (!duty.has("duty_biometric",p.id)) action("Verify with secure biometrics") { verifyDuty(p) }
  else if (p.kind == "check_in") {
   root.addView(label(if (duty.has("duty_gps",p.id)) "Biometric verified · GPS recorded · site photo required." else "Biometric verified · fresh GPS and a site photo required.",16f,cyan))
   if (!duty.has("duty_gps",p.id)) action("Capture GPS fix") { captureDutyGps(p) }
   else if (!duty.has("duty_photo",p.id)) action("Take site photo") {
    localPrefs.edit().putString("duty_camera_id",p.id).commit(); captureEvidence()
   }
  }
  action("Silence this alert") { DutyAlertDelivery(this,store).silence(p); pulse?.cancel(); dutyStage=null; updateDutyColor(p) }
  action(if(localPrefs.getBoolean("steady_alert",false)) "Use pulsing color" else "Use steady color") {
   localPrefs.edit().putBoolean("steady_alert",!localPrefs.getBoolean("steady_alert",false)).commit();showDuty(p)
  }
  action("Escalate") { showEscalation() }
  updateDutyColor(p)
  if (promptedDuty != p.id && !duty.has("duty_biometric",p.id)) {
   promptedDuty = p.id
   window.decorView.post { if (resumed && currentPage == "readiness" && currentDuty?.id == p.id) verifyDuty(p) }
  }
 }
 private fun updateDutyColor(p: DutyPrompt) {
  val stage = p.stage()
  dutyStatus?.text = "${stage.uppercase()} · ${(SystemClock.elapsedRealtime()-p.due).coerceAtLeast(0)/1000}s elapsed"
  if (stage == dutyStage && pulse?.isRunning == true && !DutyAlertDelivery(this,store).silenced(p)) return
  dutyStage = stage; pulse?.cancel()
  val color = DutyAlertPolicy.color(stage)
  fun paint(value: Int) {
   dutySurface?.setBackgroundColor(value)
   (dutySurface as? ViewGroup)?.getChildAt(0)?.setBackgroundColor(value)
  }
  paint(color)
  if (android.animation.ValueAnimator.areAnimatorsEnabled() && !localPrefs.getBoolean("steady_alert",false) && !DutyAlertDelivery(this,store).silenced(p)) {
   pulse = android.animation.ValueAnimator.ofArgb(color,Color.WHITE).apply {
    duration = 2000; repeatMode = android.animation.ValueAnimator.REVERSE; repeatCount = android.animation.ValueAnimator.INFINITE
    addUpdateListener { paint(it.animatedValue as Int) }; start()
   }
  }
 }
 private fun verifyDuty(p: DutyPrompt) {
  if (!shiftActive || p.stage() == "missed") { showDashboard(); return }
  authentication?.cancel(); val signal = CancellationSignal(); authentication = signal
  val builder = BiometricPrompt.Builder(this).setTitle("Verify readiness")
   .setNegativeButton("Cancel", mainExecutor) { _, _ -> authentication = null; DutyAlertDelivery(this,store).silence(p,"verification_cancelled"); pulse?.cancel(); dutyStage=null }
  if (Build.VERSION.SDK_INT >= 30) builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
  builder.build().authenticate(signal,mainExecutor,object : BiometricPrompt.AuthenticationCallback() {
   override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
    if (authentication !== signal || signal.isCanceled || !resumed || !shiftActive || !p.id.startsWith(session.identity()+":") || p.stage() == "missed") return
    authentication = null
    DutyAlertDelivery(this@MainActivity,store).silence(p,"biometric_verified")
    store.recordOnce("duty_biometric",p.id,JSONObject().put("verified_at",System.currentTimeMillis()))
    if (p.kind == "readiness") { duty.complete(p); showDashboard() }
    else { showDuty(p); captureDutyGps(p) }
   }
   override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
    if (authentication !== signal) return
    authentication = null
    if (errorCode == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED) { DutyAlertDelivery(this@MainActivity,store).silence(p,"verification_cancelled"); pulse?.cancel(); dutyStage=null }
    Toast.makeText(this@MainActivity,"$errString · verification still due",Toast.LENGTH_LONG).show()
   }
  })
 }
 private fun captureDutyGps(p: DutyPrompt) {
  if (gpsBusy) return
  gpsBusy = true
  Toast.makeText(this,"Requesting fresh GPS · up to 20 seconds",Toast.LENGTH_LONG).show()
  locationPing.request { gps ->
   gpsBusy = false
   if (gps != null && shiftActive && p.id.startsWith(session.identity()+":") && p.stage() != "missed") store.recordOnce("duty_gps",p.id,gps)
   else if (resumed) Toast.makeText(this,"GPS unavailable. Check-in is incomplete; retry after checking permission/GPS.",Toast.LENGTH_LONG).show()
   if (resumed && currentPage == "readiness") showDuty(p)
  }
 }
 private fun showMissedReason() {
  if (shiftActive) duty.pending(session.identity())
  val missed = duty.missed().firstOrNull()
  if (missed == null) { AlertDialog.Builder(this).setTitle("No missed checks awaiting a reason").setPositiveButton("OK",null).show(); return }
  val input = EditText(this).apply { hint = "Why was this check missed?"; filters = arrayOf(InputFilter.LengthFilter(1000)) }
  val dialog = AlertDialog.Builder(this).setTitle("Missed ${missed.getString("kind").replace('_',' ')}")
   .setMessage("The miss remains in the record. This reason is stored locally and pending; no dispatcher is notified.")
   .setView(input).setNegativeButton("Cancel",null).setPositiveButton("Record reason",null).create()
  dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
   val reason = input.text.toString().trim()
   if (reason.isEmpty()) input.error = "A reason is required"
   else {
    store.recordOnce("duty_miss_reason",missed.getString("event_key"),JSONObject().put("reason",reason).put("recorded_at",System.currentTimeMillis()).put("delivery","local_pending_no_dispatch_transport"))
    dialog.dismiss(); showEscalation()
   }
  } }; dialog.show()
 }
 private fun captureEvidence() {
  if (currentPage != "readiness") localPrefs.edit().remove("duty_camera_id").commit()
  AlertDialog.Builder(this).setTitle("Capture test photo")
   .setMessage("This opens your camera. The photo is encrypted on this phone; it is not uploaded or used for identity or uniform verification. Use test subjects only.")
   .setNegativeButton("Cancel") { _, _ -> localPrefs.edit().remove("duty_camera_id").commit() }.setPositiveButton("Open camera") { _, _ -> openCamera() }.show()
 }
 private fun openCamera() {
  if (!shiftActive) { showDashboard(); return }
  if (localPrefs.contains("camera_pending")) {
   Toast.makeText(this, "A camera capture is already pending. Return from the camera before starting another.", Toast.LENGTH_LONG).show(); return
  }
  val dir = File(cacheDir, "capture").apply { mkdirs() }
  val file = File(dir, "${UUID.randomUUID()}.jpg")
  val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
  val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
   putExtra(MediaStore.EXTRA_OUTPUT, uri)
   clipData = ClipData.newRawUri("Camera output", uri)
   addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
  }
  try {
   check(localPrefs.edit().putString("camera_pending", file.name).putString("camera_session",session.identity()).commit())
   startActivityForResult(intent, 202)
  } catch (_: Exception) {
   localPrefs.edit().remove("camera_pending").remove("camera_session").remove("duty_camera_id").commit(); file.delete()
   revokeUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
   Toast.makeText(this, "No available camera could open. Your incident notes still work offline.", Toast.LENGTH_LONG).show()
  }
 }
 override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
  super.onActivityResult(requestCode, resultCode, data)
  if (requestCode != 202) return
  val name = localPrefs.getString("camera_pending", null) ?: return
  val captureSession = localPrefs.getString("camera_session", null)
  val dutyId = localPrefs.getString("duty_camera_id",null)
  localPrefs.edit().remove("camera_pending").remove("camera_session").remove("duty_camera_id").commit()
  val valid = try { name.endsWith(".jpg") && UUID.fromString(name.removeSuffix(".jpg")).toString()+".jpg" == name } catch (_: Exception) { false }
  if (!valid) return
  val file = File(File(cacheDir, "capture"), name)
  val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
  var retainedId: String? = null
  var committed = false
  try {
   if (resultCode == RESULT_OK && shiftActive && captureSession == session.identity()) {
    val metadata = EvidenceStore(this).savePhoto(file)
    retainedId = metadata.getString("evidence_id")
    val complete = store.recordRetainedPhoto(metadata,captureSession,dutyId)
    committed = true
    Toast.makeText(this,if (complete) "Photo saved · check-in complete" else "Recorded: photo_evidence",Toast.LENGTH_LONG).show()
   } else Toast.makeText(this, if (!shiftActive || captureSession != session.identity()) "Shift changed or ended; photo was not retained." else "Photo cancelled.", Toast.LENGTH_SHORT).show()
  } catch (_: Exception) {
   if (!committed) retainedId?.let { EvidenceStore(this).remove(it) }
   Toast.makeText(this, "Photo could not be saved. Retake it while on shift.", Toast.LENGTH_LONG).show()
  } finally {
   revokeUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
   file.delete()
  }
  showDashboard()
 }
 private fun showIncident() {
  val draft = try { store.incidentDraft() } catch (_: Exception) {
   Toast.makeText(this, "Draft could not be opened. Its stored data was preserved.", Toast.LENGTH_LONG).show(); return
  }
  currentPage = "incident"
  heading("INCIDENT REPORT","Draft saved encrypted on this phone · no external transmission")
  val status = label("Encrypted draft saved · up to ${GuardStore.MAX_DRAFT_LENGTH} characters", 12f, muted)
  val input = EditText(this).apply {
   hint="Describe the incident"; setTextColor(ink); setHintTextColor(muted); minLines=4
   textSize = 16f; gravity = Gravity.TOP or Gravity.START
   setPadding(dp(16), dp(16), dp(16), dp(16))
   background = surface(Color.WHITE, cyan)
   inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
   id = View.generateViewId()
   filters = arrayOf(InputFilter.LengthFilter(GuardStore.MAX_DRAFT_LENGTH))
   isSaveEnabled = false; isSaveFromParentEnabled = false
   setText(draft)
  }
  incidentInput = input
  input.addTextChangedListener(object : TextWatcher {
   override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
   override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
   override fun afterTextChanged(text: Editable?) {
    try { store.saveIncidentDraft(text.toString()); status.text = "Encrypted draft saved" }
    catch (_: Exception) { status.text = "Draft could not be saved. Keep this screen open and retry." }
   }
  })
  root.addView(label("Incident description", 16f).apply { labelFor = input.id })
  root.addView(input, LinearLayout.LayoutParams(-1, -2)); root.addView(status)
  root.addView(label("Cancel keeps your draft. Drafts remain on this test device across shifts until submitted or explicitly discarded.",12f,muted))
  action("Save incident") {
   try {
    store.saveIncidentDraft(input.text.toString())
    if (store.submitIncidentDraft()) { Toast.makeText(this,"Incident saved",Toast.LENGTH_SHORT).show(); showDashboard() }
   } catch (_: Exception) { status.text = "Incident was not saved. Draft data was preserved; retry." }
  }
  action("Cancel") {
   try { store.saveIncidentDraft(input.text.toString()); showDashboard() }
   catch (_: Exception) { status.text = "Draft was not saved. Keep this screen open and retry." }
  }
  action("Discard draft") {
   AlertDialog.Builder(this).setTitle("Discard this draft?")
    .setMessage("This removes the unfinished incident draft from this phone. Submitted audit events are kept.")
    .setNegativeButton("Keep draft", null).setPositiveButton("Discard") { _, _ ->
     try { store.discardIncidentDraft(); showDashboard() }
     catch (_: Exception) { status.text = "Draft could not be discarded. Please retry." }
    }.show()
  }
 }
 private fun showAudit(before: Long = Long.MAX_VALUE) {
  currentPage = "audit"; auditBefore = before
  heading("LOCAL AUDIT", "Read-only local records · sync disabled · device timestamps are not server verified")
  root.addView(label("This demo has no guard sign-in. Anyone using this test installation can review its saved records. Use synthetic data only.",12f,muted))
  try {
   val entries = store.auditPage(before)
   if (entries.isEmpty()) root.addView(label("No records on this page."))
   entries.forEach { entry ->
    val kind = entry.event.getString("kind").take(80)
    action("Event #${entry.sequence} · $kind") { showAuditDetail(entry.sequence) }
    root.addView(label("${java.text.DateFormat.getDateTimeInstance().format(java.util.Date(entry.event.getLong("at")))} · ${if (entry.delivered) "Acknowledged locally" else "Pending · sync disabled"}",12f,muted))
   }
   if (entries.size == 20) action("Older records") { showAudit(entries.last().sequence) }
   if (before != Long.MAX_VALUE) action("Newest records") { showAudit() }
  } catch (_: Exception) { root.addView(label("Records could not be opened. Stored data was preserved.")) }
  action("Return") { showDashboard() }
 }
 private fun showAuditDetail(sequence: Long) {
  currentPage = "audit_detail"; auditSequence = sequence
  heading("AUDIT EVENT", "Read-only · local demo record · no server verification")
  try {
   val entry = store.auditEvent(sequence)
   if (entry == null) root.addView(label("Record is unavailable."))
   else {
    root.addView(label("Event #${entry.sequence} · ${entry.event.getString("kind").take(80)}",20f,cyan))
    root.addView(label(if (entry.delivered) "Acknowledged locally; this screen does not authenticate a server receipt." else "Pending · sync disabled",13f,muted))
    val detail = entry.event.toString(2)
    root.addView(label(detail.take(16000),14f))
    if (detail.length > 16000) root.addView(label("Display limited to 16,000 characters. The stored record is unchanged; use audit export for full content.",12f,muted))
    if (entry.event.getString("kind") == "photo_evidence") root.addView(label("This record contains photo metadata. Retained encrypted images are not displayed or exported here.",12f,muted))
   }
  } catch (_: Exception) { root.addView(label("Record could not be opened. Stored data was preserved.")) }
  action("Back to audit") { showAudit(auditBefore) }
 }
 private fun showDeviceReadiness() {
  currentPage = "device_readiness"
  val readiness = DeviceReadiness(this)
  heading("DEVICE READINESS", "Read-only checks · permission changes require your choice")
  root.addView(label("Precise location: ${if (readiness.preciseLocationGranted()) "granted" else "not granted"}"))
  root.addView(label("Device GPS: ${if (readiness.gpsEnabled()) "enabled" else "disabled or unavailable"}"))
  root.addView(label("Shift notifications: ${if (readiness.notificationsEnabled()) "enabled" else "blocked or not granted"}"))
  root.addView(label(readiness.trackingDescription(), 16f, cyan))
  root.addView(label(DutyAlertDelivery(this,store).status(),14f,muted))
  val fullScreen=FullScreenAlerts(this)
  action(if(fullScreen.consented()) "Turn off automatic full-screen alerts" else "Set up optional full-screen alerts") {
   if(fullScreen.consented()) { fullScreen.setConsent(false); showDeviceReadiness() }
   else AlertDialog.Builder(this).setTitle("Optional urgent shift alerts")
    .setMessage("Allow Mercury One to open a pulsing alert over the lock screen for a due on-shift readiness or check-in? This may turn on the screen. It does not unlock the phone or verify you. You can silence it or use steady color. Declining keeps ordinary notifications. Android 14+ also requires Allow full screen notifications in special access; sound and vibration remain controlled by your channel settings. This prototype cannot guarantee delivery during doze or stopped execution.")
    .setNegativeButton("Not now",null).setPositiveButton("I agree · review settings") { _,_ ->
     val setup=fullScreen.settingsIntent()
     if(setup==null) Toast.makeText(this,"Full-screen setup requires Android 14 or later. Ordinary notifications remain available.",Toast.LENGTH_LONG).show()
     else try { startActivity(setup); fullScreen.setConsent(true) }
     catch(_: android.content.ActivityNotFoundException) { Toast.makeText(this,"Android full-screen settings are unavailable. No app opt-in recorded.",Toast.LENGTH_LONG).show() }
     catch(_: SecurityException) { Toast.makeText(this,"Android blocked full-screen settings. No app opt-in recorded.",Toast.LENGTH_LONG).show() }
    }.show()
  }
  action("Review duty sound and vibration") {
   startActivity(Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,packageName).putExtra(android.provider.Settings.EXTRA_CHANNEL_ID,DutyAlertDelivery.CHANNEL))
  }
  root.addView(label("A location request does not prove a current fix or physical presence. Notification permission does not grant location access. If notifications are blocked, Android may still run a foreground location service; check system indicators. Photos, notes and manual checkpoints work without location.",12f,muted))
  if (Build.VERSION.SDK_INT >= 33 && !readiness.notificationPermissionGranted()) action("Request notification permission") {
   requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS),303)
  }
  action("Open notification settings") {
   try { startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName)) }
   catch (_: Exception) { Toast.makeText(this,"Notification settings are unavailable.",Toast.LENGTH_SHORT).show() }
  }
  action("Open location settings") {
   try { startActivity(Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS)) }
   catch (_: Exception) { Toast.makeText(this,"Location settings are unavailable.",Toast.LENGTH_SHORT).show() }
  }
  if (shiftActive) action("Request GPS for active demo shift") {
   if (!shiftActive) { showDeviceReadiness() }
   else if (!readiness.preciseLocationGranted()) requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION),101)
   else { startTracking(retry = true); Toast.makeText(this,"GPS retry requested; a new fix may take time.",Toast.LENGTH_SHORT).show(); showDeviceReadiness() }
  }
  action("Refresh readiness") { showDeviceReadiness(); Toast.makeText(this,"Readiness refreshed",Toast.LENGTH_SHORT).show() }
  action("Return") { showDashboard() }
 }
 private fun showInfo() {
  currentPage = "info"
  heading("DEVICE MANAGEMENT","Read-only device capabilities")
  val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
  root.addView(label("Server shift authorization: disabled · no staging issuer or trusted key configured",13f,muted))
  try {
   val identity = DeviceIdentity(this).publicIdentity()
   root.addView(label(if (identity == null) "Installation identity: not initialized" else "Installation public-key fingerprint: ${identity.thumbprint}",13f,muted))
   root.addView(label("This is an installation key, not a guard login or fleet enrollment. Hardware backing is unverified. No identity is uploaded.",12f,muted))
   if (identity == null) action("Create installation identity") {
    AlertDialog.Builder(this).setTitle("Create local installation key?")
     .setMessage("Creates a signing key in Android Keystore for future enrollment. It does not enroll this phone, authenticate a guard or send data. Uninstalling or losing the key changes the installation identity.")
     .setNegativeButton("Cancel",null).setPositiveButton("Create key") { _, _ ->
      if (!identityCreating) {
       identityCreating = true
       Toast.makeText(this,"Creating installation key…",Toast.LENGTH_SHORT).show()
       Thread {
        val success = try { DeviceIdentity(applicationContext).create(); true } catch (_: Exception) { false }
        runOnUiThread {
         identityCreating = false
         if (!isDestroyed) {
          if (!success) Toast.makeText(this,"Identity could not be initialized. Existing key material was not replaced.",Toast.LENGTH_LONG).show()
          if (currentPage == "info") showInfo()
         }
        }
       }.start()
      }
     }.show()
   }
  } catch (_: Exception) { root.addView(label("Installation identity unavailable or mismatched. Existing material was preserved; administrator recovery is required.",13f,muted)) }

  root.addView(label("Manufacturer: ${Build.MANUFACTURER}\nModel: ${Build.MODEL}\nAndroid: ${Build.VERSION.RELEASE}\nManaged device owner: ${dpm.isDeviceOwnerApp(packageName)}\nKiosk allowlisted: ${dpm.isLockTaskPermitted(packageName)}\nTracking: only during active demo shifts"))
  action("Return") { showDashboard() }
 }
 private fun shareEvents() {
  AlertDialog.Builder(this).setTitle("Export decrypted audit copy?")
   .setMessage("The exported JSON includes local incident notes and GPS coordinates. Share only to a destination you trust. Photos are not included. The temporary export is cleaned after one hour when this app resumes. Your chosen destination may keep its own copy.")
   .setNegativeButton("Cancel", null).setPositiveButton("Choose destination") { _, _ ->
    try {
     val dir = File(cacheDir, "exports").apply { mkdirs() }
     dir.listFiles()?.forEach { it.delete() }
     val file = File(dir, "mercury-audit.json").apply { writeText(store.exportJson()) }
     val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
     val send = Intent(Intent.ACTION_SEND).apply {
      type = "application/json"; putExtra(Intent.EXTRA_STREAM, uri)
      clipData = ClipData.newRawUri("Audit export", uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
     }
     startActivity(Intent.createChooser(send, "Export local audit trail"))
    } catch (_: Exception) { Toast.makeText(this, "Audit export could not be opened. Local records were preserved.", Toast.LENGTH_LONG).show() }
   }.show()
 }
 override fun onDestroy() { pulse?.cancel(); locationPing.cancel(); authentication?.cancel(); loginParticles?.stopMotion(); hud?.stopMotion(); expiryHandler.removeCallbacksAndMessages(null); store.close(); super.onDestroy() }
}
