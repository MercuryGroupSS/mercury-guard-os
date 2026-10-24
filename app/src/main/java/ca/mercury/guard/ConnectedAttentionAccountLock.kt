package ca.mercury.guard

import android.os.Looper
import android.content.Context
import java.io.File
import java.lang.ref.WeakReference

/** Local privacy fence only. No credential, account owner or capture state is exposed. */
internal object ConnectedAttentionAccountLock {
 private val live=mutableListOf<WeakReference<GuardAccountActivity>>()
 private fun main(){check(Looper.myLooper()==Looper.getMainLooper())}
 fun register(activity:GuardAccountActivity){main();live.removeAll{it.get()==null};if(live.none{it.get()===activity})live.add(WeakReference(activity))}
 fun unregister(activity:GuardAccountActivity){main();live.removeAll{it.get()==null||it.get()===activity}}
 fun lockAll(){main();val activities=live.mapNotNull{it.get()};live.removeAll{it.get()==null};activities.forEach{it.lockForConnectedAttentionEntry()}}
 /** A second live task is not process recreation; only unowned temporary output is abandoned. */
 fun cleanupAbandonedCameraOutput(context:Context){
  main();val activities=live.mapNotNull{it.get()};live.removeAll{it.get()==null}
  File(context.cacheDir,"capture/account").listFiles()?.forEach{file->if(activities.none{it.retainsPendingCameraOutput(file)})file.delete()}
 }
}
