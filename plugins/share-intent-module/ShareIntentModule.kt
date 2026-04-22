package __PACKAGE__

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ShareIntentModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "ShareIntentModule"

    @ReactMethod
    fun clearIntent() {
        reactApplicationContext.currentActivity?.intent = Intent()
    }

    @ReactMethod
    fun setExcludeFromRecents(exclude: Boolean) {
        val activity = reactApplicationContext.currentActivity ?: return
        val am = activity.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        am.appTasks.firstOrNull()?.setExcludeFromRecents(exclude)
    }
}
