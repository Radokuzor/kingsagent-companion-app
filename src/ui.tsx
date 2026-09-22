import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { C, R, S } from './theme';

/** The shared pieces every screen is built from. */

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionTitleText}>{children}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  tone = 'primary',
  busy = false,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'ghost' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  style?: object;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        tone === 'primary' && styles.btnPrimary,
        tone === 'ghost' && styles.btnGhost,
        tone === 'danger' && styles.btnDanger,
        off && styles.btnOff,
        pressed && !off && styles.btnPressed,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={tone === 'primary' ? '#fff' : C.dim} size="small" /> : null}
      <Text
        style={[
          styles.btnText,
          tone === 'ghost' && styles.btnTextGhost,
          tone === 'danger' && styles.btnTextDanger,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Pill({ text, tone = 'dim' }: { text: string; tone?: 'dim' | 'good' | 'warn' | 'bad' }) {
  const bg = { dim: C.cardHi, good: C.goodSoft, warn: C.warnSoft, bad: C.badSoft }[tone];
  const fg = { dim: C.dim, good: C.good, warn: C.warn, bad: C.bad }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.line,
    padding: S.md,
  },
  sectionTitle: { marginBottom: S.sm, marginTop: S.lg },
  sectionTitleText: {
    color: C.text,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  sectionHint: { color: C.faint, fontSize: 12, marginTop: 3, lineHeight: 17 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: R.md,
    paddingVertical: 14,
    paddingHorizontal: S.md,
  },
  btnPrimary: { backgroundColor: C.accent },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line },
  btnDanger: { backgroundColor: C.badSoft, borderWidth: 1, borderColor: 'rgba(248,113,113,0.35)' },
  btnOff: { opacity: 0.45 },
  btnPressed: { opacity: 0.82 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnTextGhost: { color: C.dim },
  btnTextDanger: { color: C.bad },
  pill: { borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  empty: { paddingVertical: S.lg, alignItems: 'center' },
  emptyTitle: { color: C.dim, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  emptyBody: { color: C.faint, fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
