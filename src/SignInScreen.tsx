import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { pairClaim, pairStart } from './api';
import { saveSession, type Session } from './session';
import { Button, Card, Glyph } from './ui';
import { C, R, S } from './theme';

/**
 * Signing in, without ever leaving the app.
 *
 * KingsChat's consent screen renders in a WebView **inside** this screen, as
 * a full-screen sheet with a grabber you can drag down to dismiss (like an
 * iOS sheet) and an X for the same thing by tap — not a separate browser
 * that opens over the app and has to be switched back from by hand. The page
 * itself (`app-login/page.js`) tells this screen the moment it is done, via
 * `window.ReactNativeWebView.postMessage` — without any polling and without
 * the app ever reading the page's content, injecting a script into it, or
 * touching its cookies. The sheet then closes itself and sign-in completes.
 *
 * Closing it any other way — the X, the drag, the Android back button —
 * still checks once whether the pairing had actually finished first
 * (`close`'s claim attempt below). That message can only be missed once,
 * not lost forever: a person who watches KingsChat say "you're signed in"
 * and then dismisses before the app notices should still end up signed in,
 * not back at this screen.
 *
 * The code cannot come back to the phone directly: KingsChat locks a
 * developer project's redirect to the website's /auth/callback and it cannot
 * be repointed at an app. So the backend brokers it — this app creates a
 * pairing, the WebView opens the site's /app-login with only the pairing id
 * in the URL, and the website hands the session back over HTTPS with a
 * secret that never left the device. See backend routes/appAuth.js.
 *
 * The consent is also the authorisation: KingsChat's developer API refuses to
 * deliver to, or send as, anyone who has not consented to this project. So
 * this screen is what makes "the bot can DM you" true, not just "we know who
 * you are".
 */

// The claim after a "done" message should succeed on the first try — the
// website already awaited `app-pair/complete` before it posted. A short
// bounded retry only covers a stray write-propagation hiccup.
const CLAIM_RETRIES = 5;
const CLAIM_RETRY_MS = 500;

// How far (or how fast) a drag on the grabber has to go before it counts as
// "dismiss" rather than "let go and spring back".
const DRAG_DISMISS_PX = 120;
const DRAG_DISMISS_VELOCITY = 0.8;
const SCREEN_H = Dimensions.get('window').height;

interface Props {
  deviceId: string;
  appVersion: string;
  onSignedIn: (session: Session) => void;
}

export default function SignInScreen({ deviceId, appVersion, onSignedIn }: Props) {
  const insets = useSafeAreaInsets();
  const [consentUrl, setConsentUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState('');
  const cancelled = useRef(false);
  const pairRef = useRef<{ pairId: string; secret: string } | null>(null);
  const finishingRef = useRef(false);
  const [translateY] = useState(() => new Animated.Value(0));

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const open = useCallback(async () => {
    setError('');
    setStarting(true);
    try {
      const pair = await pairStart(deviceId, appVersion);
      pairRef.current = { pairId: pair.pairId, secret: pair.secret };
      translateY.setValue(0);
      setConsentUrl(pair.consentUrl);
    } catch (e) {
      setError((e as Error).message || 'Could not start sign in.');
    } finally {
      if (!cancelled.current) setStarting(false);
    }
  }, [deviceId, appVersion, translateY]);

  /**
   * Closing is never just "throw the sheet away". If this is the app's own
   * post-success cleanup (`finishingRef` already true, set by `finish`
   * below), there is nothing left to check — the session is already saved.
   * Otherwise — the X, a drag, the back button — this is someone leaving
   * before the app noticed anything, which includes the case where the
   * pairing genuinely finished and only the notification missed: one claim
   * attempt here catches that before the pairing is given up on for good.
   */
  const close = useCallback(async () => {
    const pair = pairRef.current;
    setConsentUrl(null);
    setFinishing(false);
    if (pair && !finishingRef.current) {
      // A brief busy state rather than flashing back to plain "Sign in" —
      // this check is usually near-instant either way.
      setStarting(true);
      try {
        const session = await pairClaim(pair.pairId, pair.secret);
        if (session) {
          await saveSession(session);
          pairRef.current = null;
          if (!cancelled.current) onSignedIn(session);
          return;
        }
      } catch {
        // Not ready yet, or genuinely over — an ordinary dismissal either way.
      } finally {
        if (!cancelled.current) setStarting(false);
      }
    }
    pairRef.current = null;
    finishingRef.current = false;
  }, [onSignedIn]);

  const finish = useCallback(
    async (pair: { pairId: string; secret: string }) => {
      if (finishingRef.current) return;
      finishingRef.current = true;
      setFinishing(true);
      let session: Session | null = null;
      try {
        for (let attempt = 0; attempt < CLAIM_RETRIES; attempt++) {
          if (cancelled.current) return;
          session = await pairClaim(pair.pairId, pair.secret);
          if (session) break;
          await new Promise((r) => setTimeout(r, CLAIM_RETRY_MS));
        }
        if (!session) {
          setError('Signed in, but the app is still waiting on it. Tap to try again.');
          void close();
          return;
        }
        await saveSession(session);
        void close();
        if (!cancelled.current) onSignedIn(session);
      } catch (err) {
        setError((err as Error).message || 'Sign in failed.');
        void close();
      }
    },
    [close, onSignedIn],
  );

  // The page posts `{ type: "app-pair-complete", pair }` the instant its own
  // exchange succeeds. Anything else posted to this bridge is ignored.
  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const pair = pairRef.current;
      if (!pair) return;
      let data: unknown;
      try {
        data = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (!data || typeof data !== 'object' || (data as { type?: string }).type !== 'app-pair-complete') {
        return;
      }
      void finish(pair);
    },
    [finish],
  );

  // A backstop for the one thing `postMessage` can miss — a page load that
  // for any reason never ran its script (a stale cached copy, a slow
  // hydration). `?done=1` is a real URL this flow already lands on once
  // pairing has succeeded (see app-login/page.js), not a guess, so on seeing
  // it, wait a beat for the message to arrive on its own and only act if it
  // didn't.
  const onNavigate = useCallback(
    (nav: WebViewNavigation) => {
      const pair = pairRef.current;
      if (!pair || !/[?&]done=1(&|$)/.test(nav.url)) return;
      setTimeout(() => {
        if (!cancelled.current && !finishingRef.current) void finish(pair);
      }, 1500);
    },
    [finish],
  );

  // Drag the grabber/header down to dismiss, the way an iOS sheet works.
  // Scoped to that area only (via panHandlers below) so it never steals a
  // scroll or a tap meant for the page inside the WebView. Created once
  // (PanResponder owns native gesture-tracking state that must not be
  // recreated every render) — safe to close over `close`/`translateY`
  // directly since neither's identity ever actually changes after mount:
  // `translateY` is the same Animated.Value object for the component's whole
  // life, and `close`'s only real dependency (`onSignedIn`) is a stable
  // useCallback from App.tsx. The lint rule below doesn't know Animated.Value
  // isn't a ref and flags this as if it might read one during render — it
  // never does; every handler here only runs from a later gesture event.
  // eslint-disable-next-line react-hooks/refs
  const [panResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_evt, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_evt, g) => {
        if (g.dy > DRAG_DISMISS_PX || g.vy > DRAG_DISMISS_VELOCITY) {
          Animated.timing(translateY, {
            toValue: SCREEN_H,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            translateY.setValue(0);
            void close();
          });
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
    }),
  );

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.badge}>
        <Text style={styles.badgeMark}>KA</Text>
      </View>
      <Text style={styles.title}>Kings Agent</Text>
      <Text style={styles.sub}>Your agent, on your phone</Text>

      <Card style={styles.card}>
        <Text style={styles.h2}>Sign in with KingsChat</Text>
        <Text style={styles.body}>Enable local notifications and alarms, and set up your Kings Agent profile.</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button label="Sign in with KingsChat" onPress={open} busy={starting} style={styles.cta} />
      </Card>

      <Modal visible={!!consentUrl} animationType="slide" onRequestClose={() => void close()} transparent>
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={{ paddingTop: insets.top }} {...panResponder.panHandlers}>
            <View style={styles.grabberWrap}>
              <View style={styles.grabber} />
            </View>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>KingsChat</Text>
              <Pressable onPress={() => void close()} hitSlop={12} style={styles.sheetClose} accessibilityLabel="Close">
                <Glyph name="close" color={C.dim} size={16} />
              </Pressable>
            </View>
          </View>
          {finishing ? (
            <View style={styles.finishing}>
              <Text style={styles.finishingText}>Finishing sign in...</Text>
            </View>
          ) : consentUrl ? (
            <WebView
              source={{ uri: consentUrl }}
              onMessage={onMessage}
              onNavigationStateChange={onNavigate}
              sharedCookiesEnabled
              // Only what KingsChat's own consent flow needs to render and
              // post one message back — nothing is injected into the page.
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState
            />
          ) : null}
        </Animated.View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: S.lg, backgroundColor: C.bg },
  badge: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: R.lg,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: S.md,
  },
  badgeMark: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 0.5 },
  title: { color: C.text, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  sub: { color: C.dim, fontSize: 14, textAlign: 'center', marginTop: 4, marginBottom: S.xl },
  card: { padding: S.lg },
  h2: { color: C.text, fontSize: 18, fontWeight: '700', marginBottom: S.xs },
  body: { color: C.dim, fontSize: 14, lineHeight: 21, marginBottom: S.md },
  cta: { marginTop: S.xs },
  error: { color: C.bad, fontSize: 13, lineHeight: 19, marginBottom: S.sm },
  sheet: { flex: 1, backgroundColor: C.bg },
  grabberWrap: { alignItems: 'center', paddingTop: S.xs, paddingBottom: 2 },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.line },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  sheetTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  sheetClose: {
    width: 30,
    height: 30,
    borderRadius: R.pill,
    backgroundColor: C.cardHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  finishingText: { color: C.dim, fontSize: 14 },
});
