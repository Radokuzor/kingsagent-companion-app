# Where the architecture docs live

The cross-repo build specs for this app live in the `Radokuzor/KingsAgent` repo
(the backend this app talks to), not here, so they stay in one place instead of
drifting between two repos:

- `docs/architecture/companion-app-architecture-brief.md` — how this app and the
  backend/website fit together. **Phase 1 of its §9 build order is now done**
  (native KingsChat sign-in, device registration, FCM, reminder sync and
  write-back, and the deletion of the WebView / paste tab / kcId display).
  Phases 2 and 3 — the personal space and the assistant conversation as native
  screens — are not started.
- `docs/architecture/kingsagent-spaces-build.md` — the larger per-user "Bot
  Spaces" vision this app is one piece of.

On this machine: `/home/rad/Desktop/KingsAgent/docs/architecture/`.

`BUILD-BRIEF.md` in this repo's root is the source of truth for what is built
in *this* app today and how to build it locally. `ALARM-ARCHITECTURE.md` is the
reasoning behind the device-owns-the-schedule rule — why Firebase alone cannot
wake a phone, and why `USE_EXACT_ALARM` must stay in the manifest. Both are
current.

Decisions from the brief's §10 that are now settled:

- **D2 (how the native login catches the redirect)** — neither of the two
  options in the brief. The KingsChat portal entry was not changed and the app
  does not intercept navigation; the backend brokers the handoff through a
  one-time pairing (`/api/auth/app-pair/*`), so nothing secret crosses a URL and
  the phone never needs its own client id. See `BUILD-BRIEF.md`.
- **D3 (push credentials)** — the `kings-agent` Firebase project, the same one
  the backend already uses, so `pushService.js` needed no new credentials. The
  app still needs its own `google-services.json`.
- **D4 (does the DM still fire when a phone is registered)** — no, but only once
  that phone has *acknowledged arming* the alarm. Registration alone is not
  enough; see the `deliver` field.
