import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import type { ArmedReminder, Instruction } from './instructions';

const KEY_REMINDERS = 'ka.reminders.v1';
const KEY_SETTINGS = 'ka.settings.v1';
const KEY_DEVICE = 'ka.deviceId.v1';

/**
 * The site the WebView opens.
 *
 * Deliberately NOT hardcoded here. It lives in `app.json` under
 * `expo.extra.siteUrl`, so when the domain moves there is exactly ONE line to
 * change in config, and the runtime Settings field can override it with no
 * rebuild at all.
 */
const CONFIGURED_SITE_URL =
  (Constants.expoConfig?.extra as { siteUrl?: string } | undefined)?.siteUrl?.trim() ?? '';

export const START_URL_DEFAULT = CONFIGURED_SITE_URL;

export interface Settings {
  /** What the app shows. Seeded from app.json, overridable on the device. */
  startUrl: string;
  /** Optional: GET <feedUrl>?device=<deviceId> returns an instruction payload. */
  feedUrl: string;
  /** Optional: set once the agent knows which kcId this device belongs to. */
  kcId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  startUrl: START_URL_DEFAULT,
  feedUrl: '',
  kcId: '',
};

export async function loadReminders(): Promise<ArmedReminder[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_REMINDERS);
    if (!raw) return [];
    const list = JSON.parse(raw) as ArmedReminder[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveReminders(list: ArmedReminder[]): Promise<void> {
  await AsyncStorage.setItem(KEY_REMINDERS, JSON.stringify(list));
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(KEY_SETTINGS);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(KEY_SETTINGS, JSON.stringify(settings));
}

/** Cheap per-install id so the agent can address THIS phone. */
export async function deviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY_DEVICE);
  if (existing) return existing;
  const fresh = `dev_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
  await AsyncStorage.setItem(KEY_DEVICE, fresh);
  return fresh;
}

/** Same instruction id twice is armed once. */
export function alreadyArmed(list: ArmedReminder[], instruction: Instruction): boolean {
  return list.some((r) => r.id === instruction.id);
}
