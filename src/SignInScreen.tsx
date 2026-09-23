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
 * a login form it controls. That is deliberate, not a compromise waiting to
 * be tightened: an embedded WebView run by this app's own process CAN read
 * page content and inject script into it, which is exactly what "we never
 * see your password" is promising NOT to happen. (The previous build did
 * frame the website in a WebView and scrape the session out of it. That is
 * gone and must not come back, for that reason.)
 *
 * The code cannot come back to the phone directly: KingsChat locks a
 * developer project's redirect to the website's /auth/callback and it cannot
 * be repointed at an app. So the backend brokers it — this app creates a
 * pairing, opens the site's /app-login with only the pairing id in the URL,
 * and the website hands the session back over HTTPS once it has one. See
 * backend routes/appAuth.js.
 *
 * The tab closes itself. `openAuthSessionAsync` (not `openBrowserAsync`) also
 * registers `kingsagent://app-pair-complete` as the one redirect it is
 * listening for; the website navigates there — carrying only the pairing id,
 * never the secret — the instant its own exchange finishes
 * (`app/app-login/page.js`'s `returnToApp`), and the OS hands that straight
 * back to this activity (the intent-filter in AndroidManifest.xml) without
 * the person ever having to switch apps by hand. If an older install of this
 * app never registered that scheme, or the redirect is swallowed for any
 * other reason, the website's "Go back to the Kings Agent app" message is
 * still there underneath as the fallback it always was — this only removes
 * the need for it in the common case.
 *
 * The consent is also the authorisation: KingsChat's developer API refuses to
 * deliver to, or send as, anyone who has not consented to this project. So
 * this screen is what makes "the bot can DM you" true, not just "we know who
 * you are".
 */

const APP_REDIRECT = 'kingsagent://app-pair-complete';
// The claim after a successful redirect should succeed on the first try —
// the website already awaited `app-pair/complete` before it navigated here.
// A short bounded retry only covers a stray write-propagation hiccup, not a
// person who is still typing; that case is what the Custom Tab is for.
const CLAIM_RETRIES = 5;
const CLAIM_RETRY_MS = 500;

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

      setNote('Waiting for you to finish signing in...');
      const result = await WebBrowser.openAuthSessionAsync(pair.consentUrl, APP_REDIRECT, {
        showTitle: false,
        enableBarCollapsing: true,
      });

      if (cancelled.current) return;

      // The person closed the tab themselves (back button, swipe-away)
      // before finishing. Not an error — just let them try again.
      if (result.type !== 'success') {
        setBusy(false);
        setNote('');
        return;
      }

      setNote('Finishing sign in...');
      let session: Session | null = null;
      for (let attempt = 0; attempt < CLAIM_RETRIES; attempt++) {
        if (cancelled.current) return;
        try {
          session = await pairClaim(pair.pairId, pair.secret);
        } catch (e) {
          throw e;
        }
        if (session) break;
        await new Promise((r) => setTimeout(r, CLAIM_RETRY_MS));
      }

      if (!session) {
        setError('Signed in, but the app is still waiting on it. Tap to try again.');
        return;
      }
      await saveSession(session);
      if (!cancelled.current) onSignedIn(session);
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
          KingsChat&apos;s own sign-in screen opens over this app, then closes itself when you&apos;re done.
          We never see your password.
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
