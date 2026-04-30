package __PACKAGE__

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MediaSessionModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        MediaPlaybackService.reactContext = reactContext
    }

    override fun getName() = "StashMediaSession"

    private fun serviceIntent(action: String): Intent =
        Intent(reactApplicationContext, MediaPlaybackService::class.java).setAction(action)

    private fun launchService(intent: Intent) {
        val ctx = reactApplicationContext
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent)
        } else {
            ctx.startService(intent)
        }
    }

    @ReactMethod
    fun startSession(title: String, artist: String?, album: String?) {
        val intent = serviceIntent(MediaPlaybackService.ACTION_START)
            .putExtra(MediaPlaybackService.EXTRA_TITLE, title)
            .putExtra(MediaPlaybackService.EXTRA_ARTIST, artist ?: "Stash")
        if (album != null) intent.putExtra(MediaPlaybackService.EXTRA_ALBUM, album)
        launchService(intent)
    }

    @ReactMethod
    fun updateMeta(title: String, artist: String?, album: String?) {
        val intent = serviceIntent(MediaPlaybackService.ACTION_UPDATE_META)
            .putExtra(MediaPlaybackService.EXTRA_TITLE, title)
            .putExtra(MediaPlaybackService.EXTRA_ARTIST, artist ?: "Stash")
        if (album != null) intent.putExtra(MediaPlaybackService.EXTRA_ALBUM, album)
        launchService(intent)
    }

    @ReactMethod
    fun setPlaying(playing: Boolean) {
        val intent = serviceIntent(MediaPlaybackService.ACTION_SET_PLAYING)
            .putExtra(MediaPlaybackService.EXTRA_PLAYING, playing)
        launchService(intent)
    }

    @ReactMethod
    fun endSession() {
        launchService(serviceIntent(MediaPlaybackService.ACTION_STOP))
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // No-op; required for NativeEventEmitter on iOS but referenced cross-platform.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // No-op; see addListener.
    }
}
