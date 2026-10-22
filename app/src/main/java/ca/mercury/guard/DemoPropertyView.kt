package ca.mercury.guard

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.View
import android.view.MotionEvent

/** Unregistered demo geometry only. The amber issue pin is never a GPS marker. */
class DemoPropertyView(context: Context, x: Int, y: Int, private val changed: (Int, Int) -> Unit) : View(context) {
 var pinX = x; private set
 var pinY = y; private set
 private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
 init { contentDescription = "Demo property issue pin. Tap to place, or use the coordinate controls and patrol point choices."; isClickable = true }
 override fun performClick(): Boolean { super.performClick(); return true }
 override fun onTouchEvent(event: MotionEvent): Boolean {
  if (event.action == MotionEvent.ACTION_UP) {
   movePin(((event.x/width-.12f)/.76f*100).toInt(), ((event.y/height-.12f)/.76f*100).toInt())
   performClick(); return true
  }
  return event.action == MotionEvent.ACTION_DOWN
 }
 fun movePin(x: Int, y: Int) { pinX = x.coerceIn(0,100); pinY = y.coerceIn(0,100); changed(pinX, pinY); invalidate() }
 override fun onDraw(canvas: Canvas) {
  super.onDraw(canvas)
  canvas.drawColor(Color.rgb(230, 240, 244))
  val w = width.toFloat(); val h = height.toFloat()
  fun polygon(points: FloatArray, color: Int) {
   paint.color = color; paint.style = Paint.Style.FILL
   val path = Path().apply { moveTo(points[0]*w, points[1]*h); for (i in 2 until points.size step 2) lineTo(points[i]*w, points[i+1]*h); close() }
   canvas.drawPath(path, paint)
  }
  polygon(floatArrayOf(.1f,.55f,.5f,.2f,.9f,.55f,.5f,.9f), Color.WHITE)
  polygon(floatArrayOf(.25f,.52f,.5f,.72f,.5f,.43f,.25f,.23f), Color.rgb(170,195,208))
  polygon(floatArrayOf(.5f,.72f,.74f,.52f,.74f,.23f,.5f,.43f), Color.rgb(196,216,225))
  polygon(floatArrayOf(.25f,.23f,.5f,.04f,.74f,.23f,.5f,.43f), Color.rgb(245,250,252))
  val px = w * (.12f + .76f * pinX/100f); val py = h * (.12f + .76f * pinY/100f)
  paint.color = Color.rgb(155, 85, 0); canvas.drawCircle(px, py, 10*resources.displayMetrics.density, paint)
  paint.color = Color.WHITE; canvas.drawCircle(px, py, 3*resources.displayMetrics.density, paint)
 }
}
