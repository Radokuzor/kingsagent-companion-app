import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import AlarmsScreen from './src/AlarmsScreen';
import SettingsScreen from './src/SettingsScreen';
import SignInScreen from './src/SignInScreen';
import { registerDevice, unregisterDevice } from './src/api';
import { ensurePermissions } from './src/instructions';
import {
  alarmAccess,
  cancelNative,
  listNativeAlarms,
  type AlarmAccess,
  type NativeAlarmRecord,
} from './src/nativeAlarm';
import { getPushToken, onPushMessage, onPushTokenRefresh, requestPushPermission } from './src/push';
import { clearSession, loadSession, type Session } from './src/session';
import { deviceId as loadDeviceId, lastSyncAt, markSynced } from './src/store';
import { isServerAlarm, syncReminders } from './src/sync';
import { C, S } from './src/theme';

/**
 * Kings Agent companion — a native client of the Kings Agent backend.
 *
 * Two jobs, and the order matters: it is the **execution surface** for the
 * agent (a reminder set in a KingsChat DM rings here like an alarm clock,
 * offline, with the app closed), and it shows the person their own alarms
 * natively. It is not a browser for the website — the WebView, the kcId
 * scraper and the paste-an-instruction tab are gone, and per the architecture
 * brief they do not come back.
 *
 * Sync is the heartbeat. `syncReminders` runs at launch, on resume, and on a
 * push nudge; once it has run, every alarm it armed is held by Android's own
 * AlarmManager and needs nothing from us again.
 */

// A notification arriving while the app is open must still show.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type Tab = 'alarms' | 'settings';

const APP_VERSION = String(Constants.expoConfig?.version ?? '1.0.0');

export default function App() {
  return (
    <SafeAreaProvider>
      <KingsAgentApp />
    </SafeAreaProvider>
  );
}

function KingsAgentApp() {
  const insets = useSafeAreaInsets();
  const [booted, setBooted] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [tab, setTab] = useState<Tab>('alarms');
  const [alarms, setAlarms] = useState<NativeAlarmRecord[]>([]);
  const [access, setAccess] = useState<AlarmAccess | null>(null);
  const [pushReady, setPushReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');

  const deviceIdRef = useRef('');
  const sessionRef = useRef<Session | null>(null);
  deviceIdRef.current = deviceId;
  sessionRef.current = session;

  /** What is actually armed on this phone, and what Android currently allows. */
  const refreshLocal = useCallback(async () => {
    const [list, acc] = await Promise.all([listNativeAlarms(), alarmAccess()]);
    setAlarms(list);
    setAccess(acc);
  }, []);

  /**
   * Pull the server's reminders and make the phone match. Safe to call as
   * often as we like — it is idempotent by reminder id.
   */
  const sync = useCallback(async () => {
    if (!sessionRef.current || !deviceIdRef.current) return;
    setSyncing(true);
    try {
      const r = await syncReminders(deviceIdRef.current);
      if (r.error) {
        // Offline is the common case and is not a failure worth alarming
        // anyone about: whatever is armed stays armed and still rings.
        const at = await lastSyncAt();
        setSyncNote(
          at ? `Offline — last synced ${timeAgo(at)}. Armed alarms still ring.` : 'Not synced yet.',
        );
      } else {
        await markSynced();
        setSyncNote(
          r.armed || r.cancelled
            ? `Synced — ${r.armed} armed, ${r.cancelled} cleared.`
            : 'Synced just now.',
        );
      }
      await refreshLocal();
    } finally {
      setSyncing(false);
    }
  }, [refreshLocal]);

  // ── boot ───────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [id, existing] = await Promise.all([loadDeviceId(), loadSession()]);
      setDeviceId(id);
      deviceIdRef.current = id;
      setSession(existing);
      sessionRef.current = existing;
      await ensurePermissions();
      await refreshLocal();
      setBooted(true);
      if (existing) {
        await setUpPush(id);
        await sync();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Register this phone and start listening for nudges. Every step is
   * best-effort: without push the app still syncs at launch and on resume,
   * which is the documented floor, not a degraded mode to hide.
   */
  const setUpPush = useCallback(async (id: string) => {
    const granted = await requestPushPermission();
    const token = granted ? await getPushToken() : null;
    setPushReady(!!token);
    try {
      await registerDevice(id, token, APP_VERSION);
    } catch {
      // The next launch registers again.
    }
  }, []);

  // A rotated FCM token the backend never hears about is a phone that
  // silently stops being nudged.
  useEffect(() => {
    if (!session) return;
    return onPushTokenRefresh((token) => {
      registerDevice(deviceIdRef.current, token, APP_VERSION).catch(() => {});
      setPushReady(true);
    });
  }, [session]);

  // A nudge means "go and reconcile now" — never "this is the reminder".
  useEffect(() => {
    if (!session) return;
    return onPushMessage((data) => {
      if (data.type === 'sync') void sync();
    });
  }, [session, sync]);

  // Resume is the reliable sync point: Android also starts the app when an
  // alarm fires, so this covers "reconcile after every alarm" too.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void refreshLocal();
      if (sessionRef.current) void sync();
    });
    return () => sub.remove();
  }, [refreshLocal, sync]);

  // Back on Settings returns to Alarms rather than leaving the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab !== 'alarms') {
        setTab('alarms');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [tab]);

  const onSignedIn = useCallback(
    async (next: Session) => {
      setSession(next);
      sessionRef.current = next;
      await setUpPush(deviceIdRef.current);
      await sync();
    },
    [setUpPush, sync],
  );

  const onSignOut = useCallback(async () => {
    // Cancel the agent's alarms first. Leaving them armed would mean a phone
    // that nobody is signed in on still ringing for someone else's reminders,
    // with no way in the UI to see or stop them.
    const current = await listNativeAlarms();
    await Promise.all(current.filter((a) => isServerAlarm(a.id)).map((a) => cancelNative(a.id)));
    unregisterDevice(deviceIdRef.current).catch(() => {});
    await clearSession();
    setSession(null);
    sessionRef.current = null;
    setPushReady(false);
    setSyncNote('');
    setTab('alarms');
    await refreshLocal();
  }, [refreshLocal]);

  if (!booted) {
    return (
      <View style={[styles.splash, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <Text style={styles.splashText}>Kings Agent</Text>
      </View>
    );
  }

  if (!session) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <StatusBar style="light" />
        <SignInScreen deviceId={deviceId} appVersion={APP_VERSION} onSignedIn={onSignedIn} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.body}>
        {tab === 'alarms' ? (
          <AlarmsScreen
            alarms={alarms}
            deviceId={deviceId}
            syncing={syncing}
            syncNote={syncNote}
            onRefresh={sync}
            onChanged={refreshLocal}
          />
        ) : (
          <SettingsScreen
            session={session}
            access={access}
            pushReady={pushReady}
            onSignOut={onSignOut}
            onRecheck={refreshLocal}
          />
        )}
      </View>

      <View style={[styles.tabs, { paddingBottom: Math.max(insets.bottom, S.sm) }]}>
        <TabButton label="Alarms" on={tab === 'alarms'} onPress={() => setTab('alarms')} />
        <TabButton label="Settings" on={tab === 'settings'} onPress={() => setTab('settings')} />
      </View>
    </View>
  );
}

function TabButton({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.tab} hitSlop={6}>
      <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
      <View style={[styles.tabBar, on && styles.tabBarOn]} />
    </Pressable>
  );
}

function timeAgo(at: number): string {
  const mins = Math.floor((Date.now() - at) / 60000);
  if (mins < 1) return 'moments ago';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  // Android 16 forces edge-to-edge, so every screen respects the system bars
  // itself — without this the tabs sit under the navigation buttons.
  root: { flex: 1, backgroundColor: C.bg },
  body: { flex: 1 },
  splash: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  splashText: { color: C.dim, fontSize: 16, fontWeight: '700', letterSpacing: 1 },
  tabs: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: C.line,
    backgroundColor: C.bgDeep,
    paddingTop: S.sm,
  },
  tab: { flex: 1, alignItems: 'center', gap: 6 },
  tabText: { color: C.faint, fontSize: 13, fontWeight: '600' },
  tabTextOn: { color: C.text },
  tabBar: { height: 2, width: 26, borderRadius: 2, backgroundColor: 'transparent' },
  tabBarOn: { backgroundColor: C.accent },
});
