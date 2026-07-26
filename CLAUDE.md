# Rural Rosters V3

Shift-vacancy and swap-management system for Queensland Health CHHHS rural
rostering. Evolving the existing "Crystal Cascades" codebase in place — this
is NOT a from-scratch rewrite. You may freely read, reference, and modify
the existing code.

## Scope guardrail
Build for Queensland Health only. Do NOT add anything RFDS-specific
(branding, aeromedical-retrieval logic, RFDS as a deployment target) — the
IP situation with that employer is unresolved. If RFDS ever comes up, stop
and ask the user rather than assuming it's fine.

## Credentials
All credentials live in GCP Secret Manager under the `rural-rosters-v3`
project — `gcp-sa-key-v3` and `gmail-app-password-v3`. Never hardcode
credentials in source. Read them via environment variables
(GCP_SA_KEY, GMAIL_APP_PASSWORD) — the deployment layer injects them from
Secret Manager. If you ever see a hardcoded key or password in a file
you're editing, stop and flag it rather than leaving it or committing it.

## Structure
- frontend/index.html — single-file HTML/JS frontend
- backend/index.js — Node.js backend (Google Sheets as the data store,
  Cloud Run deployment target)

## Priorities (see docs/ for full detail once added)
1. Modularise backend/index.js into separate files by domain.
2. Real authentication (hashed passwords, not plaintext comparison).
3. Migrate off Google Sheets to a proper database — this one has a live
   privacy dimension (CHHHS staff data), not just tech debt, treat it as
   a real priority.
