package ca.mercury.guard

/** Demo session only; production requires server-signed grants. Monotonic time ignores clock edits. */
object ShiftPolicy {
 const val MAX_DURATION_MS = 12 * 60 * 60 * 1000L
 fun permits(start: Long, now: Long, startedBoot: Int, currentBoot: Int): Boolean =
  start >= 0 && startedBoot == currentBoot && now >= start && now - start < MAX_DURATION_MS
}
