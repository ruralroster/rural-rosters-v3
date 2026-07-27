const webpush = require('web-push'); // PHASE 3
const config = require('./config');

// ============================================================================
// PHASE 3 — WEB PUSH (VAPID) CONFIGURATION
// Keys come from Cloud Run env vars. Absent keys => push layer is a no-op.
// ============================================================================
if (config.PUSH_ENABLED) {
  webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
  console.log('[INIT] Web Push enabled');
} else {
  console.log('[INIT] Web Push DISABLED - VAPID env vars not set');
}

const { sheets } = require('./clients');
const { brisTime } = require('./utils');
const { SHEET_ID, FRONTEND_URL, PUSH_ENABLED } = config;

// ============================================================================
// PHASE 3 — PUSH NOTIFICATION FUNCTIONS
// ============================================================================

// Push Subscriptions sheet columns:
// A email | B subscription JSON | C timestamp | D district (Phase 5) | E active TRUE/FALSE
async function savePushSubscription(email, subscription) {
  try {
    if (!email || !subscription) return { error: 'Missing email or subscription' };

    let parsed;
    try { parsed = JSON.parse(subscription); } catch (e) { return { error: 'Invalid subscription JSON' }; }
    const endpoint = parsed && parsed.endpoint;
    if (!endpoint) return { error: 'Subscription missing endpoint' };

    const normalizedEmail = String(email).toLowerCase().trim();

    // Dedupe by endpoint: if this device is already registered, refresh the
    // row (reactivate + update timestamp) rather than appending a duplicate.
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Push Subscriptions!A2:E'
    });
    const rows = existing.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      try {
        const rowSub = JSON.parse(rows[i][1] || '{}');
        if (rowSub.endpoint === endpoint) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `Push Subscriptions!A${i + 2}:E${i + 2}`,
            valueInputOption: 'RAW',
            resource: { values: [[normalizedEmail, subscription, brisTime(), rows[i][3] || '', 'TRUE']] }
          });
          console.log(`savePushSubscription: refreshed existing endpoint for ${normalizedEmail}`);
          return { success: true, refreshed: true };
        }
      } catch (e) { /* malformed row — skip */ }
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Push Subscriptions!A2:E',
      valueInputOption: 'RAW',
      resource: { values: [[normalizedEmail, subscription, brisTime(), '', 'TRUE']] }
    });
    console.log(`savePushSubscription: new subscription stored for ${normalizedEmail}`);
    return { success: true };
  } catch (err) {
    console.error('savePushSubscription error:', err);
    return { error: err.toString() };
  }
}

// Sends a push to every ACTIVE subscription for the given email.
// Stale subscriptions (410 Gone / 404) are marked inactive, not deleted —
// keeps row indices stable and preserves an audit trail.
// NEVER throws; failures are logged and swallowed.
async function sendPushNotification(email, title, body, url) {
  if (!PUSH_ENABLED) return;
  try {
    const normalizedEmail = String(email || '').toLowerCase().trim();
    if (!normalizedEmail) return;

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Push Subscriptions!A2:E'
    });
    const rows = result.data.values || [];
    const payload = JSON.stringify({ title, body, url: url || FRONTEND_URL });

    for (let i = 0; i < rows.length; i++) {
      const rowEmail = String(rows[i][0] || '').toLowerCase().trim();
      const active = String(rows[i][4] || '').toUpperCase() === 'TRUE';
      if (rowEmail !== normalizedEmail || !active) continue;

      let sub;
      try { sub = JSON.parse(rows[i][1] || ''); } catch (e) { continue; }

      try {
        await webpush.sendNotification(sub, payload);
        console.log(`Push sent to ${normalizedEmail} (row ${i + 2})`);
      } catch (pushErr) {
        const code = pushErr.statusCode;
        if (code === 410 || code === 404) {
          console.log(`Push subscription stale for ${normalizedEmail} (row ${i + 2}) — marking inactive`);
          try {
            await sheets.spreadsheets.values.update({
              spreadsheetId: SHEET_ID,
              range: `Push Subscriptions!E${i + 2}`,
              valueInputOption: 'RAW',
              resource: { values: [['FALSE']] }
            });
          } catch (updateErr) {
            console.error('Failed to deactivate stale subscription:', updateErr.message);
          }
        } else {
          console.error(`Push send error for ${normalizedEmail}:`, pushErr.message);
        }
      }
    }
  } catch (err) {
    console.error('sendPushNotification error (swallowed):', err.message);
  }
}


module.exports = { savePushSubscription, sendPushNotification };
