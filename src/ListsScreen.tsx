import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { MyNote, MyTodo } from './api';
import { fmtWhen } from './format';
import { Card, Empty, Glyph, ScreenHeader, SectionTitle } from './ui';
import { C, S } from './theme';

/**
 * What the person asked the agent to remember, and what they asked it to keep
 * track of. Read-only on purpose: these are written by talking to the agent,
 * and a second editor here would be a second source of truth for the same
 * two lists.
 */
export default function ListsScreen({
  notes,
  todos,
  onBack,
}: {
  notes: MyNote[];
  todos: MyTodo[];
  onBack: () => void;
}) {
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Notes & to-dos"
        subtitle={open.length ? `${open.length} still open` : undefined}
        onBack={onBack}
      />
      <ScrollView contentContainerStyle={styles.wrap}>
        <SectionTitle hint="Ask the agent to add one — “note that the venue changed”.">Notes</SectionTitle>
        <Card style={styles.card}>
          {notes.length === 0 ? (
            <Empty title="No notes" body="Nothing has been noted down yet." />
          ) : (
            notes.map((n, i) => (
              <View key={n.id} style={[styles.row, i < notes.length - 1 && styles.rowLine]}>
                <View style={styles.dot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.text}>{n.text}</Text>
                  {n.created_at ? <Text style={styles.when}>{fmtWhen(n.created_at)}</Text> : null}
                </View>
              </View>
            ))
          )}
        </Card>

        <SectionTitle>To-dos</SectionTitle>
        <Card style={styles.card}>
          {todos.length === 0 ? (
            <Empty title="Nothing to do" body="Ask the agent to add something and it appears here." />
          ) : (
            [...open, ...done].map((t, i, all) => (
              <View key={t.id} style={[styles.row, i < all.length - 1 && styles.rowLine]}>
                {t.done ? (
                  <View style={styles.tick}>
                    <Glyph name="check" color={C.good} size={13} />
                  </View>
                ) : (
                  <View style={styles.box} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.text, t.done && styles.textDone]}>{t.text}</Text>
                </View>
              </View>
            ))
          )}
        </Card>
        <View style={{ height: S.xl }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  wrap: { padding: S.md, paddingTop: 0 },
  card: { paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: S.sm, paddingVertical: 12 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: C.line },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent, marginTop: 7 },
  box: { width: 17, height: 17, borderRadius: 5, borderWidth: 1.5, borderColor: C.line, marginTop: 1 },
  tick: {
    width: 17,
    height: 17,
    borderRadius: 5,
    backgroundColor: C.goodSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  text: { color: C.text, fontSize: 14, lineHeight: 20 },
  textDone: { color: C.faint, textDecorationLine: 'line-through' },
  when: { color: C.faint, fontSize: 11, marginTop: 3 },
});
