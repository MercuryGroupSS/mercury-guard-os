package ca.mercury.guard

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Packaged trust decides the entry flow. Intents cannot select demo or override trust. */
class LauncherActivity:Activity(){
 internal enum class Destination{DEMO,ACCOUNT,INVALID}
 companion object{
  internal fun destination(load:()->GuardServiceConfig?):Destination=try{if(load()==null)Destination.DEMO else Destination.ACCOUNT}catch(_:Exception){Destination.INVALID}
 }
 override fun onCreate(state:Bundle?){
  super.onCreate(state)
  when(destination{GuardServiceConfig.load(this)}){
   Destination.DEMO->{startActivity(Intent(this,MainActivity::class.java));finish()}
   Destination.ACCOUNT->{startActivity(Intent(this,GuardAccountActivity::class.java));finish()}
   Destination.INVALID->{
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    val content=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(32,64,32,32);setBackgroundColor(Color.rgb(244,248,250))}
    content.addView(TextView(this).apply{text="MERCURY ONE\nConnection setup unavailable";textSize=24f})
    content.addView(TextView(this).apply{text="The packaged service configuration could not be verified. Contact your administrator for a corrected build.";textSize=18f})
    content.addView(Button(this).apply{text="Close";setOnClickListener{finish()}});setContentView(content)
   }
  }
 }
}
