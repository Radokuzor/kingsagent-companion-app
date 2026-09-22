package com.kingschat.kingsagent.alarm

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject

/**
 * The bridge from JavaScript to the real Android alarm.
 *
 * JS builds the same instruction envelope it already uses; this is only the part
 * that converts it into an alarm the phone itself will fire.
 */
class AlarmModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = "KingsAlarm"

  /** False means Android has not granted exact alarms, so timing will drift. */
  @ReactMethod
  fun canScheduleExact(promise: Promise) {
    try {
      promise.resolve(AlarmScheduler.canScheduleExact(ctx))
    } catch (t: Throwable) {
      promise.reject("exact_check_failed", t)
    }
  }

  /**
   * Arms a record. For a repeating record the next occurrence is computed here,
   * in Java, so the repeat survives the app never being opened again.
   */
  @ReactMethod
  fun schedule(payloadJson: String, promise: Promise) {
    try {
      val o = JSONObject(payloadJson)
      val rec = AlarmRecord(
        id = o.getString("id"),
        title = o.optString("title", "Alarm"),
        body = o.optString("body", ""),
        triggerAt = o.optLong("at", System.currentTimeMillis() + 60_000L),
        repeat = o.optString("repeat", "none"),
        hour = o.optInt("hour", 0),
        minute = o.optInt("minute", 0),
        weekday = o.optInt("weekday", 1),
      )
      val armed = AlarmScheduler.schedule(ctx, rec)
      promise.resolve(armed.toJson().toString())
    } catch (t: Throwable) {
      promise.reject("schedule_failed", t)
    }
  }

  /** One-shot at an explicit time. Used by the test alarm and by snooze. */
  @ReactMethod
  fun scheduleAt(payloadJson: String, atMillis: Double, promise: Promise) {
    try {
      val o = JSONObject(payloadJson)
      val rec = AlarmRecord(
        id = o.getString("id"),
        title = o.optString("title", "Alarm"),
        body = o.optString("body", ""),
        triggerAt = atMillis.toLong(),
        repeat = "none",
        hour = 0,
        minute = 0,
        weekday = 1,
      )
      val armed = AlarmScheduler.schedule(ctx, rec)
      promise.resolve(armed.toJson().toString())
    } catch (t: Throwable) {
      promise.reject("schedule_at_failed", t)
    }
  }

  @ReactMethod
  fun cancel(id: String, promise: Promise) {
    try {
      AlarmScheduler.cancel(ctx, id)
      AlarmStore.remove(ctx, id)
      promise.resolve(true)
    } catch (t: Throwable) {
      promise.reject("cancel_failed", t)
    }
  }

  @ReactMethod
  fun cancelAll(promise: Promise) {
    try {
      AlarmScheduler.cancelAll(ctx)
      promise.resolve(true)
    } catch (t: Throwable) {
      promise.reject("cancel_all_failed", t)
    }
  }

  /** Everything currently armed, as a JSON array string. */
  @ReactMethod
  fun getAll(promise: Promise) {
    try {
      val arr = org.json.JSONArray()
      AlarmStore.all(ctx).forEach { arr.put(it.toJson()) }
      promise.resolve(arr.toString())
    } catch (t: Throwable) {
      promise.reject("list_failed", t)
    }
  }

  /** Silence a ringing alarm from inside the app. */
  @ReactMethod
  fun stopRinging(promise: Promise) {
    try {
      AlarmService.stop(ctx)
      promise.resolve(true)
    } catch (t: Throwable) {
      promise.reject("stop_failed", t)
    }
  }
}
