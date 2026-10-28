package ca.mercury.guard

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.util.UUID

/** Real transport control flow with an in-memory connection; no network/device acceptance claim. */
class ConnectedTransportFenceTest {
 private class Connection(url:URL,val response:JSONObject,private val opening:()->Unit={},private val reading:()->Unit={}):HttpURLConnection(url){
  val written=ByteArrayOutputStream();var disconnected=false
  override fun connect(){}
  override fun usingProxy()=false
  override fun disconnect(){disconnected=true}
  override fun getOutputStream():ByteArrayOutputStream{opening();return written}
  override fun getResponseCode()=200
  override fun getInputStream():ByteArrayInputStream{reading();return ByteArrayInputStream(response.toString().toByteArray(Charsets.UTF_8))}
 }
 private fun denied(block:()->Unit){var rejected=false;try{block()}catch(_:IllegalStateException){rejected=true};assertTrue("Expected authority fence before disclosure",rejected)}
 private val batchId get()=UUID.randomUUID().toString()
 private fun response(id:String)=JSONObject().put("batch_id",id).put("event_ids",JSONArray().put("event")).put("status","accepted_local_only")
 private fun proof()=JSONObject().put("version",2).put("payload","synthetic-in-memory-proof")
 @Test fun revokedAuthorityBeforeConnectionOpensSendsNothing(){var opened=0
  val t=GuardTransport("https://example.invalid",beforeWrite={error("Original account ended")},connectionFactory={opened++;error("Must not open")})
  denied{t.sendPilotBatch("synthetic-bearer",proof(),batchId,setOf("event"))};assertEquals(0,opened)
 }
 @Test fun accountSwitchDuringOutputStreamAcquisitionWritesZeroBodyBytes(){var current=true;lateinit var c:Connection;val id=batchId
  val t=GuardTransport("https://example.invalid",beforeWrite={check(current)},connectionFactory={url->Connection(url,response(id),opening={current=false}).also{c=it}})
  denied{t.sendPilotBatch("synthetic-bearer",proof(),id,setOf("event"))};assertEquals(0,c.written.size());assertTrue(c.disconnected)
 }
 @Test fun localWithdrawalAfterSelectionIsCheckedAgainAtTheBodyBoundary(){
  var consent=true;var current=true;lateinit var c:Connection;val id=batchId
  val fence=ConnectedUploadFence({check(current)},{check(true)},{check(consent)})
  val t=GuardTransport("https://example.invalid",beforeWrite=fence,connectionFactory={url->Connection(url,response(id),opening={consent=false}).also{c=it}})
  denied{t.sendPilotBatch("synthetic-bearer",proof(),id,setOf("event"))};assertEquals(0,c.written.size());assertTrue(c.disconnected);assertTrue(current)
 }
 @Test fun photoStopsBetweenChunksAndNeverFinalizesAfterAuthorityChange(){photoFixture{identity,bytes,metadata,event->
  var current=true;val connections=mutableListOf<Connection>()
  val t=GuardTransport("https://example.invalid",beforeWrite={check(current)},connectionFactory={url->
   val index=url.path.substringAfterLast('/').toInt();val range=PhotoChunkPlan.range(bytes.size,index);val part=bytes.copyOfRange(range.first,range.last+1)
   Connection(url,chunkReceipt(event,metadata,index,part),reading={current=false}).also{connections.add(it)}
  })
  denied{t.sendPilotEvidence("synthetic-bearer",event,metadata,bytes,identity,"mercury-local")};assertEquals(1,connections.size);assertEquals(PhotoChunkPlan.CHUNK_BYTES,connections.single().written.size());assertTrue(connections.single().disconnected)
 }}
 @Test fun photoFinalizationRechecksAuthorityInsideItsOutputStreamBoundary(){photoFixture(single=true){identity,bytes,metadata,event->
  var current=true;val connections=mutableListOf<Connection>()
  val t=GuardTransport("https://example.invalid",beforeWrite={check(current)},connectionFactory={url->
   val final=url.path.endsWith("/finalize");val receipt=if(final)JSONObject().put("event_id",event).put("evidence_id",metadata.getString("evidence_id")).put("sha256",metadata.getString("sha256")).put("bytes",bytes.size).put("status","evidence_accepted_local_only")else chunkReceipt(event,metadata,0,bytes)
   Connection(url,receipt,opening={if(final)current=false}).also{connections.add(it)}
  })
  denied{t.sendPilotEvidence("synthetic-bearer",event,metadata,bytes,identity,"mercury-local")};assertEquals(2,connections.size);assertEquals(bytes.size,connections[0].written.size());assertEquals(0,connections[1].written.size());assertTrue(connections.all{it.disconnected})
 }}
 private fun chunkReceipt(event:String,m:JSONObject,index:Int,part:ByteArray)=JSONObject().put("event_id",event).put("evidence_id",m.getString("evidence_id")).put("sha256",m.getString("sha256")).put("bytes",m.getInt("bytes")).put("chunk_index",index).put("chunk_sha256",GuardTransport.photoHash(part)).put("chunk_bytes",part.size).put("status","evidence_chunk_retained")
 private fun photoFixture(single:Boolean=false,block:(DeviceIdentity,ByteArray,JSONObject,String)->Unit){
  val context=InstrumentationRegistry.getInstrumentation().targetContext;val id=UUID.randomUUID().toString();val alias="test.transport.fence.$id";val marker="transport-fence-$id";val identity=DeviceIdentity(context,alias,marker)
  try{identity.create();val bytes=ByteArray(if(single)7 else PhotoChunkPlan.CHUNK_BYTES+7){(it%251).toByte()};val m=JSONObject().put("evidence_id",UUID.randomUUID().toString()).put("sha256",GuardTransport.photoHash(bytes)).put("bytes",bytes.size);block(identity,bytes,m,UUID.randomUUID().toString())}
  finally{KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)};File(context.noBackupFilesDir,marker).delete();File(context.noBackupFilesDir,"$marker.bak").delete()}
 }
}
