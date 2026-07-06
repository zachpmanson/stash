package __PACKAGE__

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

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

    // Reads the CURRENT activity's intent fresh on every call. Unlike
    // getConstants() (snapshotted once at native-module init), this reflects
    // the intent from the share that's actually in progress right now, which
    // matters because MainActivity's launch-mode keeps the process (and the
    // module) alive across repeated shares via onNewIntent.
    @ReactMethod
    fun getLaunchInfo(promise: Promise) {
        val intent = reactApplicationContext.currentActivity?.intent
        val result = Arguments.createMap()
        result.putString("launchAction", intent?.action)
        result.putString("componentClassName", intent?.component?.className)
        promise.resolve(result)
    }

    override fun getConstants(): Map<String, Any?> {
        val intent = reactApplicationContext.currentActivity?.intent
        return mapOf(
            "launchAction" to intent?.action,
            "componentClassName" to intent?.component?.className,
        )
    }
}
