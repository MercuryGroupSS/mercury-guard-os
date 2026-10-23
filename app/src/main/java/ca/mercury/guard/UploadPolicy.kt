package ca.mercury.guard

/** Monotonic, same-boot authority only. Reboot or clock reversal requires sign-in. */
object UploadPolicy {
 fun valid(issuedElapsed:Long,expiresElapsed:Long,boot:Int,nowElapsed:Long,nowBoot:Int):Boolean =
  issuedElapsed>=0 && boot>=0 && boot==nowBoot && nowElapsed>=issuedElapsed &&
   expiresElapsed>issuedElapsed && expiresElapsed-issuedElapsed<=86400000L && nowElapsed<expiresElapsed
 enum class Failure { REAUTHENTICATE, RETRY, REVIEW }
 fun failure(status:Int):Failure=when(status){401->Failure.REAUTHENTICATE;408,425,429->Failure.RETRY;in 500..599->Failure.RETRY;else->Failure.REVIEW}
}
