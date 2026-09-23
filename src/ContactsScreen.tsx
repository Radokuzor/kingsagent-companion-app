import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { addContact, lookupKcHandle, type KcProfile, type MyContact } from './api';
import { Avatar, Button, Card, Choice, Empty, Field, Glyph, Pill, ScreenHeader } from './ui';
import { C, R, S } from './theme';

/**
 * The address book the agent messages from.
 *
 * The one hard rule, the same one every contact-creation path in the backend
 * enforces: a name AND a KingsChat handle. A contact with no handle cannot be
 * messaged, so saving one is a bug rather than a convenience. The handle is
 * looked up as it is typed so a typo is caught here, but a handle that isn't
 * found still saves — plenty of people the agent will message have never
 * signed into anything of ours.
 *
 * Gender is only ever what the person picked, never inferred from a name: it
 * decides "Sir"/"Ma" and pronouns in every message that follows, and unknown
 * is addressed neutrally rather than guessed at.
 */

type Gender = '' | 'male' | 'female';

const GENDERS: { value: Gender; label: string }[] = [
  { value: '', label: 'Not said' },
  { value: 'male', label: 'Male · Sir' },
  { value: 'female', label: 'Female · Ma' },
];

export default function ContactsScreen({
  contacts,
  onBack,
  onAdded,
}: {
  contacts: MyContact[];
  onBack: () => void;
  onAdded: () => Promise<void> | void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Contacts"
        subtitle={contacts.length ? `${contacts.length} saved` : undefined}
        onBack={onBack}
        action={{ icon: 'plus', label: 'Add a contact', onPress: () => setAdding(true) }}
      />
      <ScrollView contentContainerStyle={styles.wrap}>
        <Card style={styles.card}>
          {contacts.length === 0 ? (
            <Empty
              title="No contacts yet"
              body="Add someone here, or just tell the agent on KingsChat who to message."
            />
          ) : (
            contacts.map((c, i) => (
              <View key={c.id} style={[styles.row, i < contacts.length - 1 && styles.rowLine]}>
                <Avatar name={c.name} handle={c.kc_handle} size={40} />
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {c.name}
                    </Text>
                    {c.gender === 'male' || c.gender === 'female' ? (
                      <Pill text={c.gender === 'male' ? 'Sir' : 'Ma'} />
                    ) : null}
                  </View>
                  {c.kc_handle ? <Text style={styles.handle}>@{c.kc_handle.replace(/^@/, '')}</Text> : null}
                  {c.style_sample ? (
                    <Text style={styles.style} numberOfLines={2}>
                      “{c.style_sample}”
                    </Text>
                  ) : null}
                </View>
              </View>
            ))
          )}
        </Card>
        <Text style={styles.footnote}>
          The agent writes to each of these in your voice. The more of your usual wording it has, the
          closer it gets.
        </Text>
        <View style={{ height: S.xl }} />
      </ScrollView>

      <AddContact
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={async () => {
          setAdding(false);
          await onAdded();
        }}
      />
    </View>
  );
}

function AddContact({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('');
  const [style, setStyle] = useState('');
  const [found, setFound] = useState<KcProfile | null>(null);
  const [looking, setLooking] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setHandle('');
    setName('');
    setGender('');
    setStyle('');
    setFound(null);
    setLooking(false);
    setNotFound(false);
    setError('');
  }, []);

  // Every keystroke invalidates the last answer — a match left on screen for a
  // handle that has since been edited is worse than no match at all.
  const onHandleChange = useCallback((value: string) => {
    setHandle(value);
    setFound(null);
    setNotFound(false);
    setLooking(false);
  }, []);

  // ...and the lookup itself is debounced, so a handle is searched for once
  // the typing stops rather than letter by letter.
  useEffect(() => {
    if (!open) return;
    const clean = handle.trim().replace(/^@/, '');
    if (clean.length < 2) return;
    timer.current = setTimeout(async () => {
      setLooking(true);
      try {
        const profile = await lookupKcHandle(clean);
        if (profile) setFound(profile);
        else setNotFound(true);
      } catch {
        // Offline or the lookup is unavailable. Not a reason to block a save.
        setNotFound(false);
      } finally {
        setLooking(false);
      }
    }, 600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [handle, open]);

  const useFound = useCallback(() => {
    if (!found) return;
    if (found.username) setHandle(found.username);
    setName((n) => n || found.name || '');
  }, [found]);

  const save = useCallback(async () => {
    const cleanHandle = handle.trim().replace(/^@/, '');
    const cleanName = name.trim();
    if (!cleanName || !cleanHandle) {
      setError('A name and a KingsChat handle are both needed — the agent has to know who to message.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await addContact({
        name: cleanName,
        kc_handle: cleanHandle,
        kc_id: found?.kcId || undefined,
        gender: gender || undefined,
        style_sample: style.trim() || undefined,
      });
      reset();
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [handle, name, gender, style, found, reset, onSaved]);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetBackdrop}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Add a contact</Text>
            <Pressable onPress={close} hitSlop={12}>
              <Text style={styles.sheetClose}>Cancel</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <Field
              label="KingsChat handle"
              value={handle}
              onChangeText={onHandleChange}
              placeholder="@their_handle"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {looking ? (
              <View style={styles.lookupRow}>
                <ActivityIndicator size="small" color={C.dim} />
                <Text style={styles.lookupText}>Searching KingsChat…</Text>
              </View>
            ) : null}
            {found ? (
              <Pressable onPress={useFound} style={styles.match}>
                <Avatar name={found.name} handle={found.username} uri={found.avatar} size={30} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.matchName} numberOfLines={1}>
                    {found.name || found.username}
                  </Text>
                  <Text style={styles.matchHandle}>@{found.username}</Text>
                </View>
                <View style={styles.matchUse}>
                  <Text style={styles.matchUseText}>Use</Text>
                </View>
              </Pressable>
            ) : null}
            {notFound ? (
              <View style={styles.warn}>
                <Glyph name="search" color={C.warn} size={14} />
                <Text style={styles.warnText}>
                  Nobody found with that handle. You can still add them — check the spelling first.
                </Text>
              </View>
            ) : null}

            <View style={{ height: S.md }} />
            <Field label="Name" value={name} onChangeText={setName} placeholder="What you call them" />

            <Text style={styles.label}>How the agent should address them</Text>
            <Choice options={GENDERS} value={gender} onChange={setGender} />
            <Text style={styles.labelHint}>
              Left unsaid, the agent uses their name and no honorific rather than guessing.
            </Text>

            <View style={{ height: S.md }} />
            <Field
              label="How you talk to them"
              value={style}
              onChangeText={setStyle}
              placeholder={'e.g. "Hey! hope you\'re good, quick one —"'}
              multiline
              hint="A line or two in your usual wording, so messages the agent sends still sound like you."
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button label="Add contact" onPress={save} busy={saving} />
            <View style={{ height: S.lg }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  wrap: { padding: S.md, paddingTop: S.md },
  card: { paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 12 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: C.line },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  name: { color: C.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  handle: { color: C.dim, fontSize: 13, marginTop: 2 },
  style: { color: C.faint, fontSize: 12, fontStyle: 'italic', marginTop: 4, lineHeight: 17 },
  footnote: { color: C.faint, fontSize: 12, lineHeight: 18, marginTop: S.md, paddingHorizontal: 2 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(3,6,14,0.75)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.bg,
    borderTopLeftRadius: R.lg,
    borderTopRightRadius: R.lg,
    borderTopWidth: 1,
    borderColor: C.line,
    maxHeight: '92%',
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
  lookupRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -S.sm, marginBottom: S.sm },
  lookupText: { color: C.faint, fontSize: 12 },
  match: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    backgroundColor: C.goodSoft,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.3)',
    padding: S.sm,
  },
  matchName: { color: C.text, fontSize: 14, fontWeight: '600' },
  matchHandle: { color: C.good, fontSize: 12, marginTop: 1 },
  matchUse: { backgroundColor: 'rgba(52,211,153,0.2)', borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 5 },
  matchUseText: { color: C.good, fontSize: 12, fontWeight: '700' },
  warn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: C.warnSoft,
    borderRadius: R.md,
    padding: S.sm,
  },
  warnText: { color: C.warn, fontSize: 12, lineHeight: 17, flex: 1 },
  label: { color: C.dim, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  labelHint: { color: C.faint, fontSize: 11, marginTop: 6, lineHeight: 16 },
  error: { color: C.bad, fontSize: 12, lineHeight: 17, marginBottom: S.sm },
});
