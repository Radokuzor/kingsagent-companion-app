package com.kingschat.kingsagent.alarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.kingschat.kingsagent.R

/**
 * Keeps the alarm ringing. A foreground service, because that is the only way
 * Android lets audio keep playing and survive the app being swiped away.
 *
 * The sound loops on the ALARM audio stream at alarm volume, and the notification
 * carries a full-screen intent so a locked phone shows the ringing screen rather
 * than a quiet banner.
 */
class AlarmService : Service() {

  private var player: MediaPlayer? = null
  private var vibrator: Vibrator? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val id = intent?.getStringExtra("id")
    if (id.isNullOrEmpty()) {
      stopRinging()
      return START_NOT_STICKY
    }
    val rec = AlarmStore.get(this, id)
    if (rec == null) {
      stopRinging()
      return START_NOT_STICKY
    }

    ensureChannels()
    goForeground(rec)
    startSound()
    startVibration()

    return START_STICKY
  }

  override fun onDestroy() {
    stopSound()
    stopVibration()
    super.onDestroy()
  }

  // ---------------------------------------------------------------- foreground

  private fun goForeground(rec: AlarmRecord) {
    val notification = buildNotification(rec)
    val type =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      else 0
    try {
      ServiceCompat.startForeground(this, NOTIF_ID, notification, type)
    } catch (t: Throwable) {
      // Worst case the alarm still rings from the activity; never crash here.
    }
  }

  private fun immutableFlag(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

  private fun buildNotification(rec: AlarmRecord): Notification {
    val fullScreen = PendingIntent.getActivity(
      this,
      rec.id.hashCode(),
      Intent(this, AlarmActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        putExtra("id", rec.id)
      },
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
    )

    val dismiss = PendingIntent.getBroadcast(
      this,
      rec.id.hashCode() + 11,
      Intent(this, AlarmActionReceiver::class.java).apply {
        action = AlarmActionReceiver.ACTION_DISMISS
        data = Uri.parse("kingsagent://dismiss/${rec.id}")
        putExtra("id", rec.id)
      },
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
    )

    val snooze = PendingIntent.getBroadcast(
      this,
      rec.id.hashCode() + 13,
      Intent(this, AlarmActionReceiver::class.java).apply {
        action = AlarmActionReceiver.ACTION_SNOOZE
        data = Uri.parse("kingsagent://snooze/${rec.id}")
        putExtra("id", rec.id)
      },
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
    )

    return NotificationCompat.Builder(this, RING_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(rec.title)
      .setContentText(if (rec.body.isNotEmpty()) rec.body else "Kings Agent alarm")
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setFullScreenIntent(fullScreen, true)
      .setContentIntent(fullScreen)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Dismiss", dismiss)
      .addAction(android.R.drawable.ic_menu_recent_history, "Snooze 5 min", snooze)
      .build()
  }

  // ---------------------------------------------------------------- sound

  private fun alarmAttributes() = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ALARM)
    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
    .build()

  private fun startSound() {
    stopSound()
    player = try {
      val afd = resources.openRawResourceFd(R.raw.alarm)
      if (afd != null) {
        val mp = MediaPlayer()
        mp.setAudioAttributes(alarmAttributes())
        mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
        afd.close()
        mp.isLooping = true
        mp.prepare()
        mp.start()
        mp
      } else {
        MediaPlayer.create(this, R.raw.alarm)?.apply {
          isLooping = true
          start()
        }
      }
    } catch (t: Throwable) {
      try {
        MediaPlayer.create(this, R.raw.alarm)?.apply {
          isLooping = true
          start()
        }
      } catch (t2: Throwable) {
        null
      }
    }
  }

  private fun stopSound() {
    try {
      player?.stop()
      player?.release()
    } catch (t: Throwable) {
      // already gone
    }
    player = null
  }

  // ---------------------------------------------------------------- vibration

  @Suppress("DEPRECATION")
  private fun resolveVibrator(): Vibrator? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
    } else {
      getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }

  private fun startVibration() {
    val v = resolveVibrator() ?: return
    vibrator = v
    val pattern = longArrayOf(0, 800, 400, 800, 400, 800, 1200, 800)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        v.vibrate(VibrationEffect.createWaveform(pattern, 0))
      } else {
        @Suppress("DEPRECATION")
        v.vibrate(pattern, 0)
      }
    } catch (t: Throwable) {
      // vibration is a nicety, never fatal
    }
  }

  private fun stopVibration() {
    try {
      vibrator?.cancel()
    } catch (t: Throwable) {
      // ignore
    }
    vibrator = null
  }

  // ---------------------------------------------------------------- plumbing

  private fun stopRinging() {
    stopSound()
    stopVibration()
    try {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    } catch (t: Throwable) {
      // ignore
    }
    stopSelf()
  }

  private fun ensureChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    if (nm.getNotificationChannel(RING_CHANNEL_ID) == null) {
      nm.createNotificationChannel(
        NotificationChannel(RING_CHANNEL_ID, "Kings Agent ringing alarm", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "The full screen alarm that rings until dismissed"
          // The sound is played by this service, so the channel must stay silent
          // or the alarm would double up.
          setSound(null, null)
          enableVibration(false)
          lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        },
      )
    }
  }

  companion object {
    const val RING_CHANNEL_ID = "kings-agent-ring"
    const val NOTIF_ID = 8811

    /** Used by the activity and the notification actions to silence everything. */
    fun stop(ctx: Context) {
      try {
        ctx.stopService(Intent(ctx, AlarmService::class.java))
      } catch (t: Throwable) {
        // ignore
      }
      try {
        (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIF_ID)
      } catch (t: Throwable) {
        // ignore
      }
    }
  }
}
