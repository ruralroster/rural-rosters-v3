const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const nodemailer = require('nodemailer');
const { SERVICE_ACCOUNT, GMAIL_USER, GMAIL_APP_PASSWORD } = require('./config');

console.log('[INIT] Starting backend initialization...');

let auth, sheets, transporter;

try {
  console.log('[INIT] Creating JWT auth...');
  auth = new JWT({
    email: SERVICE_ACCOUNT.client_email,
    key: SERVICE_ACCOUNT.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  console.log('[INIT] JWT created successfully');

  console.log('[INIT] Initializing Google Sheets API...');
  sheets = google.sheets({ version: 'v4', auth });
  console.log('[INIT] Google Sheets API initialized');

  console.log('[INIT] Initializing Nodemailer...');
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
  });
  console.log('[INIT] Nodemailer initialized');

  console.log('[INIT] All initialization complete!');
} catch (err) {
  console.error('[INIT ERROR] Failed to initialize:', err.message);
  console.error(err);
  process.exit(1);
}

module.exports = { sheets, transporter };
