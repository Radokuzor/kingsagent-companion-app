import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ensurePermissions, scheduleInstruction, testInstruction, type Instruction, type Repeat } from './instructions';
import { cancelNative, nativeAlarmAvailable, stopNativeRinging, type NativeAlarmRecord } from './nativeAlarm';
import { cancelServerAlarm, isServerAlarm } from './sync';
import { Button, Card, Empty, Pill, SectionTitle } from './ui';
import { C, R, S } from './theme';

const REPEATS: Repeat[] = ['none', 'daily', 'weekdays', 'weekly'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** The next hh:mm, today if it is still ahead, otherwise tomorrow. */
function nextOccurrence(hour: number, minute: number): Date {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

function whenLabel(rec: NativeAlarmRecord): string {
  const d = new Date(rec.triggerAt);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (rec.repeat === 'none') return `${time} · ${day} ${d.getDate()}/${d.getMonth() + 1}`;
  return `${time} · ${rec.repeat}`;
}

interface Props {
  alarms: NativeAlarmRecord[];
  deviceId: string;
  syncing: boolean;
  syncNote: string;
  onRefresh: () => Promise<void>;
  onChanged: () => Promise<void>;
}

export default function AlarmsScreen({ alarms, deviceId, syncing, syncNote, onRefresh, onChanged }: Props) {
  const [hour, setHour] = useState('07');
  const [minute, setMinute] = useState('00');
  const [label, setLabel] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('daily');
  const [busy, setBusy] = useState(false);

  // Separated because they mean different things to the person: one they set,
  // the other the agent set for them from a KingsChat conversation.
  const fromAgent = useMemo(() => alarms.filter((a) => isServerAlarm(a.id)), [alarms]);
  const mine = useMemo(() => alarms.filter((a) => !isServerAlarm(a.id)), [alarms]);

  const addAlarm = useCallback(async () => {
    const h = Number(hour);
    const m = Number(minute);
    if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) {
      Alert.alert('Check the time', 'Use a 24-hour time, like 06 and 30.');
      return;
    }
    setBusy(true);
    try {
      const when = nextOccurrence(h, m);
      const instr: Instruction = {
        id: `local_${when.getTime()}`,
        type: 'reminder',
        title: label.trim() || 'Alarm',
        body: '',
        at: when.toISOString(),
        repeat,
      };
      await ensurePermissions();
      await scheduleInstruction(instr);
      setLabel('');
      await onChanged();
    } catch (e) {
      Alert.alert("Couldn't set that alarm", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [hour, minute, label, repeat, onChanged]);

  const remove = useCallback(
    async (rec: NativeAlarmRecord) => {
      // A server reminder is also cancelled on the server, so the agent's view
      // and the conversation agree with the phone. A local one is ours alone.
      if (isServerAlarm(rec.id)) await cancelServerAlarm(rec.id, deviceId);
      else await cancelNative(rec.id);
      await onChanged();
    },
    [deviceId, onChanged],
  );

  const test = useCallback(async () => {
    await ensurePermissions();
    await scheduleInstruction(testInstruction(20));
    await onChanged();
    Alert.alert(
      'Test alarm set',
      'Rings in 20 seconds. Lock the phone and let the screen go dark — unlocked, Android shows a notification instead, by design.',
    );
  }, [onChanged]);

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      refreshControl={<RefreshControl refreshing={syncing} onRefresh={onRefresh} tintColor={C.dim} />}
    >
      <View style={styles.head}>
        <Text style={styles.h1}>Alarms</Text>
        <Pill
          text={nativeAlarmAvailable ? 'real alarm' : 'notification only'}
          tone={nativeAlarmAvailable ? 'good' : 'warn'}
        />
      </View>
      <Text style={styles.syncNote}>{syncNote}</Text>

      <SectionTitle hint="Set by the agent from your KingsChat conversation.">From your agent</SectionTitle>
      <Card>
        {fromAgent.length === 0 ? (
          <Empty
            title="Nothing from the agent yet"
            body={'Ask the bot on KingsChat — "remind me to call Mum at 6pm" — and it appears here.'}
          />
        ) : (
          fromAgent.map((a, i) => (
            <AlarmRow key={a.id} rec={a} onRemove={remove} last={i === fromAgent.length - 1} agent />
          ))
        )}
      </Card>

      <SectionTitle>Your own alarms</SectionTitle>
      <Card>
        {mine.length === 0 ? (
          <Empty title="No alarms set here" body="Add one below." />
        ) : (
          mine.map((a, i) => <AlarmRow key={a.id} rec={a} onRemove={remove} last={i === mine.length - 1} />)
        )}
      </Card>

      <SectionTitle>Add an alarm</SectionTitle>
      <Card>
        <View style={styles.timeRow}>
          <TextInput
            style={styles.timeBox}
            value={hour}
            onChangeText={setHour}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="07"
            placeholderTextColor={C.faint}
          />
          <Text style={styles.colon}>:</Text>
          <TextInput
            style={styles.timeBox}
            value={minute}
            onChangeText={setMinute}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="00"
            placeholderTextColor={C.faint}
          />
        </View>
        <TextInput
          style={styles.input}
          value={label}
          onChangeText={setLabel}
          placeholder="Label (optional)"
          placeholderTextColor={C.faint}
        />
        <View style={styles.chips}>
          {REPEATS.map((r) => (
            <Pressable
              key={r}
              onPress={() => setRepeat(r)}
              style={[styles.chip, repeat === r && styles.chipOn]}
            >
              <Text style={[styles.chipText, repeat === r && styles.chipTextOn]}>
                {r === 'none' ? 'once' : r}
              </Text>
            </Pressable>
          ))}
        </View>
        <Button label="Set alarm" onPress={addAlarm} busy={busy} />
      </Card>

      <SectionTitle>Check it works</SectionTitle>
      <Card>
        <Button label="Test alarm in 20 seconds" onPress={test} tone="ghost" />
        <View style={{ height: S.sm }} />
        <Button label="Stop ringing" onPress={() => void stopNativeRinging()} tone="ghost" />
      </Card>

      <View style={{ height: S.xl }} />
    </ScrollView>
  );
}

function AlarmRow({
  rec,
  onRemove,
  last,
  agent,
}: {
  rec: NativeAlarmRecord;
  onRemove: (rec: NativeAlarmRecord) => void;
  last: boolean;
  agent?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.rowLine]}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {rec.title}
        </Text>
        <Text style={styles.rowWhen}>{whenLabel(rec)}</Text>
        {rec.body ? (
          <Text style={styles.rowBody} numberOfLines={2}>
            {rec.body}
          </Text>
        ) : null}
      </View>
      {agent ? <Pill text="agent" tone="good" /> : null}
      <Pressable onPress={() => onRemove(rec)} hitSlop={10} style={styles.remove}>
        <Text style={styles.removeText}>Remove</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: S.md, paddingTop: S.sm, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h1: { color: C.text, fontSize: 26, fontWeight: '800' },
  syncNote: { color: C.faint, fontSize: 12, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 12 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: C.line },
  rowMain: { flex: 1 },
  rowTitle: { color: C.text, fontSize: 15, fontWeight: '600' },
  rowWhen: { color: C.dim, fontSize: 13, marginTop: 2 },
  rowBody: { color: C.faint, fontSize: 12, marginTop: 3 },
  remove: { paddingHorizontal: 6, paddingVertical: 4 },
  removeText: { color: C.faint, fontSize: 12, fontWeight: '600' },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm },
  timeBox: {
    backgroundColor: C.cardHi,
    borderRadius: R.md,
    color: C.text,
    fontSize: 30,
    fontWeight: '700',
    paddingVertical: 10,
    width: 84,
    textAlign: 'center',
  },
  colon: { color: C.dim, fontSize: 26, fontWeight: '700' },
  input: {
    backgroundColor: C.cardHi,
    borderRadius: R.md,
    color: C.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: S.md,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: S.md },
  chip: {
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: C.accentSoft, borderColor: C.accent },
  chipText: { color: C.dim, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: C.text },
});
