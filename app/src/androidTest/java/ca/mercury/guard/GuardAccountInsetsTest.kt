package ca.mercury.guard

import android.graphics.Rect
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.UiController
import androidx.test.espresso.ViewAction
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.platform.app.InstrumentationRegistry
import org.hamcrest.Matcher
import org.hamcrest.Matchers.allOf
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Common production screen layout only: no account, capture grant or private record is injected. */
class GuardAccountInsetsTest {
 private fun root(activity:GuardAccountActivity)=GuardAccountActivity::class.java.getDeclaredField("root").apply{isAccessible=true}.get(activity) as LinearLayout
 private fun generation(activity:GuardAccountActivity)=GuardAccountActivity::class.java.getDeclaredField("generation").apply{isAccessible=true}.getInt(activity)
 private fun screen(activity:GuardAccountActivity){GuardAccountActivity::class.java.getDeclaredMethod("screen",String::class.java,String::class.java).apply{isAccessible=true;invoke(activity,"SCROLL LAYOUT","Synthetic layout fixture")}}
 private fun afterLayout(scenario:ActivityScenario<GuardAccountActivity>,view:View,change:()->Unit){
  val laidOut=CountDownLatch(1)
  val listener=View.OnLayoutChangeListener{_,_,_,_,_,_,_,_,_->laidOut.countDown()}
  scenario.onActivity{view.addOnLayoutChangeListener(listener);change()}
  try{assertTrue("Inset layout did not complete",laidOut.await(5,TimeUnit.SECONDS))}
  finally{scenario.onActivity{view.removeOnLayoutChangeListener(listener)}}
  InstrumentationRegistry.getInstrumentation().waitForIdleSync()
 }
 @Suppress("DEPRECATION")
 @Test fun insetsShrinkTheMeasuredViewportAndRectangleScrollRevealsTheEditor(){
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   lateinit var content:LinearLayout;lateinit var scroll:ScrollView;lateinit var viewport:FrameLayout
   var stamp=0
   scenario.onActivity{activity->
    screen(activity);content=root(activity);scroll=content.parent as ScrollView
    // Verify the real screen hierarchy, rather than constructing a separate scrolling widget.
    viewport=scroll.parent as? FrameLayout?:error("System insets need a separate viewport parent")
    stamp=generation(activity)
   }
   InstrumentationRegistry.getInstrumentation().waitForIdleSync()
   // Explicit pixels make the 48px clipped-bottom regression independent of emulator density.
   afterLayout(scenario,scroll){
    val initial=viewport.rootWindowInsets?:error("Window insets unavailable after attachment")
    viewport.dispatchApplyWindowInsets(initial.replaceSystemWindowInsets(8,16,12,48))
   }
   scenario.onActivity{activity->
    assertSame(content,root(activity));assertEquals(stamp,generation(activity))
    assertEquals(8,viewport.paddingLeft);assertEquals(16,viewport.paddingTop)
    assertEquals(12,viewport.paddingRight);assertEquals(48,viewport.paddingBottom)
    assertEquals(0,scroll.paddingLeft);assertEquals(0,scroll.paddingTop)
    assertEquals(0,scroll.paddingRight);assertEquals(0,scroll.paddingBottom)
    assertEquals(viewport.width-20,scroll.width);assertEquals(viewport.height-64,scroll.height)
    assertTrue("Real scrolling viewport is missing",scroll.height>100)
   }
   lateinit var editor:EditText
   afterLayout(scenario,content){
    content.removeAllViews();content.setPadding(0,0,0,0)
    content.isFocusableInTouchMode=true;content.requestFocus()
    content.addView(View(content.context),LinearLayout.LayoutParams(-1,scroll.height-50))
    editor=EditText(content.context).apply{hint="Inset scrolling test input";isSaveEnabled=false}
    content.addView(editor,LinearLayout.LayoutParams(-1,88))
    content.addView(View(content.context),LinearLayout.LayoutParams(-1,200))
   }
   scenario.onActivity{
    assertFalse("Fixture must start partially below the real viewport",isDisplayingAtLeast(90).matches(editor))
    assertTrue(scroll.canScrollVertically(1))
   }
   onView(withHint("Inset scrolling test input")).perform(object:ViewAction{
    override fun getDescription()="request the measured editor rectangle from the real scrolling viewport"
    override fun getConstraints():Matcher<View> = allOf(isAssignableFrom(EditText::class.java),isDescendantOfA(isAssignableFrom(ScrollView::class.java)))
    override fun perform(ui:UiController,target:View){
     ui.loopMainThreadUntilIdle()
     val rectangle=Rect(0,0,target.width,target.height)
     content.offsetDescendantRectToMyCoords(target,rectangle)
     assertTrue("The offscreen rectangle must cause real scrolling",scroll.requestChildRectangleOnScreen(content,rectangle,true))
     ui.loopMainThreadUntilIdle()
     assertTrue(scroll.scrollY>0)
     assertTrue("Editor must be at least90percent visible before input",isDisplayingAtLeast(90).matches(target))
    }
   }).check(matches(isDisplayingAtLeast(90))).perform(click(),replaceText("Visible inset input"),closeSoftKeyboard())
   onView(withHint("Inset scrolling test input")).check(matches(withText("Visible inset input")))
   scenario.onActivity{activity->assertSame(content,root(activity));assertEquals(stamp,generation(activity))}
  }
 }
}
