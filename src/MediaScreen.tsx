import { useCallback, useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { MyDocument } from './api';
import { fmtWhen } from './format';
import { Button, Card, Empty, Glyph, ScreenHeader } from './ui';
import { C, R, S } from './theme';

/**
 * Pictures the agent generated and files that came in as images or video.
 *
 * The thumbnails load straight from the short link. That link signs a fresh
 * URL on every hit rather than holding a stored one (see the short-link
 * landmine in the backend's CLAUDE.md), so it keeps working long after a
 * signed URL would have expired — which is exactly why nothing here caches
 * a resolved address.
 */

const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;

export default function MediaScreen({ media, onBack }: { media: MyDocument[]; onBack: () => void }) {
  const [viewing, setViewing] = useState<MyDocument | null>(null);

  const openExternally = useCallback(async (url?: string | null) => {
    if (!url) return;
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else Alert.alert("Couldn't open it", 'No app on this phone would open that link.');
  }, []);

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Media"
        subtitle={media.length ? `${media.length} item${media.length === 1 ? '' : 's'}` : undefined}
        onBack={onBack}
      />
      <ScrollView contentContainerStyle={styles.wrap}>
        {media.length === 0 ? (
          <Card>
            <Empty
              title="No pictures yet"
              body={'Ask the agent to make you an image, or send it one, and it shows up here.'}
            />
          </Card>
        ) : (
          <View style={styles.grid}>
            {media.map((item) => {
              const url = item.file_url || item.pdf_url;
              const isVideo = VIDEO_EXT.test(url || '') || VIDEO_EXT.test(item.title || '');
              return (
                <Pressable
                  key={item.id}
                  onPress={() => (isVideo ? void openExternally(url) : setViewing(item))}
                  style={({ pressed }) => [styles.cell, pressed && { opacity: 0.75 }]}
                >
                  {isVideo || !url ? (
                    <View style={[styles.thumb, styles.thumbFallback]}>
                      <Glyph name="image" color={C.dim} size={26} />
                    </View>
                  ) : (
                    <Image source={{ uri: url }} style={styles.thumb} resizeMode="cover" />
                  )}
                  <Text style={styles.caption} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.when}>{fmtWhen(item.created_at)}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={{ height: S.xl }} />
      </ScrollView>

      <Modal visible={!!viewing} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewing(null)}>
          <Pressable style={styles.viewer} onPress={() => {}}>
            {viewing ? (
              <>
                <Image
                  source={{ uri: viewing.file_url || viewing.pdf_url || '' }}
                  style={styles.viewerImage}
                  resizeMode="contain"
                />
                <Text style={styles.viewerTitle} numberOfLines={2}>
                  {viewing.title}
                </Text>
                <View style={styles.viewerActions}>
                  <Button
                    label="Open"
                    tone="ghost"
                    style={{ flex: 1 }}
                    onPress={() => void openExternally(viewing.file_url || viewing.pdf_url)}
                  />
                  <Button label="Close" style={{ flex: 1 }} onPress={() => setViewing(null)} />
                </View>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  wrap: { padding: S.md, paddingTop: S.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  cell: { width: '48.4%' },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: R.md, backgroundColor: C.card },
  thumbFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  caption: { color: C.text, fontSize: 13, fontWeight: '600', marginTop: 7 },
  when: { color: C.faint, fontSize: 11, marginTop: 2 },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(3,6,14,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: S.md,
  },
  viewer: { width: '100%' },
  viewerImage: { width: '100%', height: 420, borderRadius: R.lg, backgroundColor: C.card },
  viewerTitle: { color: C.text, fontSize: 15, fontWeight: '600', marginTop: S.md, textAlign: 'center' },
  viewerActions: { flexDirection: 'row', gap: S.sm, marginTop: S.md },
});
