package ca.mercury.guard

import org.json.JSONObject
import java.util.Base64

/** Explicit approved server bytes; protocol bounds never supply a sampling default. */
class AuthorizedLocationPolicy private constructor(val payload:String,val sha256:String,val revision:Long,val noticeRevision:Long,val notice:String,val noticeSha256:String,
 val interval:Long,val minDistance:Double,val maxAge:Long,val maxAccuracy:Double,val maxLease:Long,val geofence:JSONObject?) {
 companion object {
  internal fun integer(j:JSONObject,k:String,min:Long=1,max:Long=9007199254740991L):Long {val n=j.get(k);require(n is Int||n is Long);return (n as Number).toLong().also{require(it in min..max)}}
  internal fun number(j:JSONObject,k:String,min:Double,max:Double):Double {require(j.get(k) is Number);return j.getDouble(k).also{require(it.isFinite()&&it>=min&&it<=max)}}
  internal fun exact(j:JSONObject,vararg fields:String){require(j.keys().asSequence().toSet()==fields.toSet())}
  fun parse(payload:String,sha256:String):AuthorizedLocationPolicy {
   require(payload.length in 1..10000&&payload.matches(Regex("[A-Za-z0-9_-]+"))&&sha256.matches(Regex("[a-f0-9]{64}")))
   val bytes=Base64.getUrlDecoder().decode(payload);require(bytes.size<=7500&&Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)==payload)
   val raw=String(bytes,Charsets.UTF_8);require(raw.toByteArray(Charsets.UTF_8).contentEquals(bytes)&&EscalationProtocol.hash(raw)==sha256)
   val j=JSONObject(raw);exact(j,"version","revision","notice_revision","notice_text","notice_sha256","sample_interval_ms","min_distance_m","max_fix_age_ms","max_accuracy_m","max_capture_lease_ms","geofence")
   require(integer(j,"version")==1L)
   val notice=j.get("notice_text") as? String?:error("Approved notice required")
   require(notice.length in 1..2000&&notice.trim{it.isWhitespace()||it=='\uFEFF'}==notice&&notice.toByteArray(Charsets.UTF_8).size<=6000&&EscalationRules.description(notice)&&notice.none{it in '\u0000'..'\u0009'||it in '\u000B'..'\u001F'||it=='\u007F'})
   val noticeHash=j.get("notice_sha256") as? String?:error("Notice digest required");require(noticeHash==EscalationProtocol.hash(notice))
   val geometry=if(j.isNull("geofence"))null else j.getJSONObject("geofence").let{g->
    exact(g,"type","id","revision","latitude","longitude","radius_m");require(g.get("type")=="circle"&&PatrolPlan.identifier(g.get("id") as? String?:""));integer(g,"revision");number(g,"latitude",-90.0,90.0);number(g,"longitude",-180.0,180.0);number(g,"radius_m",Double.MIN_VALUE,100000.0);JSONObject(g.toString())
   }
   return AuthorizedLocationPolicy(payload,sha256,integer(j,"revision"),integer(j,"notice_revision"),notice,noticeHash,integer(j,"sample_interval_ms",1000,3600000),number(j,"min_distance_m",0.0,10000.0),integer(j,"max_fix_age_ms",1000,300000),number(j,"max_accuracy_m",Double.MIN_VALUE,1000.0),integer(j,"max_capture_lease_ms",1000,900000),geometry)
  }
 }
}
class AuthorizedLocationConsent(val id:String,val policy:AuthorizedLocationPolicy){
 init{require(EscalationRules.uuid(id))}
 companion object {fun parse(j:JSONObject):AuthorizedLocationConsent {AuthorizedLocationPolicy.exact(j,"consent_id","policy_sha256","policy_payload");return AuthorizedLocationConsent(j.getString("consent_id"),AuthorizedLocationPolicy.parse(j.getString("policy_payload"),j.getString("policy_sha256")))}}
}
