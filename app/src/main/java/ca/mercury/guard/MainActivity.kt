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
 private var incidentInput: EditText? = null
 private var challengeExpected: String? = null
 private val localPrefs by lazy { getSharedPreferences("mercury_local", MODE_PRIVATE) }
 private val expiryHandler = Handler(Looper.getMainLooper())
 private val expiryCheck = object : Runnable {
  override fun run() {
   if (!shiftActive && currentPage in listOf("incident", "readiness", "active")) {
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
   if (shiftActive && savedInstanceState?.getString("page") == "incident") showIncident(savedInstanceState?.getString("draft").orEmpty())
   if (shiftActive && savedInstanceState?.getString("page") == "readiness") showReadiness(savedInstanceState?.getString("challenge"))
  } catch (_: Exception) {
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
  outState.putString("draft", incidentInput?.text?.toString())
  outState.putString("challenge", challengeExpected)
  super.onSaveInstanceState(outState)
 }
 override fun onResume() {
  super.onResume(); expiryHandler.post(expiryCheck)
  File(cacheDir, "exports").listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 3600000L }?.forEach { it.delete() }
 }
 override fun onPause() { expiryHandler.removeCallbacksAndMessages(null); super.onPause() }
 private fun label(value: String, size: Float = 16f, color: Int = bright): TextView = TextView(this).apply {
  text = value; textSize = size; setTextColor(color); setPadding(0,12,0,12)
 }
 private fun action(title: String, block: () -> Unit) {
  val b = Button(this).apply { text = title; isAllCaps = false; setTextColor(navy); setBackgroundTintList(android.content.res.ColorStateList.valueOf(cyan)); setOnClickListener { if (title != "End shift and stop GPS" && title != "Start simulated authorized shift" && !shiftActive && title != "Device information" && title != "Return" && title != "Export local audit events") { showDashboard() } else block() } }
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
  heading(if (active) "ACTIVE SHIFT" else "DEVICE STANDBY", "Prototype v0.3 · LOCAL DEMO ONLY · No server connection")
  root.addView(label(if(active) "Shift authorized on this device (demo)" else "No active assignment · restricted Mercury functions",17f))
  root.addView(label("Samsung Fold6 / Pixel adaptive layout  •  ${store.count()} local audit events",13f,Color.LTGRAY))
  if(!active) {
   action("Start simulated authorized shift") { beginShift() }
   action("Device information") { showInfo() }
  } else {
   action("Patrol · Begin checkpoint") { log("patrol_checkpoint",JSONObject().put("source","manual")) }
   action("Respond to readiness prompt") { showReadiness() }
   action("Capture photo evidence") { captureEvidence() }
   action("Incident report") { showIncident() }
   action("Dispatch · Acknowledge message") { log("dispatch_acknowledged") }
   action("Shift check-in") { log("guard_check_in") }
   action("End shift and stop GPS") { endShift() }
  }
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
 }
 private fun endShift() {
  session.end(); stopService(Intent(this,PatrolService::class.java)); log("shift_ended_demo"); showDashboard()
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
 private fun showIncident(draft: String = "") {
  currentPage = "incident"
  heading("INCIDENT REPORT","Saved locally on this phone · no external transmission")
  val input = EditText(this).apply { hint="Describe the incident"; setTextColor(Color.WHITE); setHintTextColor(Color.LTGRAY); minLines=4; setText(draft) }
  incidentInput = input
  root.addView(input)
  action("Save incident") { val value=input.text.toString().trim(); if(value.isNotEmpty()) {if (log("incident",JSONObject().put("description",value))) showDashboard()} }
  action("Cancel") { showDashboard() }
 }
 private fun showInfo() {
  currentPage = "info"
  heading("DEVICE MANAGEMENT","Read-only device capabilities")
  val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
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
