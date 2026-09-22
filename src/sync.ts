import { fetchReminders, patchReminder, type ServerReminder } from './api';
import { armNative, cancelNative, listNativeAlarms, nativeAlarmAvailable } from './nativeAlarm';

/**
 * Reconcile the phone's alarms against the server's reminders.
 *
 * This is the whole product in one function, so the shape of it matters:
 *
 * **The device owns the schedule. The server only sends changes.** Firestore
 * holds the truth about a reminder; the phone mirrors it and arms the alarm
 * itself with AlarmManager. Once armed it rings with no network, with the app
 * closed, with this server down — which is the entire reason this app exists
 * and the reason push must never be the mechanism, only a nudge to run this.
 *
 * So agent reliability equals ONE successful sync. Run it at every opportunity
 * the app is alive anyway: launch, resume, on a push nudge, and after an alarm
 * fires (Android starts the app to handle that).
 *
 * Idempotent by reminder id: arming the same id twice arms it once.
 */

/**
 * Server-owned alarms carry this prefix so reconcile can tell them apart from
 * alarms the person set on the phone (`local_…`) and the test alarm
 * (`test-…`). Without it, a sync would cancel someone's own 7am alarm the
 * first time it ran, because the server has never heard of it.
 */
const SERVER_PREFIX = 'srv_';

export const alarmIdFor = (reminderId: string) => `${SERVER_PREFIX}${reminderId}`;
export const isServerAlarm = (alarmId: string) => alarmId.startsWith(SERVER_PREFIX);
export const reminderIdFor = (alarmId: string) => alarmId.slice(SERVER_PREFIX.length);

export interface SyncResult {
  armed: number;
  cancelled: number;
  kept: number;
  failed: number;
  /** Set when the sync could not run at all — offline, or not signed in. */
  error?: string;
}

export async function syncReminders(deviceId: string): Promise<SyncResult> {
  const result: SyncResult = { armed: 0, cancelled: 0, kept: 0, failed: 0 };

  if (!nativeAlarmAvailable) {
    result.error = 'The native alarm module is not loaded on this build.';
    return result;
  }

  let reminders: ServerReminder[];
  try {
    // The FULL list — sent rows too. See fetchReminders' own comment: a sync
    // needs to tell "delivered" (sent:true, present) apart from "deleted"
    // (absent from this now-complete list). Filtered to outstanding-only,
    // both arrive as the same "missing", and a sync used to cancel the
    // alarm still holding a reminder the server simply hadn't marked sent
    // yet — cancellation must come from an affirmative server statement,
    // never from omission.
    reminders = await fetchReminders({ includeSent: true });
  } catch (e) {
    // Offline, or the session ended. Neither is fatal: whatever is already
    // armed on this phone stays armed and still rings.
    result.error = (e as Error).message;
    return result;
  }

  const armedNow = await listNativeAlarms();
  const armedServerIds = new Set(armedNow.filter((a) => isServerAlarm(a.id)).map((a) => a.id));

  const wanted = new Map<string, ServerReminder>();
  // Alarms the server has explicitly told us are done — the one thing besides
  // true absence (below) that may end an alarm.
  const explicitlyDone = new Set<string>();

  for (const r of reminders) {
    const alarmId = alarmIdFor(r.id);
    if (r.sent) {
      explicitlyDone.add(alarmId);
      continue;
    }
    // A one-shot whose moment has passed but isn't marked sent YET (the
    // server's own tick runs on its own cadence and may not have caught up)
    // is left exactly as it is: not armed fresh — that would make
    // AlarmManager fire it immediately, a reminder ringing late and wrong
    // rather than not at all — and not cancelled either, since this is
    // precisely the state a just-fired alarm's own resume-triggered sync can
    // observe mid-flight. A later sync sees the explicit sent:true above and
    // cleans it up then.
    if (r.repeat === 'none' && r.due_at <= Date.now()) continue;
    // A REPEATING reminder with a stale due_at is safe to arm as-is and does
    // NOT need rolling forward here first: armNative's underlying bridge
    // (AlarmModule.schedule -> AlarmScheduler.schedule, native-patches/alarm/
    // AlarmScheduler.kt) already computes the next occurrence from the
    // device's current time for any repeat other than "none", using only the
    // hour/minute/weekday extracted from `at` by nativeAlarm.ts's toPayload —
    // never the date portion. Any future instant sharing that same
    // time-of-day yields an identical extracted triple, so pre-rolling here
    // would send Kotlin the exact same hour/minute/weekday it already derives
    // itself: a no-op that only risks drifting out of sync with that native
    // algorithm if this file's copy of the maths and the Kotlin's ever
    // diverge. If nativeAlarm.ts's extraction or AlarmScheduler.kt's
    // recomputation ever changes to depend on the date part of `at`, this
    // comment (and this invariant) must be revisited.
    wanted.set(alarmId, r);
  }

  // ── arm what is new, keep what's already armed ──
  for (const [alarmId, r] of wanted) {
    if (armedServerIds.has(alarmId)) {
      result.kept += 1;
      continue;
    }
    try {
      await armNative({
        id: alarmId,
        title: r.text,
        body: '',
        at: new Date(r.due_at).toISOString(),
        repeat: r.repeat || 'none',
      });
      result.armed += 1;
      // Telling the server it is armed is what stops the reminder ALSO
      // arriving as a KingsChat DM when it comes due. Best effort: a failure
      // here means a duplicate message, not a missed alarm, so it must never
      // undo the arming.
      patchReminder(r.id, 'armed', deviceId).catch(() => {});
    } catch {
      result.failed += 1;
    }
  }

  // ── cancel ONLY on an affirmative server statement ──
  // Either this reminder is present and explicitly sent (delivered), or it
  // is genuinely absent from this now-complete list (deleted — the DM
  // "cancel my reminder" intent really does remove the Firestore row).
  // Never on "not currently wanted to (re-)arm", which used to include the
  // just-fired, not-yet-marked-sent gap handled above.
  const stillOnServer = new Set(reminders.map((r) => alarmIdFor(r.id)));
  for (const alarmId of armedServerIds) {
    if (wanted.has(alarmId)) continue;
    const deleted = !stillOnServer.has(alarmId);
    if (!explicitlyDone.has(alarmId) && !deleted) continue;
    try {
      await cancelNative(alarmId);
      result.cancelled += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}

/** The person dismissed or completed an alarm on the phone. */
export async function reportAlarmDone(alarmId: string, deviceId: string): Promise<void> {
  if (!isServerAlarm(alarmId)) return;
  try {
    await patchReminder(reminderIdFor(alarmId), 'done', deviceId);
  } catch {
    // The next sync reconciles it.
  }
}

/** The person deleted a server reminder from the phone. */
export async function cancelServerAlarm(alarmId: string, deviceId: string): Promise<void> {
  await cancelNative(alarmId);
  if (!isServerAlarm(alarmId)) return;
  try {
    await patchReminder(reminderIdFor(alarmId), 'cancelled', deviceId);
  } catch {
    // Offline: the alarm is cancelled locally, the server learns on next sync.
  }
}
