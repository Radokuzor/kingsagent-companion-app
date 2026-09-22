// ═══════════════════════════════════════════════════════════════════════
// Verification for the kcId harvest in App.tsx
//
//   node scripts/verify-kcid-snippet.js
//
// Pulls KCID_SNIPPET out of App.tsx and runs it in a fake page context, the
// way the WebView would, so the hand-off can be checked without a phone:
//
//   1. a signed-in session posts its kcId, read from localStorage, once
//   2. repeat polls never re-post the same id
//   3. a session from before this change falls back to GET /auth/me with the JWT
//   4. anything that is not 24 hex characters is refused at the source
//   5. no session means silence: no post, no network
//   6. the stop flag the app sets after storing ends the poll
// ═══════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'App.tsx');
const KCID = '6aa3505b0c24125491fd4eb0';

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && extra !== undefined ? ' -> ' + extra : ''}`);
}

/** The snippet as it ships, with the API constant already interpolated. */
function loadSnippet() {
  const src = fs.readFileSync(APP, 'utf8');
  const open = 'const KCID_SNIPPET = `';
  const start = src.indexOf(open);
  if (start < 0) throw new Error('KCID_SNIPPET not found in App.tsx');
  const bodyStart = start + open.length;
  const end = src.indexOf('`;', bodyStart);
  if (end < 0) throw new Error('KCID_SNIPPET has no closing backtick');

  const api = src.match(/const KCID_API_BASE = '([^']+)'/);
  if (!api) throw new Error('KCID_API_BASE not found in App.tsx');
  return { code: src.slice(bodyStart, end).replace('${KCID_API_BASE}', api[1]), api: api[1] };
}

/** Run the snippet in a fresh fake page. */
async function run({ storage, fetchImpl, ticks = 3 }) {
  const { code } = loadSnippet();
  const posted = [];
  const fetchCalls = [];
  const intervals = [];
  const cleared = [];

  const sandbox = {
    window: { ReactNativeWebView: { postMessage: (s) => posted.push(s) } },
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null) },
    setInterval: (fn) => {
      intervals.push(fn);
      return intervals.length;
    },
    clearInterval: (id) => cleared.push(id),
    JSON,
    console,
    fetch: (url, opts) => {
      fetchCalls.push({ url, opts });
      return fetchImpl ? fetchImpl(url, opts) : Promise.reject(new Error('no fetch'));
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'KCID_SNIPPET' });

  // The snippet polls once on install and then on the interval; drive it.
  for (let i = 0; i < ticks; i++) intervals.forEach((fn) => fn());
  await new Promise((r) => setTimeout(r, 30));

  return { posted, fetchCalls, cleared, intervals, sandbox, msgs: () => posted.map((s) => JSON.parse(s)) };
}

(async () => {
  const { api } = loadSnippet();
  console.log(`\nAPI base in the snippet: ${api}`);

  console.log('\n1. signed-in session: kcId read from localStorage');
  {
    const r = await run({ storage: { user: JSON.stringify({ id: 'acct', name: 'Rayn Man', kcId: KCID }) } });
    check('exactly one postMessage', r.posted.length === 1, r.posted.length);
    check('type is ka.kcId', r.msgs()[0]?.type === 'ka.kcId', JSON.stringify(r.msgs()[0]));
    check('kcId is the signed-in account', r.msgs()[0]?.kcId === KCID, JSON.stringify(r.msgs()[0]));
    check('source is localStorage', r.msgs()[0]?.src === 'localStorage');
    check('no API call was needed', r.fetchCalls.length === 0, r.fetchCalls.length);
  }

  console.log('\n2. repeat polls never re-post the same id');
  {
    const r = await run({ storage: { user: JSON.stringify({ kcId: KCID }) }, ticks: 10 });
    check('still exactly one postMessage', r.posted.length === 1, r.posted.length);
  }

  console.log('\n3. session from before this change: falls back to GET /auth/me');
  {
    const r = await run({
      storage: { user: JSON.stringify({ id: 'acct', name: 'Rayn Man' }), token: 'jwt-abc' },
      fetchImpl: async () => ({ ok: true, json: async () => ({ kcId: KCID, user: { kcId: KCID } }) }),
      ticks: 1,
    });
    check('called /auth/me', !!r.fetchCalls[0] && r.fetchCalls[0].url.endsWith('/auth/me'), r.fetchCalls[0]?.url);
    check('sent the JWT as a Bearer header', r.fetchCalls[0]?.opts?.headers?.Authorization === 'Bearer jwt-abc');
    check('kcId posted from the API answer', r.msgs()[0]?.kcId === KCID && r.msgs()[0]?.src === 'api', JSON.stringify(r.msgs()[0]));
  }

  console.log('\n4. junk is refused at the source');
  {
    const r = await run({ storage: { user: JSON.stringify({ kcId: 'not-an-id' }) }, ticks: 3 });
    check('no postMessage for a non-kcId', r.posted.length === 0, JSON.stringify(r.posted));
  }

  console.log('\n5. no session: silence, no network');
  {
    const r = await run({ storage: {}, ticks: 5 });
    check('no postMessage', r.posted.length === 0, JSON.stringify(r.posted));
    check('no fetch', r.fetchCalls.length === 0, r.fetchCalls.length);
  }

  console.log('\n6. the stop flag ends the poll');
  {
    // ticks: 0 leaves the interval installed but never driven, so the handler
    // can be invoked by hand after the flag is set.
    const r = await run({ storage: { user: JSON.stringify({ kcId: KCID }) }, ticks: 0 });
    const before = { posted: r.posted.length, fetched: r.fetchCalls.length };
    const timerId = r.sandbox.window.__kaKcIdTimer;
    check('poller installed its interval', timerId !== undefined && timerId !== null, timerId);

    r.sandbox.window.__kaKcIdDone = true;
    r.intervals.forEach((fn) => fn());

    check('clearInterval called with that id', r.cleared.includes(timerId), JSON.stringify(r.cleared));
    check('timer handle cleared', r.sandbox.window.__kaKcIdTimer === null, r.sandbox.window.__kaKcIdTimer);
    check(
      'nothing new posted or fetched',
      r.posted.length === before.posted && r.fetchCalls.length === before.fetched
    );
  }

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
