import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ensurePermissions, scheduleInstruction, type Instruction, type Repeat } from './instructions';
import { cancelNative, nativeAlarmAvailable, type NativeAlarmRecord } from './nativeAlarm';
import { cancelServerAlarm, isServerAlarm } from './sync';
import { Button, Card, Empty, Fab, Pill } from './ui';
import { C, R, S } from './theme';

/**
 * One list: every alarm armed on this phone, whichever end set it.
 *
 * The split this used to have — "from your agent" above "your own alarms" —
 * was a distinction the person never has to act on. An alarm rings the same
 * way and is removed the same way either way; where it came from only matters
 * to `remove`, which still cancels a server reminder on the server too so the
 * agent's view and the phone agree. Nothing in the UI repeats that detail.
 *
 * Setting one is behind the + button rather than a form that is always on
 * screen, so what this screen shows is the alarms and nothing else.
 */

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
  const [adding, setAdding] = useState(false);

  // Soonest first — the only order that answers "what is next?" at a glance.
  const sorted = useMemo(() => [...alarms].sort((a, b) => a.triggerAt - b.triggerAt), [alarms]);

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

  return (
    <View style={styles.root}>
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
        {syncNote ? <Text style={styles.syncNote}>{syncNote}</Text> : null}

        <Card style={styles.card}>
          {sorted.length === 0 ? (
            <Empty
              title="No alarms set"
              body={'Tap + to set one, or ask the agent on KingsChat — "remind me to call Mum at 6pm".'}
            />
          ) : (
            sorted.map((a, i) => (
              <AlarmRow key={a.id} rec={a} onRemove={remove} last={i === sorted.length - 1} />
            ))
          )}
        </Card>

        <View style={{ height: 96 }} />
      </ScrollView>

      <Fab label="Add an alarm" onPress={() => setAdding(true)} />
      <AddAlarm open={adding} onClose={() => setAdding(false)} onChanged={onChanged} />
    </View>
  );
}

function AlarmRow({
  rec,
  onRemove,
  last,
}: {
  rec: NativeAlarmRecord;
  onRemove: (rec: NativeAlarmRecord) => void;
  last: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.rowLine]}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTime}>{whenLabel(rec)}</Text>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {rec.title}
        </Text>
        {rec.body ? (
          <Text style={styles.rowBody} numberOfLines={2}>
            {rec.body}
          </Text>
        ) : null}
      </View>
      <Pressable onPress={() => onRemove(rec)} hitSlop={10} style={styles.remove}>
        <Text style={styles.removeText}>Remove</Text>
      </Pressable>
    </View>
  );
}

function AddAlarm({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [hour, setHour] = useState('07');
  const [minute, setMinute] = useState('00');
  const [label, setLabel] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('daily');
  const [busy, setBusy] = useState(false);

  const add = useCallback(async () => {
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
      onClose();
    } catch (e) {
      Alert.alert("Couldn't set that alarm", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [hour, minute, label, repeat, onChanged, onClose]);

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetBackdrop}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>New alarm</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.sheetClose}>Cancel</Text>
            </Pressable>
          </View>

          <View style={styles.sheetBody}>
            <View style={styles.timeRow}>
              <TextInput
                style={styles.timeBox}
                value={hour}
                onChangeText={setHour}
                keyboardType="number-pad"
                maxLength={2}
                placeholder="07"
                placeholderTextColor={C.faint}
                selectTextOnFocus
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
                selectTextOnFocus
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
            <Button label="Set alarm" onPress={add} busy={busy} />
            <View style={{ height: S.lg }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  wrap: { padding: S.md, paddingTop: S.sm, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h1: { color: C.text, fontSize: 26, fontWeight: '800' },
  syncNote: { color: C.faint, fontSize: 12, marginTop: 4 },
  card: { marginTop: S.md, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 13 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: C.line },
  rowMain: { flex: 1 },
  rowTime: { color: C.text, fontSize: 17, fontWeight: '700' },
  rowTitle: { color: C.dim, fontSize: 14, marginTop: 3 },
  rowBody: { color: C.faint, fontSize: 12, marginTop: 3 },
  remove: { paddingHorizontal: 6, paddingVertical: 4 },
  removeText: { color: C.faint, fontSize: 12, fontWeight: '600' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(3,6,14,0.75)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.bg,
    borderTopLeftRadius: R.lg,
    borderTopRightRadius: R.lg,
    borderTopWidth: 1,
    borderColor: C.line,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.md,
    paddingVertical: S.md,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  sheetTitle: { color: C.text, fontSize: 17, fontWeight: '700' },
  sheetClose: { color: C.dim, fontSize: 14, fontWeight: '600' },
  sheetBody: { padding: S.md },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm },
  timeBox: {
    backgroundColor: C.cardHi,
    borderRadius: R.md,
    color: C.text,
    fontSize: 34,
    fontWeight: '700',
    paddingVertical: 12,
    width: 96,
    textAlign: 'center',
  },
  colon: { color: C.dim, fontSize: 28, fontWeight: '700' },
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
