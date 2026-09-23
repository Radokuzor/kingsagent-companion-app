import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import ContactsScreen from './ContactsScreen';
import DocumentsScreen from './DocumentsScreen';
import ListsScreen from './ListsScreen';
import MediaScreen from './MediaScreen';
import ScheduledScreen from './ScheduledScreen';
import { ApiError, fetchMyData, type MyData } from './api';
import type { Session } from './session';
import { Avatar, Card, NavRow } from './ui';
import { C, R, S } from './theme';

/**
 * Home — the person's own space, the same thing the website's /me page shows
 * and nothing more: their profile, the documents and images the agent made
 * for them, their address book, their notes and to-dos, their scheduled
 * sends.
 *
 * Two deliberate absences. The chat history is not here: the conversation
 * lives in KingsChat, which is where they had it, and mirroring it in a
 * second place adds nothing. And nothing on this screen is a second copy of
 * the Alarms tab — reminders get a row that switches tabs rather than a list
 * that could disagree with the one holding the real alarms.
 */

export type HomeRoute = 'home' | 'documents' | 'media' | 'contacts' | 'lists' | 'scheduled';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|mp4|mov|webm|m4v)$/i;

/** Pictures and video the agent generated or was sent, as opposed to reading matter. */
export function isMedia(doc: { kind?: string; file_url?: string | null; title?: string }): boolean {
  if (doc.kind === 'image') return true;
  return IMAGE_EXT.test(doc.file_url || '') || IMAGE_EXT.test(doc.title || '');
}

interface Props {
  session: Session;
  route: HomeRoute;
  onNavigate: (route: HomeRoute) => void;
  onOpenAlarms: () => void;
}

export default function HomeScreen({ session, route, onNavigate, onOpenAlarms }: Props) {
  const [data, setData] = useState<MyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await fetchMyData());
      setError('');
    } catch (e) {
      const err = e as ApiError;
      // `no_conversation` is not a fault — it is someone who installed the app
      // before ever messaging the bot, and it deserves a direction, not an
      // error message.
      setError(
        err.code === 'no_conversation'
          ? "You haven't messaged the agent on KingsChat yet. Say hello there and your space fills in here."
          : err.message || "Couldn't load your space.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Pull-to-refresh wants the spinner up front; the first load already starts
  // with `loading` true, and setting it again synchronously inside the effect
  // below would just be a cascading render.
  const refresh = useCallback(async () => {
    setLoading(true);
    await load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const media = useMemo(() => (data?.documents ?? []).filter(isMedia), [data]);
  const docs = useMemo(() => (data?.documents ?? []).filter((d) => !isMedia(d)), [data]);
  const openTodos = useMemo(() => (data?.todos ?? []).filter((t) => !t.done).length, [data]);

  const back = () => onNavigate('home');

  if (route === 'documents') return <DocumentsScreen documents={docs} onBack={back} />;
  if (route === 'media') return <MediaScreen media={media} onBack={back} />;
  if (route === 'lists')
    return <ListsScreen notes={data?.notes ?? []} todos={data?.todos ?? []} onBack={back} />;
  if (route === 'scheduled') return <ScheduledScreen sends={data?.scheduledSends ?? []} onBack={back} />;
  if (route === 'contacts')
    return <ContactsScreen contacts={data?.contacts ?? []} onBack={back} onAdded={refresh} />;

  const profile = data?.profile;
  const subtitle = [profile?.role_title, profile?.org].filter(Boolean).join(' · ');

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.dim} />}
    >
      <View style={styles.profile}>
        <Avatar name={session.name} handle={session.kcUsername} uri={session.avatarUrl} size={64} />
        <View style={styles.profileText}>
          <Text style={styles.name} numberOfLines={1}>
            {session.name || profile?.display_name || 'Your KingsChat account'}
          </Text>
          {session.kcUsername ? <Text style={styles.handle}>@{session.kcUsername}</Text> : null}
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {error ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      ) : null}

      <Card style={styles.nav}>
        <NavRow
          icon="doc"
          label="Documents"
          hint="Research, reports and files"
          count={docs.length}
          onPress={() => onNavigate('documents')}
        />
        <NavRow
          icon="image"
          label="Media"
          hint="Pictures the agent made or you sent"
          count={media.length}
          onPress={() => onNavigate('media')}
        />
        <NavRow
          icon="people"
          label="Contacts"
          hint="Who the agent can message for you"
          count={data?.contacts.length ?? 0}
          onPress={() => onNavigate('contacts')}
        />
        <NavRow
          icon="check"
          label="Notes & to-dos"
          hint={openTodos ? `${openTodos} still open` : 'What you asked it to remember'}
          count={(data?.notes.length ?? 0) + (data?.todos.length ?? 0)}
          onPress={() => onNavigate('lists')}
        />
        <NavRow
          icon="clock"
          label="Scheduled sends"
          hint="Messages waiting to go out"
          count={data?.scheduledSends.length ?? 0}
          onPress={() => onNavigate('scheduled')}
        />
        <NavRow
          icon="bell"
          label="Reminders"
          hint="Everything set to ring on this phone"
          count={data?.reminders.length ?? 0}
          onPress={onOpenAlarms}
          last
        />
      </Card>

      {profile && (profile.timezone || profile.gender) ? (
        <Card style={styles.details}>
          <Text style={styles.detailsTitle}>What the agent knows about you</Text>
          {profile.timezone ? <Detail label="Time zone" value={profile.timezone} /> : null}
          {profile.gender === 'male' || profile.gender === 'female' ? (
            <Detail label="Addressed as" value={profile.gender === 'male' ? 'Sir' : 'Ma'} />
          ) : null}
          <Text style={styles.detailsNote}>
            Tell the agent in a DM to change any of this — &quot;my timezone is Lagos&quot;.
          </Text>
        </Card>
      ) : null}

      <View style={{ height: S.xl }} />
    </ScrollView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: S.md, paddingTop: S.sm, backgroundColor: C.bg },
  profile: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.sm },
  profileText: { flex: 1 },
  name: { color: C.text, fontSize: 22, fontWeight: '800' },
  handle: { color: C.dim, fontSize: 14, marginTop: 3 },
  subtitle: { color: C.faint, fontSize: 13, marginTop: 3 },
  notice: {
    backgroundColor: C.warnSoft,
    borderRadius: R.md,
    padding: S.sm,
    marginTop: S.sm,
  },
  noticeText: { color: C.warn, fontSize: 12, lineHeight: 18 },
  nav: { marginTop: S.md, paddingVertical: 2 },
  details: { marginTop: S.md },
  detailsTitle: { color: C.text, fontSize: 13, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: S.sm },
  detailLabel: { color: C.dim, fontSize: 14 },
  detailValue: { color: C.text, fontSize: 14, fontWeight: '600' },
  detailsNote: { color: C.faint, fontSize: 12, lineHeight: 18, marginTop: S.md },
});
