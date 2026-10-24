package ca.mercury.guard

import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.Executors
import java.util.concurrent.Future

/**
 * Inline read-only view for the secure account Activity, never an independently authorized Activity.
 * The host freshly verifies the profile/device/assignment before construction, supplies the exact
 * current-owner/session/generation predicate, and closes this view whenever its screen is replaced.
 * No credentials, Intent authority, wire changes or offline authorization cache are held here.
 */
internal class ConnectedIncidentHistoryView(
 context:Context,private val scope:ConnectedIncidentDraftScope,
 stillAuthorized:()->Boolean,onBack:()->Unit,onUnavailable:()->Unit,
 private val openStore:()->ScopedEventStore={ScopedEventStore(context)}
):LinearLayout(context),java.io.Closeable {
 private var authorized:(()->Boolean)?=stillAuthorized
 private var back:(()->Unit)?=onBack
 private var unavailable:(()->Unit)?=onUnavailable
 private val handler=Handler(Looper.getMainLooper())
 private val callbackToken=Any()
 private val worker=Executors.newSingleThreadExecutor()
 private var task:Future<*>?=null
 private var revision=0L
 private var closed=false
 private var attached=false
 private val expiryCheck=object:Runnable{
  override fun run(){if(!closed&&attached&&permit())handler.postDelayed(this,500)}
 }
 init{orientation=VERTICAL;isSaveEnabled=false;label("Recorded incidents stay encrypted on this phone. Service acceptance and dashboard delivery are separate.")}
 private fun permit():Boolean {
  if(closed)return false
  val okay=try{authorized?.invoke()==true}catch(_:Exception){false}
  if(!okay){val callback=unavailable;close();callback?.invoke()}
  return okay
 }
 private fun label(value:String,size:Float=16f):TextView=TextView(context).apply{
  text=value;textSize=size;setTextColor(Color.rgb(25,42,54));setPadding(0,12,0,12);isSaveEnabled=false
 }.also{addView(it)}
 private fun action(value:String,run:()->Unit)=Button(context).apply{
  text=value;isAllCaps=false;isSaveEnabled=false;setOnClickListener{if(permit())run()}
 }.also{addView(it)}
 private fun scrub(view:View){
  view.setOnClickListener(null)
  if(view is TextView)view.text=""
  if(view is ViewGroup)for(i in 0 until view.childCount)scrub(view.getChildAt(i))
 }
 private fun reset(){for(i in 0 until childCount)scrub(getChildAt(i));removeAllViews()}
 private fun header(){label("MY RECORDED INCIDENTS",22f);label("Read-only incidents for this verified account and assignment. Earlier records without complete original account ownership remain preserved and are not shown.")}
 private fun observed(at:Long)=DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT).format(Date(at))
 private fun <T> read(load:()->T,render:(T)->Unit){
  if(!permit())return
  task?.cancel(true);val expected=++revision;reset();header();label("Opening encrypted records…")
  task=worker.submit{
   var result:T?=null;var failed=false
   try{result=load()}catch(_:Exception){failed=true}
   handler.postAtTime({
    if(closed||!attached||expected!=revision||!permit())return@postAtTime
    reset();header()
    if(failed||result==null){label("Encrypted history is unavailable. Existing records and delivery queues are preserved.");action("Back to assignment"){back?.invoke()}}
    else render(result!!)
   },callbackToken,android.os.SystemClock.uptimeMillis())
  }
 }
 fun refresh(){if(attached&&!closed)page(null)}
 private fun page(before:Long?){
  read({openStore().use{it.incidentPage(scope,before)}}){result->
   if(result.items.isEmpty())label("No recorded incidents with complete original ownership are available in this assignment.")
   for(record in result.items)action("${observed(record.observedAt)}\n${record.receiptState.label}\nOpen incident ${record.eventId}"){detail(record.sequence,record.eventId,before)}
   result.nextBeforeSequence?.let{next->action("Older incidents"){page(next)}}
   if(before!=null)action("Newest incidents"){page(null)}
   action("Refresh incident receipts"){page(before)}
   action("Back to assignment"){back?.invoke()}
  }
 }
 private fun detail(sequence:Long,eventId:String,before:Long?){
  read({openStore().use{it.incidentDetail(scope,sequence,eventId)?:error("Original incident unavailable")}}){record->
   label(record.receiptState.label)
   label("Observed: ${observed(record.observedAt)}\nGuard: ${record.guardId}\nSite: ${record.siteId}\nAssignment: ${record.assignmentId}\nIncident: ${record.eventId}")
   label(record.description)
   record.receiptBatchId?.let{label("Service receipt batch: $it\nThis confirms service acceptance only. No dashboard delivery or operator response is established.")}
   action("Back to recorded incidents"){page(before)}
   action("Back to assignment"){back?.invoke()}
  }
 }
 override fun onAttachedToWindow(){super.onAttachedToWindow();attached=true;if(!closed){refresh();handler.post(expiryCheck)}}
 override fun onDetachedFromWindow(){attached=false;close();super.onDetachedFromWindow()}
 override fun close(){
  if(closed)return
  closed=true;revision++;task?.cancel(true);task=null;worker.shutdownNow()
  handler.removeCallbacks(expiryCheck);handler.removeCallbacksAndMessages(callbackToken)
  authorized=null;back=null;unavailable=null;reset()
 }
}
