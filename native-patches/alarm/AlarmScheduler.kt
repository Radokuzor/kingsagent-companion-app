package com.kingschat.kingsagent.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.util.Calendar

/**
 * The scheduling core.
 *
 * Uses `setAlarmClock`, which is the only alarm type Android does not defer in
 * Doze. The system actually wakes out of Doze shortly before it fires. That is
 * what makes this a real alarm rather than a notification that arrives late.
 */
object AlarmScheduler {
  private const val BASE_REQUEST = 4200

  private fun immutableFlag(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

  fun broadcastPendingIntent(ctx: Context, id: String): PendingIntent {
    val i = Intent(ctx, AlarmReceiver::class.java).apply {
      action = "com.kingschat.kingsagent.ACTION_RING"
      data = AlarmStore.uri(id)
      putExtra("id", id)
    }
    return PendingIntent.getBroadcast(
      ctx,
      BASE_REQUEST + id.hashCode(),
      i,
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
    )
  }

  private fun showPendingIntent(ctx: Context, id: String): PendingIntent {
    val i = Intent(ctx, AlarmActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      putExtra("id", id)
    }
    return PendingIntent.getActivity(
      ctx,
      BASE_REQUEST + 1 + id.hashCode(),
      i,
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
    )
  }

  fun canScheduleExact(ctx: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    return am.canScheduleExactAlarms()
  }

  /**
   * @return true when the strongest alarm clock type was used, false when it had
   * to fall back to a Doze-tolerant exact alarm.
   */
  fun arm(ctx: Context, rec: AlarmRecord): Boolean {
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val op = broadcastPendingIntent(ctx, rec.id)
    val show = showPendingIntent(ctx, rec.id)

    return try {
      am.setAlarmClock(AlarmManager.AlarmClockInfo(rec.triggerAt, show), op)
      true
    } catch (e: SecurityException) {
      // Exact alarms refused. Still arm something that fires, just less precisely.
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, rec.triggerAt, op)
      false
    }
  }

  fun cancel(ctx: Context, id: String) {
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    am.cancel(broadcastPendingIntent(ctx, id))
  }

  /** Arms a record, computing its next occurrence from the repeat rule. */
  fun schedule(ctx: Context, rec: AlarmRecord): AlarmRecord {
    val target =
      if (rec.repeat == "none") rec.triggerAt
      else nextOccurrence(rec, System.currentTimeMillis())

    val armed = rec.copy(triggerAt = target)
    AlarmStore.put(ctx, armed)
    arm(ctx, armed)
    return armed
  }

  fun cancelAll(ctx: Context) {
    AlarmStore.all(ctx).forEach { cancel(ctx, it.id) }
    AlarmStore.clear(ctx)
  }

  /** Next firing time for a repeating record, strictly after [after]. */
  fun nextOccurrence(rec: AlarmRecord, after: Long): Long {
    val c = Calendar.getInstance()
    c.timeInMillis = after
    c.set(Calendar.HOUR_OF_DAY, rec.hour)
    c.set(Calendar.MINUTE, rec.minute)
    c.set(Calendar.SECOND, 0)
    c.set(Calendar.MILLISECOND, 0)
    if (c.timeInMillis <= after) c.add(Calendar.DAY_OF_YEAR, 1)

    when (rec.repeat) {
      "weekly" -> {
        var guard = 0
        while (c.get(Calendar.DAY_OF_WEEK) != rec.weekday && guard < 8) {
          c.add(Calendar.DAY_OF_YEAR, 1)
          guard++
        }
      }
      "weekdays" -> {
        var guard = 0
        while (
          (c.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY ||
            c.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY) && guard < 8
        ) {
          c.add(Calendar.DAY_OF_YEAR, 1)
          guard++
        }
      }
      else -> Unit
    }
    return c.timeInMillis
  }
}
