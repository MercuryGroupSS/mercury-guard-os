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

/** Inline secure-host view. Owner/session checks precede every response, render and navigation. */
internal class ConnectedPrivatePanel(context:Context,stillAuthorized:()->Boolean,onUnavailable:()->Unit):LinearLayout(context),java.io.Closeable {
 private var authorized:(()->Boolean)?=stillAuthorized
 private var unavailable:(()->Unit)?=onUnavailable
 private val handler=Handler(Looper.getMainLooper())
 private val fence=ConnectedReadFence()
 private var closed=false
 private val checkExpiry=object:Runnable{override fun run(){if(isAttachedToWindow&&permit())handler.postDelayed(this,500)}}
 init{orientation=VERTICAL;isSaveEnabled=false}
 private fun permit():Boolean {
  if(closed)return false
  if(try{authorized?.invoke()==true}catch(_:Exception){false})return true
  val callback=unavailable;close();callback?.invoke();return false
 }
 private fun scrub(v:View){v.setOnClickListener(null);if(v is TextView)v.text="";if(v is ViewGroup)for(i in 0 until v.childCount)scrub(v.getChildAt(i))}
 private fun reset(){for(i in 0 until childCount)scrub(getChildAt(i));removeAllViews()}
 fun begin(message:String):Long? {if(!permit())return null;val ticket=fence.begin();reset();text(message);return ticket}
 fun render(ticket:Long,show:ConnectedPrivatePanel.()->Unit):Boolean {
  if(!fence.accepts(ticket)||!isAttachedToWindow||!permit())return false
  reset();show();return true
 }
 fun text(value:String){if(!permit())return;addView(TextView(context).apply{text=value;textSize=16f;setTextColor(Color.rgb(25,42,54));setPadding(0,12,0,12);isSaveEnabled=false;setTextIsSelectable(true)})}
 fun action(value:String,run:()->Unit){if(!permit())return;addView(Button(context).apply{text=value;isAllCaps=false;isSaveEnabled=false;setOnClickListener{if(permit())run()}})}
 override fun onAttachedToWindow(){super.onAttachedToWindow();handler.post(checkExpiry)}
 override fun onDetachedFromWindow(){close();super.onDetachedFromWindow()}
 override fun close(){if(closed)return;closed=true;fence.close();handler.removeCallbacks(checkExpiry);authorized=null;unavailable=null;reset()}
}
