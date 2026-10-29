package ca.mercury.guard

import android.os.SystemClock
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** Explicit configured service only. Personal credentials are returned only to the separate biometric store. */
class GuardAccountClient(endpoint: String,private val network:android.net.Network?=null,private val cancellation:UploadCancellation?=null) {
 companion object { private val possessionLock=java.util.concurrent.locks.ReentrantLock() }
 private val origin = endpoint.trimEnd('/')
 init {
  val uri = URI(endpoint)
  require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null)
  require(uri.path.isNullOrEmpty() || uri.path == "/")
 }
 class HttpFailure(val statusCode:Int):IllegalStateException("Request unavailable (HTTP $statusCode)")
 fun accountPageUrl():String = origin+"/account/"
 fun logout(session:Session){
  val result=request("/v1/session/logout",null,session,"POST")
  require(result.keys().asSequence().toSet()==setOf("status")&&result.get("status")=="signed_out")
 }
 class Session internal constructor(private var token: String?, internal val expiresElapsed: Long) {
  internal fun bearer(): String {
   check(SystemClock.elapsedRealtime() < expiresElapsed) { "Sign in again" }
   return token ?: error("Signed out")
  }
  fun clear() { token = null }
  override fun toString() = "GuardSession(redacted)"
 }
 fun login(guardId: String, password: CharArray): Session {
  require(guardId.matches(Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}")))
  require(password.size in 1..1024)
  val started = SystemClock.elapsedRealtime()
  val response = try { request("/v1/session/login", JSONObject().put("guard_id", guardId).put("password", String(password))) }
   finally { password.fill('\u0000') }
  return sessionResponse(response,started)
 }
 private fun sessionResponse(response:JSONObject,started:Long):Session {
  require(response.keys().asSequence().toSet() == setOf("access_token", "expires_at", "server_time_ms"))
  val token = response.get("access_token") as? String ?: error("Invalid session")
  require(token.isNotBlank() && token.length <= 16384 && token.none { it.isWhitespace() })
  val expiry = integer(response,"expires_at")
  val server = integer(response,"server_time_ms")
  val remaining = Math.subtractExact(Math.multiplyExact(expiry,1000L),server)
  require(server > 0 && remaining in 1..86400000L)
  // Anchor at request start so transport delay cannot extend the session.
  return Session(token,Math.addExact(started,remaining)).also { it.bearer() }
 }
 internal class PersonalResult(val session:Session,val credential:JSONObject){override fun toString()="PersonalResult(redacted)";fun clear(){session.clear();credential.remove("refresh_token")}}
 private fun personalResponse(response:JSONObject,started:Long,config:GuardServiceConfig,thumb:String):PersonalResult{
  require(response.keys().asSequence().toSet()==setOf("access_token","expires_at","server_time_ms","refresh_token","permit"))
  val credential=JSONObject().put("refresh_token",response.getString("refresh_token")).put("permit",response.getJSONObject("permit"))
  PersonalAccountProtocol.validate(credential,config,thumb)
  val session=sessionResponse(JSONObject().put("access_token",response.get("access_token")).put("expires_at",response.get("expires_at")).put("server_time_ms",response.get("server_time_ms")),started)
  return PersonalResult(session,credential)
 }
 internal fun personalLogin(guardId:String,password:CharArray,config:GuardServiceConfig,identity:DeviceIdentity):PersonalResult{
  require(guardId.matches(Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}"))&&password.size in 1..1024)
  val thumb=identity.publicIdentity()?.thumbprint?:error("Installation identity required");val at=System.currentTimeMillis();val id=java.util.UUID.randomUUID().toString()
  val message="mercury-personal-login-v1\n${config.audience}\n$guardId\n${config.deviceId}\n$at\n$id\n$thumb"
  val proof=JSONObject().put("issued_at_ms",at).put("request_id",id).put("thumbprint",thumb).put("signature_der",identity.signPersonalMessage(message))
  val started=SystemClock.elapsedRealtime()
  val r=try{request("/v1/session/personal/login",JSONObject().put("guard_id",guardId).put("password",String(password)).put("device_id",config.deviceId).put("proof",proof),maxRequestBytes=8192)}finally{password.fill('\u0000')}
  return personalResponse(r,started,config,thumb)
 }
 internal fun personalReturn(credential:JSONObject,config:GuardServiceConfig,identity:DeviceIdentity):PersonalResult=possession{
  val thumb=identity.publicIdentity()?.thumbprint?:error("Installation identity required");PersonalAccountProtocol.validate(credential,config,thumb)
  val permit=credential.getJSONObject("permit");val token=credential.getString("refresh_token")
  val c=request("/v1/session/personal/challenge",JSONObject().put("permit",permit),maxRequestBytes=8192)
  require(c.keys().asSequence().toSet()==setOf("audience","request_id","challenge","expires_at")&&c.getString("audience")==config.audience&&EscalationRules.uuid(c.getString("request_id"))&&c.getString("challenge").matches(Regex("[A-Za-z0-9_-]{43}")))
  fun hash(v:String)=java.security.MessageDigest.getInstance("SHA-256").digest(v.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
  // Canonical property insertion order matches the protocol permit's exact two-key wire representation.
  val canonicalPermit=JSONObject().put("payload",permit.getString("payload")).put("signature",permit.getString("signature"))
  val message="mercury-personal-refresh-v1\n${config.audience}\n${c.getString("request_id")}\n${c.getString("challenge")}\n$thumb\n${hash(permit.getString("payload")+"."+permit.getString("signature"))}\n${hash(token)}"
  val proof=JSONObject().put("request_id",c.getString("request_id")).put("challenge",c.getString("challenge")).put("signature_der",identity.signPersonalMessage(message))
  val started=SystemClock.elapsedRealtime()
  personalResponse(request("/v1/session/personal/refresh",JSONObject().put("permit",canonicalPermit).put("refresh_token",token).put("proof",proof),maxRequestBytes=32768),started,config,thumb)
 }
 fun profile(session: Session): JSONObject = request("/v1/me",null,session)
 fun assignments(session: Session, deviceId: String, identity: DeviceIdentity, expectedAudience: String): JSONObject = possession {
  val proof = proof(session,deviceId,identity,expectedAudience)
  request("/v1/assignments",proof,session)
 }
 fun grant(session: Session, deviceId: String, assignmentId: String, identity: DeviceIdentity, expectedAudience: String): JSONObject =
  possession{request("/v1/shift-grant",JSONObject().put("assignment_id",assignmentId).put("proof",proof(session,deviceId,identity,expectedAudience)),session)}
 fun dispatch(session:Session,deviceId:String,assignmentId:String,identity:DeviceIdentity,expectedAudience:String,cursor:String?):JSONObject =
  possession{request("/v1/dispatch",JSONObject().put("assignment_id",assignmentId).put("cursor",cursor?:JSONObject.NULL).put("proof",proof(session,deviceId,identity,expectedAudience)),session)}
 fun transition(session:Session,deviceId:String,assignmentId:String,identity:DeviceIdentity,expectedAudience:String,transition:JSONObject):JSONObject =
  possession{request("/v1/shift-transition",JSONObject().put("assignment_id",assignmentId).put("transition",transition).put("proof",proof(session,deviceId,identity,expectedAudience)),session)}
 fun createEscalation(session:Session,deviceId:String,identity:DeviceIdentity,expectedAudience:String,raw:String):JSONObject=possession{
  EscalationProtocol.parse(raw)
  val signed=escalationProof(session,deviceId,identity,expectedAudience,"create",EscalationProtocol.hash(raw))
  request("/v1/escalations",JSONObject().put("intent",EscalationProtocol.encode(raw)).put("proof",signed),session,maxRequestBytes=16384)
 }
 fun escalationStatus(session:Session,deviceId:String,identity:DeviceIdentity,expectedAudience:String,id:String):JSONObject=possession{
  val hash=EscalationProtocol.hash(EscalationProtocol.statusPayload(id))
  request("/v1/escalations/status",JSONObject().put("escalation_id",id).put("proof",escalationProof(session,deviceId,identity,expectedAudience,"status",hash)),session)
 }
 internal fun locationConsent(session:Session,deviceId:String,identity:DeviceIdentity,audience:String,raw:String):JSONObject=possession{
  require(raw.toByteArray(Charsets.UTF_8).size<=4096);val intent=JSONObject(raw);val operation=intent.getString("action");require(operation in setOf("consent","withdraw"))
  val id=if(operation=="withdraw")intent.getString("consent_id")else null
  val proof=locationConsentProof(session,deviceId,identity,audience,operation,EscalationProtocol.hash(raw),id)
  request("/v1/location-consents",JSONObject().put("intent",EscalationProtocol.encode(raw)).put("proof",proof),session,maxRequestBytes=8192)
 }
 internal fun locationConsentStatus(session:Session,deviceId:String,identity:DeviceIdentity,audience:String,id:String):JSONObject=possession{
  require(EscalationRules.uuid(id));val raw=JSONObject().put("consent_id",id).toString()
  request("/v1/location-consents/status",JSONObject().put("consent_id",id).put("proof",locationConsentProof(session,deviceId,identity,audience,"status",EscalationProtocol.hash(raw),id)),session)
 }
 private fun locationConsentProof(session:Session,deviceId:String,identity:DeviceIdentity,audience:String,operation:String,hash:String,id:String?):JSONObject{
  val response=request("/v1/location-consents/challenge",JSONObject().put("device_id",deviceId).put("consent_id",id?:JSONObject.NULL),session)
  require(response.get("audience")==audience)
  return identity.signLocationConsentChallenge(audience,operation,response.getString("request_id"),response.getString("challenge"),hash)
 }
 private fun <T> possession(action:()->T):T {
  // The backend keeps one outstanding nonce per account/device. Keep its request paired
  // with its proof while allowing a stopped job to leave a contended lock promptly.
  while(!possessionLock.tryLock(100,java.util.concurrent.TimeUnit.MILLISECONDS))cancellation?.check()
  try{cancellation?.check();return action()}finally{possessionLock.unlock()}
 }
 private fun escalationProof(session:Session,deviceId:String,identity:DeviceIdentity,audience:String,operation:String,hash:String):JSONObject {
  require(PatrolPlan.identifier(deviceId))
  val response=request("/v1/device-challenge",JSONObject().put("device_id",deviceId),session)
  require(response.get("audience")==audience)
  return identity.signEscalationChallenge(audience,operation,response.getString("request_id"),response.getString("challenge"),hash)
 }
 private fun proof(session: Session, deviceId: String, identity: DeviceIdentity, expectedAudience: String): JSONObject {
  require(deviceId.matches(Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}")))
  val response = request("/v1/device-challenge",JSONObject().put("device_id",deviceId),session)
  require(response.get("audience") == expectedAudience)
  return identity.signEnrollmentChallenge(expectedAudience,response.getString("request_id"),response.getString("challenge"))
 }
 private fun request(path: String, body: JSONObject?, session: Session? = null,method:String?=null,maxRequestBytes:Int=4096): JSONObject {
  cancellation?.check()
  val url=URL(origin+path)
  val connection = (network?.openConnection(url)?:url.openConnection()) as HttpURLConnection
  try {
   cancellation?.attach(connection);cancellation?.check()
   connection.requestMethod = method?:if(body == null) "GET" else "POST"
   connection.instanceFollowRedirects = false; connection.connectTimeout = 10000; connection.readTimeout = 10000
   session?.let { connection.setRequestProperty("Authorization", "Bearer ${it.bearer()}") }
   if(body != null) {
    val bytes = body.toString().toByteArray(Charsets.UTF_8); require(bytes.size <= maxRequestBytes)
    connection.doOutput = true; connection.setRequestProperty("Content-Type","application/json"); connection.setFixedLengthStreamingMode(bytes.size)
    cancellation?.check();connection.outputStream.use { cancellation?.check();it.write(bytes) }
   }
   val status=connection.responseCode;val rejectedTransition=status==409&&path=="/v1/shift-transition";if(status!=200&&!rejectedTransition)throw HttpFailure(status)
   val raw = (if(rejectedTransition)connection.errorStream?:error("Missing rejection receipt") else connection.inputStream).use { input ->
    val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(4096)
    while(true) { val count = input.read(buffer); if(count < 0) break; check(out.size()+count <= 262144); out.write(buffer,0,count) }
    out.toString("UTF-8")
   }
   return JSONObject(raw).also{if(rejectedTransition)require(it.optString("status")=="shift_rejected_local_only")}
  } finally { cancellation?.detach(connection);connection.disconnect() }
 }
 private fun integer(value: JSONObject, name: String): Long {
  val n=value.get(name); require(n is Int || n is Long); return (n as Number).toLong()
 }
}
