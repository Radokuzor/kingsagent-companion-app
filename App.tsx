import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Notifications from 'expo-notifications';

import {
  ArmedReminder,
  Instruction,
  cancelArmed,
  describe,
  ensurePermissions,
  parseInstruction,
  scheduleInstruction,
  testInstruction,
} from './src/instructions';
import {
  DEFAULT_SETTINGS,
  Settings,
  alreadyArmed,
  deviceId,
  loadReminders,
  loadSettings,
  saveReminders,
  saveSettings,
} from './src/store';
import {
  AccessTarget,
  AlarmAccess,
  NativeAlarmRecord,
  alarmAccess,
  cancelNative,
  listNativeAlarms,
  nativeAlarmAvailable,
  nativeAlarmStatus,
  openAccessSettings,
  pushToken,
  stopNativeRinging,
} from './src/nativeAlarm';

// A notification that arrives while the app is open must still show.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Alarms first. This is an alarm app that also shows the site, not the reverse.
type Tab = 'alarms' | 'site' | 'arm';
type RepeatOpt = 'none' | 'daily' | 'weekdays' | 'weekly';

const REPEAT_OPTIONS: RepeatOpt[] = ['none', 'daily', 'weekdays', 'weekly'];

/**
 * The four things Android gates a real alarm behind. Since Android 14 the first
 * one is no longer granted at install time for an ordinary app, which is why an
 * alarm can ring as a quiet banner instead of taking over the screen.
 */
const ACCESS_ROWS: { key: AccessTarget; title: string; why: string }[] = [
  {
    key: 'fullScreen',
    title: 'Full screen alarms',
    why: 'Android 14 and up needs this switched on by hand. Without it the alarm rings as a banner instead of taking over the screen.',
  },
  {
    key: 'exactAlarm',
    title: 'Exact alarms',
    why: 'Without this Android may delay the alarm, so it fires late.',
  },
  {
    key: 'battery',
    title: 'Battery optimisation off',
    why: 'With optimisation on, Android can hold alarms back while the phone is idle.',
  },
  {
    key: 'notifications',
    title: 'Notifications allowed',
    why: 'With notifications off an alarm cannot appear at all.',
  },
];

const SAMPLE = JSON.stringify(
  {
    instructions: [
      {
        id: 'rem_20260922_1400',
        type: 'reminder',
        title: 'Workout',
        body: 'Legs day. 45 minutes.',
        at: '2026-09-22T14:00:00+01:00',
        repeat: 'weekdays',
        data: { from: 'kingschat' },
      },
    ],
  },
  null,
  2,
);

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * The web app's API. Must match `NEXT_PUBLIC_API_URL` in the frontend's build,
 * because the injected script below calls it cross-origin from inside the page.
 */
const KCID_API_BASE = 'https://kcagent.up.railway.app/api';

/**
 * Runs inside the WebView, on the page's own origin, and hands the phone the
 * kcId of whoever is signed in there.
 *
 * Why this is the whole answer: the kcId belongs to the SESSION the WebView is
 * already holding, not to anything the app can compute. The site keeps its
 * KingsChat identity in `localStorage.user` after sign in, so the page can read
 * it. Nothing is typed and there is no pairing step.
 *
 * It polls rather than reading once, because sign in ends on a client-side
 * route change inside a single page load: `injectedJavaScript` fires on
 * document load, so a one-shot read would miss the moment the session appears.
 */
const KCID_SNIPPET = `(function () {
  if (window.__kaKcIdTimer) return;
  var API = '${KCID_API_BASE}';
  var sent = '';
  function post(kcId, src) {
    kcId = String(kcId || '').toLowerCase();
    // Exactly 24 hex characters, or it is not a kcId. Checked here as well as
    // on the native side: a wrong value would mis-address this phone later.
    if (!/^[0-9a-f]{24}$/.test(kcId) || kcId === sent) return;
    sent = kcId;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ka.kcId', kcId: kcId, src: src }));
  }
  function fromStorage() {
    try {
      var u = JSON.parse(localStorage.getItem('user') || '{}');
      return (u && u.kcId) || '';
    } catch (e) { return ''; }
  }
  function fromApi() {
    var t = localStorage.getItem('token');
    if (!t) return;
    fetch(API + '/auth/me', { headers: { Authorization: 'Bearer ' + t } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) post((d.kcId || (d.user && d.user.kcId) || ''), 'api'); })
      .catch(function () {});
  }
  function tick() {
    if (window.__kaKcIdDone) {
      clearInterval(window.__kaKcIdTimer);
      window.__kaKcIdTimer = null;
      return;
    }
    var k = fromStorage();
    if (k) post(k, 'localStorage'); else fromApi();
  }
  tick();
  window.__kaKcIdTimer = setInterval(tick, 3000);
})();
true;`;

/** The next time today at hh:mm, or tomorrow if that moment has passed. */
function nextOccurrence(hour: number, minute: number): Date {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

function formatWhen(rec: NativeAlarmRecord): string {
  const d = new Date(rec.triggerAt);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const rep = rec.repeat === 'none' ? 'once' : rec.repeat;
  const when = rec.repeat === 'none' ? `${day} ${d.toLocaleDateString()}` : `next ${day}`;
  return `${time} · ${when} · ${rep}`;
}

// Android 16 forces edge-to-edge, so every screen must respect the system bars
// itself. Without this the bottom tabs sit under the phone's navigation buttons.
export default function App() {
  return (
    <SafeAreaProvider>
      <KingsAgentApp />
    </SafeAreaProvider>
  );
}

function KingsAgentApp() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('alarms');
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [draft, setDraft] = useState<Settings>(DEFAULT_SETTINGS);
  const [reminders, setReminders] = useState<ArmedReminder[]>([]);
  const [nativeAlarms, setNativeAlarms] = useState<NativeAlarmRecord[]>([]);
  const [access, setAccess] = useState<AlarmAccess | null>(null);
  const [paste, setPaste] = useState('');
  const [feedback, setFeedback] = useState('');
  const [permissionNote, setPermissionNote] = useState('');
  const [thisDevice, setThisDevice] = useState('');
  const [feedNote, setFeedNote] = useState('');
  const [newHour, setNewHour] = useState(7);
  const [newMinute, setNewMinute] = useState(0);
  const [newRepeat, setNewRepeat] = useState<RepeatOpt>('daily');
  const [newLabel, setNewLabel] = useState('');
  const [webCanGoBack, setWebCanGoBack] = useState(false);
  const [pushTok, setPushTok] = useState('');
  const [pushErr, setPushErr] = useState('');
  const webRef = useRef<WebView>(null);
  const remindersRef = useRef<ArmedReminder[]>([]);
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);

  remindersRef.current = reminders;
  settingsRef.current = settings;

  /** What the phone currently allows, and what is actually armed on it. */
  const refreshNative = useCallback(async () => {
    const [list, acc] = await Promise.all([listNativeAlarms(), alarmAccess()]);
    setNativeAlarms(list);
    setAccess(acc);
  }, []);

  // ---- boot
  useEffect(() => {
    (async () => {
      const [s, r, id] = await Promise.all([loadSettings(), loadReminders(), deviceId()]);
      setSettings(s);
      setDraft(s);
      setReminders(r);
      setThisDevice(id);
      setReady(true);
      const perm = await ensurePermissions();
      setPermissionNote(perm.message);
      await refreshNative();
      // The push token is only needed for one-time pairing, so a failure here
      // must never hold up the alarm side of the app.
      try {
        setPushTok(await pushToken());
      } catch (e) {
        setPushErr((e as Error).message);
      }
    })();
  }, [refreshNative]);

  // ---- refresh when the user comes back, because the fix is to leave the app,
  // flip a system switch, and return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshNative();
    });
    return () => sub.remove();
  }, [refreshNative]);

  // ---- tapping a notification opens the site
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => setTab('site'));
    return () => sub.remove();
  }, []);

  const arm = useCallback(
    async (instructions: Instruction[], source: ArmedReminder['source']): Promise<string> => {
      const lines: string[] = [];
      const next = [...remindersRef.current];

      for (const instr of instructions) {
        if (alreadyArmed(next, instr)) {
          lines.push(`• ${instr.title} — already armed, skipped`);
          continue;
        }
        try {
          const result = await scheduleInstruction(instr);
          next.push({
            ...instr,
            notificationIds: result.notificationIds,
            engine: result.engine,
            armedAt: new Date().toISOString(),
            source,
          });
          lines.push(`• ${instr.title} — ${describe(instr)} [${result.engine}]`);
        } catch (e) {
          lines.push(`• ${instr.title} — FAILED: ${(e as Error).message}`);
        }
      }

      setReminders(next);
      await saveReminders(next);
      return lines.join('\n');
    },
    [],
  );

  // ---- optional pull transport: GET <feedUrl>?device=<id>
  useEffect(() => {
    if (!settings.feedUrl || !thisDevice) return;
    let cancelled = false;

    const pull = async () => {
      try {
        const url = `${settings.feedUrl}${settings.feedUrl.includes('?') ? '&' : '?'}device=${encodeURIComponent(thisDevice)}`;
        const res = await fetch(url);
        const text = await res.text();
        if (cancelled) return;
        const parsed = parseInstruction(text);
        if (!parsed.ok) {
          setFeedNote(`feed: ${parsed.error}`);
          return;
        }
        const fresh = parsed.instructions.filter((i) => !alreadyArmed(remindersRef.current, i));
        if (fresh.length === 0) {
          setFeedNote('feed: nothing new');
          return;
        }
        const summary = await arm(fresh, 'feed');
        setFeedNote(`feed: armed ${fresh.length}\n${summary}`);
        await refreshNative();
      } catch (e) {
        if (!cancelled) setFeedNote(`feed: ${(e as Error).message}`);
      }
    };

    pull();
    const timer = setInterval(pull, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [settings.feedUrl, thisDevice, arm, refreshNative]);

  // ---- Android back: leave the site history first, then return home.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab === 'site') {
        if (webCanGoBack) {
          webRef.current?.goBack();
        } else {
          setTab('alarms');
        }
        return true;
      }
      if (tab === 'arm') {
        setTab('alarms');
        return true;
      }
      // On the Alarms tab, let Android do its normal thing and leave the app.
      return false;
    });
    return () => sub.remove();
  }, [tab, webCanGoBack]);

  const onPasteArm = useCallback(async () => {
    const parsed = parseInstruction(paste);
    if (!parsed.ok) {
      setFeedback(`Rejected.\n${parsed.error}`);
      return;
    }
    const perm = await ensurePermissions();
    setPermissionNote(perm.message);
    const summary = await arm(parsed.instructions, 'paste');
    setFeedback(`Armed from clipboard:\n${summary}`);
    setPaste('');
    await refreshNative();
    setTab('alarms');
  }, [paste, arm, refreshNative]);

  /** The whole local-alarm path: pick a time, set it, it rings without us. */
  const onCreateAlarm = useCallback(async () => {
    const when = nextOccurrence(newHour, newMinute);
    const instr: Instruction = {
      id: `local_${when.getTime()}`,
      type: 'reminder',
      title: newLabel.trim() || 'Alarm',
      body: '',
      at: when.toISOString(),
      repeat: newRepeat,
    };
    const perm = await ensurePermissions();
    setPermissionNote(perm.message);
    const summary = await arm([instr], 'local');
    setFeedback(summary);
    setNewLabel('');
    await refreshNative();
  }, [newHour, newMinute, newRepeat, newLabel, arm, refreshNative]);

  const onTest = useCallback(async () => {
    const perm = await ensurePermissions();
    setPermissionNote(perm.message);
    const summary = await arm([testInstruction(20)], 'test');
    await refreshNative();
    Alert.alert(
      'Test alarm',
      `${summary}\n\nNow lock the phone properly, wait for the screen to go dark, and leave it alone. That is the only way to see a real alarm: unlocked, Android shows a notification by design.`,
    );
  }, [arm, refreshNative]);

  const onStopRinging = useCallback(async () => {
    await stopNativeRinging();
    setFeedback('Ringing stopped.');
    await refreshNative();
  }, [refreshNative]);

  const onRemove = useCallback(
    async (item: ArmedReminder) => {
      await cancelArmed(item);
      await cancelNative(item.id);
      const next = remindersRef.current.filter((r) => r.id !== item.id);
      setReminders(next);
      await saveReminders(next);
      await refreshNative();
    },
    [refreshNative],
  );

  const onRemoveNative = useCallback(
    async (rec: NativeAlarmRecord) => {
      await cancelNative(rec.id);
      const js = remindersRef.current.find((r) => r.id === rec.id);
      if (js) await cancelArmed(js);
      const next = remindersRef.current.filter((r) => r.id !== rec.id);
      setReminders(next);
      await saveReminders(next);
      await refreshNative();
    },
    [refreshNative],
  );

  const onFix = useCallback(async (target: AccessTarget) => {
    const opened = await openAccessSettings(target);
    if (!opened) {
      Alert.alert(
        'Open settings by hand',
        'This phone would not open that screen directly. Open Settings, then Apps, then Kings Agent, and allow it there.',
      );
    }
  }, []);

  const onSaveSettings = useCallback(async () => {
    const clean: Settings = {
      startUrl: draft.startUrl.trim() || DEFAULT_SETTINGS.startUrl,
      feedUrl: draft.feedUrl.trim(),
      kcId: draft.kcId.trim(),
    };
    setSettings(clean);
    setDraft(clean);
    await saveSettings(clean);
    setFeedback('Settings saved.');
    setTab('alarms');
  }, [draft]);

  /**
   * The site hands over the kcId of the account it is signed in as. This is
   * the entire linking step: nothing is typed, nothing is paired.
   */
  const onWebMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    let msg: { type?: string; kcId?: string } = {};
    try {
      msg = JSON.parse(event.nativeEvent.data) as typeof msg;
    } catch {
      // The page posts other things too. Not ours, ignore it.
      return;
    }
    if (msg.type !== 'ka.kcId') return;

    const kcId = String(msg.kcId || '').trim().toLowerCase();
    // A kcId is exactly 24 hex characters. Anything else is not one, and a
    // wrong value here would mis-address this phone later, so it is rejected.
    if (!/^[0-9a-f]{24}$/.test(kcId)) return;
    if (settingsRef.current.kcId === kcId) return;

    const next: Settings = { ...settingsRef.current, kcId };
    setSettings(next);
    setDraft(next);
    void saveSettings(next);
    setFeedback(`Linked to KingsChat as ${kcId}.`);
    // It can stop looking now.
    webRef.current?.injectJavaScript('window.__kaKcIdDone = true; true;');
  }, []);

  if (!ready) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color="#4DA3FF" />
      </View>
    );
  }

  // Only the gates that are actually blocking show up. When none are, say so.
  const blocked = ACCESS_ROWS.filter((row) => access !== null && !access[row.key]);
  const armedCount = nativeAlarmAvailable ? nativeAlarms.length : reminders.length;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.body}>
        {/* The site stays mounted while we still do not know this phone's
            kcId, even on another tab: the sign-in session lives in this
            WebView, so it has to be alive to hand the kcId over. Once the
            kcId is known there is nothing to harvest, and it loads only on
            the Site tab. */}
        {(tab === 'site' || !settings.kcId) && (
          <View
            style={[styles.webHost, tab === 'site' ? null : styles.webHostHidden]}
            pointerEvents={tab === 'site' ? 'auto' : 'none'}
          >
            <WebView
              ref={webRef}
              source={{ uri: settings.startUrl }}
              startInLoadingState
              setSupportMultipleWindows={false}
              allowsBackForwardNavigationGestures
              injectedJavaScript={KCID_SNIPPET}
              onMessage={onWebMessage}
              onNavigationStateChange={(nav) => setWebCanGoBack(nav.canGoBack)}
              renderLoading={() => (
                <View style={[styles.screen, styles.center]}>
                  <ActivityIndicator color="#4DA3FF" />
                </View>
              )}
              renderError={(...args: unknown[]) => (
                <View style={[styles.screen, styles.center, styles.pad]}>
                  <Text style={styles.h1}>Cannot open the site</Text>
                  <Text style={styles.dim}>{String(args[args.length - 1] ?? '')}</Text>
                  <Text style={styles.dim}>{settings.startUrl}</Text>
                </View>
              )}
            />
          </View>
        )}

        {tab === 'alarms' && (
          <ScrollView contentContainerStyle={styles.pad}>
            <Text style={styles.h1}>Alarms</Text>
            <Text style={styles.dim}>
              These ring from the phone itself with no internet and with our server down.
            </Text>

            {/* ---- the gates that make a real alarm ---- */}
            {access === null ? null : blocked.length === 0 ? (
              <Text style={styles.ok}>
                Alarm access: all granted. A locked phone will take the screen and ring until you
                dismiss it.
              </Text>
            ) : (
              <View style={styles.accessBox}>
                <Text style={styles.accessHead}>
                  {blocked.length} setting{blocked.length > 1 ? 's' : ''} stopping a real alarm
                </Text>
                {blocked.map((row) => (
                  <View key={row.key} style={styles.accessRow}>
                    <Text style={styles.accessTitle}>{row.title}</Text>
                    <Text style={styles.accessWhy}>{row.why}</Text>
                    <Pressable style={styles.fixBtn} onPress={() => onFix(row.key)}>
                      <Text style={styles.fixText}>Open the setting</Text>
                    </Pressable>
                  </View>
                ))}
                <Text style={styles.tiny}>
                  Come back here after each one. This panel updates by itself.
                </Text>
              </View>
            )}

            {/* ---- set an alarm, right here, no agent needed ---- */}
            <Text style={[styles.h2, styles.gap]}>Set an alarm</Text>
            <View style={styles.stepperRow}>
              <View style={styles.stepper}>
                <Pressable style={styles.stepBtn} onPress={() => setNewHour((h) => (h + 1) % 24)}>
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
                <Text style={styles.bigTime}>{pad2(newHour)}</Text>
                <Pressable style={styles.stepBtn} onPress={() => setNewHour((h) => (h + 23) % 24)}>
                  <Text style={styles.stepText}>-</Text>
                </Pressable>
              </View>
              <Text style={styles.colon}>:</Text>
              <View style={styles.stepper}>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => setNewMinute((m) => (m + 5) % 60)}
                >
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
                <Text style={styles.bigTime}>{pad2(newMinute)}</Text>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => setNewMinute((m) => (m + 55) % 60)}
                >
                  <Text style={styles.stepText}>-</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.repeatRow}>
              {REPEAT_OPTIONS.map((r) => (
                <Pressable
                  key={r}
                  style={[styles.chip, newRepeat === r && styles.chipOn]}
                  onPress={() => setNewRepeat(r)}
                >
                  <Text style={[styles.chipText, newRepeat === r && styles.chipTextOn]}>{r}</Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={styles.input}
              value={newLabel}
              onChangeText={setNewLabel}
              placeholder="Label (optional)"
              placeholderTextColor="#6b7280"
            />

            <Pressable style={styles.btn} onPress={onCreateAlarm}>
              <Text style={styles.btnText}>Set alarm</Text>
            </Pressable>

            {feedback ? <Text style={styles.note}>{feedback}</Text> : null}
            {permissionNote ? <Text style={styles.note}>{permissionNote}</Text> : null}

            <Pressable style={styles.btnGhost} onPress={onTest}>
              <Text style={styles.btnGhostText}>Test alarm in 20 seconds</Text>
            </Pressable>
            <Pressable style={styles.btnGhost} onPress={onStopRinging}>
              <Text style={styles.btnGhostText}>Stop ringing now</Text>
            </Pressable>

            <Text style={styles.tiny}>Engine: {nativeAlarmStatus}</Text>

            <Text style={[styles.h2, styles.gap]}>
              Armed on this phone ({armedCount})
            </Text>

            {armedCount === 0 ? (
              <Text style={styles.dim}>
                Nothing armed yet. Set one above, or arm something the agent sent you from the Arm
                tab.
              </Text>
            ) : nativeAlarmAvailable ? (
              nativeAlarms.map((rec) => (
                <View key={rec.id} style={styles.card}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.cardTitle}>{rec.title}</Text>
                    <Pressable onPress={() => onRemoveNative(rec)}>
                      <Text style={styles.remove}>Remove</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.dim}>{formatWhen(rec)}</Text>
                  {rec.body ? <Text style={styles.cardBody}>{rec.body}</Text> : null}
                </View>
              ))
            ) : (
              reminders.map((item) => (
                <View key={item.id} style={styles.card}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <Pressable onPress={() => onRemove(item)}>
                      <Text style={styles.remove}>Remove</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.dim}>{describe(item)}</Text>
                  {item.body ? <Text style={styles.cardBody}>{item.body}</Text> : null}
                  <Text style={styles.tiny}>
                    {item.repeat && item.repeat !== 'none' ? `${item.repeat} · ` : ''}
                    {item.engine === 'native' ? 'real alarm' : 'notification'} · {item.source} · id{' '}
                    {item.id}
                  </Text>
                </View>
              ))
            )}

            <Text style={[styles.h2, styles.gap]}>Connect this phone to the agent</Text>
            <Text style={styles.dim}>
              Send the two lines below to the agent once, in KingsChat or here. After that it can
              push an alarm straight to this phone, and it never needs sending again.
            </Text>
            <View style={styles.card}>
              <Text style={styles.label}>Device id</Text>
              <Text style={styles.cardBody} selectable>
                {thisDevice || '(not ready yet)'}
              </Text>
              <Text style={styles.label}>Push token</Text>
              <Text style={styles.cardBody} selectable>
                {pushTok || pushErr || '(asking Android for it…)'}
              </Text>
              <Text style={styles.tiny}>
                Long press either line to copy it. The alarm itself never needs the internet, only
                the message that tells this phone to set one.
              </Text>
            </View>

            <Text style={[styles.h2, styles.gap]}>Settings</Text>
            <Text style={styles.label}>Site the app opens</Text>
            <TextInput
              style={styles.input}
              value={draft.startUrl}
              onChangeText={(t) => setDraft({ ...draft, startUrl: t })}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.label}>Instruction feed URL (optional)</Text>
            <TextInput
              style={styles.input}
              value={draft.feedUrl}
              onChangeText={(t) => setDraft({ ...draft, feedUrl: t })}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://.../instructions.json"
              placeholderTextColor="#6b7280"
            />
            <Text style={styles.label}>KingsChat ID (kcId)</Text>
            <TextInput
              style={[styles.input, draft.kcId ? styles.inputLocked : null]}
              value={draft.kcId}
              onChangeText={(t) => setDraft({ ...draft, kcId: t })}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!draft.kcId}
              placeholder="fills itself once you sign in on the Site tab"
              placeholderTextColor="#6b7280"
            />
            <Text style={styles.tiny}>
              {draft.kcId
                ? 'Read from the KingsChat account signed in on the Site tab. Nothing to type.'
                : 'Sign in on the Site tab and this fills itself.'}
            </Text>
            <Pressable style={styles.btn} onPress={onSaveSettings}>
              <Text style={styles.btnText}>Save settings</Text>
            </Pressable>

            <Text style={styles.tiny}>
              device id {thisDevice}
              {access ? ` · android ${access.androidVersion} (api ${access.sdkInt})` : ''}
            </Text>
            {feedNote ? <Text style={styles.note}>{feedNote}</Text> : null}
            <Pressable onPress={() => Linking.openSettings()}>
              <Text style={styles.link}>Open this app's system settings</Text>
            </Pressable>
          </ScrollView>
        )}

        {tab === 'arm' && (
          <ScrollView contentContainerStyle={styles.pad}>
            <Text style={styles.h1}>Arm from KingsChat</Text>
            <Text style={styles.dim}>
              Paste the instruction the agent sent you. That is the whole product: the agent decides,
              this phone executes.
            </Text>
            <TextInput
              style={[styles.input, styles.mono]}
              value={paste}
              onChangeText={setPaste}
              multiline
              textAlignVertical="top"
              placeholder={SAMPLE}
              placeholderTextColor="#4b5563"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable style={styles.btn} onPress={onPasteArm}>
              <Text style={styles.btnText}>Arm it</Text>
            </Pressable>
            <Pressable onPress={() => setPaste(SAMPLE)}>
              <Text style={styles.link}>Fill a sample instruction</Text>
            </Pressable>
            {feedback ? <Text style={styles.note}>{feedback}</Text> : null}
            <Text style={styles.tiny}>
              Fields: id, type (reminder|task|command), title, body, at (ISO 8601 with offset),
              repeat (none|daily|weekdays|weekly), data.
            </Text>
          </ScrollView>
        )}
      </View>

      <View style={[styles.tabs, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {(
          [
            ['alarms', 'Alarms'],
            ['site', 'Site'],
            ['arm', 'Arm'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <Pressable key={key} style={styles.tab} onPress={() => setTab(key)}>
            <Text style={[styles.tabText, tab === key && styles.tabActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f1115' },
  center: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  // The site layer fills the body. Hidden, it stays mounted and rendered
  // (which is how the kcId gets harvested off another tab) but takes no space,
  // no touches and no pixels.
  webHost: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  webHostHidden: { opacity: 0, zIndex: -1 },
  pad: { padding: 18, paddingBottom: 40 },
  h1: { color: '#ffffff', fontSize: 20, fontWeight: '700', marginBottom: 6 },
  h2: { color: '#ffffff', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  dim: { color: '#9aa5b1', fontSize: 14, marginBottom: 12, lineHeight: 20 },
  cardBody: { color: '#cbd5e1', fontSize: 14, marginTop: 6 },
  tiny: { color: '#6b7280', fontSize: 11, marginTop: 8, lineHeight: 16 },
  ok: {
    color: '#86efac',
    backgroundColor: '#12251a',
    borderColor: '#1f4d31',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    marginTop: 10,
    lineHeight: 19,
  },
  note: {
    color: '#fde68a',
    backgroundColor: '#2a2415',
    borderColor: '#4d3f18',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    marginBottom: 14,
    lineHeight: 19,
  },
  accessBox: {
    backgroundColor: '#1a1410',
    borderColor: '#5a3a1c',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginTop: 10,
  },
  accessHead: { color: '#fdba74', fontSize: 15, fontWeight: '700', marginBottom: 10 },
  accessRow: {
    borderTopColor: '#33261a',
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 12,
  },
  accessTitle: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  accessWhy: { color: '#c9b8a8', fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 8 },
  fixBtn: {
    backgroundColor: '#c2410c',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  fixText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  stepper: { alignItems: 'center' },
  stepBtn: {
    backgroundColor: '#1c222c',
    borderColor: '#2c3440',
    borderWidth: 1,
    borderRadius: 8,
    width: 54,
    paddingVertical: 6,
    alignItems: 'center',
  },
  stepText: { color: '#93b4d8', fontSize: 18, fontWeight: '700', lineHeight: 22 },
  bigTime: {
    color: '#ffffff',
    fontSize: 44,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginVertical: 4,
  },
  colon: { color: '#4b5563', fontSize: 40, fontWeight: '700', marginHorizontal: 8, marginTop: 2 },
  repeatRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 14, marginBottom: 4 },
  chip: {
    borderColor: '#2c3440',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginHorizontal: 4,
  },
  chipOn: { backgroundColor: '#1f6feb', borderColor: '#1f6feb' },
  chipText: { color: '#9aa5b1', fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: '#ffffff' },
  card: {
    backgroundColor: '#161a21',
    borderColor: '#262c36',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: '#ffffff', fontSize: 16, fontWeight: '600', flex: 1, paddingRight: 10 },
  remove: { color: '#ff6b6b', fontSize: 13 },
  label: { color: '#9aa5b1', fontSize: 12, marginBottom: 4, marginTop: 10 },
  input: {
    backgroundColor: '#12161d',
    borderColor: '#262c36',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#e8ecf1',
    fontSize: 13,
    marginTop: 10,
  },
  mono: { minHeight: 180, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  // Locked, because the value was read from the session rather than typed.
  inputLocked: { color: '#9aa5b1', backgroundColor: '#0f1115' },
  btn: {
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 6,
  },
  btnText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  btnGhost: {
    backgroundColor: '#161a21',
    borderColor: '#2c3440',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  btnGhostText: { color: '#cbd5e1', fontSize: 14, fontWeight: '600' },
  link: { color: '#4da3ff', fontSize: 13, paddingVertical: 8 },
  gap: { marginTop: 26 },
  tabs: {
    flexDirection: 'row',
    borderTopColor: '#262c36',
    borderTopWidth: 1,
    backgroundColor: '#12161d',
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  tabText: { color: '#6b7280', fontSize: 13, fontWeight: '600' },
  tabActive: { color: '#4da3ff' },
});
