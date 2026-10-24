package ca.mercury.guard

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView

/** Generic presentation only. This view cannot silence, acknowledge or complete a check. */
internal class ConnectedCheckInAttentionView(context:Context,
 private val animationsEnabled:()->Boolean={ValueAnimator.areAnimatorsEnabled()}):LinearLayout(context),java.io.Closeable {
 companion object {const val PULSE_MILLIS=4000L}
 private val ink=Color.rgb(25,42,54)
 private val white=Color.rgb(250,252,253)
 private val heading=TextView(context).apply{textSize=28f;setTextColor(ink);isAccessibilityHeading=true;isSaveEnabled=false}
 private val description=TextView(context).apply{textSize=17f;setTextColor(ink);isSaveEnabled=false}
 private val explanation=TextView(context).apply{textSize=15f;setTextColor(ink);accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE;isSaveEnabled=false}
 private var pulse:ValueAnimator?=null
 private var pendingPulse=false
 private var lastToken:String?=null
 private var lastStage:CheckInAttentionTiming.Stage?=null
 private var requestedPulse=false
 private var accent=Color.rgb(0,104,125)
 private var closed=false
 internal val isPulsing:Boolean get()=pulse?.isStarted==true
 init{
  orientation=VERTICAL;isSaveEnabled=false
  val pad=(20*resources.displayMetrics.density).toInt();setPadding(pad,pad,pad,pad)
  addView(TextView(context).apply{text="MERCURY ONE";textSize=13f;letterSpacing=0.12f;setTextColor(Color.rgb(0,104,125));isSaveEnabled=false})
  for(label in listOf(heading,description,explanation)){label.setPadding(0,pad/2,0,pad/2);addView(label)}
  paint(white)
 }
 fun present(stage:CheckInAttentionTiming.Stage,token:String?,shouldPulse:Boolean,silenced:Boolean,budgetExhausted:Boolean,steady:Boolean){
  if(closed)return
  accent=when(stage){CheckInAttentionTiming.Stage.GREEN,CheckInAttentionTiming.Stage.COMPLETE->Color.rgb(0,121,83);CheckInAttentionTiming.Stage.YELLOW->Color.rgb(170,111,0);CheckInAttentionTiming.Stage.RED,CheckInAttentionTiming.Stage.CLOSED->Color.rgb(163,48,66);else->Color.rgb(0,104,125)}
  heading.text=when(stage){
   CheckInAttentionTiming.Stage.WAITING->"Check-in scheduled"
   CheckInAttentionTiming.Stage.GREEN->"Check-in due"
   CheckInAttentionTiming.Stage.YELLOW->"Check-in still due"
   CheckInAttentionTiming.Stage.RED->"Check-in needs attention"
   CheckInAttentionTiming.Stage.COMPLETE->"Check-in saved on this phone"
   CheckInAttentionTiming.Stage.CLOSED->"Check-in window closed"
   CheckInAttentionTiming.Stage.ENDED->"Scheduled reminders ended"
  }
  description.text=when(stage){
   CheckInAttentionTiming.Stage.COMPLETE->"Delivery is separate. Review the service receipt before treating it as received."
   CheckInAttentionTiming.Stage.CLOSED->"A reason adds context and keeps the original deadline. It does not replace the check."
   CheckInAttentionTiming.Stage.ENDED->"Review your assignment for current instructions."
   CheckInAttentionTiming.Stage.WAITING->"Follow the assigned schedule. Opening this screen does not complete a check."
   else->"Sign in and complete the required verification. Opening or silencing this reminder does not complete it."
  }
  explanation.text=when{
   stage==CheckInAttentionTiming.Stage.COMPLETE->"Saved locally; service delivery remains separate."
   stage==CheckInAttentionTiming.Stage.ENDED->"No further attention cue is scheduled."
   silenced->"Silenced for this check on this phone. The check is still incomplete."
   budgetExhausted&&stage !in setOf(CheckInAttentionTiming.Stage.COMPLETE,CheckInAttentionTiming.Stage.ENDED)->"Attention cues have ended for this window. Completion and delivery remain separate."
   steady||!animationsEnabled()->"Steady colors."
   else->"Calm attention."
  }
  val active=stage in setOf(CheckInAttentionTiming.Stage.GREEN,CheckInAttentionTiming.Stage.YELLOW,CheckInAttentionTiming.Stage.RED)
  val wanted=shouldPulse&&active&&!silenced&&!budgetExhausted&&!steady&&animationsEnabled()
  val newCue=wanted&&(!requestedPulse||lastToken!=token||lastStage!=stage)
  lastToken=token;lastStage=stage;requestedPulse=wanted
  if(!wanted){stopPulse();paint(white)}else if(newCue){stopPulse();if(isAttachedToWindow)startPulse()else pendingPulse=true}
  if(pulse==null)paint(white)
 }
 private fun paint(color:Int){background=GradientDrawable().apply{setColor(color);cornerRadius=20*resources.displayMetrics.density;setStroke((2*resources.displayMetrics.density).toInt().coerceAtLeast(1),accent)}}
 private fun startPulse(){
  if(closed||!requestedPulse||!animationsEnabled())return
  pendingPulse=false
  val tint=Color.rgb((Color.red(accent)+7*Color.red(white))/8,(Color.green(accent)+7*Color.green(white))/8,(Color.blue(accent)+7*Color.blue(white))/8)
  pulse=ValueAnimator.ofArgb(white,tint,white).apply{duration=PULSE_MILLIS;repeatCount=0;addUpdateListener{paint(it.animatedValue as Int)};start()}
 }
 private fun stopPulse(){pendingPulse=false;pulse?.cancel();pulse=null}
 fun stopMotion(){stopPulse();requestedPulse=false;paint(white)}
 fun unavailable(){if(closed)return;accent=Color.rgb(0,104,125);stopMotion();lastToken=null;lastStage=null;heading.text="Reminders off or unavailable";description.text="Enable reminders for this assignment, or refresh your authorization and phone settings.";explanation.text="No check has been completed by this screen."}
 override fun onAttachedToWindow(){super.onAttachedToWindow();if(pendingPulse&&!closed)startPulse()}
 override fun onDetachedFromWindow(){close();super.onDetachedFromWindow()}
 override fun close(){if(closed)return;closed=true;stopPulse();lastToken=null;for(i in 0 until childCount)(getChildAt(i) as? TextView)?.text="";accent=Color.rgb(0,104,125);paint(white)}
}
