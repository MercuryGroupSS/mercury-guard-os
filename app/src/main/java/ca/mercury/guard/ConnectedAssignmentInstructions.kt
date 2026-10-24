package ca.mercury.guard

import org.json.JSONObject

/** Network-only read model. It has no disk cache, attendance mutation or acknowledgement action. */
internal class ConnectedAssignmentInstructions private constructor(
 val messages:List<Message>,val nextCursor:String,val hasMore:Boolean,val checkedAt:Long
) {
 class Message(val id:String,val version:Long,val title:String,val body:String,val issuedAt:Long,val dueAt:Long?){
  override fun toString()="AssignmentInstruction(redacted)"
 }
 override fun toString()="AssignmentInstructions(redacted)"
 companion object {
  private fun exact(j:JSONObject,vararg keys:String){require(j.keys().asSequence().toSet()==keys.toSet())}
  private fun number(j:JSONObject,key:String):Long {val value=j.get(key);require(value is Int||value is Long);return(value as Number).toLong().also{require(it in 1..9007199254740991L)}}
  fun parse(scope:DispatchScope,previousCursor:String?,page:JSONObject):ConnectedAssignmentInstructions {
   require(page.toString().toByteArray(Charsets.UTF_8).size<=262144)
   exact(page,"scope","changes","next_cursor","has_more","server_time_ms")
   val expected=scope.json();val received=page.getJSONObject("scope")
   require(received.keys().asSequence().toSet()==expected.keys().asSequence().toSet())
   for(key in expected.keys())if(key=="revocation_version"){
    val value=received.get(key);require(value is Int||value is Long);require((value as Number).toLong()==scope.binding.revocationVersion)
   }else require(received.get(key) is String&&received.get(key)==expected.get(key))
   val cursor=page.get("next_cursor") as? String?:error("Cursor required");require(EscalationRules.uuid(cursor))
   val more=page.get("has_more") as? Boolean?:error("Page state required");if(more)require(cursor!=previousCursor)
   val time=number(page,"server_time_ms");val changes=page.getJSONArray("changes");require(changes.length()<=25)
   val seen=mutableSetOf<String>();val messages=mutableListOf<Message>()
   for(i in 0 until changes.length()){
    val m=changes.getJSONObject(i);exact(m,"message_id","version","state","title","body","issued_at","due_at")
    val id=m.get("message_id") as? String?:error("Message ID required");require(PatrolPlan.identifier(id)&&seen.add(id))
    val version=number(m,"version");val issued=number(m,"issued_at")
    val title=m.get("title") as? String?:error("Title required");val body=m.get("body") as? String?:error("Body required")
    require(title.length<=200&&body.length<=8000)
    val state=m.get("state") as? String;require(state in setOf("active","retracted"))
    val due=if(m.isNull("due_at"))null else number(m,"due_at").also{require(it>=issued)}
    if(state=="active"){require(title.isNotBlank()&&body.isNotBlank());messages.add(Message(id,version,title,body,issued,due))}
    else require(title.isEmpty()&&body.isEmpty())
   }
   return ConnectedAssignmentInstructions(messages.toList(),cursor,more,time)
  }
 }
}
