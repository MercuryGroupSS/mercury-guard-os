package ca.mercury.guard

import android.content.Context
import android.os.SystemClock
import android.provider.Settings

class DemoSession(private val context: Context) {
 private val prefs = context.getSharedPreferences("mercury_demo", Context.MODE_PRIVATE)
 private fun boot() = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
 fun active(): Boolean = boot() >= 0 && ShiftPolicy.permits(
  prefs.getLong("started_elapsed", -1), SystemClock.elapsedRealtime(), prefs.getInt("boot", -2), boot())
 fun identity(): String { check(active()); return "${prefs.getInt("boot", -2)}:${prefs.getLong("started_elapsed", -1)}" }
 fun start() { prefs.edit().putLong("started_elapsed", SystemClock.elapsedRealtime()).putInt("boot", boot()).commit() }
 fun end() { prefs.edit().remove("started_elapsed").remove("boot").remove("shift").commit() }
}
