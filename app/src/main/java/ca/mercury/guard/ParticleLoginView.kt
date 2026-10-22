package ca.mercury.guard

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
import android.opengl.GLES20.*
import android.opengl.GLSurfaceView
import android.os.SystemClock
import android.view.View
import android.view.accessibility.AccessibilityManager
import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.*

/** Persistent reference-derived particles, rendered in one GL draw on the render thread. */
class ParticleLoginView(context: Context) : GLSurfaceView(context) {
 private val density=resources.displayMetrics.density
 private val samples=context.assets.open("mercury_face_reference.jpeg").use { input ->
  val image=BitmapFactory.decodeStream(input)
  val values=ArrayList<Float>()
  var i=0
  for(y in 8 until image.height step 7) for(x in 0 until image.width step 7) {
   val blue=Color.blue(image.getPixel(x,y))
   if(blue<24) continue
   val angle=i*2.3999632f
   val radius=sqrt(((i*73)%997)/997f)*.97f
   values.add(x/image.width.toFloat()-.5f); values.add((y-8)/(image.height-8).toFloat()-.5f)
   values.add(cos(angle)*radius); values.add(sin(angle)*radius)
   values.add(i*.08f); values.add(((blue/16*16+8)*1.05f-12).coerceIn(0f,255f)/255f)
   i++
  }
  image.recycle()
  values.toFloatArray()
 }
 private val vertices=ByteBuffer.allocateDirect(samples.size*4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(samples); position(0) }
 @Volatile private var blend=0f
 @Volatile private var target=0f
 @Volatile private var elapsed=0f
 @Volatile private var frameCount=0
 @Volatile private var drawNanos=0L
 private var running=false
 private var started=0L
 private var lastFrame=0L
 private var lastRequest=0L
 private val tick=object:Runnable {
  override fun run() {
   if(!running) return
   if(!motionAllowed()) { blend=target; stopMotion(); requestRender(); return }
   val now=SystemClock.uptimeMillis()
   val step=(now-lastFrame)/3200f
   blend=if(blend<target) min(target,blend+step) else max(target,blend-step)
   elapsed=(now-started)/1000f; lastFrame=now
   if(now-lastRequest>=32 && (blend<1f || target<1f)) { lastRequest=now; requestRender() }
   // Ensure the exact end pose is submitted, then stop redrawing the static hold.
   if(blend==1f && target==1f && lastRequest!=Long.MAX_VALUE) { requestRender(); lastRequest=Long.MAX_VALUE }
   postOnAnimation(this)
  }
 }
 init {
  setEGLContextClientVersion(2)
  preserveEGLContextOnPause=true
  setRenderer(object:Renderer {
   private var program=0
   private var viewportLocation=0
   private var progressLocation=0
   private var clockLocation=0
   private var densityLocation=0
   private var w=1
   private var h=1
   private fun shader(type:Int,code:String):Int {
    val id=glCreateShader(type); glShaderSource(id,code); glCompileShader(id)
    val ok=IntArray(1); glGetShaderiv(id,GL_COMPILE_STATUS,ok,0)
    check(ok[0]!=0) { glGetShaderInfoLog(id) }; return id
   }
   override fun onSurfaceCreated(gl:GL10?,config:EGLConfig?) {
    val vs=shader(GL_VERTEX_SHADER,"""
     attribute vec2 targetPoint; attribute vec2 circlePoint; attribute vec2 detail;
     uniform vec2 viewport; uniform float progress; uniform float clock; uniform float density;
     varying vec4 tint;
     void main() {
      float m=progress*progress*(3.0-2.0*progress);
      float radius=min(viewport.x,viewport.y)*0.37;
      float c=cos(clock*0.10), s=sin(clock*0.10);
      vec2 rotated=vec2(circlePoint.x*c-circlePoint.y*s,circlePoint.x*s+circlePoint.y*c);
      float pulse=1.0+0.025*sin(clock*1.7+detail.x);
      float fh=min(viewport.y*0.85,viewport.x*1.05); float fw=fh*848.0/1221.0;
      vec2 point=mix(rotated*radius*pulse,targetPoint*vec2(fw,fh),m);
      gl_Position=vec4(point.x*2.0/viewport.x,-point.y*2.0/viewport.y,0.0,1.0);
      gl_PointSize=mix(density*2.5,fw/848.0*7.1,m);
      tint=vec4(mix(vec3(70.0,145.0,160.0),vec3(20.0,122.0,177.0),m)/255.0,mix(58.0/255.0,detail.y,m));
     }
    """)
    val fs=shader(GL_FRAGMENT_SHADER,"""
     precision mediump float; varying vec4 tint;
     void main() {
      float distanceFromCenter=length(gl_PointCoord-vec2(0.5));
      float edge=1.0-smoothstep(0.38,0.50,distanceFromCenter);
      gl_FragColor=vec4(tint.rgb,tint.a*edge);
     }
    """)
    program=glCreateProgram(); glAttachShader(program,vs); glAttachShader(program,fs); glLinkProgram(program)
    val ok=IntArray(1);glGetProgramiv(program,GL_LINK_STATUS,ok,0);check(ok[0]!=0) { glGetProgramInfoLog(program) }
    glDeleteShader(vs);glDeleteShader(fs)
    viewportLocation=glGetUniformLocation(program,"viewport")
    progressLocation=glGetUniformLocation(program,"progress")
    clockLocation=glGetUniformLocation(program,"clock")
    densityLocation=glGetUniformLocation(program,"density")
    val buffer=IntArray(1);glGenBuffers(1,buffer,0);glBindBuffer(GL_ARRAY_BUFFER,buffer[0])
    vertices.position(0);glBufferData(GL_ARRAY_BUFFER,samples.size*4,vertices,GL_STATIC_DRAW)
    for((name,offset) in arrayOf("targetPoint" to 0,"circlePoint" to 8,"detail" to 16)) {
     val loc=glGetAttribLocation(program,name);glEnableVertexAttribArray(loc)
     glVertexAttribPointer(loc,2,GL_FLOAT,false,24,offset)
    }

    glEnable(GL_BLEND);glBlendFunc(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA)
    glClearColor(1f,1f,1f,1f)
   }
   override fun onSurfaceChanged(gl:GL10?,width:Int,height:Int) { w=width;h=height;glViewport(0,0,w,h) }
   override fun onDrawFrame(gl:GL10?) {
    val before=System.nanoTime()
    glClear(GL_COLOR_BUFFER_BIT);glUseProgram(program)
    glUniform2f(viewportLocation,w.toFloat(),h.toFloat())
    glUniform1f(progressLocation,blend)
    glUniform1f(clockLocation,elapsed)
    glUniform1f(densityLocation,density)
    glDrawArrays(GL_POINTS,0,samples.size/6)
    frameCount++;drawNanos+=System.nanoTime()-before
   }
  })
  renderMode=RENDERMODE_WHEN_DIRTY
 }
 private fun motionAllowed()=ValueAnimator.areAnimatorsEnabled() && !(context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager).isTouchExplorationEnabled
 fun setSigningIn(value:Boolean) { target=if(value) 1f else 0f;lastRequest=0L;if(!motionAllowed()) { blend=target;requestRender() } }
 fun startMotion() {
  if(running || !isAttachedToWindow || !isShown || windowVisibility!=View.VISIBLE || !motionAllowed()) return
  running=true;started=SystemClock.uptimeMillis();lastFrame=started;lastRequest=0L;postOnAnimation(tick)
 }
 fun stopMotion() { running=false;removeCallbacks(tick) }
 fun renderingStats()="particles=${samples.size/6}, GL frames=$frameCount, mean CPU submission ms=${if(frameCount>0) drawNanos/1e6/frameCount else 0.0}"
 override fun onAttachedToWindow() { super.onAttachedToWindow();startMotion() }
 override fun onDetachedFromWindow() { stopMotion();super.onDetachedFromWindow() }
 override fun onWindowVisibilityChanged(visibility:Int) { super.onWindowVisibilityChanged(visibility);if(visibility==View.VISIBLE) startMotion() else stopMotion() }
}
