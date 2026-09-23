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

/**
 * `includeSent` asks the server for the FULL list — sent reminders too, not
 * only outstanding ones. `sync.ts` needs both: a reminder that's sent means
 * "delivered, end its alarm"; a reminder that's simply absent from this full
 * list means "deleted, end its alarm" — two different, both legitimate,
 * server-affirmed reasons to cancel. Filtered to outstanding-only (the
 * default, `includeSent: false`), "delivered" and "deleted" arrive as the
 * same thing — nothing — which is what let a sync cancel the alarm still
 * holding a reminder the server simply hadn't marked sent yet.
 */
export async function fetchReminders({ includeSent = false }: { includeSent?: boolean } = {}): Promise<
  ServerReminder[]
> {
  const qs = includeSent ? '?include_sent=1' : '';
  const d = await call(`/agent-connect/reminders${qs}`, { method: 'GET' });
  return Array.isArray(d.reminders) ? d.reminders : [];
}

export async function createReminder(text: string, dueAt: number, repeat = 'none') {
  const d = await call('/agent-connect/reminders', {
    method: 'POST',
    body: JSON.stringify({ text, due_at: dueAt, repeat }),
  });
  return d.reminder as ServerReminder;
}

/**
 * What this phone did with a reminder — never what it downloaded. A row that
 * was fetched but not armed stays outstanding on the server, on purpose.
 *
 *   armed     the alarm is really set; this is what stops the DM going out too
 *   blocked   the arm FAILED — `reason` is how the agent can tell the person
 *             in chat that their alarm did not go on
 *   expired   a one-shot already past due, refused rather than rung late
 *   done      dismissed here (a repeat rolls forward server-side, never ends)
 *   cancelled an explicit end, repeats included
 *
 * No `armed_at`: the server stamps its own, so a skewed device clock can't
 * write the audit field.
 */
export type ReminderAck = 'armed' | 'blocked' | 'expired' | 'done' | 'cancelled';

export async function patchReminder(
  id: string,
  status: ReminderAck,
  deviceId: string,
  reason?: string,
) {
  return call(`/agent-connect/reminders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, device_id: deviceId, ...(reason ? { reason } : {}) }),
  });
}

// ─── personal space (the Home section) ─────────────────────────────────
// Everything the website's /me page shows, minus the transcript: the app
// asks for `messages=0` because it deliberately does not display the chat
// history, and 200 messages it will never render is the heaviest part of
// this response.

export interface MyProfile {
  display_name?: string | null;
  org?: string | null;
  role_title?: string | null;
  timezone?: string | null;
  gender?: string | null;
  prefs?: string | null;
}

export interface MyContact {
  id: string;
  name: string;
  kc_handle?: string | null;
  kc_id?: string | null;
  style_sample?: string | null;
  gender?: string | null;
  note?: string | null;
}

export interface MyDocument {
  id: string;
  title: string;
  kind: string;
  body?: string;
  sources?: string[];
  pdf_url?: string | null;
  file_url?: string | null;
  created_at?: number | null;
}

export interface MyNote {
  id: string;
  text: string;
  created_at?: number | null;
}

export interface MyTodo {
  id: string;
  text: string;
  done?: boolean;
  created_at?: number | null;
}

export interface MyScheduledSend {
  id: string;
  title?: string | null;
  send_at?: number | null;
  status?: string | null;
  contact_name?: string | null;
}

export interface MyData {
  profile: MyProfile | null;
  notes: MyNote[];
  todos: MyTodo[];
  contacts: MyContact[];
  reminders: ServerReminder[];
  scheduledSends: MyScheduledSend[];
  documents: MyDocument[];
}

export async function fetchMyData(): Promise<MyData> {
  const d = await call('/agent-connect/my-data?messages=0', { method: 'GET' });
  return {
    profile: d.profile ?? null,
    notes: Array.isArray(d.notes) ? d.notes : [],
    todos: Array.isArray(d.todos) ? d.todos : [],
    contacts: Array.isArray(d.contacts) ? d.contacts : [],
    reminders: Array.isArray(d.reminders) ? d.reminders : [],
    scheduledSends: Array.isArray(d.scheduledSends) ? d.scheduledSends : [],
    documents: Array.isArray(d.documents) ? d.documents : [],
  };
}

export interface NewContact {
  name: string;
  kc_handle: string;
  kc_id?: string;
  gender?: 'male' | 'female';
  style_sample?: string;
}

/**
 * The same write the bot makes for "add contact" in a DM, and the same rule:
 * a name and a KingsChat handle are both mandatory. A contact with no handle
 * cannot be messaged, so it is a bug rather than a valid save.
 */
export async function addContact(contact: NewContact): Promise<MyContact> {
  const d = await call('/agent-connect/contacts', {
    method: 'POST',
    body: JSON.stringify(contact),
  });
  return d.contact as MyContact;
}

export interface KcProfile {
  kcId?: string | null;
  username?: string | null;
  name?: string | null;
  avatar?: string | null;
}

/**
 * Look a KingsChat handle up before saving it, so a typo is caught here
 * rather than by a message that silently goes nowhere. Not found is a normal
 * answer — plenty of people the agent will message have never signed in — so
 * this resolves to `null` rather than throwing.
 */
export async function lookupKcHandle(username: string): Promise<KcProfile | null> {
  const clean = username.trim().replace(/^@/, '');
  if (!clean) return null;
  const d = await call('/auth/kingschat/lookup', {
    method: 'POST',
    body: JSON.stringify({ username: clean }),
  });
  return d.found && d.profile ? (d.profile as KcProfile) : null;
}

export { API_BASE };
