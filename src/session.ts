import * as SecureStore from 'expo-secure-store';

/**
 * The phone's session with the Kings Agent backend.
 *
 * In the OS secure store (Android Keystore), never AsyncStorage: AsyncStorage
 * is a plaintext file inside the app sandbox, readable on a rooted phone and
 * in a full device backup. `token` is a bearer credential for this person's
 * whole account and `refreshToken` mints more of them, so neither belongs
 * anywhere else.
 *
 * `kcId` is in here rather than in the UI on purpose. It is plumbing — the id
 * the backend uses to name this account — and the brief is explicit that it is
 * never displayed, never logged and never put in a URL. The person sees their
 * KingsChat name.
 */
export interface Session {
  token: string;
  refreshToken: string;
  kcId: string | null;
  name: string | null;
  kcUsername: string | null;
  avatarUrl: string | null;
}

const KEY = 'ka.session.v1';

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return parsed && parsed.token ? parsed : null;
  } catch {
    // A corrupt or unreadable entry is the same as no session: sign in again.
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // nothing stored, nothing to clear
  }
}
