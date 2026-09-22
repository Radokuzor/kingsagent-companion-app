import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { pairClaim, pairStart } from './api';
import { saveSession, type Session } from './session';
import { Button, Card } from './ui';
import { C, R, S } from './theme';

/**
 * Signing in, the way KingsChat expects an app to.
 *
 * The consent runs in a **Chrome Custom Tab** — KingsChat's own screen, in the
 * system browser, so this app never sees anyone's password and never renders
 * a login form it controls. (The previous build framed the website in a
 * WebView and scraped the session out of it. That is gone and must not come
 * back.)
 *
 * The code cannot come back to the phone directly: KingsChat locks a
 * developer project's redirect to the website's /auth/callback and it cannot
 * be repointed at an app. So the backend brokers it — this app creates a
 * pairing, opens the site's /app-login with only the pairing id in the URL,
 * and then polls to claim the session with a secret that never left the
 * device. See backend routes/appAuth.js.
 *
 * The consent is also the authorisation: KingsChat's developer API refuses to
 * deliver to, or send as, anyone who has not consented to this project. So
 * this screen is what makes "the bot can DM you" true, not just "we know who
 * you are".
 */

const POLL_MS = 2000;
const GIVE_UP_MS = 5 * 60 * 1000;

interface Props {
  deviceId: string;
  appVersion: string;
  onSignedIn: (session: Session) => void;
}

export default function SignInScreen({ deviceId, appVersion, onSignedIn }: Props) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const cancelled = useRef(false);

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const signIn = useCallback(async () => {
    setError('');
    setBusy(true);
    setNote('Opening KingsChat...');
    try {
      const pair = await pairStart(deviceId, appVersion);

      // Not openAuthSessionAsync: that waits for a redirect back to a scheme
      // this app owns, and there is none — the website finishes the exchange.
      // So open the tab and poll for the session instead.
      WebBrowser.openBrowserAsync(pair.consentUrl, {
        showTitle: false,
        enableBarCollapsing: true,
      }).catch(() => {});

      setNote('Waiting for you to finish signing in...');
      const until = Date.now() + GIVE_UP_MS;

      while (Date.now() < until) {
        if (cancelled.current) return;
        await new Promise((r) => setTimeout(r, POLL_MS));
        let session: Session | null = null;
        try {
          session = await pairClaim(pair.pairId, pair.secret);
        } catch (e) {
          // 202 is handled as null by the client; anything thrown here is a
          // real failure (expired pairing, bad secret, server down).
          throw e;
        }
        if (session) {
          await saveSession(session);
          try {
            await WebBrowser.dismissBrowser();
          } catch {
            // Already closed by the person, which is fine.
          }
          if (!cancelled.current) onSignedIn(session);
          return;
        }
      }
      setError('That took too long. Tap to try again.');
    } catch (e) {
      setError((e as Error).message || 'Sign in failed.');
    } finally {
      if (!cancelled.current) {
        setBusy(false);
        setNote('');
      }
    }
  }, [deviceId, appVersion, onSignedIn]);

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.badge}>
        <Text style={styles.badgeMark}>KA</Text>
      </View>
      <Text style={styles.title}>Kings Agent</Text>
      <Text style={styles.sub}>Your agent, on your phone</Text>

      <Card style={styles.card}>
        <Text style={styles.h2}>Sign in with KingsChat</Text>
        <Text style={styles.body}>
          Your reminders ring here like a real alarm — offline, with the app closed. Signing in is
          also what lets the agent message you, and send messages as you when you ask it to.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {note && !error ? <Text style={styles.note}>{note}</Text> : null}

        <Button
          label={busy ? 'Waiting...' : 'Sign in with KingsChat'}
          onPress={signIn}
          busy={busy}
          style={styles.cta}
        />

        <Text style={styles.small}>
          KingsChat's own sign-in screen opens in your browser. We never see your password.
        </Text>
      </Card>
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
  small: { color: C.faint, fontSize: 12, lineHeight: 18, marginTop: S.sm, textAlign: 'center' },
  error: { color: C.bad, fontSize: 13, lineHeight: 19, marginBottom: S.sm },
  note: { color: C.dim, fontSize: 13, marginBottom: S.sm },
});
