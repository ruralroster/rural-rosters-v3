# Rural Rosters Backend — Modularisation Boundary Map

Target: split the monolithic `index.js` (2,215 lines, Crystal Cascades sandbox
version) into modules with ZERO behaviour change. Execute only AFTER the debug
change list is merged and the Barron Falls + Phase 3 test protocols pass.

## Recommended deviation from the original plan

The original plan (auth / officers / staff / marketplace / utils) splits by
*role*. That splits badly: most functions serve both roles (e.g.
`approveShiftRequest` is an officer action on a staff request — which file?).
This map splits by *domain* instead, which gives clean one-way dependencies:

```
index.js (router) ──> domain modules ──> clients.js ──> config.js
                              │
                              └──> push.js, ics.js, utils.js
```

No module ever requires the router; push/ics/utils never require domain
modules. Zero circular-dependency risk.

## File layout

```
backend/
├── index.js          # HTTP server, CORS, action dispatch table ONLY
├── config.js         # constants + env (SHEET_ID, FRONTEND_URL, VAPID, creds)
├── clients.js        # JWT auth, sheets client, nodemailer transporter (singletons)
├── utils.js          # brisTime, formatDate, normaliseDate, formatASTLabel, SIGN_OFF
├── ics.js            # getShiftTimes, generateICS
├── push.js           # savePushSubscription, sendPushNotification
├── users.js          # identity + settings
├── vacancies.js      # shift definitions + vacancy CRUD
├── requests.js       # shift-cover request lifecycle
└── marketplace.js    # swap listings, claims, proposals
```

## Function → module assignment (all 41 functions)

| Module | Functions |
| --- | --- |
| **users.js** | checkUserExists, getOfficerLocations, getStaffLocations, getAllLocations, updateUserLocations, updateUserPrimaryLocations, updateUserAST |
| **vacancies.js** | getJobTypesForLocation, getOfficerVacancies, getStaffAvailableShifts, saveOfficerVacancies, addShiftType, getShiftTypesForOfficer |
| **requests.js** | requestShifts, approveShiftRequest, denyShiftRequest, reofferShift, checkShiftApplicants, countPendingRequests, getPendingCounts, getOfficerPendingApprovals, getOfficerPastApprovals |
| **marketplace.js** | listShiftForSwap, getMarketplaceListings, claimShift, getOfficerMarketplaceListings, getOfficerApprovedListings, approveSwap, denySwap, approvePendingSwap, denySwapWithReason, removeFromMarketplace, proposeSwap, approveSwapProposal, denySwapProposal, denySwapProposalWithReason, getOfficerSwapProposals, getOfficerPastSwapProposals |
| **push.js** | savePushSubscription, sendPushNotification |
| **ics.js** | getShiftTimes, generateICS |
| **utils.js** | brisTime, formatDate, normaliseDate, formatASTLabel (+ SIGN_OFF const) |

Notes:
- `getStaffAvailableShifts` reads the Requests sheet for pending flags but is
  fundamentally a vacancy read — keep in vacancies.js, requiring nothing from
  requests.js (it reads the sheet directly, as now).
- `requests.js` and `marketplace.js` both require `users.js` (for
  getOfficerLocations / getStaffLocations), `push.js`, `ics.js`, `utils.js`,
  and `clients.js`. `users.js` requires only clients + utils. One-way, clean.

## Dependency pattern — singletons, not injection

Keep it boring. `clients.js` initialises once at require time (preserving the
current [INIT] logging and fail-fast process.exit behaviour) and exports:

```javascript
// clients.js
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const nodemailer = require('nodemailer');
const config = require('./config');

const auth = new JWT({ email: ..., key: ..., scopes: [...] });
const sheets = google.sheets({ version: 'v4', auth });
const transporter = nodemailer.createTransport({ ... });

module.exports = { sheets, transporter };
```

Every domain module starts:
```javascript
const { sheets, transporter } = require('./clients');
const { SHEET_ID, FRONTEND_URL, GMAIL_USER } = require('./config');
const { brisTime, normaliseDate } = require('./utils');
const { sendPushNotification } = require('./push');
```

No DI framework, no factories. Node's require cache makes these singletons.

## config.js — do the security fix during this refactor

This is the natural moment to remove the hardcoded service-account key and
Gmail app password:

```javascript
// config.js — credentials from env, with the JSON key as a single env var
const SERVICE_ACCOUNT = process.env.GCP_SA_KEY
  ? JSON.parse(process.env.GCP_SA_KEY)
  : null;  // null => rely on Application Default Credentials (preferred)
```

Preferred end state: attach the service account to the Cloud Run service and
construct auth with `new google.auth.GoogleAuth({ scopes: [...] })` — no key
material anywhere. If that change feels too large to bundle with the refactor,
at minimum move the two secrets to env vars; but do NOT ship the modularised
version with secrets still hardcoded, because the refactor commit is exactly
the kind of thing that ends up shared for review.

## index.js after the split (~120 lines)

Only: requires of all modules, the http.createServer boilerplate (CORS,
OPTIONS, GET /, body parsing) unchanged, and the switch statement with each
case delegating to `module.fn(...)`. The switch stays a switch — do not
convert to a dispatch object in the same commit (behaviour-preserving means
resisting every "while I'm here" improvement).

## Docker note

`node:20-alpine` unchanged. Ensure the Dockerfile `COPY` includes the new
`.js` files (a `COPY . .` already does; a file-list COPY needs updating).

## Verification (the whole point)

1. `node --check` every module.
2. `node index.js` locally — [INIT] log lines identical to the monolith's.
3. Deploy to the sandbox Cloud Run service.
4. Re-run the FULL Barron Falls 20-section protocol + the Phase 3 addendum
   (P3.1–P3.20). Identical results = refactor done. Any deviation = the
   refactor introduced it, by definition, since nothing else changed.
5. Diff discipline: `cat` all modules concatenated vs the monolith should
   show only moved code, added require/module.exports lines, and nothing else.
