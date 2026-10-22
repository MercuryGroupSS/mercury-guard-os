package ca.mercury.guard

object DutyAlertPolicy {
 const val REPEAT_MS = 30_000L
 const val DEADLINE_MS = 600_000L
 fun slot(due: Long, now: Long): Int? = if (now < due || now-due >= DEADLINE_MS) null else ((now-due)/REPEAT_MS).toInt()
 fun shouldNotify(due: Long, now: Long, lastSlot: Int, silenced: Boolean): Boolean =
  !silenced && slot(due,now)?.let { it > lastSlot } == true
 fun color(stage: String): Int = when(stage) {
  "green" -> 0xFF37D36B.toInt()
  "yellow" -> 0xFFFFCF33.toInt()
  else -> 0xFFFF7575.toInt()
 }
}
