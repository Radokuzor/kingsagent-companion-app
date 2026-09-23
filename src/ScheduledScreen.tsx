import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { MyScheduledSend } from './api';
import { fmtWhen } from './format';
import { Card, Empty, Glyph, Pill, ScreenHeader } from './ui';
import { C, R, S } from './theme';

/**
 * Messages the agent is holding until their time comes.
 *
 * `needs_action` is the one status worth surfacing loudly: it means the send
 * stopped to ask the person something (whose name to put on it, how to talk
 * to that contact) and is waiting on a reply in the KingsChat DM — so the
 * answer is over there, not here.
 */

const TONE: Record<string, 'dim' | 'good' | 'warn' | 'bad'> = {
  pending: 'dim',
  sent: 'good',
  needs_action: 'warn',
  failed: 'bad',
};

const LABEL: Record<string, string> = {
  pending: 'waiting',
  sent: 'sent',
  needs_action: 'needs you',
  failed: 'failed',
};

export default function ScheduledScreen({
  sends,
  onBack,
}: {
  sends: MyScheduledSend[];
  onBack: () => void;
}) {
  const needsAction = sends.some((s) => s.status === 'needs_action');

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Scheduled sends"
        subtitle={sends.length ? `${sends.length} queued` : undefined}
        onBack={onBack}
      />
      <ScrollView contentContainerStyle={styles.wrap}>
        {needsAction ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              One of these is waiting on an answer from you. The agent asked in your KingsChat DM —
              reply there and it goes out.
            </Text>
          </View>
        ) : null}

        <Card style={styles.card}>
          {sends.length === 0 ? (
            <Empty
              title="Nothing queued"
              body={'Tell the agent to "send this to Rita tomorrow at 9" and it waits here until then.'}
            />
          ) : (
            sends.map((s, i) => {
              const status = s.status || 'pending';
              return (
                <View key={s.id} style={[styles.row, i < sends.length - 1 && styles.rowLine]}>
                  <View style={styles.tile}>
                    <Glyph name="clock" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={2}>
                      {s.title || 'Message'}
                    </Text>
                    <Text style={styles.when}>
                      {fmtWhen(s.send_at) || 'No time set'}
                      {s.contact_name ? ` · to ${s.contact_name}` : ''}
                    </Text>
                  </View>
                  <Pill text={LABEL[status] || status} tone={TONE[status] || 'dim'} />
                </View>
              );
            })
          )}
        </Card>
        <View style={{ height: S.xl }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  wrap: { padding: S.md, paddingTop: S.md },
  card: { paddingVertical: 2 },
  banner: { backgroundColor: C.warnSoft, borderRadius: R.md, padding: S.sm, marginBottom: S.md },
  bannerText: { color: C.warn, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 13 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: C.line },
  tile: {
    width: 36,
    height: 36,
    borderRadius: R.md,
    backgroundColor: C.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: C.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  when: { color: C.faint, fontSize: 12, marginTop: 3 },
});
