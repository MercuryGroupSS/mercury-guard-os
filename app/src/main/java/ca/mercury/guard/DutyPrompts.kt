package ca.mercury.guard

import android.os.SystemClock
import org.json.JSONObject

data class DutyPrompt(val id: String, val kind: String, val due: Long) {
 fun stage(now: Long = SystemClock.elapsedRealtime()) = DutyTiming.stage(now - due)
}
/** Explicit demo cadence; real schedules must arrive from an authenticated assignment. */
class DutyPrompts(private val store: GuardStore) {
 fun due(session: String, now: Long = SystemClock.elapsedRealtime()): List<DutyPrompt> {
  val start = session.substringAfter(":").toLong()
  val result = mutableListOf<DutyPrompt>()
  for ((kind, interval) in listOf("readiness" to 900_000L, "check_in" to 1_800_000L)) {
   for (slot in 1..((now-start)/interval).coerceAtMost(10000).toInt()) {
    val prompt = DutyPrompt("$session:$kind:$slot", kind, start + slot*interval)
    store.recordOnce("duty_due", prompt.id, JSONObject().put("session",session).put("kind",kind).put("due_elapsed",prompt.due))
    result.add(prompt)
   }
  }
  return result
 }
 fun requestCheckIn(session: String, now: Long = SystemClock.elapsedRealtime()): DutyPrompt {
  val existing = pending(session, now).firstOrNull { it.kind == "check_in" }
  if (existing != null) return existing
  val p = DutyPrompt("$session:check_in:manual:$now", "check_in", now)
  store.recordOnce("duty_due", p.id, JSONObject().put("session",session).put("kind",p.kind).put("due_elapsed",now))
  return p
 }
 fun pending(session: String, now: Long = SystemClock.elapsedRealtime()): List<DutyPrompt> {
  due(session, now)
  val complete = store.eventsOf("duty_completed").map { it.getString("event_key") }.toSet()
  val prompts = store.eventsOf("duty_due").filter { it.optString("session") == session }
   .map { DutyPrompt(it.getString("event_key"),it.getString("kind"),it.getLong("due_elapsed")) }
  prompts.filter { it.id !in complete && it.stage(now) == "missed" }.forEach {
   store.recordOnce("duty_missed", it.id, JSONObject().put("kind",it.kind).put("due_elapsed",it.due)
    .put("missed_at_elapsed",it.due+600_000).put("detected_at",System.currentTimeMillis())
    .put("delivery","local_pending_no_dispatch_transport"))
  }
  return prompts.filter { it.id !in complete && it.stage(now) != "missed" }.sortedBy { it.due }
 }
 fun complete(p: DutyPrompt, now: Long = SystemClock.elapsedRealtime()): Boolean {
  val saved = store.eventsOf("duty_due").firstOrNull { it.optString("event_key") == p.id } ?: return false
  if (saved.optString("kind") != p.kind || saved.optLong("due_elapsed",-1) != p.due ||
      p.kind !in setOf("readiness","check_in") || p.stage(now) in setOf("scheduled","missed") ||
      has("duty_missed",p.id) || !has("duty_biometric",p.id)) return false
  if (p.kind == "check_in" && (!has("duty_gps",p.id) || !has("duty_photo",p.id))) return false
  return store.recordOnce("duty_completed",p.id,JSONObject().put("kind",p.kind).put("completed_at",System.currentTimeMillis()))
 }
 fun has(kind: String, id: String) = store.eventsOf(kind).any { it.optString("event_key") == id }
 fun missed() = store.eventsOf("duty_missed").filter { !has("duty_miss_reason",it.getString("event_key")) }
}
