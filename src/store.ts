import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Small, non-secret device state. Anything that is a credential lives in
 * src/session.ts (the OS secure store) instead, never here.
 *
 * What used to be in this file and is deliberately gone: `startUrl` (the
 * WebView's address), `feedUrl` (the paste/pull instruction transport) and
 * `kcId`. The app is a native client of the backend API now — it signs in
 * with KingsChat itself and is handed the kcId with its session, so there is
 * nothing left to point at a website or to type in by hand.
 */

const KEY_DEVICE = 'ka.deviceId.v1';
const KEY_LAST_SYNC = 'ka.lastSync.v1';

/** Stable per-install id, so the backend can address THIS phone. */
export async function deviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY_DEVICE);
  if (existing) return existing;
  const fresh = `dev_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
  await AsyncStorage.setItem(KEY_DEVICE, fresh);
  return fresh;
}

export async function lastSyncAt(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(KEY_LAST_SYNC);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function markSynced(at = Date.now()): Promise<void> {
  await AsyncStorage.setItem(KEY_LAST_SYNC, String(at));
}
