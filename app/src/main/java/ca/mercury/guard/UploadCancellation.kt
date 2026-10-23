package ca.mercury.guard

import java.net.HttpURLConnection

/** Cancellation disconnects the current bounded HTTP request; no subsequent request may start. */
class UploadCancellation {
 @Volatile private var stopped=false
 private val lock=Any()
 private var connection:HttpURLConnection?=null
 fun check(){check(!stopped){"Upload stopped"}}
 fun attach(value:HttpURLConnection)=synchronized(lock){check();connection=value}
 fun detach(value:HttpURLConnection)=synchronized(lock){if(connection===value)connection=null}
 fun cancel(){val value=synchronized(lock){stopped=true;connection.also{connection=null}};value?.disconnect()}
 fun cancelled()=stopped
}
