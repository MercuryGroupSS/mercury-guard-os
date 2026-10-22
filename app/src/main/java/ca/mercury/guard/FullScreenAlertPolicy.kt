package ca.mercury.guard

/** Pure gate; tests supply OS states without changing real permissions. */
object FullScreenAlertPolicy {
 fun allowed(consented: Boolean, osAllowed: Boolean, notifications: Boolean, highImportance: Boolean,
             lockedOrScreenOff: Boolean, active: Boolean, alreadyAttempted: Boolean): Boolean =
  consented && osAllowed && notifications && highImportance && lockedOrScreenOff && active && !alreadyAttempted
}
