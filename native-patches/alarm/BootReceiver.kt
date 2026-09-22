package com.kingschat.kingsagent.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * AlarmManager forgets every alarm across a reboot. This re-arms them all from
 * the local store so a 6am alarm still rings after the phone restarted overnight.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    val action = intent.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED &&
      action != "android.intent.action.QUICKBOOT_POWERON" &&
      action != Intent.ACTION_MY_PACKAGE_REPLACED
    ) {
      return
    }

    val now = System.currentTimeMillis()
    AlarmStore.all(ctx).forEach { rec ->
      val target =
        if (rec.repeat == "none") rec.triggerAt
        else AlarmScheduler.nextOccurrence(rec, now)

      // A one-shot that already passed while the phone was off is dropped.
      if (target > now) {
        val armed = rec.copy(triggerAt = target)
        AlarmStore.put(ctx, armed)
        AlarmScheduler.arm(ctx, armed)
      } else if (rec.repeat == "none") {
        AlarmStore.remove(ctx, rec.id)
      }
    }
  }
}
