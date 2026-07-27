const SERVICE_ACCOUNT = JSON.parse(process.env.GCP_SA_KEY);

const GMAIL_USER = 'ruralroster@gmail.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

// STAGING Sheet ID
const SHEET_ID = '1CFBuEK6P32ZA28TxrgsLpRbLKfCnLUlsOaRkH5JFDXc';
const FRONTEND_URL = 'https://ruralroster.github.io/casualrosters-v2/';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = 'mailto:ruralroster@gmail.com';
const PUSH_ENABLED = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

module.exports = {
  SERVICE_ACCOUNT,
  GMAIL_USER,
  GMAIL_APP_PASSWORD,
  SHEET_ID,
  FRONTEND_URL,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT,
  PUSH_ENABLED
};
