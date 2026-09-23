import type { ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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
  avatar: { backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarImg: { backgroundColor: C.cardHi },
  avatarText: { color: C.accent, fontWeight: '800' },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 13 },
  navRowLine: { borderBottomWidth: 1, borderBottomColor: C.line },
  navRowPressed: { opacity: 0.6 },
  navTile: {
    width: 36,
    height: 36,
    borderRadius: R.md,
    backgroundColor: C.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navLabel: { color: C.text, fontSize: 15, fontWeight: '600' },
  navHint: { color: C.faint, fontSize: 12, marginTop: 2, lineHeight: 16 },
  navCount: { color: C.dim, fontSize: 14, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  headerBack: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: C.text, fontSize: 18, fontWeight: '700' },
  headerSub: { color: C.faint, fontSize: 12, marginTop: 1 },
  headerAction: {
    width: 32,
    height: 32,
    borderRadius: R.pill,
    backgroundColor: C.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: { marginBottom: S.md },
  fieldLabel: { color: C.dim, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  fieldHint: { color: C.faint, fontSize: 11, marginTop: 5, lineHeight: 16 },
  input: {
    backgroundColor: C.cardHi,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    color: C.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  inputMulti: { minHeight: 84, textAlignVertical: 'top', paddingTop: 11 },
  choices: { flexDirection: 'row', gap: 8 },
  choice: {
    flex: 1,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    paddingVertical: 9,
    alignItems: 'center',
  },
  choiceOn: { backgroundColor: C.accentSoft, borderColor: C.accent },
  choiceText: { color: C.dim, fontSize: 12, fontWeight: '600' },
  choiceTextOn: { color: C.text },
  fab: {
    position: 'absolute',
    right: S.md,
    bottom: S.md,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
});

// ─── the Home section's pieces ─────────────────────────────────────────
// Deliberately hand-drawn from plain Views rather than an icon package:
// adding a native dependency here would mean an `expo prebuild`, and prebuild
// silently deletes the alarm components (see scripts/restore-native-patches.sh).
// A nav row is worth no such risk.

export type GlyphName =
  | 'doc'
  | 'image'
  | 'people'
  | 'check'
  | 'clock'
  | 'bell'
  | 'grid'
  | 'cog'
  | 'chevron'
  | 'plus'
  | 'close'
  | 'back'
  | 'search';

export function Glyph({ name, color = C.accent, size = 18 }: { name: GlyphName; color?: string; size?: number }) {
  const u = size / 18; // every shape below is drawn against an 18pt box
  const bar = (w: number, top: number) => (
    <View key={top} style={{ position: 'absolute', top: top * u, left: 3 * u, width: w * u, height: 2 * u, borderRadius: 1, backgroundColor: color }} />
  );
  const box = { width: size, height: size };

  switch (name) {
    case 'doc':
      return <View style={box}>{[bar(12, 3), bar(12, 8), bar(7, 13)]}</View>;
    case 'image':
      return (
        <View style={box}>
          <View style={{ position: 'absolute', top: 2 * u, left: 1 * u, width: 16 * u, height: 14 * u, borderRadius: 3 * u, borderWidth: 1.6 * u, borderColor: color }} />
          <View style={{ position: 'absolute', top: 5 * u, left: 4 * u, width: 3.4 * u, height: 3.4 * u, borderRadius: 2 * u, backgroundColor: color }} />
          <View style={{ position: 'absolute', bottom: 3.6 * u, left: 3 * u, width: 12 * u, height: 3 * u, borderTopLeftRadius: 3 * u, borderTopRightRadius: 3 * u, backgroundColor: color }} />
        </View>
      );
    case 'people':
      return (
        <View style={box}>
          <View style={{ position: 'absolute', top: 1.5 * u, left: 5.5 * u, width: 7 * u, height: 7 * u, borderRadius: 4 * u, borderWidth: 1.6 * u, borderColor: color }} />
          <View style={{ position: 'absolute', bottom: 1.5 * u, left: 2 * u, width: 14 * u, height: 7 * u, borderTopLeftRadius: 7 * u, borderTopRightRadius: 7 * u, borderWidth: 1.6 * u, borderBottomWidth: 0, borderColor: color }} />
        </View>
      );
    case 'check':
      return (
        <View style={box}>
          <View style={{ position: 'absolute', top: 9 * u, left: 2.5 * u, width: 6 * u, height: 2 * u, borderRadius: 1, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
          <View style={{ position: 'absolute', top: 7 * u, left: 6 * u, width: 11 * u, height: 2 * u, borderRadius: 1, backgroundColor: color, transform: [{ rotate: '-45deg' }] }} />
        </View>
      );
    case 'clock':
      return (
        <View style={box}>
          <View style={{ position: 'absolute', top: 1 * u, left: 1 * u, width: 16 * u, height: 16 * u, borderRadius: 8 * u, borderWidth: 1.6 * u, borderColor: color }} />
          <View style={{ position: 'absolute', top: 8 * u, left: 8.2 * u, width: 5 * u, height: 1.8 * u, borderRadius: 1, backgroundColor: color }} />
          <View style={{ position: 'absolute', top: 5 * u, left: 8.2 * u, width: 1.8 * u, height: 4.5 * u, borderRadius: 1, backgroundColor: color }} />
        </View>
      );
    case 'bell':
      return (
        <View style={box}>
          <View style={{ position: 'absolute', top: 2 * u, left: 3.5 * u, width: 11 * u, height: 10 * u, borderTopLeftRadius: 5.5 * u, borderTopRightRadius: 5.5 * u, borderWidth: 1.6 * u, borderBottomWidth: 0, borderColor: color }} />
          <View style={{ position: 'absolute', top: 11.4 * u, left: 2 * u, width: 14 * u, height: 1.8 * u, borderRadius: 1, backgroundColor: color }} />
          <View style={{ position: 'absolute', bottom: 1.2 * u, left: 7.6 * u, width: 3 * u, height: 3 * u, borderRadius: 2 * u, backgroundColor: color }} />
        </View>
      );
    case 'grid': {
      const quad = (top: number, left: number) => (
        <View
          key={`${top}-${left}`}
          style={{ position: 'absolute', top: top * u, left: left * u, width: 6.5 * u, height: 6.5 * u, borderRadius: 2 * u, backgroundColor: color }}
        />
      );
      return <View style={box}>{[quad(2, 2), quad(2, 9.5), quad(9.5, 2), quad(9.5, 9.5)]}</View>;
    }
    case 'cog': {
      const nub = (style: object) => (
        <View
          key={JSON.stringify(style)}
          style={[{ position: 'absolute', borderRadius: 1, backgroundColor: color }, style]}
        />
      );
      return (
        <View style={box}>
          <View style={{ position: 'absolute', top: 4 * u, left: 4 * u, width: 10 * u, height: 10 * u, borderRadius: 5 * u, borderWidth: 1.7 * u, borderColor: color }} />
          {[
            nub({ top: 0, left: 8.2 * u, width: 1.8 * u, height: 4 * u }),
            nub({ bottom: 0, left: 8.2 * u, width: 1.8 * u, height: 4 * u }),
            nub({ left: 0, top: 8.2 * u, height: 1.8 * u, width: 4 * u }),
            nub({ right: 0, top: 8.2 * u, height: 1.8 * u, width: 4 * u }),
          ]}
        </View>
      );
    }
    case 'search':
      return (
        <View style={box}>
          <View style={{ position: 'absolute', top: 1.5 * u, left: 1.5 * u, width: 12 * u, height: 12 * u, borderRadius: 6 * u, borderWidth: 1.6 * u, borderColor: color }} />
          <View style={{ position: 'absolute', bottom: 1.8 * u, right: 2 * u, width: 5 * u, height: 1.8 * u, borderRadius: 1, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
        </View>
      );
    case 'plus':
      return (
        <View style={box}>
          <View style={{ position: 'absolute', top: 8.1 * u, left: 2 * u, width: 14 * u, height: 2 * u, borderRadius: 1, backgroundColor: color }} />
          <View style={{ position: 'absolute', left: 8.1 * u, top: 2 * u, height: 14 * u, width: 2 * u, borderRadius: 1, backgroundColor: color }} />
        </View>
      );
    case 'close':
      return (
        <View style={box}>
          <View style={{ position: 'absolute', top: 8.1 * u, left: 2 * u, width: 14 * u, height: 1.8 * u, borderRadius: 1, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
          <View style={{ position: 'absolute', top: 8.1 * u, left: 2 * u, width: 14 * u, height: 1.8 * u, borderRadius: 1, backgroundColor: color, transform: [{ rotate: '-45deg' }] }} />
        </View>
      );
    case 'chevron':
    case 'back':
      return (
        <View style={[box, { transform: [{ rotate: name === 'back' ? '180deg' : '0deg' }] }]}>
          <View style={{ position: 'absolute', top: 4.2 * u, left: 6 * u, width: 7 * u, height: 1.8 * u, borderRadius: 1, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
          <View style={{ position: 'absolute', bottom: 4.2 * u, left: 6 * u, width: 7 * u, height: 1.8 * u, borderRadius: 1, backgroundColor: color, transform: [{ rotate: '-45deg' }] }} />
        </View>
      );
  }
}

export function initialsOf(name?: string | null, fallback?: string | null): string {
  const source = (name || fallback || '').trim();
  if (!source) return '?';
  return (
    source
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

export function Avatar({
  name,
  handle,
  uri,
  size = 52,
}: {
  name?: string | null;
  handle?: string | null;
  uri?: string | null;
  size?: number;
}) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={[dim, styles.avatarImg]} />;
  return (
    <View style={[dim, styles.avatar]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.34 }]}>{initialsOf(name, handle)}</Text>
    </View>
  );
}

/**
 * The Home hub's one repeated element: a tinted icon tile, a label, what is
 * behind it, and how much of it there is. The count is the point — it is what
 * tells someone whether opening the row is worth a tap.
 */
export function NavRow({
  icon,
  label,
  hint,
  count,
  onPress,
  last,
}: {
  icon: GlyphName;
  label: string;
  hint?: string;
  count?: number;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.navRow, !last && styles.navRowLine, pressed && styles.navRowPressed]}
    >
      <View style={styles.navTile}>
        <Glyph name={icon} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.navLabel}>{label}</Text>
        {hint ? <Text style={styles.navHint}>{hint}</Text> : null}
      </View>
      {typeof count === 'number' ? <Text style={styles.navCount}>{count}</Text> : null}
      <Glyph name="chevron" color={C.faint} size={16} />
    </Pressable>
  );
}

/** A sub-screen's top bar: back, title, and at most one action. */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  action,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  action?: { icon: GlyphName; onPress: () => void; label: string };
}) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.headerBack}>
        <Glyph name="back" color={C.dim} size={18} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.headerSub}>{subtitle}</Text> : null}
      </View>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={10} style={styles.headerAction} accessibilityLabel={action.label}>
          <Glyph name={action.icon} color={C.accent} size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Field({
  label,
  hint,
  ...input
}: {
  label: string;
  hint?: string;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={C.faint}
        {...input}
        style={[styles.input, input.multiline && styles.inputMulti, input.style]}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.choices}>
      {options.map((o) => (
        <Pressable
          key={o.value || 'unset'}
          onPress={() => onChange(o.value)}
          style={[styles.choice, value === o.value && styles.choiceOn]}
        >
          <Text style={[styles.choiceText, value === o.value && styles.choiceTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The round action button that replaced an always-open form. */
export function Fab({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
    >
      <Glyph name="plus" color="#fff" size={22} />
    </Pressable>
  );
}
