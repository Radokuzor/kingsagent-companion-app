import { registerRootComponent } from 'expo';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';

import App from './App';
import { deviceId } from './src/store';
import { syncReminders } from './src/sync';

/**
 * The background nudge handler — and the reason it is HERE, at module scope,
 * rather than inside a component.
 *
 * Android delivers a data-only FCM message to a headless JS task when the app
 * is not in the foreground. That task runs before any React tree exists, so
 * the handler has to be registered as the bundle loads or the message is
 * dropped. This is what makes "the agent sets a reminder in a KingsChat DM and
 * the phone arms the alarm" work with the app closed.
 *
 * What it does is reconcile, not ring: it re-reads the reminder list and hands
 * anything new to AlarmManager, which then owns the alarm from that moment —
 * offline, and whether or not any further push ever arrives. The nudge only
 * decides HOW SOON the phone finds out, never whether the alarm fires.
 *
 * Every failure is swallowed. A throw here is an unhandled headless-task
 * error; the next launch or resume reconciles anyway.
 */
try {
  setBackgroundMessageHandler(getMessaging(), async (message) => {
    if (message?.data?.type !== 'sync') return;
    try {
      await syncReminders(await deviceId());
    } catch {
      // Offline, or signed out. The next foreground sync covers it.
    }
  });
} catch {
  // No Firebase on this build (no google-services.json). Alarms and
  // foreground syncing are unaffected — only the instant nudge is missing.
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
registerRootComponent(App);
