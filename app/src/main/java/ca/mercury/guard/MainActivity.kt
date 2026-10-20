package ca.mercury.guard

import android.Manifest
import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.*
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.*
import android.view.*
import android.widget.*
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

/** Phase 1 field prototype: standalone, with clearly marked local DEMO assignment. */
class MainActivity : Activity() {
 private lateinit var root: LinearLayout
 private lateinit var store: GuardStore
 private val prefs by lazy { getSharedPreferences("mercury_demo", MODE_PRIVATE) }
 private var shiftActive: Boolean get() = prefs.getBoolean("shift", false); set(v) { prefs.edit().putBoolean("shift", v).apply() }
 private val navy = Color.rgb(12,21,38)
 private val cyan = Color.rgb(63,193,255)
 private val bright = Color.WHITE
 override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState); store = GuardStore(this)
  window.statusBarColor = navy; window.navigationBarColor = navy
  showDashboard()
 }
 private fun label(value: String, size: Float = 16f, color: Int = bright): TextView = TextView(this).apply {
  text = value; textSize = size; setTextColor(color); setPadding(0,12,0,12)
 }
 private fun action(title: String, block: () -> Unit) {
  val b = Button(this).apply { text = title; isAllCaps = false; setTextColor(navy); setBackgroundTintList(android.content.res.ColorStateList.valueOf(cyan)); setOnClickListener { block() } }
  root.addView(b, LinearLayout.LayoutParams(-1,-2).apply { bottomMargin = 12 })
 }
 private fun heading(title: String, subtitle: String) {
  val scroll = ScrollView(this).apply { setBackgroundColor(navy); fillViewport=true }
  root = LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(28,36,28,30) }
  scroll.addView(root); setContentView(scroll)
  root.addView(label("◆ MERCURY  /  GUARD OS",24f,cyan))
  root.addView(label(title,26f)); root.addView(label(subtitle,13f,Color.LTGRAY))
 }
 private fun log(kind: String, details: JSONObject = JSONObject()) { store.record(kind,details); Toast.makeText(this,"Recorded: $kind",Toast.LENGTH_SHORT).show() }
 private fun showDashboard() {
  val active = shiftActive
  heading(if (active) "ACTIVE SHIFT" else "DEVICE STANDBY", "Prototype v0.1 · LOCAL DEMO ONLY · No server connection")
  root.addView(label(if(active) "Shift authorized on this device (demo)" else "No active assignment · restricted Mercury functions",17f))
  root.addView(label("Samsung Fold6 / Pixel adaptive layout  •  ${store.count()} local audit events",13f,Color.LTGRAY))
  if(!active) {
   action("Start simulated authorized shift") { beginShift() }
   action("Device information") { showInfo() }
  } else {
   action("Patrol · Begin checkpoint") { log("patrol_checkpoint",JSONObject().put("source","manual")) }
   action("Respond to readiness prompt") { showReadiness() }
   action("Uniform / photo evidence (demo)") { captureEvidence() }
   action("Incident report") { showIncident() }
   action("Dispatch · Acknowledge message") { log("dispatch_acknowledged") }
   action("Shift check-in") { log("guard_check_in") }
   action("End shift and stop GPS") { endShift() }
  }
  action("Export local audit events") { shareEvents() }
  root.addView(label("No facial recognition, client messaging, payroll sync, or true remote management is enabled in this prototype.",12f,Color.LTGRAY))
 }
 private fun beginShift() {
  shiftActive = true; log("shift_started_demo")
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
  stopService(Intent(this,PatrolService::class.java)); log("shift_ended_demo"); shiftActive=false; showDashboard()
 }
 private fun showReadiness() {
  heading("READINESS CHALLENGE", "Respond while on duty · visible, voluntary test")
  val options = listOf("NORTH","SOUTH","EAST","WEST")
  val expected = options.random()
  root.addView(label("Tap $expected",22f,cyan))
  options.forEach { option -> action(option) {
   log("readiness_response",JSONObject().put("correct",option==expected)); showDashboard()
  } }
 }
 private fun captureEvidence() {
  log("evidence_capture_requested")
  // No biometric collection in demo. Camera integration requires scoped storage and secure upload.
  Toast.makeText(this,"Camera/media capture is not enabled in this safe prototype",Toast.LENGTH_LONG).show()
 }
 private fun showIncident() {
  heading("INCIDENT REPORT","Saved locally on this phone · no external transmission")
  val input = EditText(this).apply { hint="Describe the incident"; setTextColor(Color.WHITE); setHintTextColor(Color.LTGRAY); minLines=4 }
  root.addView(input)
  action("Save incident") { val value=input.text.toString().trim(); if(value.isNotEmpty()) {log("incident",JSONObject().put("description",value));showDashboard()} }
  action("Cancel") { showDashboard() }
 }
 private fun showInfo() {
  heading("DEVICE MANAGEMENT","Read-only device capabilities")
  val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
  root.addView(label("Manufacturer: ${Build.MANUFACTURER}\nModel: ${Build.MODEL}\nAndroid: ${Build.VERSION.RELEASE}\nManaged device owner: ${dpm.isDeviceOwnerApp(packageName)}\nKiosk allowlisted: ${dpm.isLockTaskPermitted(packageName)}\nTracking: only during active demo shifts"))
  action("Return") { showDashboard() }
 }
 private fun shareEvents() {
  val send=Intent(Intent.ACTION_SEND).apply { type="application/json"; putExtra(Intent.EXTRA_TEXT,store.exportJson()) }
  startActivity(Intent.createChooser(send,"Export demo audit trail"))
 }
 override fun onDestroy() { super.onDestroy() }
}
