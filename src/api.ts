import Constants from 'expo-constants';

import { clearSession, loadSession, saveSession, type Session } from './session';

/**
 * The Kings Agent backend. Every client read and write goes through it — the
 * app deliberately does NOT talk to Firestore directly, because the logic and
 * the credentials live on the server and a phone is not a trusted place for
 * either.
 */
const API_BASE = String(
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? '',
).replace(/\/+$/, '');

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parse(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/** Unauthenticated call. Used by pairing, which happens before any session. */
async function callPublic(path: string, body?: unknown, method = 'POST'): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await parse(res);
  if (!res.ok && res.status !== 202) {
    throw new ApiError(data.message || data.error || `HTTP ${res.status}`, res.status, data.error || '');
  }
  return { ...data, __status: res.status };
}

/**
 * Authenticated call, with exactly one silent refresh on a 401.
 *
 * Our JWT lasts 7 days and the app has to survive longer than that in a
 * drawer, so a 401 is the expected end of a token's life, not an error worth
 * showing anyone. One retry, and if the refresh itself fails the session is
 * genuinely dead and gets cleared so the UI asks for consent again.
 */
async function call(path: string, options: RequestInit = {}, retrying = false): Promise<any> {
  const session = await loadSession();
  if (!session) throw new ApiError('Not signed in', 401, 'no_session');

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 401 && !retrying) {
    const refreshed = await refreshSession(session);
    if (refreshed) return call(path, options, true);
    await clearSession();
    throw new ApiError('Session expired', 401, 'session_expired');
  }

  const data = await parse(res);
  if (!res.ok) {
    throw new ApiError(data.message || data.error || `HTTP ${res.status}`, res.status, data.error || '');
  }
  return data;
}

async function refreshSession(session: Session): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    if (!res.ok) return false;
    const data = await parse(res);
    if (!data.token) return false;
    await saveSession({
      ...session,
      token: data.token,
      refreshToken: data.refresh_token || session.refreshToken,
      kcId: data.kcId ?? session.kcId,
      name: data.user?.name ?? session.name,
      kcUsername: data.user?.kcUsername ?? session.kcUsername,
      avatarUrl: data.user?.avatarUrl ?? session.avatarUrl,
    });
    return true;
  } catch {
    // Offline. Not a dead session — say no and let the caller try later.
    return false;
  }
}

// ─── pairing ───────────────────────────────────────────────────────────

export interface PairStart {
  pairId: string;
  secret: string;
  consentUrl: string;
  expiresAt: number;
}

export async function pairStart(deviceId: string, appVersion: string): Promise<PairStart> {
  const d = await callPublic('/auth/app-pair/start', {
    device_id: deviceId,
    platform: 'android',
    app_version: appVersion,
  });
  return { pairId: d.pair_id, secret: d.secret, consentUrl: d.consent_url, expiresAt: d.expires_at };
}

/**
 * Poll while the consent screen is open. `null` means "still waiting" — the
 * person is mid sign-in, which is a normal state and not a failure.
 */
export async function pairClaim(pairId: string, secret: string): Promise<Session | null> {
  const d = await callPublic('/auth/app-pair/claim', { pair_id: pairId, secret });
  if (d.__status === 202 || d.status === 'pending') return null;
  return {
    token: d.token,
    refreshToken: d.refresh_token,
    kcId: d.kcId ?? null,
    name: d.user?.name ?? null,
    kcUsername: d.user?.kcUsername ?? null,
    avatarUrl: d.user?.avatarUrl ?? null,
  };
}

// ─── devices ───────────────────────────────────────────────────────────

export async function registerDevice(deviceId: string, fcmToken: string | null, appVersion: string) {
  return call('/devices', {
    method: 'POST',
    body: JSON.stringify({
      device_id: deviceId,
      fcm_token: fcmToken,
      platform: 'android',
      app_version: appVersion,
    }),
  });
}

export async function unregisterDevice(deviceId: string) {
  return call(`/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
}

// ─── reminders ─────────────────────────────────────────────────────────

export interface ServerReminder {
  id: string;
  text: string;
  due_at: number;
  repeat: 'none' | 'daily' | 'weekdays' | 'weekly';
  deliver: 'dm' | 'device' | 'both';
  device_ids: string[];
  sent: boolean;
}

export async function fetchReminders(): Promise<ServerReminder[]> {
  const d = await call('/agent-connect/reminders', { method: 'GET' });
  return Array.isArray(d.reminders) ? d.reminders : [];
}

export async function createReminder(text: string, dueAt: number, repeat = 'none') {
  const d = await call('/agent-connect/reminders', {
    method: 'POST',
    body: JSON.stringify({ text, due_at: dueAt, repeat }),
  });
  return d.reminder as ServerReminder;
}

/** Tell the server what this phone did with a reminder. */
export async function patchReminder(
  id: string,
  status: 'armed' | 'done' | 'cancelled',
  deviceId: string,
) {
  return call(`/agent-connect/reminders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, device_id: deviceId }),
  });
}

export { API_BASE };
