package __PACKAGE__

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
    fun finishTask() {
        reactApplicationContext.currentActivity?.finish()
    }

    override fun getConstants(): Map<String, Any?> {
        val action = reactApplicationContext.currentActivity?.intent?.action
        return mapOf("launchAction" to action)
    }
}
