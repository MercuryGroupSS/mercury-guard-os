package ca.mercury.guard

import android.app.*
import android.os.*
import android.content.Intent
import android.graphics.Color
import android.view.*
import android.widget.*
import android.animation.ValueAnimator

/** User-opened or explicitly consented OS full-screen notification. Keyguard remains intact. */
class DutyAlertActivity : Activity() {
 private lateinit var store: GuardStore
 private val handler=Handler(Looper.getMainLooper())
 private var pulse: ValueAnimator?=null
 private var stage: String?=null
 private lateinit var panel: LinearLayout
 private lateinit var title: TextView
 private val tick=object: Runnable { override fun run() {
  val session=DemoSession(this@DutyAlertActivity)
  val p=if(session.active()) DutyPrompts(store).pending(session.identity()).firstOrNull { it.id==intent.getStringExtra("duty_id") } else null
  if(p==null || DutyAlertDelivery(this@DutyAlertActivity,store).silenced(p) || (intent.getBooleanExtra("full_screen",false) && (!FullScreenAlerts(this@DutyAlertActivity).consented() || !FullScreenAlerts(this@DutyAlertActivity).osAllowed()))) { finish(); return }
  val next=p.stage()
  title.text="${next.uppercase()} · verification due"
  if(stage!=next || pulse?.isRunning!=true) {
   stage=next; pulse?.cancel(); val color=DutyAlertPolicy.color(next); panel.setBackgroundColor(color)
   if(ValueAnimator.areAnimatorsEnabled() && !getSharedPreferences("mercury_local",0).getBoolean("steady_alert",false)) {
    pulse=ValueAnimator.ofArgb(color,Color.WHITE).apply { duration=2000; repeatMode=ValueAnimator.REVERSE; repeatCount=ValueAnimator.INFINITE; addUpdateListener { panel.setBackgroundColor(it.animatedValue as Int) }; start() }
   }
  }
  handler.postDelayed(this,1000)
 } }
 override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState); store=GuardStore(this)
  setShowWhenLocked(true)
  val session=DemoSession(this)
  val prompt=if(session.active()) DutyPrompts(store).pending(session.identity()).firstOrNull{it.id==intent.getStringExtra("duty_id")} else null
  val automatic=intent.getBooleanExtra("full_screen",false)
  if(prompt==null || DutyAlertDelivery(this,store).silenced(prompt) || (automatic && (!FullScreenAlerts(this).consented() || !FullScreenAlerts(this).osAllowed()))) { finish(); return }
  setTurnScreenOn(automatic) // OS notification launch only; never dismisses keyguard.
  if(automatic) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

  panel=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; gravity=Gravity.CENTER; setPadding(40,40,40,40) }
  fun label(text:String,size:Float)=TextView(this).apply { this.text=text; textSize=size; setTextColor(Color.rgb(25,42,54)); setPadding(0,20,0,20) }
  panel.addView(label("Mercury One",22f)); title=label("Verification due",30f);panel.addView(title)
  panel.addView(label("Timed local demo. Unlock to verify. Silencing stops attention cues but does not complete the check.",18f))
  panel.addView(Button(this).apply { text="Unlock and open Mercury One"; setOnClickListener {
   val keyguard=getSystemService(KEYGUARD_SERVICE) as KeyguardManager
   fun open() { startActivity(Intent(this@DutyAlertActivity,MainActivity::class.java)); finish() }
   if(keyguard.isKeyguardLocked) keyguard.requestDismissKeyguard(this@DutyAlertActivity,object:KeyguardManager.KeyguardDismissCallback(){ override fun onDismissSucceeded(){open()} }) else open()
  } })
  panel.addView(Button(this).apply { text="Silence this alert"; setOnClickListener {
   val session=DemoSession(this@DutyAlertActivity)
   if(session.active()) DutyPrompts(store).pending(session.identity()).firstOrNull{it.id==intent.getStringExtra("duty_id")}?.let { DutyAlertDelivery(this@DutyAlertActivity,store).silence(it) }
   finish()
  } })
  panel.addView(Button(this).apply { text="Use steady color"; setOnClickListener { getSharedPreferences("mercury_local",0).edit().putBoolean("steady_alert",true).commit(); pulse?.cancel(); stage=null } })
  setContentView(ScrollView(this).apply { isFillViewport=true; addView(panel) })
 }
 override fun onResume(){super.onResume();handler.post(tick)}
 override fun onPause(){handler.removeCallbacksAndMessages(null);pulse?.cancel();super.onPause()}
 override fun onDestroy(){handler.removeCallbacksAndMessages(null);pulse?.cancel();store.close();super.onDestroy()}
}
