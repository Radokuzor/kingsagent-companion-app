package com.kingschat.kingsagent.alarm

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The ringing screen. Built in code rather than XML so the whole alarm lives in
 * one place, and deliberately has no back-out: a ringing alarm must be dismissed
 * or snoozed on purpose.
 */
class AlarmActivity : Activity() {

  private var alarmId: String? = null
  private var record: AlarmRecord? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    }
    @Suppress("DEPRECATION")
    window.addFlags(
      WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
    )

    alarmId = intent?.getStringExtra("id")
    record = alarmId?.let { AlarmStore.get(this, it) }

    setContentView(buildUi(record))

    // If the receiver was refused a foreground-service start, start it here where
    // the app is unambiguously in the foreground.
    alarmId?.let { id ->
      try {
        ContextCompat.startForegroundService(
          this,
          Intent(this, AlarmService::class.java).apply {
            putExtra("id", id)
            putExtra("ringing", true)
          },
        )
      } catch (t: Throwable) {
        // the notification path still works
      }
    }
  }

  private fun buildUi(rec: AlarmRecord?): View {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor("#0B0D11"))
      setPadding(64, 64, 64, 64)
    }

    root.addView(
      label("KINGS AGENT ALARM"),
    )

    val time = SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date())
    root.addView(
      text(time, 64f, "#FFFFFF", true).apply {
        setPadding(0, 40, 0, 40)
      },
    )

    root.addView(text(rec?.title ?: "Alarm", 30f, "#E8ECF1", true))

    if (!rec?.body.isNullOrEmpty()) {
      root.addView(
        text(rec!!.body, 18f, "#9AA5B1", false).apply {
          setPadding(0, 24, 0, 0)
          gravity = Gravity.CENTER
        },
      )
    }

    root.addView(
      action("Dismiss", "#1F6FEB") {
        send(AlarmActionReceiver.ACTION_DISMISS)
        finish()
      },
    )

    root.addView(
      action("Snooze 5 minutes", "#262C36") {
        send(AlarmActionReceiver.ACTION_SNOOZE)
        finish()
      },
    )

    return root
  }

  private fun send(action: String) {
    val id = alarmId ?: return
    sendBroadcast(
      Intent(this, AlarmActionReceiver::class.java).apply {
        this.action = action
        data = android.net.Uri.parse("kingsagent://action/$id")
        putExtra("id", id)
      },
    )
  }

  private fun label(t: String) = text(t, 13f, "#4DA3FF", true).apply {
    letterSpacing = 0.2f
  }

  private fun text(t: String, size: Float, color: String, bold: Boolean) =
    TextView(this).apply {
      text = t
      textSize = size
      setTextColor(Color.parseColor(color))
      gravity = Gravity.CENTER
      if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

  private fun action(t: String, bg: String, onClick: () -> Unit) =
    Button(this).apply {
      text = t
      textSize = 17f
      setTextColor(Color.WHITE)
      setBackgroundColor(Color.parseColor(bg))
      setOnClickListener { onClick() }
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { setMargins(0, 48, 0, 0) }
    }

  /** A ringing alarm is never dismissed by the back gesture. */
  @Suppress("DEPRECATION")
  override fun onBackPressed() {
    // deliberately nothing
  }
}
