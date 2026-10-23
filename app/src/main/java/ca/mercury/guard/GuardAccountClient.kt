package ca.mercury.guard

import android.os.SystemClock
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** Explicit configured service only. No credentials, tokens or refresh tokens are persisted. */
class GuardAccountClient(endpoint: String) {
 private val origin = endpoint.trimEnd('/')
 init {
  val uri = URI(endpoint)
  require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null)
  require(uri.path.isNullOrEmpty() || uri.path == "/")
 }
 class Session internal constructor(private var token: String?, private val expiresElapsed: Long) {
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
 fun profile(session: Session): JSONObject = request("/v1/me",null,session)
 fun assignments(session: Session, deviceId: String, identity: DeviceIdentity, expectedAudience: String): JSONObject {
  val proof = proof(session,deviceId,identity,expectedAudience)
  return request("/v1/assignments",proof,session)
 }
 fun grant(session: Session, deviceId: String, assignmentId: String, identity: DeviceIdentity, expectedAudience: String): JSONObject =
  request("/v1/shift-grant",JSONObject().put("assignment_id",assignmentId).put("proof",proof(session,deviceId,identity,expectedAudience)),session)
 private fun proof(session: Session, deviceId: String, identity: DeviceIdentity, expectedAudience: String): JSONObject {
  require(deviceId.matches(Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}")))
  val response = request("/v1/device-challenge",JSONObject().put("device_id",deviceId),session)
  require(response.get("audience") == expectedAudience)
  return identity.signEnrollmentChallenge(expectedAudience,response.getString("request_id"),response.getString("challenge"))
 }
 private fun request(path: String, body: JSONObject?, session: Session? = null): JSONObject {
  val connection = URL(origin+path).openConnection() as HttpURLConnection
  try {
   connection.requestMethod = if(body == null) "GET" else "POST"
   connection.instanceFollowRedirects = false; connection.connectTimeout = 10000; connection.readTimeout = 10000
   session?.let { connection.setRequestProperty("Authorization", "Bearer ${it.bearer()}") }
   if(body != null) {
    val bytes = body.toString().toByteArray(Charsets.UTF_8); require(bytes.size <= 4096)
    connection.doOutput = true; connection.setRequestProperty("Content-Type","application/json"); connection.setFixedLengthStreamingMode(bytes.size)
    connection.outputStream.use { it.write(bytes) }
   }
   check(connection.responseCode == 200) { "Request unavailable (HTTP ${connection.responseCode})" }
   val raw = connection.inputStream.use { input ->
    val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(4096)
    while(true) { val count = input.read(buffer); if(count < 0) break; check(out.size()+count <= 262144); out.write(buffer,0,count) }
    out.toString("UTF-8")
   }
   return JSONObject(raw)
  } finally { connection.disconnect() }
 }
 private fun integer(value: JSONObject, name: String): Long {
  val n=value.get(name); require(n is Int || n is Long); return (n as Number).toLong()
 }
}
