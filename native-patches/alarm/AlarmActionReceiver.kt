package com.kingschat.kingsagent.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Handles the Dismiss and Snooze taps, from either the ringing screen or the
 * notification actions.
 */
class AlarmActionReceiver : BroadcastReceiver() {

  override fun onReceive(ctx: Context, intent: Intent) {
    val id = intent.getStringExtra("id") ?: return

    when (intent.action) {
      ACTION_DISMISS -> {
        AlarmService.stop(ctx)
        val rec = AlarmStore.get(ctx, id)
        // A one-shot is finished; a repeating alarm was already re-armed by
        // AlarmReceiver, so it must stay in the store.
        if (rec != null && rec.repeat == "none") {
          AlarmStore.remove(ctx, id)
          AlarmScheduler.cancel(ctx, id)
        }
      }

      ACTION_SNOOZE -> {
        AlarmService.stop(ctx)
        val rec = AlarmStore.get(ctx, id) ?: return
        val snoozeId = "$id@snooze"
        val snoozed = AlarmRecord(
          id = snoozeId,
          title = rec.title,
          body = if (rec.body.isNotEmpty()) rec.body else "Snoozed 5 minutes",
          triggerAt = System.currentTimeMillis() + SNOOZE_MILLIS,
          repeat = "none",
          hour = 0,
          minute = 0,
          weekday = 0,
        )
        AlarmStore.put(ctx, snoozed)
        AlarmScheduler.arm(ctx, snoozed)
      }
    }
  }

  companion object {
    const val ACTION_DISMISS = "com.kingschat.kingsagent.ACTION_DISMISS"
    const val ACTION_SNOOZE = "com.kingschat.kingsagent.ACTION_SNOOZE"
    const val SNOOZE_MILLIS = 5L * 60L * 1000L
  }
}
