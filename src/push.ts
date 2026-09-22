import {
  AuthorizationStatus,
  getMessaging,
  getToken,
  onMessage,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import { PermissionsAndroid, Platform } from 'react-native';

/**
 * FCM — and nothing about this file is the alarm.
 *
 * Every message we send is data-only and says one thing: "go and reconcile
 * now". The phone then re-reads the reminder list and arms its own alarms.
 * Push is a latency optimisation on top of syncing at launch and resume; if
 * it never arrived the product would still work, just with the phone finding
 * out later. Never make an alarm depend on a push arriving — Doze defers
 * them, and a rarely-opened app gets deprioritised.
 *
 * Everything degrades: no google-services.json, no Play Services, permission
 * denied — each returns null or a no-op rather than throwing, because none of
 * them stop an already-armed alarm from ringing.
 *
 * Modular API (`getMessaging(...)`), not the old `messaging().x` namespace:
 * @react-native-firebase v22+ deprecated that and v26 removed the default
 * export entirely.
 */

export async function requestPushPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return false;
    }
    const status = await requestPermission(getMessaging());
    return (
      status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

/** This install's FCM address, or null if push is unavailable here. */
export async function getPushToken(): Promise<string | null> {
  try {
    return (await getToken(getMessaging())) || null;
  } catch {
    return null;
  }
}

/**
 * FCM rotates tokens on its own schedule. A rotation the backend never hears
 * about is a phone that silently stops being nudged, so re-register on every
 * one.
 */
export function onPushTokenRefresh(handler: (token: string) => void): () => void {
  try {
    return onTokenRefresh(getMessaging(), handler);
  } catch {
    return () => {};
  }
}

/** A nudge while the app is in the foreground. */
export function onPushMessage(handler: (data: Record<string, string>) => void): () => void {
  try {
    return onMessage(getMessaging(), async (msg) => {
      handler((msg.data ?? {}) as Record<string, string>);
    });
  } catch {
    return () => {};
  }
}
