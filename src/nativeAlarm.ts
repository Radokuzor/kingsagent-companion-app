import { NativeModules, Platform } from 'react-native';

/**
 * Bridge to the real Android alarm (AlarmManager.setAlarmClock plus a foreground
 * service). This is Level 2: the phone rings like an alarm clock, not a message.
 *
 * Everything here degrades gracefully. If the native module is missing for any
 * reason, `nativeAlarmAvailable` is false and the caller falls back to
 * expo-notifications, so a reminder is never silently lost.
 */

export type NativeRepeat = 'none' | 'daily' | 'weekdays' | 'weekly';

/** Structural type, not imported from instructions.ts, to avoid an import cycle. */
export interface AlarmInstructionLike {
  id: string;
  title: string;
  body?: string;
  at?: string;
  repeat?: string;
}

export interface NativeAlarmRecord {
  id: string;
  title: string;
  body: string;
  triggerAt: number;
  repeat: NativeRepeat;
  hour: number;
  minute: number;
  weekday: number;
}

interface KingsAlarmBridge {
  canScheduleExact(): Promise<boolean>;
  schedule(payloadJson: string): Promise<string>;
  scheduleAt(payloadJson: string, atMillis: number): Promise<string>;
  cancel(id: string): Promise<boolean>;
  cancelAll(): Promise<boolean>;
  getAll(): Promise<string>;
  stopRinging(): Promise<boolean>;
  alarmAccess(): Promise<string>;
  openAccessSettings(target: string): Promise<boolean>;
  pushToken(): Promise<string>;
}

/**
 * The four gates on a real alarm. `true` means granted, or not applicable to
 * this Android version. Since Android 14 a full-screen alarm is a Special App
 * Access permission that an ordinary app does not get automatically, so the app
 * reports it rather than ringing silently as a banner.
 */
export interface AlarmAccess {
  fullScreen: boolean;
  exactAlarm: boolean;
  battery: boolean;
  notifications: boolean;
  androidVersion: string;
  sdkInt: number;
}

export type AccessTarget = 'fullScreen' | 'exactAlarm' | 'battery' | 'notifications';

const bridge: KingsAlarmBridge | undefined = (NativeModules as Record<string, KingsAlarmBridge>)
  .KingsAlarm;

export const nativeAlarmAvailable: boolean =
  Platform.OS === 'android' && typeof bridge?.schedule === 'function';

export const nativeAlarmStatus: string = nativeAlarmAvailable
  ? 'real alarm (AlarmManager + foreground service)'
  : Platform.OS === 'android'
    ? 'notification only (native alarm module not loaded)'
    : 'notification only (not Android)';

/** JS getDay() is 0=Sunday. java.util.Calendar is 1=Sunday. */
const JS_TO_JAVA_WEEKDAY = [1, 2, 3, 4, 5, 6, 7];

function toPayload(instr: AlarmInstructionLike) {
  const when = instr.at ? new Date(instr.at) : new Date(Date.now() + 60_000);
  return {
    id: instr.id,
    title: instr.title,
    body: instr.body ?? '',
    at: when.getTime(),
    repeat: (instr.repeat ?? 'none') as NativeRepeat,
    hour: when.getHours(),
    minute: when.getMinutes(),
    weekday: JS_TO_JAVA_WEEKDAY[when.getDay()] ?? 1,
  };
}

function requireBridge(): KingsAlarmBridge {
  if (!bridge) throw new Error('native alarm module unavailable');
  return bridge;
}

/** Arms a repeating or one-shot alarm on the phone itself. */
export async function armNative(instr: AlarmInstructionLike): Promise<NativeAlarmRecord> {
  const json = await requireBridge().schedule(JSON.stringify(toPayload(instr)));
  return JSON.parse(json) as NativeAlarmRecord;
}

/** Arms a one-shot at an explicit instant. Used by the test alarm. */
export async function armNativeAt(
  instr: AlarmInstructionLike,
  atMillis: number,
): Promise<NativeAlarmRecord> {
  const json = await requireBridge().scheduleAt(JSON.stringify(toPayload(instr)), atMillis);
  return JSON.parse(json) as NativeAlarmRecord;
}

export async function cancelNative(id: string): Promise<void> {
  if (!bridge) return;
  await bridge.cancel(id);
}

export async function cancelAllNative(): Promise<void> {
  if (!bridge) return;
  await bridge.cancelAll();
}

export async function listNativeAlarms(): Promise<NativeAlarmRecord[]> {
  if (!bridge) return [];
  try {
    return JSON.parse(await bridge.getAll()) as NativeAlarmRecord[];
  } catch {
    return [];
  }
}

export async function nativeCanScheduleExact(): Promise<boolean> {
  if (!bridge) return false;
  try {
    return await bridge.canScheduleExact();
  } catch {
    return false;
  }
}

/** Silences a ringing alarm from inside the app. */
export async function stopNativeRinging(): Promise<void> {
  if (!bridge) return;
  try {
    await bridge.stopRinging();
  } catch {
    // nothing to stop
  }
}

/** Current state of the four alarm gates, or null if the module is missing. */
export async function alarmAccess(): Promise<AlarmAccess | null> {
  if (!bridge) return null;
  try {
    return JSON.parse(await bridge.alarmAccess()) as AlarmAccess;
  } catch {
    return null;
  }
}

/** Sends the user straight to the system screen for one gate. */
export async function openAccessSettings(target: AccessTarget): Promise<boolean> {
  if (!bridge) return false;
  try {
    return await bridge.openAccessSettings(target);
  } catch {
    return false;
  }
}

/**
 * This device's push token, for one-time pairing with a KingsChat account.
 * Only the UI needs it; the alarm path is entirely native.
 */
export async function pushToken(): Promise<string> {
  if (!bridge) throw new Error('native alarm module unavailable');
  return bridge.pushToken();
}
