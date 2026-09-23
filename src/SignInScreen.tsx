import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { pairClaim, pairStart } from './api';
import { saveSession, type Session } from './session';
import { Button, Card, Glyph } from './ui';
import { C, R, S } from './theme';

/**
 * Signing in, without ever leaving the app.
 *
 * KingsChat's consent screen renders in a WebView **inside** this screen, as
 * a full-screen sheet with its own close button — not a separate browser
 * that opens over the app and has to be switched back from by hand. The page
 * itself (`app-login/page.js`) tells this screen the moment it is done, via
 * `window.ReactNativeWebView.postMessage` — the same message the sheet is
 * shown, without any polling and without the app ever reading the page's
 * content, injecting a script into it, or touching its cookies. The sheet
 * then closes itself and sign-in completes.
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

interface Props {
  deviceId: string;
  appVersion: string;
  onSignedIn: (session: Session) => void;
}

export default function SignInScreen({ deviceId, appVersion, onSignedIn }: Props) {
  const [consentUrl, setConsentUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState('');
  const cancelled = useRef(false);
  const pairRef = useRef<{ pairId: string; secret: string } | null>(null);
  const finishingRef = useRef(false);

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const open = useCallback(async () => {
    setError('');
    setStarting(true);
    try {
      const pair = await pairStart(deviceId, appVersion);
      pairRef.current = { pairId: pair.pairId, secret: pair.secret };
      setConsentUrl(pair.consentUrl);
    } catch (e) {
      setError((e as Error).message || 'Could not start sign in.');
    } finally {
      if (!cancelled.current) setStarting(false);
    }
  }, [deviceId, appVersion]);

  const close = useCallback(() => {
    setConsentUrl(null);
    setFinishing(false);
    pairRef.current = null;
    finishingRef.current = false;
  }, []);

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
          close();
          return;
        }
        await saveSession(session);
        close();
        if (!cancelled.current) onSignedIn(session);
      } catch (err) {
        setError((err as Error).message || 'Sign in failed.');
        close();
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

      <Modal
        visible={!!consentUrl}
        animationType="slide"
        onRequestClose={close}
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>KingsChat</Text>
            <Pressable onPress={close} hitSlop={12} style={styles.sheetClose} accessibilityLabel="Close">
              <Glyph name="close" color={C.dim} size={16} />
            </Pressable>
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
        </View>
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
