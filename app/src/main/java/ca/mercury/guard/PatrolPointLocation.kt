package ca.mercury.guard

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings

/** One foreground point action, independent of continuous collection and its listener. */
internal class PatrolPointLocation(context:Context,private val port:Port=SdkPort(context),private val handler:Handler=Handler(Looper.getMainLooper()),private val nanos:()->Long={SystemClock.elapsedRealtimeNanos()},private val boot:()->Int={Settings.Global.getInt(context.contentResolver,Settings.Global.BOOT_COUNT,-1)}) {
 internal interface Port {
  fun ready():Boolean
  fun subscribe(listener:LocationListener)
  fun remove(listener:LocationListener)
 }
 private class SdkPort(private val context:Context):Port {
  private val manager=context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
  override fun ready()=context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED&&manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
  override fun subscribe(listener:LocationListener){
   if(context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED)throw SecurityException("Precise permission required")
   manager.requestLocationUpdates(LocationManager.GPS_PROVIDER,0L,0f,listener,Looper.getMainLooper())
  }
  override fun remove(listener:LocationListener){manager.removeUpdates(listener)}
 }
 private var listener:LocationListener?=null
 private var completion:((AuthorizedPatrolLocation?)->Unit)?=null
 private var timeout:Runnable?=null
 fun cancel(){completion=null;finish(null)}
 private fun finish(value:AuthorizedPatrolLocation?){
  val done=completion;completion=null
  val owned=listener;listener=null
  if(owned!=null)try{port.remove(owned)}catch(_:Exception){}
  timeout?.let{handler.removeCallbacks(it)};timeout=null
  done?.invoke(value)
 }
 fun request(grant:VerifiedShiftGrant,binding:GrantBinding,anchor:ServerTimeAnchor,stillAuthorized:()->Boolean,done:(AuthorizedPatrolLocation?)->Unit){
  cancel();completion=done
  val requested=nanos()
  fun allowed():Boolean=try{
   val elapsed=nanos()/1000000;val currentBoot=boot()
   stillAuthorized()&&port.ready()&&anchor.bootCount==currentBoot&&grant.location!=null&&grant.permits("patrol",binding,elapsed,currentBoot)&&grant.permits("location",binding,elapsed,currentBoot)
  }catch(_:Exception){false}
  if(!allowed()){finish(null);return}
  val owned=object:LocationListener{
   override fun onLocationChanged(location:Location){
    if(listener!==this||completion==null)return
    if(!allowed()){finish(null);return}
    val sample=AuthorizedPatrolLocation.fromLocation(location,grant,anchor,requested,nanos())?:return
    finish(sample)
   }
   override fun onProviderEnabled(provider:String){}
   override fun onProviderDisabled(provider:String){if(listener===this)finish(null)}
   @Deprecated("Android 9 callback") override fun onStatusChanged(provider:String?,status:Int,extras:Bundle?){}
  }
  listener=owned
  try{port.subscribe(owned)}catch(_:Exception){finish(null);return}
  if(listener!==owned)return
  val remaining=grant.expiresElapsed-nanos()/1000000
  if(remaining<=0){finish(null);return}
  val limit=Runnable{if(listener===owned)finish(null)};timeout=limit;handler.postDelayed(limit,minOf(20000L,remaining))
 }
}
