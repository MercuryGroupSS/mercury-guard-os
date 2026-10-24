package ca.mercury.guard

/** Observations only: none of these values grants capture, schedules a check or proves presence. */
internal object ConnectedReadiness {
 enum class Access { AVAILABLE, BLOCKED, UNAVAILABLE }
 enum class Channel { AVAILABLE, BLOCKED, NOT_CREATED, UNAVAILABLE }
 enum class Consent { NO_POLICY, NONE, PENDING, ACCEPTED, WITHDRAWAL_PENDING, WITHDRAWN, UNAVAILABLE }
 data class Snapshot(
  val precise:Access,val gps:Access,val notifications:Access,val reminders:Channel,
  val collection:Channel,val exactAlarms:Access,val consent:Consent,val collecting:Boolean?
 ) {
  fun lines():List<String> = listOf(
   "Precise location permission: ${access(precise)}",
   "Device GPS provider: ${access(gps)}",
   "App notifications: ${access(notifications)}",
   "Connected check-in notification channel: ${channel(reminders)}",
   "Connected location notification channel: ${channel(collection)}",
   "Exact alarm access: ${access(exactAlarms)} · observed only; no reminder is enabled here",
   "This assignment's approved location consent: "+when(consent){
    Consent.NO_POLICY->"no approved policy; connected collection is unavailable"
    Consent.NONE->"no retained consent for this exact policy"
    Consent.PENDING->"original consent retained; service receipt pending"
    Consent.ACCEPTED->"service accepted this consent; sharing still needs current shift permission"
    Consent.WITHDRAWAL_PENDING->"withdrawn on this phone; service confirmation pending"
    Consent.WITHDRAWN->"withdrawal confirmed by service"
    Consent.UNAVAILABLE->"could not be read; no consent state is assumed"
   },
   "Collection for this consent: "+when(collecting){true->"sharing session open on this phone; fresh location and permission to continue are checked separately";false->"no sharing session observed on this phone";null->"not verified"},
   "Fresh location: not checked here. Location permission, GPS availability and a sharing session do not prove a fresh fix or physical presence."
  )
 }
 private fun access(a:Access)=when(a){Access.AVAILABLE->"available";Access.BLOCKED->"not granted or disabled";Access.UNAVAILABLE->"unavailable to inspect"}
 private fun channel(c:Channel)=when(c){Channel.AVAILABLE->"available";Channel.BLOCKED->"blocked";Channel.NOT_CREATED->"not created on this phone";Channel.UNAVAILABLE->"unavailable to inspect"}
}

/** A view replacement, refresh or close permanently fences results started in an earlier view. */
internal class ConnectedReadFence {
 private var revision=0L
 private var closed=false
 fun begin():Long {check(!closed);return ++revision}
 fun accepts(ticket:Long)=!closed&&ticket==revision
 fun close(){closed=true;revision++}
}
