import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { openAccessSettings, type AccessTarget, type AlarmAccess } from './nativeAlarm';
import type { Session } from './session';
import { Button, Card, Pill, SectionTitle } from './ui';
import { C, R, S } from './theme';

/**
 * Account, the four Android gates, and sign out. Nothing else.
 *
 * Specifically NOT here, and it must not come back: the kcId, the app's JWT,
 * the KingsChat access token, the FCM token, the device id, the backend URL,
 * the instruction feed box. Those are plumbing; the person recognises their
 * KingsChat name, not a 24-character hex string.
 */

const ACCESS_ROWS: { key: AccessTarget; title: string; why: string }[] = [
  {
    key: 'fullScreen',
    title: 'Full screen alarms',
    why: 'Android 14 and up needs this switched on by hand. Without it an alarm rings as a banner instead of taking over the screen.',
  },
  { key: 'exactAlarm', title: 'Exact alarms', why: 'Without this Android may delay an alarm, so it fires late.' },
  { key: 'battery', title: 'Battery optimisation off', why: 'With optimisation on, Android can hold alarms back while the phone is idle.' },
  { key: 'notifications', title: 'Notifications allowed', why: 'With notifications off an alarm cannot appear at all.' },
];

interface Props {
  session: Session;
  access: AlarmAccess | null;
  pushReady: boolean;
  onSignOut: () => void;
  onRecheck: () => void;
}

export default function SettingsScreen({ session, access, pushReady, onSignOut, onRecheck }: Props) {
  const initials = (session.name || session.kcUsername || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  const fix = async (target: AccessTarget) => {
    const opened = await openAccessSettings(target);
    if (!opened) {
      Alert.alert(
        'Open settings by hand',
        'This phone would not open that screen directly. Open Settings, then Apps, then Kings Agent, and allow it there.',
      );
    }
  };

  const allGranted =
    access && access.fullScreen && access.exactAlarm && access.battery && access.notifications;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.h1}>Settings</Text>

      <SectionTitle>Account</SectionTitle>
      <Card>
        <View style={styles.account}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || '?'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{session.name || 'Your KingsChat account'}</Text>
            {session.kcUsername ? <Text style={styles.handle}>@{session.kcUsername}</Text> : null}
          </View>
        </View>
        <Text style={styles.note}>
          The agent can message you, and send messages as you when you ask it to, because you signed
          in here.
        </Text>
      </Card>

      <SectionTitle hint="These four decide whether an alarm really rings.">Alarm permissions</SectionTitle>
      <Card>
        {!access ? (
          <Text style={styles.note}>Checking...</Text>
        ) : (
          <>
            {ACCESS_ROWS.map((row, i) => {
              const ok = access[row.key];
              return (
                <View key={row.key} style={[styles.accessRow, i < ACCESS_ROWS.length - 1 && styles.rowLine]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.accessTitle}>{row.title}</Text>
                    {!ok ? <Text style={styles.accessWhy}>{row.why}</Text> : null}
                  </View>
                  {ok ? (
                    <Pill text="on" tone="good" />
                  ) : (
                    <Pressable onPress={() => void fix(row.key)} style={styles.fix}>
                      <Text style={styles.fixText}>Fix</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
            <Text style={styles.note}>
              Android {access.androidVersion}
              {allGranted ? ' · everything an alarm needs is allowed.' : ''}
            </Text>
            <View style={{ height: S.sm }} />
            <Button label="Check again" onPress={onRecheck} tone="ghost" />
          </>
        )}
      </Card>

      <SectionTitle hint="Push only tells the phone to sync sooner. Alarms ring without it.">
        Agent updates
      </SectionTitle>
      <Card>
        <View style={styles.pushRow}>
          <Text style={styles.accessTitle}>Instant updates</Text>
          <Pill text={pushReady ? 'on' : 'sync on open'} tone={pushReady ? 'good' : 'warn'} />
        </View>
        <Text style={styles.note}>
          {pushReady
            ? 'A reminder set in a KingsChat DM reaches this phone within seconds.'
            : "Push isn't available on this install, so new reminders are picked up when you open the app. Anything already set still rings on time."}
        </Text>
      </Card>

      <View style={{ height: S.lg }} />
      <Button label="Sign out" onPress={onSignOut} tone="danger" />
      <Text style={styles.signOutNote}>
        Signing out cancels the alarms the agent set on this phone.
      </Text>
      <View style={{ height: S.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: S.md, paddingTop: S.sm, backgroundColor: C.bg },
  h1: { color: C.text, fontSize: 26, fontWeight: '800' },
  account: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: R.pill,
    backgroundColor: C.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: C.accent, fontSize: 18, fontWeight: '800' },
  name: { color: C.text, fontSize: 17, fontWeight: '700' },
  handle: { color: C.dim, fontSize: 14, marginTop: 2 },
  note: { color: C.faint, fontSize: 12, lineHeight: 18, marginTop: S.sm },
  accessRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 12 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: C.line },
  accessTitle: { color: C.text, fontSize: 15, fontWeight: '600' },
  accessWhy: { color: C.faint, fontSize: 12, lineHeight: 18, marginTop: 3 },
  fix: {
    borderRadius: R.pill,
    backgroundColor: C.accentSoft,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  fixText: { color: C.accent, fontSize: 12, fontWeight: '700' },
  pushRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  signOutNote: { color: C.faint, fontSize: 12, textAlign: 'center', marginTop: S.sm },
});
