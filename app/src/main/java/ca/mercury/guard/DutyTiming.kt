package ca.mercury.guard

/** Monotonic stages: boundary values belong to the next stage. */
object DutyTiming {
 fun stage(ageMs: Long): String = when {
  ageMs < 0 -> "scheduled"
  ageMs < 120_000 -> "green"
  ageMs < 300_000 -> "yellow"
  ageMs < 600_000 -> "red"
  else -> "missed"
 }
}
