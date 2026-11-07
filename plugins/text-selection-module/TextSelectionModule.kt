package __PACKAGE__

import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil

/**
 * Reads the currently-active text selection (start/end offsets + text length)
 * from whichever TextView on screen currently holds a live selection.
 *
 * RN's read-only selectable <Text> never surfaces selection to JS, and the
 * legacy UIManagerModule.resolveView isn't available on the new (bridgeless)
 * architecture, so we instead walk the current activity's window tree for a
 * TextView with an active selection. Runs on the UI thread (view access must).
 */
class TextSelectionModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "TextSelection"

    @ReactMethod
    fun getSelection(surfaceTag: Int, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            try {
                val activity = reactApplicationContext.currentActivity
                val root = activity?.window?.decorView?.rootView
                if (root == null) {
                    promise.resolve(null)
                    return@runOnUiThread
                }
                val tv = findTextViewWithSelection(root)
                if (tv == null) {
                    promise.resolve(null)
                    return@runOnUiThread
                }
                val start = tv.selectionStart
                val end = tv.selectionEnd
                val length = tv.text?.length ?: 0
                if (start < 0 || end <= start || length <= 0) {
                    promise.resolve(null)
                    return@runOnUiThread
                }
                val result = Arguments.createMap()
                result.putInt("start", start)
                result.putInt("end", end)
                result.putInt("length", length)
                promise.resolve(result)
            } catch (e: Throwable) {
                Log.e("TextSelection", "getSelection error", e)
                promise.reject("E_SELECTION", e.message)
            }
        }
    }

    private fun findTextViewWithSelection(view: View): TextView? {
        if (view is TextView && view.selectionStart >= 0 && view.selectionStart != view.selectionEnd) {
            return view
        }
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                val found = findTextViewWithSelection(view.getChildAt(i)) ?: continue
                return found
            }
        }
        return null
    }
}
