import { useCallback } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { MyDocument } from './api';
import { fmtWhen } from './format';
import { Card, Empty, Glyph, Pill, ScreenHeader } from './ui';
import { C, R, S } from './theme';

/**
 * Everything the agent researched, wrote or was sent, as reading matter.
 *
 * A document is always a hosted link — KingsChat outbound is text-only, so
 * the backend hosts the file and shares a short `/l/{code}` URL. The phone
 * opens that link rather than trying to render a PDF it has no viewer for.
 */

const KIND_LABEL: Record<string, string> = {
  research: 'research',
  report: 'report',
  chat: 'answer',
  received: 'received',
  converted: 'converted',
  doc: 'document',
};

export default function DocumentsScreen({
  documents,
  onBack,
}: {
  documents: MyDocument[];
  onBack: () => void;
}) {
  const open = useCallback(async (doc: MyDocument) => {
    const url = doc.pdf_url || doc.file_url;
    if (!url) {
      Alert.alert(doc.title, doc.body?.trim() || 'This one has no file attached to it.');
      return;
    }
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else Alert.alert("Couldn't open it", 'No app on this phone would open that link.');
  }, []);

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Documents"
        subtitle={documents.length ? `${documents.length} saved` : undefined}
        onBack={onBack}
      />
      <ScrollView contentContainerStyle={styles.wrap}>
        <Card style={styles.card}>
          {documents.length === 0 ? (
            <Empty
              title="Nothing saved yet"
              body={'Ask the agent on KingsChat to research something, and it lands here.'}
            />
          ) : (
            documents.map((doc, i) => (
              <Pressable
                key={doc.id}
                onPress={() => void open(doc)}
                style={({ pressed }) => [
                  styles.row,
                  i < documents.length - 1 && styles.rowLine,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <View style={styles.tile}>
                  <Glyph name="doc" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={2}>
                    {doc.title}
                  </Text>
                  <View style={styles.meta}>
                    <Pill text={KIND_LABEL[doc.kind] || doc.kind} />
                    {doc.created_at ? <Text style={styles.when}>{fmtWhen(doc.created_at)}</Text> : null}
                  </View>
                </View>
                <Glyph name="chevron" color={C.faint} size={16} />
              </Pressable>
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
  wrap: { padding: S.md, paddingTop: S.md },
  card: { paddingVertical: 2 },
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
  meta: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: 6 },
  when: { color: C.faint, fontSize: 12 },
});
