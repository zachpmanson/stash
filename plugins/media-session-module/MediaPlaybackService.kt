package __PACKAGE__

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.util.Log
import android.view.KeyEvent
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.AudioAttributesCompat
import androidx.media.AudioFocusRequestCompat
import androidx.media.AudioManagerCompat
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.media.session.MediaButtonReceiver
import android.content.ComponentName
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

class MediaPlaybackService : Service() {

    private lateinit var session: MediaSessionCompat
    private var isPlaying: Boolean = false
    private var title: String = ""
    private var artist: String = "Stash"
    private var album: String? = null
    private var foregroundStarted: Boolean = false
    private var focusRequest: AudioFocusRequestCompat? = null
    private val audioManager by lazy { getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private var silentTrack: AudioTrack? = null

    companion object {
        const val TAG = "StashMedia"
        const val CHANNEL_ID = "stash-media-playback"
        const val NOTIF_ID = 1042

        const val ACTION_START = "com.zachmanson.stash.media.START"
        const val ACTION_UPDATE_META = "com.zachmanson.stash.media.UPDATE_META"
        const val ACTION_SET_PLAYING = "com.zachmanson.stash.media.SET_PLAYING"
        const val ACTION_STOP = "com.zachmanson.stash.media.STOP"
        const val ACTION_TOGGLE = "com.zachmanson.stash.media.TOGGLE"
        const val ACTION_NEXT = "com.zachmanson.stash.media.NEXT"
        const val ACTION_PREV = "com.zachmanson.stash.media.PREV"

        const val EXTRA_TITLE = "title"
        const val EXTRA_ARTIST = "artist"
        const val EXTRA_ALBUM = "album"
        const val EXTRA_PLAYING = "playing"

        const val EVENT_TOGGLE = "StashMediaToggle"
        const val EVENT_NEXT = "StashMediaNext"
        const val EVENT_PREV = "StashMediaPrev"

        @Volatile
        var reactContext: ReactApplicationContext? = null

        fun emit(eventName: String) {
            val ctx = reactContext
            val active = ctx?.hasActiveReactInstance() == true
            Log.d(TAG, "emit $eventName ctx=${ctx != null} active=$active")
            if (ctx == null || !active) return
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, null)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        val mbrComponent = ComponentName(this, MediaButtonReceiver::class.java)
        session = MediaSessionCompat(this, "StashMediaSession", mbrComponent, null)
        val mbrIntent = Intent(Intent.ACTION_MEDIA_BUTTON).setComponent(mbrComponent)
        val mbrPendingIntent = PendingIntent.getBroadcast(
            this,
            0,
            mbrIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        session.setMediaButtonReceiver(mbrPendingIntent)
        session.setCallback(object : MediaSessionCompat.Callback() {
            override fun onPlay() { Log.d(TAG, "cb onPlay"); emit(EVENT_TOGGLE) }
            override fun onPause() { Log.d(TAG, "cb onPause"); emit(EVENT_TOGGLE) }
            override fun onSkipToNext() { Log.d(TAG, "cb onSkipToNext"); emit(EVENT_NEXT) }
            override fun onSkipToPrevious() { Log.d(TAG, "cb onSkipToPrevious"); emit(EVENT_PREV) }
            override fun onMediaButtonEvent(mediaButtonEvent: Intent): Boolean {
                val key = mediaButtonEvent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
                Log.d(TAG, "onMediaButtonEvent action=${key?.action} keyCode=${key?.keyCode} repeat=${key?.repeatCount}")
                return super.onMediaButtonEvent(mediaButtonEvent)
            }
        })
        session.isActive = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand action=${intent?.action}")
        if (intent?.action == Intent.ACTION_MEDIA_BUTTON) {
            MediaButtonReceiver.handleIntent(session, intent)
            return START_NOT_STICKY
        }
        when (intent?.action) {
            ACTION_START -> {
                title = intent.getStringExtra(EXTRA_TITLE) ?: ""
                artist = intent.getStringExtra(EXTRA_ARTIST) ?: "Stash"
                album = intent.getStringExtra(EXTRA_ALBUM)
                isPlaying = true
                requestAudioFocus()
                startSilentTrack()
                updateSessionState()
                pushForegroundNotification()
            }
            ACTION_UPDATE_META -> {
                intent.getStringExtra(EXTRA_TITLE)?.let { title = it }
                intent.getStringExtra(EXTRA_ARTIST)?.let { artist = it }
                album = intent.getStringExtra(EXTRA_ALBUM) ?: album
                updateSessionState()
                pushForegroundNotification()
            }
            ACTION_SET_PLAYING -> {
                isPlaying = intent.getBooleanExtra(EXTRA_PLAYING, false)
                if (isPlaying) {
                    requestAudioFocus()
                    startSilentTrack()
                } else {
                    stopSilentTrack()
                    abandonAudioFocus()
                }
                updateSessionState()
                pushForegroundNotification()
            }
            ACTION_TOGGLE -> emit(EVENT_TOGGLE)
            ACTION_NEXT -> emit(EVENT_NEXT)
            ACTION_PREV -> emit(EVENT_PREV)
            ACTION_STOP -> {
                stopSilentTrack()
                abandonAudioFocus()
                stopForeground(true)
                foregroundStarted = false
                stopSelf()
                return START_NOT_STICKY
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopSilentTrack()
        abandonAudioFocus()
        session.isActive = false
        session.release()
        super.onDestroy()
    }

    private fun startSilentTrack() {
        if (silentTrack != null) return
        val sampleRate = 44100
        val frameCount = sampleRate / 10
        val buffer = ShortArray(frameCount)
        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setBufferSizeInBytes(frameCount * 2)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()
        track.write(buffer, 0, buffer.size)
        track.setLoopPoints(0, frameCount, -1)
        track.setVolume(0f)
        track.play()
        silentTrack = track
        Log.d(TAG, "silent track started state=${track.playState}")
    }

    private fun stopSilentTrack() {
        val track = silentTrack ?: return
        try { track.stop() } catch (_: Throwable) {}
        track.release()
        silentTrack = null
        Log.d(TAG, "silent track stopped")
    }

    private fun requestAudioFocus() {
        if (focusRequest != null) return
        val attrs = AudioAttributesCompat.Builder()
            .setUsage(AudioAttributesCompat.USAGE_MEDIA)
            .setContentType(AudioAttributesCompat.CONTENT_TYPE_SPEECH)
            .build()
        val req = AudioFocusRequestCompat.Builder(AudioManagerCompat.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attrs)
            .setOnAudioFocusChangeListener { change ->
                Log.d(TAG, "audio focus change=$change")
                when (change) {
                    AudioManager.AUDIOFOCUS_LOSS,
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> emit(EVENT_TOGGLE)
                }
            }
            .build()
        val result = AudioManagerCompat.requestAudioFocus(audioManager, req)
        Log.d(TAG, "requestAudioFocus result=$result")
        if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            focusRequest = req
        }
    }

    private fun abandonAudioFocus() {
        val req = focusRequest ?: return
        val result = AudioManagerCompat.abandonAudioFocusRequest(audioManager, req)
        Log.d(TAG, "abandonAudioFocus result=$result")
        focusRequest = null
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Playback",
            NotificationManager.IMPORTANCE_LOW,
        )
        channel.setShowBadge(false)
        channel.setSound(null, null)
        nm.createNotificationChannel(channel)
    }

    private fun updateSessionState() {
        Log.d(TAG, "updateSessionState isPlaying=$isPlaying title='$title' artist='$artist' active=${session.isActive}")
        val metaBuilder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
        // Intentionally omit METADATA_KEY_DURATION so MediaStyle hides the seek bar.
        album?.let { metaBuilder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM, it) }
        session.setMetadata(metaBuilder.build())

        val state = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                    PlaybackStateCompat.ACTION_PAUSE or
                    PlaybackStateCompat.ACTION_PLAY_PAUSE or
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS,
            )
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
                1.0f,
            )
            .build()
        session.setPlaybackState(state)
    }

    private fun servicePendingIntent(action: String, requestCode: Int): PendingIntent {
        val intent = Intent(this, MediaPlaybackService::class.java).setAction(action)
        return PendingIntent.getService(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun buildNotification(): Notification {
        val style = MediaStyle()
            .setMediaSession(session.sessionToken)
            .setShowActionsInCompactView(0, 1, 2)

        val playPauseIcon = if (isPlaying) {
            android.R.drawable.ic_media_pause
        } else {
            android.R.drawable.ic_media_play
        }
        val playPauseLabel = if (isPlaying) "Pause" else "Play"

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(artist)
            .setStyle(style)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .addAction(
                android.R.drawable.ic_media_previous,
                "Previous",
                servicePendingIntent(ACTION_PREV, 1),
            )
            .addAction(
                playPauseIcon,
                playPauseLabel,
                servicePendingIntent(ACTION_TOGGLE, 2),
            )
            .addAction(
                android.R.drawable.ic_media_next,
                "Next",
                servicePendingIntent(ACTION_NEXT, 3),
            )

        val deepLink = Intent(Intent.ACTION_VIEW, Uri.parse("stash://listen"))
            .setPackage(packageName)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        builder.setContentIntent(
            PendingIntent.getActivity(
                this,
                0,
                deepLink,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            ),
        )

        return builder.build()
    }

    private fun pushForegroundNotification() {
        val notification = buildNotification()
        if (!foregroundStarted) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIF_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                )
            } else {
                startForeground(NOTIF_ID, notification)
            }
            foregroundStarted = true
        } else {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIF_ID, notification)
        }
    }
}
