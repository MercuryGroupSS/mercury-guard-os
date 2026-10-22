package ca.mercury.guard

import android.content.Context
import android.os.SystemClock
import android.provider.Settings

/** Explicitly created local test schedule. Never a server-authorized assignment. */
class DemoAssignment(private val context: Context) {
 private val prefs = context.getSharedPreferences("mercury_demo_assignment", Context.MODE_PRIVATE)
 private fun boot() = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
 fun create() {
  val now = System.currentTimeMillis()
  prefs.edit().putLong("start", now).putLong("end", now + 8 * 60 * 60 * 1000L)
   .putLong("end_elapsed", SystemClock.elapsedRealtime() + 8 * 60 * 60 * 1000L)
   .putInt("boot", boot()).putBoolean("consumed", false).commit()
 }
 fun start() = prefs.getLong("start", -1)
 fun end() = prefs.getLong("end", -1)
 fun available() = boot() >= 0 && prefs.getInt("boot", -2) == boot() &&
  !prefs.getBoolean("consumed", false) && start() > 0 && SystemClock.elapsedRealtime() < prefs.getLong("end_elapsed", -1)
 fun consumed() = prefs.getBoolean("consumed", false)
 fun consume(): Boolean = prefs.edit().putBoolean("consumed", true).commit()
 fun canClockOut(): Boolean = prefs.getLong("end_elapsed", -1).let {
  it >= 0 && ShiftTiming.atOrAfterEnd(SystemClock.elapsedRealtime(), it)
 }
}

object ShiftTiming {
 fun atOrAfterEnd(now: Long, end: Long) = end >= 0 && now >= end
 fun mayClockIn(assignmentAvailable: Boolean, authenticated: Boolean, permissionsReady: Boolean, alreadyConsumed: Boolean) =
  assignmentAvailable && authenticated && permissionsReady && !alreadyConsumed
}
