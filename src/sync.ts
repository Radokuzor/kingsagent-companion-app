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
    reminders = await fetchReminders();
  } catch (e) {
    // Offline, or the session ended. Neither is fatal: whatever is already
    // armed on this phone stays armed and still rings.
    result.error = (e as Error).message;
    return result;
  }

  const armedNow = await listNativeAlarms();
  const armedServerIds = new Set(armedNow.filter((a) => isServerAlarm(a.id)).map((a) => a.id));

  const wanted = new Map<string, ServerReminder>();
  for (const r of reminders) {
    if (r.sent) continue;
    // A one-shot whose moment has passed is not armed. Arming it would make
    // AlarmManager fire immediately, which is a reminder ringing late and
    // wrong rather than not at all.
    if (r.repeat === 'none' && r.due_at <= Date.now()) continue;
    wanted.set(alarmIdFor(r.id), r);
  }

  // ── arm what is new ──
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

  // ── cancel what the server no longer has ──
  for (const alarmId of armedServerIds) {
    if (wanted.has(alarmId)) continue;
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
