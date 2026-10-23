package ca.mercury.guard

import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** One guard's short-lived upload bearer. Never contains a password or refresh token. */
class UploadAuthority internal constructor(val generation:String,val guardId:String,val vendorId:String,val subject:String,
 val configuration:String,val thumbprint:String,private val token:String,val issuedElapsed:Long,
 val expiresElapsed:Long,val boot:Int,val workVersion:Long){
 internal fun session()=GuardAccountClient.Session(token,expiresElapsed)
 override fun toString()="UploadAuthority(redacted)"
 internal fun json()=JSONObject().put("generation",generation).put("guard",guardId).put("vendor",vendorId).put("subject",subject)
  .put("configuration",configuration).put("thumbprint",thumbprint).put("token",token).put("issued",issuedElapsed)
  .put("expires",expiresElapsed).put("boot",boot).put("work",workVersion)
}

class UploadAuthorityStore internal constructor(private val context:Context,name:String="upload-authority-v1",
 private val elapsed:()->Long={SystemClock.elapsedRealtime()},
 private val boot:()->Int={Settings.Global.getInt(context.contentResolver,Settings.Global.BOOT_COUNT,-1)}){
 init{require(name.matches(Regex("[A-Za-z0-9-]{1,100}")))}
 private val file=AtomicFile(File(context.noBackupFilesDir,name))
 private val purpose="mercury-upload-authority:$name"
 private val cipher=DeviceCipher()
 companion object { private val lock=Any() }
 private fun read():UploadAuthority? {
  val raw=try{file.openRead().use{check(it.available()<=65536);it.readBytes()}}catch(_:java.io.FileNotFoundException){return null}
  val j=JSONObject(String(cipher.decrypt(String(raw,Charsets.UTF_8),purpose),Charsets.UTF_8))
  require(j.keys().asSequence().toSet()==setOf("generation","guard","vendor","subject","configuration","thumbprint","token","issued","expires","boot","work"))
  val g=j.getString("generation");require(UUID.fromString(g).toString()==g)
  val token=j.getString("token");require(token.length in 1..16384&&token.none{it.isWhitespace()})
  for(k in listOf("guard","vendor"))require(j.getString(k).matches(Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}")))
  for(k in listOf("configuration","thumbprint"))require(j.getString(k).matches(Regex("[a-f0-9]{64}")))
  require(EscalationRules.uuid(j.getString("subject")))
  require(j.getLong("work")>=0)
  return UploadAuthority(g,j.getString("guard"),j.getString("vendor"),j.getString("subject"),j.getString("configuration"),j.getString("thumbprint"),token,j.getLong("issued"),j.getLong("expires"),j.getInt("boot"),j.getLong("work"))
 }
 private fun write(value:UploadAuthority){val out=file.startWrite();try{out.write(cipher.encrypt(value.json().toString().toByteArray(Charsets.UTF_8),purpose).toByteArray(Charsets.UTF_8));file.finishWrite(out)}catch(e:Exception){file.failWrite(out);throw e}}
 internal fun authorize(config:GuardServiceConfig,session:GuardAccountClient.Session,guardId:String,vendorId:String,subject:String,thumbprint:String):UploadAuthority=synchronized(lock){
  val now=elapsed();val version=boot();val token=session.bearer();val expires=session.expiresElapsed
  require(guardId.matches(Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}"))&&vendorId.matches(Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}")))
  require(EscalationRules.uuid(subject)&&thumbprint.matches(Regex("[a-f0-9]{64}"))&&UploadPolicy.valid(now,expires,version,now,version))
  val value=UploadAuthority(UUID.randomUUID().toString(),guardId,vendorId,subject,config.uploadBinding(),thumbprint,token,now,expires,version,0)
  write(value);value
 }
 internal fun load(config:GuardServiceConfig,thumbprint:String):UploadAuthority?=synchronized(lock){
  try{val v=read()?:return@synchronized null
   if(v.configuration!=config.uploadBinding()||v.thumbprint!=thumbprint||!UploadPolicy.valid(v.issuedElapsed,v.expiresElapsed,v.boot,elapsed(),boot())){file.delete();null}else v
  }catch(_:Exception){file.delete();null}
 }
 internal fun current(value:UploadAuthority,config:GuardServiceConfig):Boolean=load(config,value.thumbprint)?.generation==value.generation
 internal fun touch(config:GuardServiceConfig,thumbprint:String):UploadAuthority?=synchronized(lock){
  val v=load(config,thumbprint)?:return@synchronized null
  val next=UploadAuthority(v.generation,v.guardId,v.vendorId,v.subject,v.configuration,v.thumbprint,v.session().bearer(),v.issuedElapsed,v.expiresElapsed,v.boot,Math.addExact(v.workVersion,1));write(next);next
 }
 internal fun clear(generation:String?=null)=synchronized(lock){if(generation==null||try{read()?.generation==generation}catch(_:Exception){true})file.delete()}
}
