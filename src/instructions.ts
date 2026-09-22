import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { armNative, cancelNative, nativeAlarmAvailable } from './nativeAlarm';

/**
 * Instruction envelope — the ONE contract between the KingsChat agent and this app.
 * The agent DMs this JSON (or a URL that serves it). Nothing else is programmable in v1.
 */
export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly';
export type InstructionType = 'reminder' | 'task' | 'command';

export interface Instruction {
  /** Stable id from the agent. Same id twice = armed once (idempotent). */
  id: string;
  type: InstructionType;
  title: string;
  body?: string;
  /** ISO 8601 with offset, e.g. 2026-09-22T14:00:00+01:00. Local strings also accepted. */
  at?: string;
  repeat?: Repeat;
  data?: Record<string, unknown>;
}

export interface ArmedReminder extends Instruction {
  notificationIds: string[];
  armedAt: string;
  source: 'paste' | 'feed' | 'test' | 'local';
  /** Which engine actually armed it. 'native' is the real ringing alarm. */
  engine?: 'native' | 'notification';
}

/** Android channel that actually rings (MAX importance + sound). */
export const ALARM_CHANNEL_ID = 'kings-agent-alarms-v2';

/**
 * The previous channel id. Android freezes a channel's sound once it exists, so
 * changing the sound requires a NEW channel id, otherwise the change is ignored
 * on every device that already has the old one.
 */
const LEGACY_CHANNEL_ID = 'kings-agent-alarms';

/** The alarm sound, shipped in android/app/src/main/res/raw/alarm.wav */
const ALARM_SOUND = 'alarm.wav';

export const TYPES: InstructionType[] = ['reminder', 'task', 'command'];
export const REPEATS: Repeat[] = ['none', 'daily', 'weekdays', 'weekly'];

// ---------------------------------------------------------------- parsing

export type ParseResult =
  | { ok: true; instructions: Instruction[] }
  | { ok: false; error: string };

function coerce(raw: unknown, where: string): { instruction?: Instruction; error?: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: `${where}: not a JSON object` };
  }
  const o = raw as Record<string, unknown>;

  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : '';
  if (!id) return { error: `${where}: missing "id"` };

  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : '';
  if (!title) return { error: `${where} (id=${id}): missing "title"` };

  const type: InstructionType = TYPES.includes(o.type as InstructionType)
    ? (o.type as InstructionType)
    : 'reminder';

  const repeat: Repeat = REPEATS.includes(o.repeat as Repeat) ? (o.repeat as Repeat) : 'none';

  const at = typeof o.at === 'string' && o.at.trim() ? o.at.trim() : undefined;
  if (type === 'reminder' && !at) {
    return { error: `${where} (id=${id}): a reminder needs "at"` };
  }
  if (at && Number.isNaN(new Date(at).getTime())) {
    return { error: `${where} (id=${id}): "at" is not a date I can read (${at})` };
  }

  return {
    instruction: {
      id,
      type,
      title,
      body: typeof o.body === 'string' ? o.body : undefined,
      at,
      repeat,
      data: typeof o.data === 'object' && o.data !== null ? (o.data as Record<string, unknown>) : undefined,
    },
  };
}

/** Accepts a single object, an array, or {"instructions": [...]}. */
export function parseInstruction(raw: string): ParseResult {
  const text = (raw ?? '').trim();
  if (!text) return { ok: false, error: 'Nothing pasted.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }

  let list: unknown[];
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { instructions?: unknown[] }).instructions)
  ) {
    list = (parsed as { instructions: unknown[] }).instructions;
  } else {
    list = [parsed];
  }

  if (list.length === 0) return { ok: false, error: 'No instructions in that payload.' };

  const out: Instruction[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];

  list.forEach((item, i) => {
    const { instruction, error } = coerce(item, `item ${i + 1}`);
    if (error) {
      errors.push(error);
      return;
    }
    if (instruction && !seen.has(instruction.id)) {
      seen.add(instruction.id);
      out.push(instruction);
    }
  });

  if (out.length === 0) {
    return { ok: false, error: errors.join('\n') || 'Nothing usable in that payload.' };
  }
  if (errors.length) {
    return { ok: false, error: `${out.length} usable, ${errors.length} rejected:\n${errors.join('\n')}` };
  }
  return { ok: true, instructions: out };
}

// ---------------------------------------------------------------- scheduling

export function describe(instr: Instruction): string {
  if (!instr.at) return instr.type === 'command' ? 'runs when opened' : 'no time set';
  const d = new Date(instr.at);
  if (Number.isNaN(d.getTime())) return instr.at;
  const label = d.toLocaleString([], {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return instr.repeat && instr.repeat !== 'none' ? `${label} · ${instr.repeat}` : label;
}

/** Ask for the two Android things that decide whether an alarm actually rings. */
export async function ensurePermissions(): Promise<{ granted: boolean; message: string }> {
  if (Platform.OS === 'android') {
    // Retire the old channel so its frozen default sound cannot linger.
    try {
      await Notifications.deleteNotificationChannelAsync(LEGACY_CHANNEL_ID);
    } catch {
      // never existed on this device, nothing to do
    }

    await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
      name: 'Kings Agent alarms',
      description: 'Reminders and tasks sent by the agent',
      importance: Notifications.AndroidImportance.MAX,
      sound: ALARM_SOUND,
      // Play on the ALARM stream rather than the notification stream. This is the
      // single biggest reason a reminder sounds like an alarm and not a ping: the
      // alarm stream is usually at full volume even when notifications are quiet.
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.ALARM,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
        flags: {
          enforceAudibility: true,
          requestHardwareAudioVideoSynchronization: false,
        },
      },
      // An insistent pattern, not one polite buzz.
      vibrationPattern: [0, 700, 250, 700, 250, 700, 600, 700, 600, 700],
      enableVibrate: true,
      enableLights: true,
      lightColor: '#4DA3FF',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
      showBadge: true,
    });
  }

  let status = (await Notifications.getPermissionsAsync()).status;
  if (status !== 'granted') {
    status = (
      await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      })
    ).status;
  }

  if (status === 'granted') return { granted: true, message: 'Notifications allowed.' };
  return {
    granted: false,
    message:
      'Notifications are blocked. Android 13+: Settings > Apps > Kings Agent > Notifications. ' +
      'Android 12+: also allow "Alarms & reminders" or timed alarms will not fire.',
  };
}

function contentFor(instr: Instruction): Notifications.NotificationContentInput {
  return {
    title: instr.title,
    body: instr.body ?? '',
    sound: ALARM_SOUND,
    data: { ...(instr.data ?? {}), instructionId: instr.id, instructionType: instr.type },
  };
}

export interface ArmResult {
  engine: 'native' | 'notification';
  notificationIds: string[];
}

/**
 * Arms the instruction on the DEVICE.
 *
 * Prefers the real Android alarm, which rings like an alarm clock and survives
 * Doze, the app being closed and the phone being rebooted. Falls back to an
 * expo-notifications notification if the native module is unavailable, so a
 * reminder is never silently lost.
 */
export async function scheduleInstruction(instr: Instruction): Promise<ArmResult> {
  if (instr.type === 'command') return { engine: 'notification', notificationIds: [] };

  if (!instr.at) throw new Error('No "at" time to schedule.');

  if (nativeAlarmAvailable) {
    const at = new Date(instr.at);
    if (Number.isNaN(at.getTime())) throw new Error(`Unreadable time: ${instr.at}`);
    if ((instr.repeat ?? 'none') === 'none' && at.getTime() <= Date.now() + 5_000) {
      throw new Error('That time is already in the past.');
    }
    try {
      await armNative(instr);
      return { engine: 'native', notificationIds: [] };
    } catch {
      // fall through to the notification path so something is still armed
    }
  }

  const when = new Date(instr.at);
  if (Number.isNaN(when.getTime())) throw new Error(`Unreadable time: ${instr.at}`);

  const repeat = instr.repeat ?? 'none';

  if (repeat === 'none') {
    if (when.getTime() <= Date.now() + 5_000) {
      throw new Error('That time is already in the past.');
    }
    const id = await Notifications.scheduleNotificationAsync({
      content: contentFor(instr),
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
        channelId: ALARM_CHANNEL_ID,
      } as Notifications.DateTriggerInput,
    });
    return { engine: 'notification', notificationIds: [id] };
  }

  const hour = when.getHours();
  const minute = when.getMinutes();
  const ids: string[] = [];

  if (repeat === 'daily') {
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: contentFor(instr),
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
          channelId: ALARM_CHANNEL_ID,
        } as Notifications.DailyTriggerInput,
      }),
    );
    return { engine: 'notification', notificationIds: ids };
  }

  // weekly -> that weekday only. weekdays -> Mon..Fri (Expo: 1=Sunday .. 7=Saturday).
  const weekdays = repeat === 'weekly' ? [when.getDay() + 1] : [2, 3, 4, 5, 6];
  for (const weekday of weekdays) {
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: contentFor(instr),
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday,
          hour,
          minute,
          channelId: ALARM_CHANNEL_ID,
        } as Notifications.WeeklyTriggerInput,
      }),
    );
  }
  return { engine: 'notification', notificationIds: ids };
}

export async function cancelArmed(armed: ArmedReminder): Promise<void> {
  if (armed.engine === 'native') {
    await cancelNative(armed.id);
    return;
  }
  for (const id of armed.notificationIds) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // already fired or gone, nothing to do
    }
  }
}

/** The one-tap proof that the alarm path works, before any agent is involved. */
export function testInstruction(seconds = 20): Instruction {
  const at = new Date(Date.now() + seconds * 1000).toISOString();
  return {
    id: `test-${Date.now()}`,
    type: 'reminder',
    title: 'Kings Agent test alarm',
    body: `If you can read this, the agent can ring your phone. (${seconds}s timer)`,
    at,
    repeat: 'none',
    data: { test: true },
  };
}
