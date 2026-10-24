package ca.mercury.guard

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Opaque-slot, generic attention only. Private details and completion require fresh sign-in. */
class ConnectedCheckInAlertActivity:Activity(){
 private lateinit var reminders:AuthorizedReminders
 private var token:String?=null
 private var automatic=false
 private var generation=0
 private var resumed=false
 private var card:ConnectedCheckInAttentionView?=null
 private var content:LinearLayout?=null
 private var feedback:TextView?=null
 private var silence:Button?=null
 private val handler=Handler(Looper.getMainLooper())
 private val tick=object:Runnable{override fun run(){
  if(!resumed||isFinishing||isDestroyed)return
  val value=token?:return
  val snapshot=reminders.genericSnapshot(value)
  if(snapshot==null||(automatic&&!reminders.fullScreenAllowed(value))){clearAndFinish();return}
  card?.present(snapshot.stage,snapshot.token,snapshot.pulse,snapshot.silenced,snapshot.budgetExhausted,steady())
  silence?.isEnabled=!snapshot.silenced
  handler.postDelayed(this,snapshot.nextRefreshInMillis.coerceIn(50,1000))
 }}
 private fun steady()=getSharedPreferences("mercury_connected_attention_ui",MODE_PRIVATE).getBoolean("steady_colors",false)
 override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);window.addFlags(WindowManager.LayoutParams.FLAG_SECURE);reminders=AuthorizedReminders(this);open(intent)}
 override fun onNewIntent(incoming:Intent){super.onNewIntent(incoming);setIntent(incoming);open(incoming)}
 private fun open(incoming:Intent){
  clearContent()
  val value=incoming.getStringExtra(AuthorizedReminders.EXTRA_TOKEN)
  if(value==null||reminders.genericSnapshot(value)==null){clearAndFinish();return}
  // Token validity is checked before locking any existing account screen.
  ConnectedAttentionAccountLock.lockAll()
  automatic=incoming.getBooleanExtra(AuthorizedReminders.EXTRA_FULL_SCREEN,false)
  if(automatic&&!reminders.fullScreenAllowed(value)){clearAndFinish();return}
  token=value;setShowWhenLocked(true);setTurnScreenOn(automatic)
  val background=Color.rgb(244,248,250)
  val inner=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(24,32,24,24);setBackgroundColor(background)}
  content=inner;val stamp=generation
  card=ConnectedCheckInAttentionView(this).also{inner.addView(it)}
  feedback=TextView(this).apply{text="This screen contains no account or site details. Unlock your phone and sign in to complete a check.";textSize=16f;setTextColor(Color.rgb(25,42,54));setPadding(0,20,0,20);isSaveEnabled=false}.also{inner.addView(it)}
  fun action(label:String,run:()->Unit)=Button(this).apply{text=label;isAllCaps=false;isSaveEnabled=false;setOnClickListener{if(resumed&&generation==stamp&&token==value&&content===inner&&!isFinishing&&!isDestroyed)run()}}.also{inner.addView(it)}
  action("Open Mercury One"){
   if(reminders.genericSnapshot(value)==null){clearAndFinish();return@action}
   val locked=try{val keyguard=getSystemService(KEYGUARD_SERVICE) as KeyguardManager;keyguard.isKeyguardLocked||keyguard.isDeviceLocked}catch(_:RuntimeException){true}
   if(locked){feedback?.text="Unlock your phone first, then open Mercury One and sign in.";return@action}
   startActivity(Intent(this,GuardAccountActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP))
   finish()
  }
  silence=action("Silence this check"){
   if(reminders.silenceToken(value))feedback?.text="Silenced on this phone. The check has not been completed."
   else feedback?.text="This reminder changed or ended. No check was completed."
   handler.removeCallbacks(tick);tick.run()
  }
  action("Use steady colors"){
   check(getSharedPreferences("mercury_connected_attention_ui",MODE_PRIVATE).edit().putBoolean("steady_colors",true).commit())
   card?.stopMotion();handler.removeCallbacks(tick);tick.run()
  }
  val scroll=ScrollView(this).apply{isFillViewport=true;addView(inner)}
  val viewport=FrameLayout(this).apply{setBackgroundColor(background);addView(scroll,FrameLayout.LayoutParams(-1,-1))}
  setContentView(viewport)
  viewport.setOnApplyWindowInsetsListener{v,i->v.setPadding(i.systemWindowInsetLeft,i.systemWindowInsetTop,i.systemWindowInsetRight,i.systemWindowInsetBottom);i};viewport.requestApplyInsets()
  handler.post(tick)
 }
 private fun scrub(view:View){view.setOnClickListener(null);if(view is TextView)view.text="";if(view is ViewGroup)for(i in 0 until view.childCount)scrub(view.getChildAt(i))}
 private fun clearContent(){generation++;handler.removeCallbacks(tick);card?.close();card=null;content?.let{scrub(it);it.removeAllViews()};silence=null;feedback=null;content=null;token=null}
 private fun clearAndFinish(){clearContent();finish()}
 override fun onResume(){super.onResume();resumed=true;handler.removeCallbacks(tick);if(token!=null)handler.post(tick)}
 override fun onPause(){resumed=false;handler.removeCallbacks(tick);card?.stopMotion();super.onPause()}
 override fun onDestroy(){clearContent();super.onDestroy()}
}
