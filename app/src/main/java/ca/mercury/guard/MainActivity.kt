package ca.mercury.guard

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.admin.DevicePolicyManager
import android.content.*
import android.content.pm.PackageManager
import android.graphics.Color
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
 private val navy = Color.rgb(12,21,38)
 private val cyan = Color.rgb(63,193,255)
 private val bright = Color.WHITE
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
   if (!shiftActive && currentPage in listOf("incident", "readiness", "active", "patrol")) {
    stopService(Intent(this@MainActivity, PatrolService::class.java)); showDashboard()
   }
   expiryHandler.postDelayed(this, 1000)
  }
 }
 override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState); store = GuardStore(this)
  window.statusBarColor = navy; window.navigationBarColor = navy
  try {
   showDashboard()
   auditBefore = savedInstanceState?.getLong("audit_before", Long.MAX_VALUE) ?: Long.MAX_VALUE
   if (savedInstanceState?.getString("page") == "info") showInfo()
   if (savedInstanceState?.getString("page") == "device_readiness") showDeviceReadiness()
   if (savedInstanceState?.getString("page") == "audit") showAudit(auditBefore)
   if (savedInstanceState?.getString("page") == "audit_detail") showAuditDetail(savedInstanceState.getLong("audit_sequence"))
   if (shiftActive && savedInstanceState?.getString("page") == "patrol") showPatrol()
   if (shiftActive && savedInstanceState?.getString("page") == "incident") showIncident()
   if (shiftActive && savedInstanceState?.getString("page") == "readiness") showReadiness(savedInstanceState?.getString("challenge"))
  } catch (_: Exception) {
   currentPage = "storage_error"
   heading("LOCAL STORAGE UNAVAILABLE", "Encrypted data could not be opened. No records were erased.")
   root.addView(label("Restart the app or contact your administrator. Do not uninstall if you need to preserve records."))
  }
  val pending = localPrefs.getString("camera_pending", null)
  if (pending != null && !shiftActive) {
   File(File(cacheDir, "capture"), pending).takeIf { it.parentFile == File(cacheDir, "capture") }?.delete()
   localPrefs.edit().remove("camera_pending").commit()
  }
  File(cacheDir, "capture").listFiles()?.filter { it.name != pending && System.currentTimeMillis() - it.lastModified() > 86400000L }?.forEach { it.delete() }
 }
 override fun onSaveInstanceState(outState: Bundle) {
  outState.putString("page", currentPage)
  outState.putLong("audit_before", auditBefore)
  outState.putLong("audit_sequence", auditSequence)
  outState.putString("challenge", challengeExpected)
  super.onSaveInstanceState(outState)
 }
 override fun onResume() {
  super.onResume(); expiryHandler.post(expiryCheck)
  if (currentPage == "device_readiness") showDeviceReadiness()
  File(cacheDir, "exports").listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 3600000L }?.forEach { it.delete() }
 }
 override fun onPause() { expiryHandler.removeCallbacksAndMessages(null); super.onPause() }
 private fun label(value: String, size: Float = 16f, color: Int = bright): TextView = TextView(this).apply {
  text = value; textSize = size; setTextColor(color); setPadding(0,12,0,12)
 }
 private fun action(title: String, block: () -> Unit) {
  val b = Button(this).apply { text = title; isAllCaps = false; setTextColor(navy); setBackgroundTintList(android.content.res.ColorStateList.valueOf(cyan)); setOnClickListener { if (title != "End shift and stop GPS" && title != "Start simulated authorized shift" && !shiftActive && title != "Device information" && title != "Create installation identity" && title != "Return" && title != "Export local audit events" && title != "Review local audit events" && title != "Device readiness" && currentPage !in listOf("audit", "audit_detail", "device_readiness")) { showDashboard() } else block() } }
  root.addView(b, LinearLayout.LayoutParams(-1,-2).apply { bottomMargin = 12 })
 }
 private fun heading(title: String, subtitle: String) {
  val scroll = ScrollView(this).apply { setBackgroundColor(navy); isFillViewport=true }
  root = LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(28,36,28,30) }
  scroll.addView(root)
  val frame = FrameLayout(this).apply {
   setBackgroundColor(navy)
   addView(scroll, FrameLayout.LayoutParams(-1, -1))
  }
  setContentView(frame)
  frame.setOnApplyWindowInsetsListener { view, insets ->
   view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
   insets
  }
  frame.requestApplyInsets()
  root.addView(label("◆ MERCURY  /  GUARD OS",24f,cyan))
  root.addView(label(title,26f)); root.addView(label(subtitle,13f,Color.LTGRAY))
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
  heading(if (active) "ACTIVE SHIFT" else "DEVICE STANDBY", "Prototype v0.13 · LOCAL DEMO ONLY · No server connection")
  root.addView(label(if(active) "Shift authorized on this device (demo)" else "No active assignment · restricted Mercury functions",17f))
  root.addView(label("Samsung Fold6 / Pixel adaptive layout  •  ${store.count()} local audit events · ${store.pendingCount()} pending (sync disabled)",13f,Color.LTGRAY))
  if(!active) {
   action("Start simulated authorized shift") { beginShift() }
   action("Device information") { showInfo() }
  } else {
   action("Patrol · Open demo route") { showPatrol() }
   action("Respond to readiness prompt") { showReadiness() }
   action("Capture photo evidence") { captureEvidence() }
   action("Incident report") { showIncident() }
   if (store.incidentDraft().isNotEmpty()) root.addView(label("An encrypted incident draft is available. Open Incident report to resume it.", 13f, Color.LTGRAY))
   action("Dispatch · Acknowledge message") { log("dispatch_acknowledged") }
   action("Shift check-in") { log("guard_check_in") }
   action("End shift and stop GPS") { endShift() }
  }
  action("Device readiness") { showDeviceReadiness() }
  action("Review local audit events") { showAudit() }
  action("Export local audit events") { shareEvents() }
  root.addView(label("Photos are encrypted locally. Identity/uniform verification, live dispatch, payroll sync and remote management are not enabled.",12f,Color.LTGRAY))
 }
 private fun beginShift() {
  session.start(); if (!log("shift_started_demo")) { session.end(); showDashboard(); return }
  if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
   requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION),101)
  } else startTracking()
  showDashboard()
 }
 private fun startTracking() {
  if (!shiftActive || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return
  try { startForegroundService(Intent(this,PatrolService::class.java)) }
  catch (e: Exception) { log("location_start_failed", JSONObject().put("reason",e.javaClass.simpleName)) }
 }
 override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
  super.onRequestPermissionsResult(requestCode,permissions,grantResults)
  if(requestCode==101 && grantResults.isNotEmpty() && grantResults[0]==PackageManager.PERMISSION_GRANTED) startTracking()
  if (currentPage == "device_readiness" && requestCode in listOf(101,303)) showDeviceReadiness()
 }
 private fun endShift() {
  session.end(); stopService(Intent(this,PatrolService::class.java)); log("shift_ended_demo"); showDashboard()
 }
 private fun showPatrol() {
  if (!shiftActive) { showDashboard(); return }
  currentPage = "patrol"
  val sessionId = session.identity()
  val next = store.patrolProgress(sessionId)
  heading("DEMO PATROL ROUTE", "Manual test route · no QR, NFC or physical presence verification")
  root.addView(label("$next / ${DemoRoute.checkpoints.size} checkpoints recorded", 20f, cyan))
  DemoRoute.checkpoints.forEachIndexed { i, name -> root.addView(label("${if (i < next) "✓" else "○"} $name")) }
  if (next < DemoRoute.checkpoints.size) {
   action("Record checkpoint: ${DemoRoute.checkpoints[next]}") {
    try {
     if (shiftActive && session.identity() == sessionId) store.recordCheckpoint(sessionId, next)
     showPatrol()
    } catch (_: Exception) {
     Toast.makeText(this, "Checkpoint was not saved. Please try again.", Toast.LENGTH_LONG).show()
    }
   }
  } else root.addView(label("Demo route complete. A new shift starts a new route."))
  action("Return") { showDashboard() }
 }
 private fun showReadiness(restored: String? = null) {
  currentPage = "readiness"
  heading("READINESS CHALLENGE", "Respond while on duty · visible, voluntary test")
  val options = listOf("NORTH","SOUTH","EAST","WEST")
  val expected = restored?.takeIf { it in options } ?: options.random()
  challengeExpected = expected
  root.addView(label("Tap $expected",22f,cyan))
  options.forEach { option -> action(option) {
   log("readiness_response",JSONObject().put("correct",option==expected)); showDashboard()
  } }
 }
 private fun captureEvidence() {
  AlertDialog.Builder(this).setTitle("Capture test photo")
   .setMessage("This opens your camera. The photo is encrypted on this phone; it is not uploaded or used for identity or uniform verification. Use test subjects only.")
   .setNegativeButton("Cancel", null).setPositiveButton("Open camera") { _, _ -> openCamera() }.show()
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
   localPrefs.edit().putString("camera_pending", file.name).commit()
   startActivityForResult(intent, 202)
  } catch (_: Exception) {
   localPrefs.edit().remove("camera_pending").commit(); file.delete()
   revokeUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
   Toast.makeText(this, "No available camera could open. Your incident notes still work offline.", Toast.LENGTH_LONG).show()
  }
 }
 override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
  super.onActivityResult(requestCode, resultCode, data)
  if (requestCode != 202) return
  val name = localPrefs.getString("camera_pending", null) ?: return
  localPrefs.edit().remove("camera_pending").commit()
  if (!name.matches(Regex("[a-f0-9-]{36}\\.jpg"))) return
  val file = File(File(cacheDir, "capture"), name)
  val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
  var retainedId: String? = null
  try {
   if (resultCode == RESULT_OK && shiftActive) {
    val metadata = EvidenceStore(this).savePhoto(file)
    retainedId = metadata.getString("evidence_id")
    if (!log("photo_evidence", metadata)) EvidenceStore(this).remove(metadata.getString("evidence_id"))
   } else Toast.makeText(this, if (!shiftActive) "Shift ended; photo was not retained." else "Photo cancelled.", Toast.LENGTH_SHORT).show()
  } catch (_: Exception) {
   retainedId?.let { EvidenceStore(this).remove(it) }
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
  val status = label("Encrypted draft saved · up to ${GuardStore.MAX_DRAFT_LENGTH} characters", 12f, Color.LTGRAY)
  val input = EditText(this).apply {
   hint="Describe the incident"; setTextColor(Color.WHITE); setHintTextColor(Color.LTGRAY); minLines=4
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
  root.addView(input); root.addView(status)
  root.addView(label("Cancel keeps your draft. Drafts remain on this test device across shifts until submitted or explicitly discarded.",12f,Color.LTGRAY))
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
  root.addView(label("This demo has no guard sign-in. Anyone using this test installation can review its saved records. Use synthetic data only.",12f,Color.LTGRAY))
  try {
   val entries = store.auditPage(before)
   if (entries.isEmpty()) root.addView(label("No records on this page."))
   entries.forEach { entry ->
    val kind = entry.event.getString("kind").take(80)
    action("Event #${entry.sequence} · $kind") { showAuditDetail(entry.sequence) }
    root.addView(label("${java.text.DateFormat.getDateTimeInstance().format(java.util.Date(entry.event.getLong("at")))} · ${if (entry.delivered) "Acknowledged locally" else "Pending · sync disabled"}",12f,Color.LTGRAY))
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
    root.addView(label(if (entry.delivered) "Acknowledged locally; this screen does not authenticate a server receipt." else "Pending · sync disabled",13f,Color.LTGRAY))
    val detail = entry.event.toString(2)
    root.addView(label(detail.take(16000),14f))
    if (detail.length > 16000) root.addView(label("Display limited to 16,000 characters. The stored record is unchanged; use audit export for full content.",12f,Color.LTGRAY))
    if (entry.event.getString("kind") == "photo_evidence") root.addView(label("This record contains photo metadata. Retained encrypted images are not displayed or exported here.",12f,Color.LTGRAY))
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
  root.addView(label("A location request does not prove a current fix or physical presence. Notification permission does not grant location access. If notifications are blocked, Android may still run a foreground location service; check system indicators. Photos, notes and manual checkpoints work without location.",12f,Color.LTGRAY))
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
   else { startTracking(); showDeviceReadiness() }
  }
  action("Refresh readiness") { showDeviceReadiness() }
  action("Return") { showDashboard() }
 }
 private fun showInfo() {
  currentPage = "info"
  heading("DEVICE MANAGEMENT","Read-only device capabilities")
  val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
  root.addView(label("Incoming assignments/dispatch: disabled · no authenticated staging connection",13f,Color.LTGRAY))
  root.addView(label("Server shift authorization: disabled · no staging issuer or trusted key configured",13f,Color.LTGRAY))
  try {
   val identity = DeviceIdentity(this).publicIdentity()
   root.addView(label(if (identity == null) "Installation identity: not initialized" else "Installation public-key fingerprint: ${identity.thumbprint}",13f,Color.LTGRAY))
   root.addView(label("This is an installation key, not a guard login or fleet enrollment. Hardware backing is unverified. No identity is uploaded.",12f,Color.LTGRAY))
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
  } catch (_: Exception) { root.addView(label("Installation identity unavailable or mismatched. Existing material was preserved; administrator recovery is required.",13f,Color.LTGRAY)) }

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
 override fun onDestroy() { expiryHandler.removeCallbacksAndMessages(null); store.close(); super.onDestroy() }
}
