package com.kingschat.kingsagent.alarm

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject

/**
 * One scheduled alarm. Kept on the device so it survives the app being killed
 * and the phone being rebooted.
 */
data class AlarmRecord(
  val id: String,
  val title: String,
  val body: String,
  val triggerAt: Long,
  /** none | daily | weekdays | weekly */
  val repeat: String,
  val hour: Int,
  val minute: Int,
  /** Calendar.DAY_OF_WEEK value, only meaningful when repeat == "weekly" */
  val weekday: Int,
) {
  fun toJson(): JSONObject = JSONObject().apply {
    put("id", id)
    put("title", title)
    put("body", body)
    put("triggerAt", triggerAt)
    put("repeat", repeat)
    put("hour", hour)
    put("minute", minute)
    put("weekday", weekday)
  }

  companion object {
    fun from(o: JSONObject) = AlarmRecord(
      id = o.optString("id"),
      title = o.optString("title"),
      body = o.optString("body", ""),
      triggerAt = o.optLong("triggerAt", 0L),
      repeat = o.optString("repeat", "none"),
      hour = o.optInt("hour", 0),
      minute = o.optInt("minute", 0),
      weekday = o.optInt("weekday", 0),
    )
  }
}

/**
 * Persistence for armed alarms. SharedPreferences is deliberate: it is readable
 * from a BroadcastReceiver before React Native has even started, which is the
 * whole point. The JS side is not involved in the ringing path.
 */
object AlarmStore {
  private const val PREFS = "kings_agent_alarms"
  private const val KEY = "alarms"

  private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun all(c: Context): List<AlarmRecord> {
    val raw = prefs(c).getString(KEY, null) ?: return emptyList()
    return try {
      val arr = JSONArray(raw)
      (0 until arr.length()).mapNotNull { i ->
        try {
          AlarmRecord.from(arr.getJSONObject(i))
        } catch (e: Exception) {
          null
        }
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  private fun write(c: Context, list: List<AlarmRecord>) {
    val arr = JSONArray()
    list.forEach { arr.put(it.toJson()) }
    prefs(c).edit().putString(KEY, arr.toString()).apply()
  }

  fun put(c: Context, rec: AlarmRecord) {
    val next = all(c).filterNot { it.id == rec.id } + rec
    write(c, next)
  }

  fun remove(c: Context, id: String) {
    write(c, all(c).filterNot { it.id == id })
  }

  fun clear(c: Context) = write(c, emptyList())

  fun get(c: Context, id: String): AlarmRecord? = all(c).firstOrNull { it.id == id }

  fun uri(id: String): Uri = Uri.parse("kingsagent://alarm/$id")
}
