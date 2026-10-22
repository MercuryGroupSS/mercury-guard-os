package ca.mercury.guard

import org.json.JSONObject

/** Future authenticated transport boundary. Does not initialize identity, transmit or acknowledge. */
class SignedOutbox(private val store: GuardStore, private val identity: DeviceIdentity) {
 fun prepare(audience: String, limit: Int = 50): JSONObject? {
  require(audience.matches(Regex("[A-Za-z0-9._:/-]{1,128}")))
  check(identity.publicIdentity() != null) { "Installation identity is required before preparing signed batches" }
  val batch = store.prepareBatch(limit) ?: return null
  return identity.signEventBatch(audience,batch)
 }
}
