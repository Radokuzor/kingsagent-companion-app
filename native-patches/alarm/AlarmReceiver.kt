package com.kingschat.kingsagent.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/**
 * Fired by AlarmManager at the exact alarm time. This runs with the app closed,
 * the screen off and the phone locked, which is the entire reason the alarm is
 * native rather than a notification.
 */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    val id = intent.getStringExtra("id") ?: return
    val rec = AlarmStore.get(ctx, id) ?: return

    // Re-arm the NEXT occurrence first. Doing it here rather than relying on the
    // app being opened means a daily reminder keeps ringing for months even if
    // the user never launches the app again.
    if (rec.repeat != "none") {
      val nextTrigger = AlarmScheduler.nextOccurrence(rec, rec.triggerAt + 1000L)
      val next = rec.copy(triggerAt = nextTrigger)
      AlarmStore.put(ctx, next)
      AlarmScheduler.arm(ctx, next)
    }

    val svc = Intent(ctx, AlarmService::class.java).apply {
      putExtra("id", id)
      putExtra("ringing", true)
    }

    try {
      ContextCompat.startForegroundService(ctx, svc)
    } catch (t: Throwable) {
      // Android 12+ can refuse a foreground-service start from the background.
      // Not fatal: AlarmActivity starts the service once it is on screen, and the
      // full-screen notification is posted from there.
    }
  }
}
