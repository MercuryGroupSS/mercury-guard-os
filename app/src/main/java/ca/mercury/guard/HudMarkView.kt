package ca.mercury.guard

import android.content.Context
import android.animation.ValueAnimator
import android.view.animation.LinearInterpolator
import android.view.accessibility.AccessibilityManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View

/** Decorative instrument motif. Never represents connection, location or readiness. */
class HudMarkView(context: Context) : View(context) {
 private var phase = 0f
 private var animator: ValueAnimator? = null
 fun startMotion() {
  if (!isAttachedToWindow || !isShown || windowVisibility != VISIBLE || animator != null || !ValueAnimator.areAnimatorsEnabled() ||
   (context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager).isTouchExplorationEnabled) return
  animator = ValueAnimator.ofFloat(0f, 360f).apply {
   duration = 18000; repeatCount = ValueAnimator.INFINITE; interpolator = LinearInterpolator()
   addUpdateListener { phase = it.animatedValue as Float; invalidate() }; start()
  }
 }
 fun stopMotion() { animator?.cancel(); animator = null }
 override fun onWindowVisibilityChanged(visibility: Int) {
  super.onWindowVisibilityChanged(visibility)
  if (visibility == VISIBLE) startMotion() else stopMotion()
 }
 override fun onAttachedToWindow() { super.onAttachedToWindow(); startMotion() }
 override fun onDetachedFromWindow() { stopMotion(); super.onDetachedFromWindow() }
 private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
 override fun onDraw(canvas: Canvas) {
  super.onDraw(canvas)
  val density = resources.displayMetrics.density
  val cx = width / 2f
  val cy = height / 2f
  val radius = minOf(width, height) * 0.38f
  paint.style = Paint.Style.STROKE
  paint.strokeWidth = density
  paint.color = Color.rgb(195, 215, 224)
  canvas.drawCircle(cx, cy, radius, paint)
  canvas.drawCircle(cx, cy, radius * 0.72f, paint)
  paint.color = Color.rgb(0, 133, 157)
  paint.strokeWidth = 2 * density
  canvas.drawArc(RectF(cx-radius, cy-radius, cx+radius, cy+radius), -75f + phase, 110f, false, paint)
  canvas.drawArc(RectF(cx-radius, cy-radius, cx+radius, cy+radius), 105f + phase, 110f, false, paint)
  paint.strokeWidth = density
  canvas.drawLine(cx-radius-22*density, cy, cx-radius-6*density, cy, paint)
  canvas.drawLine(cx+radius+6*density, cy, cx+radius+22*density, cy, paint)
  val core = radius * 0.26f
  canvas.drawLine(cx, cy-core, cx+core, cy, paint)
  canvas.drawLine(cx+core, cy, cx, cy+core, paint)
  canvas.drawLine(cx, cy+core, cx-core, cy, paint)
  canvas.drawLine(cx-core, cy, cx, cy-core, paint)
 }
}
