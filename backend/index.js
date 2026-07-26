/**
 * Rural Rosters Backend V2 - Staging
 * Staging credentials + clear-first vacancies + mailto links + checkUserExists fix
 */

const http = require('http');
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const nodemailer = require('nodemailer');
const webpush = require('web-push'); // PHASE 3

const SERVICE_ACCOUNT = JSON.parse(process.env.GCP_SA_KEY);

const GMAIL_USER = 'ruralroster@gmail.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

// STAGING Sheet ID
const SHEET_ID = '1CFBuEK6P32ZA28TxrgsLpRbLKfCnLUlsOaRkH5JFDXc';
const FRONTEND_URL = 'https://ruralroster.github.io/casualrosters-v2/';
const BRISBANE_TZ = 'Australia/Brisbane';
const brisTime = () => new Date().toLocaleString('en-AU', { timeZone: BRISBANE_TZ, hour12: true,
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const SIGN_OFF = '<p style="margin-top:16px;">Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>';

// ============================================================================
// PHASE 3 — WEB PUSH (VAPID) CONFIGURATION
// Keys come from Cloud Run env vars. Absent keys => push layer is a no-op.
// ============================================================================
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = 'mailto:ruralroster@gmail.com';
const PUSH_ENABLED = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (PUSH_ENABLED) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('[INIT] Web Push enabled');
} else {
  console.log('[INIT] Web Push DISABLED - VAPID env vars not set');
}


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

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && req.url === '/') { res.writeHead(200); res.end(JSON.stringify({ status: 'ok', service: 'Rural Rosters API V2 Staging' })); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { action, params } = JSON.parse(body);
      console.log('Action:', action);
      let result;
      switch (action) {
        case 'checkUserExists':           result = await checkUserExists(params.email, params.password); break;
        case 'getOfficerLocations':       result = await getOfficerLocations(params.email); break;
        case 'getStaffLocations':         result = await getStaffLocations(params.email); break;
        case 'getJobTypesForLocation':    result = await getJobTypesForLocation(params.location); break;
        case 'getOfficerVacancies':       result = await getOfficerVacancies(params.email); break;
        case 'getStaffAvailableShifts':   result = await getStaffAvailableShifts(params.email); break;
        case 'requestShifts':             result = await requestShifts(params.email, params.name, params.shifts); break;
        case 'saveOfficerVacancies':      result = await saveOfficerVacancies(params.email, params.vacancies); break;
        case 'listShiftForSwap':          result = await listShiftForSwap(params.email, params.name, params.date, params.jobType, params.location, params.isServiceDisruption, params.availableDays); break;
        case 'getMarketplaceListings':    result = await getMarketplaceListings(params.email); break;
        case 'claimShift':                result = await claimShift(params.claimingEmail, params.claimingName, params.originalEmail, params.originalName, params.date, params.jobType, params.location); break;
        case 'getOfficerMarketplaceListings': result = await getOfficerMarketplaceListings(params.email); break;
        case 'getOfficerPendingApprovals':    result = await getOfficerPendingApprovals(params.email); break;
        case 'getOfficerPastApprovals':       result = await getOfficerPastApprovals(params.email); break;
        case 'approveSwap':               result = await approveSwap(params.claimingEmail, params.claimingName, params.originalEmail, params.originalName, params.officerEmail, params.officerName, params.date, params.jobType, params.location, params.sendEmail !== false); break;
        case 'denySwap':                  result = await denySwap(params.claimingEmail, params.claimingName, params.originalEmail, params.originalName, params.officerEmail, params.officerName, params.date, params.jobType, params.location, params.sendEmail !== false); break;
        case 'approvePendingSwap':        result = await approvePendingSwap(params.staffEmail, params.staffName, params.date, params.jobType, params.location); break;
        case 'denySwapWithReason':        result = await denySwapWithReason(params.staffEmail, params.staffName, params.date, params.jobType, params.location, params.reason); break;
        case 'getOfficerApprovedListings':  result = await getOfficerApprovedListings(params.email); break;
        case 'getOfficerSwapProposals':     result = await getOfficerSwapProposals(params.email); break;
        case 'getOfficerPastSwapProposals':  result = await getOfficerPastSwapProposals(params.email); break;
        case 'removeFromMarketplace':       result = await removeFromMarketplace(params.staffEmail, params.staffName, params.date, params.jobType, params.location); break;
        case 'denySwapProposalWithReason':  result = await denySwapProposalWithReason(params.claimingEmail, params.claimingName, params.date, params.jobType, params.location, params.reason); break;
        case 'approveShiftRequest':       result = await approveShiftRequest(params.email, params.name, params.date, params.jobType, params.location, params.sendEmail !== false); break;
        case 'denyShiftRequest':          result = await denyShiftRequest(params.email, params.name, params.date, params.jobType, params.location, params.sendEmail !== false); break;
        case 'proposeSwap':               result = await proposeSwap(params.claimingEmail, params.claimingName, params.originalEmail, params.originalName, params.date, params.jobType, params.location, params.offeredDate, params.offeredJobType); break;
        case 'approveSwapProposal':       result = await approveSwapProposal(params.claimingEmail, params.claimingName, params.originalEmail, params.originalName, params.officerEmail, params.officerName, params.date, params.jobType, params.location, params.offeredDate, params.offeredJobType, params.sendEmail !== false); break;
        case 'denySwapProposal':          result = await denySwapProposal(params.claimingEmail, params.claimingName, params.officerEmail, params.officerName, params.date, params.jobType, params.location, params.sendEmail !== false); break;
        case 'updateUserLocations':             result = await updateUserLocations(params.email, params.locations, params.role); break;
        case 'updateUserPrimaryLocations':      result = await updateUserPrimaryLocations(params.email, params.primaryLocations); break;
        case 'updateUserAST':             result = await updateUserAST(params.email, params.astQuals); break;
        case 'countPendingRequests':      result = await countPendingRequests(params.email); break;
        case 'getPendingCounts':           result = await getPendingCounts(params.email); break;
        case 'addShiftType':               result = await addShiftType(params.officerEmail, params.location, params.jobType, params.startTime, params.endTime, params.astRequired); break;
        case 'reofferShift':               result = await reofferShift(params.officerEmail, params.officerName, params.staffEmail, params.staffName, params.date, params.jobType, params.location); break;
        case 'checkShiftApplicants':       result = await checkShiftApplicants(params.shifts); break;
        case 'getShiftTypesForOfficer':    result = await getShiftTypesForOfficer(params.email); break;
        case 'getAllLocations':              result = await getAllLocations(); break;
        case 'savePushSubscription':       result = await savePushSubscription(params.email, params.subscription); break; // PHASE 3
        default: result = { error: 'Unknown action: ' + action };
      }
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('Error:', err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.toString() }));
    }
  });
});

// ============================================================================
// AUTH & USER FUNCTIONS
// ============================================================================

// Fix: immediate return on first email+password match — no collect-then-prefer logic.
// Rule: a user with two rows (Staff + Officer) must have a unique password per row.
// Staff rows should appear before Officer rows in the sheet as a safe default.
async function checkUserExists(email, password) {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Users!A2:H'
    });

    const rows = result.data.values || [];
    const normalizedEmail = email.toLowerCase().trim();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowEmail = String(row[0] || '').toLowerCase().trim();
      const rowPassword = String(row[4] || '').trim();
      const rowRole = String(row[3] || '').trim();

      console.log(`Row ${i}: email="${rowEmail}" role="${rowRole}" passwordMatch=${rowPassword === password}`);

      if (rowEmail === normalizedEmail && rowPassword === password) {
        console.log(`Login match at row ${i}: ${normalizedEmail} as ${rowRole}`);
        return {
          email: row[0],
          name: row[1],
          locations: row[2],
          role: rowRole,
          astQuals: row[6] || 'Emergency',
          primaryLocations: row[7] || ''
        };
      }
    }

    return { error: 'Invalid email or password' };
  } catch (err) {
    console.error('checkUserExists error:', err);
    return { error: err.toString() };
  }
}

async function getOfficerLocations(email) {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Rostering Officers!A2:C'
    });

    const rows = result.data.values || [];
    const locations = [];
    const normalizedEmail = String(email).toLowerCase().trim();

    for (let row of rows) {
      const rowEmail = String(row[2]).toLowerCase().trim();
      if (rowEmail === normalizedEmail) {
        const location = String(row[0]).trim();
        if (location && !locations.includes(location)) {
          locations.push(location);
        }
      }
    }

    return locations;
  } catch (err) {
    console.error('getOfficerLocations error:', err);
    return [];
  }
}

async function getStaffLocations(email) {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Users!A2:C'
    });

    const rows = result.data.values || [];
    const normalizedEmail = email.toLowerCase().trim();

    for (let row of rows) {
      if (row[0] && String(row[0]).toLowerCase().trim() === normalizedEmail) {
        return (row[2] || '').split(',').map(l => l.trim());
      }
    }

    return [];
  } catch (err) {
    console.error('getStaffLocations error:', err);
    return [];
  }
}

async function getJobTypesForLocation(location) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Shift Types!A2:B'
    });

    const rows = response.data.values || [];
    const jobTypes = new Set();

    rows.forEach(row => {
      const jobType = String(row[0]).trim();
      const loc = String(row[1]).trim();
      if (loc === location && jobType) {
        jobTypes.add(jobType);
      }
    });

    return { jobTypes: Array.from(jobTypes).sort() };
  } catch (err) {
    console.error('getJobTypesForLocation error:', err);
    return { error: err.toString() };
  }
}

// ============================================================================
// VACANCY FUNCTIONS
// ============================================================================

async function getOfficerVacancies(email) {
  try {
    const locations = await getOfficerLocations(email);
    if (locations.length === 0) return [];

    const allVacancies = [];
    const locationNames = ['Innisfail', 'Mareeba', 'Tully', 'Yarrabah', 'Atherton', 'Mossman', 'Babinda', 'Cairns', 'Telehealth', 'TestHub'];

    for (let location of locations) {
      if (!locationNames.includes(location)) continue;
      try {
        const result = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: `Vacancies - ${location}!A2:D`
        });
        const rows = result.data.values || [];
        for (let row of rows) {
          if (row[0] && row[1]) {
            allVacancies.push({ date: formatDate(row[0]), jobType: row[1], location: row[2] });
          }
        }
      } catch (locErr) {
        console.log(`getOfficerVacancies: skipping ${location} - ${locErr.message}`);
      }
    }

    return allVacancies;
  } catch (err) {
    console.error('getOfficerVacancies error:', err);
    return [];
  }
}

async function getStaffAvailableShifts(email) {
  try {
    const locations = await getStaffLocations(email);
    if (locations.length === 0) {
      console.log('No locations found for staff member:', email);
      return [];
    }

    console.log('Staff locations:', locations);

    const allShifts = [];
    const locationNames = ['Innisfail', 'Mareeba', 'Tully', 'Yarrabah', 'Atherton', 'Mossman', 'Babinda', 'Cairns', 'Telehealth', 'TestHub'];

    for (let location of locations) {
      if (!locationNames.includes(location)) {
        console.log('Skipping invalid location:', location);
        continue;
      }
      try {
        const result = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: `Vacancies - ${location}!A2:D`
        });
        const rows = result.data.values || [];
        console.log(`Found ${rows.length} shifts in ${location}`);
        for (let row of rows) {
          if (row[0] && row[1]) {
            allShifts.push({ date: formatDate(row[0]), jobType: row[1], location: row[2] });
          }
        }
      } catch (locErr) {
        console.log(`Error reading ${location} vacancies:`, locErr.message);
      }
    }

    console.log('Total shifts found:', allShifts.length);

    // Cross-reference Requests sheet to flag shifts with pending applicants
    try {
      const reqResp = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID, range: 'Requests!A2:G'
      });
      const pendingKeys = new Set();
      for (const row of (reqResp.data.values || [])) {
        const st = String(row[6] || '').toUpperCase();
        if (st === 'PENDING' || st === 'BACKUP') {
          pendingKeys.add(normaliseDate(String(row[3]||'').trim())+'|'+String(row[4]||'').trim()+'|'+String(row[5]||'').trim());
        }
      }
      return allShifts.map(s => ({
        ...s,
        hasPendingApplicants: pendingKeys.has(normaliseDate(s.date)+'|'+s.jobType+'|'+s.location)
      }));
    } catch (e) {
      console.error('getStaffAvailableShifts pending check error:', e.message);
      return allShifts;
    }
  } catch (err) {
    console.error('getStaffAvailableShifts error:', err);
    return [];
  }
}

// Fix: clears existing vacancies for each officer location before writing new ones.
// Prevents duplicate accumulation on repeated saves.
async function saveOfficerVacancies(email, vacancies) {
  try {
    const locations = await getOfficerLocations(email);
    if (locations.length === 0) return { error: 'No locations found for officer' };

    console.log(`Saving ${vacancies.length} vacancies for officer ${email}`);

    const locationNames = ['Innisfail', 'Mareeba', 'Tully', 'Yarrabah', 'Atherton', 'Mossman', 'Babinda', 'Cairns', 'Telehealth', 'TestHub'];

    const vacanciesByLocation = {};
    for (let vac of vacancies) {
      if (!vacanciesByLocation[vac.location]) vacanciesByLocation[vac.location] = [];
      vacanciesByLocation[vac.location].push(vac);
    }

    for (let location of locations) {
      if (!locationNames.includes(location)) continue;

      const sheetName = `Vacancies - ${location}`;
      const newVacancies = vacanciesByLocation[location] || [];

      try {
        // Clear all existing data for this location before writing
        await sheets.spreadsheets.values.clear({
          spreadsheetId: SHEET_ID,
          range: `${sheetName}!A2:D`
        });
        console.log(`Cleared old vacancies from ${sheetName}`);

        if (newVacancies.length > 0) {
          const rows = newVacancies.map(vac => [vac.date, vac.jobType, location, '']);
          await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: `${sheetName}!A2:D`,
            valueInputOption: 'RAW',
            resource: { values: rows }
          });
          console.log(`Added ${rows.length} new vacancies to ${sheetName}`);
        }
      } catch (err) {
        console.error(`Error updating ${sheetName}:`, err);
      }
    }

    return { success: true, message: `Saved ${vacancies.length} vacancies` };
  } catch (err) {
    console.error('saveOfficerVacancies error:', err);
    return { error: err.toString() };
  }
}

// ============================================================================
// SHIFT REQUEST FUNCTIONS
// ============================================================================

// Fix: includes mailto Approve/Deny buttons in officer notification emails (restored from V1)
async function requestShifts(email, name, shifts) {
  try {
    const timestamp = brisTime();
    console.log(`Shift request from ${name} (${email}) for ${shifts.length} shifts`);

    const officerResult = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Rostering Officers!A2:C'
    });

    const officerRows = officerResult.data.values || [];
    const officersByLocation = {};
    for (let row of officerRows) {
      const location = String(row[0]).trim();
      if (!officersByLocation[location]) officersByLocation[location] = [];
      officersByLocation[location].push({ name: String(row[1]).trim(), email: String(row[2]).trim() });
    }

    // Check each shift for existing applicants — determine Pending vs Backup
    const existingReqResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: 'Requests!A2:G'
    });
    const existingRows = existingReqResp.data.values || [];

    const isBackup = (shift) => existingRows.some(row => {
      const st = String(row[6]||'').toUpperCase();
      return (st === 'PENDING' || st === 'BACKUP') &&
        normaliseDate(String(row[3]||'').trim()) === normaliseDate(shift.date) &&
        String(row[4]||'').trim() === shift.jobType &&
        String(row[5]||'').trim() === shift.location;
    });

    const getApplicants = (shift) => existingRows
      .filter(row => {
        const st = String(row[6]||'').toUpperCase();
        return (st === 'PENDING' || st === 'BACKUP') &&
          normaliseDate(String(row[3]||'').trim()) === normaliseDate(shift.date) &&
          String(row[4]||'').trim() === shift.jobType &&
          String(row[5]||'').trim() === shift.location;
      })
      .map(row => ({ name: String(row[2]||'').trim(), timestamp: String(row[0]||'').trim() }));

    const normalShifts = shifts.filter(s => !isBackup(s));
    const backupShifts = shifts.filter(s => isBackup(s));

    const requestsToAdd = [
      ...normalShifts.map(s => [timestamp, email, name, s.date, s.jobType, s.location, 'Pending', '', '']),
      ...backupShifts.map(s => [timestamp, email, name, s.date, s.jobType, s.location, 'Backup', '', ''])
    ];

    if (requestsToAdd.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Requests!A2:I',
        valueInputOption: 'RAW',
        resource: { values: requestsToAdd }
      });
      console.log(`Logged ${requestsToAdd.length} requests (${normalShifts.length} pending, ${backupShifts.length} backup)`);
    }

    const shiftsByLocation = {};
    for (let shift of shifts) {
      if (!shiftsByLocation[shift.location]) shiftsByLocation[shift.location] = [];
      shiftsByLocation[shift.location].push(shift);
    }

    for (let location in shiftsByLocation) {
      const locationShifts = shiftsByLocation[location];
      const officers = officersByLocation[location] || [];
      const shiftList = locationShifts.map(s => `${s.date} - ${s.jobType} @ ${location}`).join('<br>');
      const shiftListText = locationShifts.map(s => `${s.date} - ${s.jobType} @ ${location}`).join(', ');

      const htmlBody = `<p>Dear {OFFICER_NAME},</p>
<p><strong>${name}</strong> is requesting to cover the following shifts:</p>
<p><strong>${shiftList}</strong></p>
<p>Please log in to Rural Rosters to approve or deny this request:</p>
<p><a href="${FRONTEND_URL}" style="background: #2c3e50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">Log in to Rural Rosters</a></p>
<p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`;

      for (let officer of officers) {
        try {
          await transporter.sendMail({
            from: GMAIL_USER,
            to: officer.email,
            cc: 'ruralroster@gmail.com',
            subject: `[Rural Rosters] ${name} is requesting shifts`,
            html: htmlBody.replace('{OFFICER_NAME}', officer.name)
          });
          console.log(`Email sent to ${officer.email}`);
          await sendPushNotification(officer.email, 'New shift request', `${name}: ${shiftListText}`, FRONTEND_URL); // PHASE 3
        } catch (err) {
          console.error(`Failed to email ${officer.email}:`, err);
        }
      }
    }


    // Send update emails for backup shifts (one per shift per officer location)
    for (const shift of backupShifts) {
      const officers = officersByLocation[shift.location] || [];
      const existing = getApplicants(shift);
      const allApplicants = [...existing, { name, timestamp }];
      const tableRows = allApplicants.map((a, idx) =>
        `<tr><td style="padding:6px 12px;">${idx + 1}.</td><td style="padding:6px 12px;">${a.name}</td><td style="padding:6px 12px;color:#666;">${a.timestamp || 'Just now'}</td></tr>`
      ).join('');

      for (const officer of officers) {
        try {
          await transporter.sendMail({
            from: GMAIL_USER, to: officer.email, cc: GMAIL_USER,
            subject: `[Rural Rosters] Update: ${normaliseDate(shift.date)} - ${shift.jobType} @ ${shift.location} now has multiple applicants`,
            html: `<p>Dear ${officer.name},</p>
<p>The following shift has been applied for by multiple staff members:</p>
<p><strong>${normaliseDate(shift.date)} - ${shift.jobType} @ ${shift.location}</strong></p>
<table style="border-collapse:collapse;margin:10px 0;">
  <tr style="background:#f9f9f9;"><th style="padding:6px 12px;text-align:left;">#</th><th style="padding:6px 12px;text-align:left;">Applicant</th><th style="padding:6px 12px;text-align:left;">Applied</th></tr>
  ${tableRows}
</table>
<p>Please log in to review all applicants and approve or deny each one.</p>
<p><a href="${FRONTEND_URL}" style="background:#2c3e50;color:white;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block;margin:10px 0;">Open Rural Rosters</a></p>
<p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
          });
        } catch (emailErr) {
          console.error('Backup shift email error:', emailErr.message);
        }
      }
    }

    return { success: true, message: 'Request submitted and emails sent' };
  } catch (err) {
    console.error('requestShifts error:', err);
    return { error: err.toString() };
  }
}

async function approveShiftRequest(email, name, date, jobType, location, sendEmail = true) {
  try {
    const resolvedTimestamp = brisTime();
    const requestsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: 'Requests!A2:I'
    });
    const requestsRows = requestsResponse.data.values || [];

    // 1. Approve the target row
    for (let i = 0; i < requestsRows.length; i++) {
      const st = String(requestsRows[i][6]||'').toUpperCase();
      if (requestsRows[i][1] === email.trim() &&
          normaliseDate(String(requestsRows[i][3]||'').trim()) === normaliseDate(date.trim()) &&
          String(requestsRows[i][4]||'').trim() === jobType.trim() &&
          String(requestsRows[i][5]||'').trim() === location.trim() &&
          (st === 'PENDING' || st === 'BACKUP' || st === 'RE-OFFERED')) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Requests!G${i + 2}:I${i + 2}`,
          valueInputOption: 'RAW',
          resource: { values: [['Approved', '', resolvedTimestamp]] }
        });
        break;
      }
    }

    // 2. Auto-deny all other Pending/Backup/Re-offered applicants for the same shift
    // Uses the original requestsRows read (pre-approval) which reliably has Backup rows
    const autoDeniedApplicants = [];
    const normDate = normaliseDate(date.trim());
    console.log(`approveShiftRequest: auto-deny scan — approved=${email.trim()}, date=${normDate}, job=${jobType.trim()}, loc=${location.trim()}, total rows=${requestsRows.length}`);
    for (let i = 0; i < requestsRows.length; i++) {
      const st = String(requestsRows[i][6]||'').toUpperCase();
      const rowEmail = String(requestsRows[i][1]||'').trim();
      const rowDate = normaliseDate(String(requestsRows[i][3]||'').trim());
      const rowJobType = String(requestsRows[i][4]||'').trim();
      const rowLocation = String(requestsRows[i][5]||'').trim();

      if (rowEmail !== String(email).trim() &&
          rowDate === normDate &&
          rowJobType === String(jobType).trim() &&
          rowLocation === String(location).trim() &&
          (st === 'PENDING' || st === 'BACKUP' || st === 'RE-OFFERED')) {
        console.log(`Auto-denying row ${i+2}: ${requestsRows[i][2]} (${rowEmail}) status=${st}`);
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Requests!G${i + 2}:I${i + 2}`,
          valueInputOption: 'RAW',
          resource: { values: [['Auto-Denied', 'Approved for another applicant', resolvedTimestamp]] }
        });
        autoDeniedApplicants.push({
          email: rowEmail,
          name: String(requestsRows[i][2]||'').trim()
        });
      }
    }
    console.log(`approveShiftRequest: auto-denied ${autoDeniedApplicants.length} applicant(s) for ${date} ${jobType} @ ${location}`);

    // 3. Remove shift from Vacancies sheet
    try {
      const vacResp = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID, range: `Vacancies - ${location}!A2:D`
      });
      const vacRows = vacResp.data.values || [];
      const filteredRows = vacRows.filter(row =>
        !(normaliseDate(String(row[0]||'').trim()) === normaliseDate(date) &&
          String(row[1]||'').trim() === jobType)
      );
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID, range: `Vacancies - ${location}!A2:D`
      });
      if (filteredRows.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID, range: `Vacancies - ${location}!A2:D`,
          valueInputOption: 'RAW', resource: { values: filteredRows }
        });
      }
      console.log(`Removed approved shift from Vacancies - ${location}: ${date} ${jobType}`);
    } catch (vacErr) {
      console.error('approveShiftRequest vacancy removal error:', vacErr.message);
    }

    // 4. Send auto-denial emails to other applicants
    for (const applicant of autoDeniedApplicants) {
      try {
        await transporter.sendMail({
          from: GMAIL_USER, to: applicant.email, cc: GMAIL_USER,
          subject: `[Rural Rosters] Shift ${date} - ${jobType} @ ${location} has been filled`,
          html: `<p>Dear ${applicant.name},</p>
<p>Thank you for applying for the following shift:</p>
<p><strong>${date} - ${jobType} @ ${location}</strong></p>
<p>This shift has been approved for another staff member. Your application has been automatically closed.</p>
<p>Thank you for your interest and availability.</p>
<p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
        });
        await sendPushNotification(applicant.email, 'Shift filled', `${date} - ${jobType} @ ${location} went to another applicant`, FRONTEND_URL); // PHASE 3
      } catch (emailErr) {
        console.error(`Auto-denial email error for ${applicant.email}:`, emailErr.message);
      }
    }

    // 5. Send approval email with ICS to the approved person
    if (sendEmail) {
      const times = await getShiftTimes(location, jobType);
      const icsContent = generateICS(date, jobType, location, times.start, times.end, `${jobType} @ ${location} — Approved`);
      const mailOptions = {
        from: GMAIL_USER, to: email, cc: GMAIL_USER,
        subject: `[Rural Rosters] Your Shift Request Approved`,
        html: `<p>Dear ${name},</p><p>Your shift request has been <strong>APPROVED</strong>!</p><p><strong>${date} - ${jobType} @ ${location}</strong></p><p>A calendar event is attached — tap it to add the shift to your calendar.</p><p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
      };
      if (icsContent) {
        mailOptions.attachments = [{
          filename: `shift-${date.replace(/\//g,'-')}.ics`,
          content: icsContent,
          contentType: 'text/calendar; charset=utf-8; method=PUBLISH'
        }];
      }
      await transporter.sendMail(mailOptions);
      await sendPushNotification(email, 'Shift approved', `${date} - ${jobType} @ ${location}`, FRONTEND_URL); // PHASE 3
    }
    return { success: true, autoDenied: autoDeniedApplicants.length };
  } catch (err) {
    console.error('approveShiftRequest error:', err);
    return { error: err.toString() };
  }
}

async function denyShiftRequest(email, name, date, jobType, location, sendEmail = true) {
  try {
    const requestsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Requests!A2:I'
    });
    const requestsRows = requestsResponse.data.values || [];
    for (let i = 0; i < requestsRows.length; i++) {
      const dSt = String(requestsRows[i][6]||'').toUpperCase();
      if (requestsRows[i][1] === email &&
          normaliseDate(String(requestsRows[i][3]||'').trim()) === normaliseDate(date) &&
          String(requestsRows[i][4]||'').trim() === jobType &&
          String(requestsRows[i][5]||'').trim() === location &&
          (dSt === 'PENDING' || dSt === 'BACKUP' || dSt === 'RE-OFFERED')) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Requests!G${i + 2}:I${i + 2}`,
          valueInputOption: 'RAW',
          resource: { values: [['Denied', '', brisTime()]] }
        });
        break;
      }
    }
    if (sendEmail) {
      await transporter.sendMail({
        from: GMAIL_USER, to: email, cc: GMAIL_USER,
        subject: `[Rural Rosters] Your Shift Request Denied`,
        html: `<p>Dear ${name},</p><p>Your shift request has been <strong>DENIED</strong>.</p><p><strong>${date} - ${jobType} @ ${location}</strong></p><p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
      });
    }
    if (sendEmail) await sendPushNotification(email, 'Shift request denied', `${date} - ${jobType} @ ${location}`, FRONTEND_URL); // PHASE 3
    return { success: true };
  } catch (err) {
    console.error('denyShiftRequest error:', err);
    return { error: err.toString() };
  }
}

// ============================================================================
// SWAP / MARKETPLACE FUNCTIONS
// ============================================================================

async function listShiftForSwap(email, name, date, jobType, location, isServiceDisruption, availableDays) {
  try {
    const normDate = normaliseDate(date);
    const row = [email, name, normDate, jobType, location, 'Pending Verification', isServiceDisruption ? 'Y' : 'N', availableDays || ''];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Listings!A2:H',
      valueInputOption: 'RAW',
      resource: { values: [row] }
    });
    console.log('Shift listed for swap:', email, normDate, jobType, location);

    // Notify officer(s) for this location + always CC ruralroster
    try {
      const officersResult = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Rostering Officers!A2:C'
      });
      const allRows = officersResult.data.values || [];
      console.log(`listShiftForSwap: ${allRows.length} rows in Rostering Officers, filtering for location="${location}"`);

      const officers = allRows
        .filter(r => String(r[0]).trim() === location)
        .map(r => ({ name: String(r[1]).trim(), email: String(r[2]).trim() }));

      console.log(`listShiftForSwap: found ${officers.length} officer(s) for ${location}:`, officers.map(o => o.email));

      const emailHtml = `<p>Dear Rostering Officer,</p>
<p><strong>${name}</strong> has listed the following shift for swap and is awaiting your approval:</p>
<table style="border-collapse:collapse;margin:10px 0;">
  <tr><td style="padding:6px 12px;font-weight:bold;">Shift:</td><td style="padding:6px 12px;"><strong>${normDate} - ${jobType} @ ${location}</strong></td></tr>
  <tr><td style="padding:6px 12px;font-weight:bold;">Service disruption:</td><td style="padding:6px 12px;">${isServiceDisruption ? 'Yes' : 'No'}</td></tr>
</table>
<p>Please log in to review and approve or deny this swap request.</p>
<p><a href="${FRONTEND_URL}" style="background:#2c3e50;color:white;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block;margin:10px 0;">Open Rural Rosters</a></p>
<p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`;

      if (officers.length > 0) {
        for (let officer of officers) {
          try {
            await transporter.sendMail({
              from: GMAIL_USER,
              to: officer.email,
              cc: GMAIL_USER,
              subject: '[Rural Rosters] New Shift Swap Request Pending Review',
              html: emailHtml.replace('Dear Rostering Officer,', `Dear ${officer.name},`)
            });
            console.log(`listShiftForSwap: email sent to officer ${officer.email}`);
            await sendPushNotification(officer.email, 'Swap listing pending review', `${name}: ${normDate} - ${jobType} @ ${location}`, FRONTEND_URL); // PHASE 3
          } catch (sendErr) {
            console.error(`listShiftForSwap: failed to email ${officer.email}:`, sendErr.message);
          }
        }
      } else {
        // No officer found for location — notify ruralroster directly
        console.log(`listShiftForSwap: no officer found for ${location}, notifying ruralroster`);
        await transporter.sendMail({
          from: GMAIL_USER,
          to: GMAIL_USER,
          subject: `[Rural Rosters] New Swap Request — No Officer Found for ${location}`,
          html: emailHtml
        });
      }
    } catch (emailErr) {
      console.error('listShiftForSwap email section error:', emailErr.message);
    }

    return { success: true, message: 'Shift listed for swap (pending officer approval)' };
  } catch (err) {
    console.error('listShiftForSwap error:', err);
    return { error: err.toString() };
  }
}

async function getMarketplaceListings(email) {
  try {
    const locations = await getStaffLocations(email);
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Listings!A2:H'
    });
    const rows = result.data.values || [];
    const listings = [];
    for (let row of rows) {
      if (locations.includes(String(row[4]).trim()) && String(row[5]).trim() === 'Available') {
        listings.push({
          originalEmail: row[0], originalName: row[1], date: normaliseDate(row[2]), jobType: row[3], location: row[4],
          isServiceDisruption: row[6] === 'Y', availableDays: row[7] || ''
        });
      }
    }
    return listings;
  } catch (err) {
    console.error('getMarketplaceListings error:', err);
    return [];
  }
}

async function claimShift(claimingEmail, claimingName, originalEmail, originalName, date, jobType, location) {
  try {
    const timestamp = brisTime();
    const claimRow = [claimingEmail, claimingName, originalEmail, originalName, date, jobType, location, timestamp, 'Pending'];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Claims!A2:I',
      valueInputOption: 'RAW',
      resource: { values: [claimRow] }
    });
    const officerResult = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Rostering Officers!A2:C'
    });
    const officerRows = officerResult.data.values || [];
    for (let row of officerRows) {
      if (String(row[0]).trim() === location) {
        await transporter.sendMail({
          from: GMAIL_USER, to: String(row[2]).trim(), cc: 'ruralroster@gmail.com',
          subject: `[Rural Rosters] Shift Swap Claim - ${claimingName} claiming from ${originalName}`,
          html: `<p>Dear ${String(row[1]).trim()},</p><p><strong>${claimingName}</strong> has claimed a shift from <strong>${originalName}</strong>:</p><p><strong>${date} - ${jobType} @ ${location}</strong></p><p>Please log in to Rural Rosters to review this request:</p><p><a href="${FRONTEND_URL}" style="background: #2c3e50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">Log in to Rural Rosters</a></p><p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
        });
        break;
      }
    }
    return { success: true, message: 'Shift claimed successfully' };
  } catch (err) {
    console.error('claimShift error:', err);
    return { error: err.toString() };
  }
}

async function getOfficerMarketplaceListings(email) {
  try {
    const locations = await getOfficerLocations(email);
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Listings!A2:H'
    });
    const rows = result.data.values || [];
    const listings = [];
    for (let row of rows) {
      if (locations.includes(String(row[4]).trim()) && String(row[5]).trim() === 'Pending Verification') {
        listings.push({
          originalEmail: row[0], originalName: row[1], date: normaliseDate(row[2]), jobType: row[3], location: row[4],
          isServiceDisruption: row[6] === 'Y', availableDays: row[7] || ''
        });
      }
    }
    return listings;
  } catch (err) {
    console.error('getOfficerMarketplaceListings error:', err);
    return [];
  }
}

async function getOfficerPendingApprovals(email) {
  try {
    const locations = await getOfficerLocations(email);
    const claims = [];

  // Read both sheets in parallel — independent try/catch so one failure
  // doesn't lose the other's data (mirrors getPendingCounts structure)
  const [claimsRows, requestsRows] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Marketplace Claims!A2:M' })
      .then(r => r.data.values || [])
      .catch(err => { console.error('getOfficerPendingApprovals - Claims read error:', err.message); return []; }),
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Requests!A2:I' })
      .then(r => r.data.values || [])
      .catch(err => { console.error('getOfficerPendingApprovals - Requests read error:', err.message); return []; })
  ]);

  for (let i = 0; i < claimsRows.length; i++) {
    if (claimsRows[i][4] && locations.includes(String(claimsRows[i][6]).trim()) && claimsRows[i][8] && String(claimsRows[i][8]).toUpperCase() === 'PENDING') {
      const rowType = claimsRows[i][12] ? String(claimsRows[i][12]).trim() : 'swap_claim';
      claims.push({
        type: rowType,
        claimingEmail: claimsRows[i][0], claimingName: claimsRows[i][1],
        originalEmail: claimsRows[i][2], originalName: claimsRows[i][3],
        date: claimsRows[i][4], jobType: claimsRows[i][5], location: claimsRows[i][6],
        claimedTimestamp: claimsRows[i][7],
        offeredDate: claimsRows[i][10] || '',
        offeredJobType: claimsRows[i][11] || ''
      });
    }
  }

  // Build set of shift keys that already have an APPROVED row.
  // BACKUP rows for these shifts belong in Past, not Outstanding.
  const approvedShiftKeys = new Set();
  for (const row of requestsRows) {
    if (String(row[6]||'').toUpperCase() === 'APPROVED') {
      approvedShiftKeys.add(`${String(row[3]||'').trim()}|${String(row[4]||'').trim()}|${String(row[5]||'').trim()}`);
    }
  }

  for (let i = 0; i < requestsRows.length; i++) {
    const reqSt = String(requestsRows[i][6]||'').toUpperCase();
    const shiftKey = `${String(requestsRows[i][3]||'').trim()}|${String(requestsRows[i][4]||'').trim()}|${String(requestsRows[i][5]||'').trim()}`;
    const isBackup = reqSt === 'BACKUP';
    const shiftAlreadyApproved = approvedShiftKeys.has(shiftKey);

    // Skip BACKUP rows where the shift is already approved — they belong in Past Cover Requests
    if (isBackup && shiftAlreadyApproved) continue;

    if (requestsRows[i][5] && locations.includes(String(requestsRows[i][5]).trim()) && (reqSt === 'PENDING' || reqSt === 'BACKUP' || reqSt === 'RE-OFFERED')) {
      claims.push({
        type: 'shift_request',
        requestStatus: String(requestsRows[i][6]||'').trim(),
        claimingEmail: requestsRows[i][1], claimingName: requestsRows[i][2],
        date: requestsRows[i][3], jobType: requestsRows[i][4], location: requestsRows[i][5],
        claimedTimestamp: requestsRows[i][0]
      });
    }
  }

    console.log(`getOfficerPendingApprovals: ${claims.length} pending items for ${email}`);
    return claims;
  } catch (err) {
    console.error('getOfficerPendingApprovals error:', err);
    return [];
  }
}

async function getOfficerPastApprovals(email) {
  try {
    const locations = await getOfficerLocations(email);
    const pastApprovals = {};

    const claimsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Claims!A2:J'
    });
    const claimsRows = claimsResponse.data.values || [];
    for (let i = 0; i < claimsRows.length; i++) {
      const status = String(claimsRows[i][8] || '').trim().toUpperCase();
      if (claimsRows[i][4] && locations.includes(String(claimsRows[i][6]).trim()) && (status === 'APPROVED' || status === 'DENIED')) {
        const shiftKey = claimsRows[i][4] + '|' + claimsRows[i][5] + '|' + claimsRows[i][6];
        if (!pastApprovals[shiftKey]) {
          pastApprovals[shiftKey] = { date: claimsRows[i][4], jobType: claimsRows[i][5], location: claimsRows[i][6], approved: null, denied: [], resolvedDate: null };
        }
        if (status === 'APPROVED') {
          pastApprovals[shiftKey].approved = { email: claimsRows[i][0], name: claimsRows[i][1] };
          pastApprovals[shiftKey].resolvedDate = claimsRows[i][9] || claimsRows[i][7];
        } else {
          pastApprovals[shiftKey].denied.push({ email: claimsRows[i][0], name: claimsRows[i][1] });
          pastApprovals[shiftKey].resolvedDate = claimsRows[i][9] || claimsRows[i][7];
        }
      }
    }

    const requestsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Requests!A2:I'
    });
    const requestsRows = requestsResponse.data.values || [];

    // Build set of approved shift keys so BACKUP rows for those shifts appear in Past
    const approvedShiftKeysPast = new Set();
    for (const row of requestsRows) {
      if (String(row[6]||'').toUpperCase() === 'APPROVED' &&
          row[5] && locations.includes(String(row[5]).trim())) {
        approvedShiftKeysPast.add(`${String(row[3]||'').trim()}|${String(row[4]||'').trim()}|${String(row[5]||'').trim()}`);
      }
    }

    for (let i = 0; i < requestsRows.length; i++) {
      const status = String(requestsRows[i][6] || '').trim().toUpperCase();
      // Also include BACKUP rows for shifts that have been approved — display as auto-denied
      const shiftKey_pa = requestsRows[i][3] + '|' + requestsRows[i][4] + '|' + requestsRows[i][5];
      const isBackupForApprovedShift = status === 'BACKUP' && approvedShiftKeysPast.has(shiftKey_pa);
      if (requestsRows[i][5] && locations.includes(String(requestsRows[i][5]).trim()) && (status === 'APPROVED' || status === 'DENIED' || status === 'AUTO-DENIED' || isBackupForApprovedShift)) {
        const shiftKey = requestsRows[i][3] + '|' + requestsRows[i][4] + '|' + requestsRows[i][5];
        if (!pastApprovals[shiftKey]) {
          pastApprovals[shiftKey] = { date: requestsRows[i][3], jobType: requestsRows[i][4], location: requestsRows[i][5], approved: null, denied: [], autoDenied: [], resolvedDate: null };
        }
        if (status === 'APPROVED') {
          pastApprovals[shiftKey].approved = { email: requestsRows[i][1], name: requestsRows[i][2] };
          pastApprovals[shiftKey].resolvedDate = requestsRows[i][8] || requestsRows[i][0];
        } else if (status === 'AUTO-DENIED' || isBackupForApprovedShift) {
          pastApprovals[shiftKey].autoDenied.push({ email: requestsRows[i][1], name: requestsRows[i][2], timestamp: requestsRows[i][0] });
        } else {
          pastApprovals[shiftKey].denied.push({ email: requestsRows[i][1], name: requestsRows[i][2] });
          pastApprovals[shiftKey].resolvedDate = requestsRows[i][8] || requestsRows[i][0];
        }
      }
    }

    const result = Object.values(pastApprovals);
    result.sort((a, b) => new Date(b.date.split('/').reverse().join('-')) - new Date(a.date.split('/').reverse().join('-')));
    return result;
  } catch (err) {
    console.error('getOfficerPastApprovals error:', err);
    return [];
  }
}

async function approveSwap(claimingEmail, claimingName, originalEmail, originalName, officerEmail, officerName, date, jobType, location, sendEmail = true) {
  try {
    const resolvedTimestamp = brisTime();
    const claimsResult = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Claims!A2:J'
    });
    const claimRows = claimsResult.data.values || [];
    const otherApplicants = [];
    const isSwap = originalEmail && originalEmail.trim();

    for (let i = 0; i < claimRows.length; i++) {
      if (String(claimRows[i][4]).trim() === date && String(claimRows[i][5]).trim() === jobType && String(claimRows[i][6]).trim() === location) {
        if (claimRows[i][0] === claimingEmail && claimRows[i][2] === originalEmail) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `Marketplace Claims!I${i + 2}:J${i + 2}`,
            valueInputOption: 'RAW',
            resource: { values: [['Approved', resolvedTimestamp]] }
          });
        } else if (String(claimRows[i][8]).trim() === 'Pending') {
          otherApplicants.push({ email: claimRows[i][0], name: claimRows[i][1] });
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `Marketplace Claims!I${i + 2}:J${i + 2}`,
            valueInputOption: 'RAW',
            resource: { values: [['Denied', resolvedTimestamp]] }
          });
        }
      }
    }

    if (sendEmail && !isSwap && claimingEmail && claimingEmail.trim()) {
      await transporter.sendMail({
        from: GMAIL_USER, to: claimingEmail, cc: 'ruralroster@gmail.com',
        subject: `[Rural Rosters] Your Shift Request Approved`,
        html: `<p>Dear ${claimingName},</p><p>Your request to cover the shift has been <strong>APPROVED</strong>:</p><p><strong>${date} - ${jobType} @ ${location}</strong></p><p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
      });
    }

    if (isSwap && sendEmail) {
      if (claimingEmail && claimingEmail.trim()) {
        await transporter.sendMail({
          from: GMAIL_USER, to: claimingEmail, cc: 'ruralroster@gmail.com',
          subject: `[Rural Rosters] Shift Swap Approved`,
          html: `<p>Dear ${claimingName},</p><p>Your request to cover the shift has been <strong>APPROVED</strong>:</p><p><strong>${date} - ${jobType} @ ${location}</strong></p><p>Original staff member: ${originalName}</p><p>Please coordinate with ${originalName} to confirm the handover.</p><p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
        });
      }
      if (originalEmail && originalEmail.trim()) {
        await transporter.sendMail({
          from: GMAIL_USER, to: originalEmail, cc: 'ruralroster@gmail.com',
          subject: `[Rural Rosters] Your Shift Swap Approved`,
          html: `<p>Dear ${originalName},</p><p>Your shift swap request has been <strong>APPROVED</strong>:</p><p><strong>${date} - ${jobType} @ ${location}</strong></p><p>Staff member taking your shift: ${claimingName}</p><p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
        });
      }
      for (let applicant of otherApplicants) {
        if (applicant.email && applicant.email.trim()) {
          await transporter.sendMail({
            from: GMAIL_USER, to: applicant.email, cc: 'ruralroster@gmail.com',
            subject: `[Rural Rosters] Shift Swap - Another Applicant Approved`,
            html: `<p>Dear ${applicant.name},</p><p>Unfortunately, another applicant was approved for the following shift:</p><p><strong>${date} - ${jobType} @ ${location}</strong></p><p>Please try again for future shifts.</p><p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
          });
        }
      }
    }

    if (sendEmail && claimingEmail && claimingEmail.trim()) { // PHASE 3
      await sendPushNotification(claimingEmail, isSwap ? 'Shift swap approved' : 'Shift request approved', `${date} - ${jobType} @ ${location}`, FRONTEND_URL);
    }
    if (sendEmail && isSwap && originalEmail && originalEmail.trim()) {
      await sendPushNotification(originalEmail, 'Your shift swap approved', `${date} - ${jobType} @ ${location}`, FRONTEND_URL);
    }
    return { success: true, message: 'Shift approved and emails sent' };
  } catch (err) {
    console.error('approveSwap error:', err);
    return { error: err.toString() };
  }
}

async function denySwap(claimingEmail, claimingName, originalEmail, originalName, officerEmail, officerName, date, jobType, location, sendEmail = true) {
  try {
    const resolvedTimestamp = brisTime();
    const claimsResult = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Claims!A2:J'
    });
    const claimRows = claimsResult.data.values || [];
    const isSwap = originalEmail && originalEmail.trim();

    for (let i = 0; i < claimRows.length; i++) {
      if (claimRows[i][0] === claimingEmail && claimRows[i][2] === originalEmail && claimRows[i][4] === date) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Marketplace Claims!I${i + 2}:J${i + 2}`,
          valueInputOption: 'RAW',
          resource: { values: [['Denied', resolvedTimestamp]] }
        });
        break;
      }
    }

    if (sendEmail && claimingEmail && claimingEmail.trim()) {
      await transporter.sendMail({
        from: GMAIL_USER, to: claimingEmail, cc: 'ruralroster@gmail.com',
        subject: isSwap ? `[Rural Rosters] Shift Swap Not Approved` : `[Rural Rosters] Your Shift Request Denied`,
        html: isSwap
          ? `<p>Dear ${claimingName},</p><p>Unfortunately, your request to cover the shift has been <strong>DENIED</strong>:</p><p><strong>${date} - ${jobType} @ ${location}</strong></p><p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
          : `<p>Dear ${claimingName},</p><p>Unfortunately, your shift request has been <strong>DENIED</strong>:</p><p><strong>${date} - ${jobType} @ ${location}</strong></p><p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
      });
    }

    if (sendEmail && claimingEmail && claimingEmail.trim()) await sendPushNotification(claimingEmail, 'Shift request denied', `${date} - ${jobType} @ ${location}`, FRONTEND_URL); // PHASE 3
    return { success: true, message: 'Shift denied and email sent' };
  } catch (err) {
    console.error('denySwap error:', err);
    return { error: err.toString() };
  }
}

async function approvePendingSwap(staffEmail, staffName, date, jobType, location) {
  try {
    const listingsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Listings!A2:H'
    });
    const listingsRows = listingsResponse.data.values || [];
    let availableDays = '';
    for (let i = 0; i < listingsRows.length; i++) {
      if (String(listingsRows[i][0]).trim() === String(staffEmail).trim() &&
          normaliseDate(String(listingsRows[i][2]).trim()) === normaliseDate(String(date).trim()) &&
          String(listingsRows[i][3]).trim() === String(jobType).trim() &&
          String(listingsRows[i][4]).trim() === String(location).trim()) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Marketplace Listings!F${i + 2}`,
          valueInputOption: 'RAW',
          resource: { values: [['Available']] }
        });
        availableDays = listingsRows[i][7] || '';
        console.log(`approvePendingSwap: updated row ${i+2} to Available`);
        break;
      }
    }
    if (!availableDays && availableDays !== '') {
      console.warn(`approvePendingSwap: no matching row found for ${staffEmail} ${date} ${jobType} @ ${location}`);
    }
    await transporter.sendMail({
      from: GMAIL_USER, to: staffEmail, cc: GMAIL_USER,
      subject: `[Rural Rosters] Your Swap Approved`,
      html: `<p>Dear ${staffName},</p><p>Your swap request has been approved and is now live on the marketplace!</p><p><strong>${date} - ${jobType} @ ${location}</strong></p><p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
    });
    await sendPushNotification(staffEmail, 'Swap listed on marketplace', `${date} - ${jobType} @ ${location}`, FRONTEND_URL); // PHASE 3
    return { success: true, message: 'Swap approved and moved to marketplace' };
  } catch (err) {
    console.error('approvePendingSwap error:', err);
    return { error: err.toString() };
  }
}

async function denySwapWithReason(staffEmail, staffName, date, jobType, location, reason) {
  try {
    const listingsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Listings!A2:H'
    });
    const listingsRows = listingsResponse.data.values || [];
    for (let i = 0; i < listingsRows.length; i++) {
      if (String(listingsRows[i][0]).trim() === String(staffEmail).trim() &&
          normaliseDate(String(listingsRows[i][2]).trim()) === normaliseDate(String(date).trim()) &&
          String(listingsRows[i][3]).trim() === String(jobType).trim() &&
          String(listingsRows[i][4]).trim() === String(location).trim()) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Marketplace Listings!F${i + 2}`,
          valueInputOption: 'RAW',
          resource: { values: [['Denied']] }
        });
        break;
      }
    }
    await transporter.sendMail({
      from: GMAIL_USER, to: staffEmail, cc: 'ruralroster@gmail.com',
      subject: `[Rural Rosters] Your Swap Request Denied`,
      html: `<p>Dear ${staffName},</p><p>Your shift swap request has been <strong>DENIED</strong>.</p><p><strong>${date} - ${jobType} @ ${location}</strong></p><p><strong>Reason:</strong> ${reason}</p><p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
    });
    await sendPushNotification(staffEmail, 'Swap listing denied', `${date} - ${jobType} @ ${location}`, FRONTEND_URL); // PHASE 3
    return { success: true, message: 'Swap denied and email sent' };
  } catch (err) {
    console.error('denySwapWithReason error:', err);
    return { error: err.toString() };
  }
}


// ============================================================================
// SWAP PROPOSAL FUNCTIONS
// ============================================================================

// Staff B proposes to take Staff A's shift, offering one of Staff A's can-work dates in return.
// Columns: A-J existing, K=offeredDate, L=offeredJobType, M='swap_proposal'
async function proposeSwap(claimingEmail, claimingName, originalEmail, originalName, date, jobType, location, offeredDate, offeredJobType) {
  try {
    const timestamp = brisTime();
    // Normalise both dates to DD/MM/YYYY before storing
    const normDate = normaliseDate(date);
    const normOfferedDate = normaliseDate(offeredDate);
    const row = [
      claimingEmail, claimingName, originalEmail, originalName,
      normDate, jobType, location, timestamp, 'Pending', '',
      normOfferedDate, offeredJobType, 'swap_proposal'
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Claims!A2:M',
      valueInputOption: 'RAW',
      resource: { values: [row] }
    });

    // Email officer with approve/deny mailto links
    const officerResult = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Rostering Officers!A2:C'
    });
    const officerRows = officerResult.data.values || [];
    for (let row of officerRows) {
      if (String(row[0]).trim() === location) {
        const officerEmail = String(row[2]).trim();
        const officerName = String(row[1]).trim();

        await transporter.sendMail({
          from: GMAIL_USER, to: officerEmail, cc: 'ruralroster@gmail.com',
          subject: `[Rural Rosters] Swap Proposal: ${claimingName} ↔ ${originalName}`,
          html: `<p>Dear ${officerName},</p>
<p><strong>${claimingName}</strong> has proposed the following shift swap:</p>
<table style="border-collapse: collapse; margin: 15px 0;">
  <tr><td style="padding: 6px 12px; font-weight: bold;">Taking from ${originalName}:</td><td style="padding: 6px 12px;"><strong>${normDate} - ${jobType} @ ${location}</strong></td></tr>
  <tr><td style="padding: 6px 12px; font-weight: bold;">Offering in return:</td><td style="padding: 6px 12px;"><strong>${normOfferedDate} - ${offeredJobType} @ ${location}</strong></td></tr>
</table>
<p>Please log in to Rural Rosters to approve or deny this proposal:</p>
<p><a href="${FRONTEND_URL}" style="background: #2c3e50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">Log in to Rural Rosters</a></p>
<p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
        });
        await sendPushNotification(officerEmail, 'New swap proposal', `${claimingName} <-> ${originalName}: ${normDate} - ${jobType}`, FRONTEND_URL); // PHASE 3
        break;
      }
    }

    return { success: true, message: 'Swap proposal submitted and officer notified' };
  } catch (err) {
    console.error('proposeSwap error:', err);
    return { error: err.toString() };
  }
}

async function approveSwapProposal(claimingEmail, claimingName, originalEmail, originalName, officerEmail, officerName, date, jobType, location, offeredDate, offeredJobType, sendEmail = true) {
  try {
    const resolvedTimestamp = brisTime();

    // Update status in Marketplace Claims
    const claimsResult = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Claims!A2:M'
    });
    const claimRows = claimsResult.data.values || [];
    for (let i = 0; i < claimRows.length; i++) {
      if (
        claimRows[i][0] === claimingEmail &&
        normaliseDate(String(claimRows[i][4]).trim()) === normaliseDate(date) &&
        String(claimRows[i][5]).trim() === jobType &&
        String(claimRows[i][6]).trim() === location &&
        String(claimRows[i][12] || '').trim() === 'swap_proposal' &&
        String(claimRows[i][8]).trim().toUpperCase() === 'PENDING'
      ) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Marketplace Claims!I${i + 2}:J${i + 2}`,
          valueInputOption: 'RAW',
          resource: { values: [['Approved', resolvedTimestamp]] }
        });
        break;
      }
    }

    // Email Staff B (claimingEmail) — taking Staff A's shift
    if (sendEmail && claimingEmail && claimingEmail.trim()) {
      const timesB = await getShiftTimes(location, jobType);
      const icsB = generateICS(date, jobType, location, timesB.start, timesB.end, `${jobType} @ ${location} — Swap Approved`);
      const mailB = {
        from: GMAIL_USER, to: claimingEmail, cc: 'ruralroster@gmail.com',
        subject: `[Rural Rosters] Your Swap Proposal Approved`,
        html: `<p>Dear ${claimingName},</p>
<p>Your shift swap proposal has been <strong>APPROVED</strong>.</p>
<table style="border-collapse: collapse; margin: 15px 0;">
  <tr><td style="padding: 6px 12px; font-weight: bold;">You are now covering:</td><td style="padding: 6px 12px;"><strong>${date} - ${jobType} @ ${location}</strong> (from ${originalName})</td></tr>
  <tr><td style="padding: 6px 12px; font-weight: bold;">In exchange you gave up:</td><td style="padding: 6px 12px;"><strong>${offeredDate} - ${offeredJobType} @ ${location}</strong></td></tr>
</table>
<p>A calendar event is attached for your new shift — tap it to add to your calendar.</p>
<p>Please coordinate with ${originalName} to confirm the handover.</p>
<p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
      };
      if (icsB) mailB.attachments = [{ filename: `shift-${date.replace(/\//g,'-')}.ics`, content: icsB, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }];
      await transporter.sendMail(mailB);
    }

    // Email Staff A (originalEmail) — taking Staff B's offered shift
    if (sendEmail && originalEmail && originalEmail.trim()) {
      const timesA = await getShiftTimes(location, offeredJobType);
      const icsA = generateICS(offeredDate, offeredJobType, location, timesA.start, timesA.end, `${offeredJobType} @ ${location} — Swap Approved`);
      const mailA = {
        from: GMAIL_USER, to: originalEmail, cc: 'ruralroster@gmail.com',
        subject: `[Rural Rosters] Your Shift Swap Approved`,
        html: `<p>Dear ${originalName},</p>
<p>A shift swap involving your roster has been <strong>APPROVED</strong>.</p>
<table style="border-collapse: collapse; margin: 15px 0;">
  <tr><td style="padding: 6px 12px; font-weight: bold;">Your shift being covered by ${claimingName}:</td><td style="padding: 6px 12px;"><strong>${date} - ${jobType} @ ${location}</strong></td></tr>
  <tr><td style="padding: 6px 12px; font-weight: bold;">You are now working:</td><td style="padding: 6px 12px;"><strong>${offeredDate} - ${offeredJobType} @ ${location}</strong></td></tr>
</table>
<p>A calendar event is attached for your new shift — tap it to add to your calendar.</p>
<p>Please coordinate with ${claimingName} to confirm the handover.</p>
<p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
      };
      if (icsA) mailA.attachments = [{ filename: `shift-${offeredDate.replace(/\//g,'-')}.ics`, content: icsA, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }];
      await transporter.sendMail(mailA);
    }

    if (sendEmail) { // PHASE 3
      await sendPushNotification(claimingEmail, 'Swap approved', `You now cover ${date} - ${jobType} @ ${location}`, FRONTEND_URL);
      await sendPushNotification(originalEmail, 'Swap approved', `You now work ${offeredDate} - ${offeredJobType} @ ${location}`, FRONTEND_URL);
    }
    return { success: true, message: 'Swap proposal approved and both parties notified' };
  } catch (err) {
    console.error('approveSwapProposal error:', err);
    return { error: err.toString() };
  }
}

async function denySwapProposal(claimingEmail, claimingName, officerEmail, officerName, date, jobType, location, sendEmail = true) {
  try {
    const resolvedTimestamp = brisTime();

    const claimsResult = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Claims!A2:M'
    });
    const claimRows = claimsResult.data.values || [];
    for (let i = 0; i < claimRows.length; i++) {
      if (
        claimRows[i][0] === claimingEmail &&
        normaliseDate(String(claimRows[i][4]).trim()) === normaliseDate(date) &&
        String(claimRows[i][5]).trim() === jobType &&
        String(claimRows[i][6]).trim() === location &&
        String(claimRows[i][12] || '').trim() === 'swap_proposal' &&
        String(claimRows[i][8]).trim().toUpperCase() === 'PENDING'
      ) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Marketplace Claims!I${i + 2}:J${i + 2}`,
          valueInputOption: 'RAW',
          resource: { values: [['Denied', resolvedTimestamp]] }
        });
        break;
      }
    }

    // Email Staff B only — generic message, officer handles any further discussion
    if (sendEmail && claimingEmail && claimingEmail.trim()) {
      await transporter.sendMail({
        from: GMAIL_USER, to: claimingEmail, cc: 'ruralroster@gmail.com',
        subject: `[Rural Rosters] Your Swap Proposal Not Approved`,
        html: `<p>Dear ${claimingName},</p>
<p>Your proposed shift swap for <strong>${date} - ${jobType} @ ${location}</strong> has not been approved by your rostering officer.</p>
<p>Please contact your rostering officer directly if you would like further details.</p>
<p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
      });
    }

    if (sendEmail) await sendPushNotification(claimingEmail, 'Swap proposal denied', `${date} - ${jobType} @ ${location}`, FRONTEND_URL); // PHASE 3
    return { success: true, message: 'Swap proposal denied and Staff B notified' };
  } catch (err) {
    console.error('denySwapProposal error:', err);
    return { error: err.toString() };
  }
}


// ============================================================================
// SWAPS TAB FUNCTIONS
// ============================================================================

async function getOfficerApprovedListings(email) {
  try {
    const locations = await getOfficerLocations(email);
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Listings!A2:H'
    });
    const rows = result.data.values || [];
    const listings = [];
    for (let row of rows) {
      if (locations.includes(String(row[4]).trim()) && String(row[5]).trim() === 'Available') {
        listings.push({
          originalEmail: row[0], originalName: row[1], date: normaliseDate(row[2]),
          jobType: row[3], location: row[4],
          isServiceDisruption: row[6] === 'Y', availableDays: row[7] || ''
        });
      }
    }
    return listings;
  } catch (err) {
    console.error('getOfficerApprovedListings error:', err);
    return [];
  }
}

async function getOfficerSwapProposals(email) {
  try {
    const locations = await getOfficerLocations(email);

    // Build AST quals map from Users sheet for both parties
    const usersResult = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Users!A2:H'
    });
    const usersMap = {};
    for (let row of (usersResult.data.values || [])) {
      const userEmail = String(row[0] || '').toLowerCase().trim();
      usersMap[userEmail] = row[6] || 'Emergency';
    }

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Claims!A2:M'
    });
    const rows = result.data.values || [];
    const proposals = [];
    for (let row of rows) {
      const type = String(row[12] || '').trim();
      const status = String(row[8] || '').trim().toUpperCase();
      if (
        type === 'swap_proposal' &&
        status === 'PENDING' &&
        row[6] && locations.includes(String(row[6]).trim())
      ) {
        const claimingEmail = row[0];
        const originalEmail = row[2];
        proposals.push({
          claimingEmail, claimingName: row[1],
          originalEmail, originalName: row[3],
          date: normaliseDate(row[4]), jobType: row[5], location: row[6],
          timestamp: row[7],
          offeredDate: normaliseDate(row[10] || ''), offeredJobType: row[11] || '',
          claimingAst: formatASTLabel(usersMap[claimingEmail.toLowerCase().trim()]),
          originalAst: formatASTLabel(usersMap[originalEmail.toLowerCase().trim()])
        });
      }
    }
    return proposals;
  } catch (err) {
    console.error('getOfficerSwapProposals error:', err);
    return [];
  }
}

// Pulls an approved listing back to Pending Verification and emails the staff member
async function removeFromMarketplace(staffEmail, staffName, date, jobType, location) {
  try {
    const listingsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Listings!A2:H'
    });
    const listingsRows = listingsResponse.data.values || [];
    for (let i = 0; i < listingsRows.length; i++) {
      if (
        String(listingsRows[i][0]).trim() === String(staffEmail).trim() &&
        normaliseDate(String(listingsRows[i][2]).trim()) === normaliseDate(String(date).trim()) &&
        String(listingsRows[i][3]).trim() === String(jobType).trim() &&
        String(listingsRows[i][4]).trim() === String(location).trim() &&
        String(listingsRows[i][5]).trim() === 'Available'
      ) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Marketplace Listings!F${i + 2}`,
          valueInputOption: 'RAW',
          resource: { values: [['Pending Verification']] }
        });
        break;
      }
    }
    await transporter.sendMail({
      from: GMAIL_USER, to: staffEmail, cc: 'ruralroster@gmail.com',
      subject: `[Rural Rosters] Your Shift Removed from Marketplace`,
      html: `<p>Dear ${staffName},</p>
<p>Your shift listed for swap has been removed from the marketplace by your rostering officer:</p>
<p><strong>${date} - ${jobType} @ ${location}</strong></p>
<p>Please contact your rostering officer directly for further details.</p>
<p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
    });
    await sendPushNotification(staffEmail, 'Listing removed from marketplace', `${date} - ${jobType} @ ${location}`, FRONTEND_URL); // PHASE 3
    return { success: true, message: 'Listing pulled back and staff notified' };
  } catch (err) {
    console.error('removeFromMarketplace error:', err);
    return { error: err.toString() };
  }
}

async function denySwapProposalWithReason(claimingEmail, claimingName, date, jobType, location, reason) {
  try {
    const resolvedTimestamp = brisTime();
    const claimsResult = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Claims!A2:M'
    });
    const claimRows = claimsResult.data.values || [];
    for (let i = 0; i < claimRows.length; i++) {
      if (
        claimRows[i][0] === claimingEmail &&
        normaliseDate(String(claimRows[i][4]).trim()) === normaliseDate(date) &&
        String(claimRows[i][5]).trim() === jobType &&
        String(claimRows[i][6]).trim() === location &&
        String(claimRows[i][12] || '').trim() === 'swap_proposal' &&
        String(claimRows[i][8]).trim().toUpperCase() === 'PENDING'
      ) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Marketplace Claims!I${i + 2}:J${i + 2}`,
          valueInputOption: 'RAW',
          resource: { values: [['Denied', resolvedTimestamp]] }
        });
        break;
      }
    }
    await transporter.sendMail({
      from: GMAIL_USER, to: claimingEmail, cc: 'ruralroster@gmail.com',
      subject: `[Rural Rosters] Your Swap Proposal Not Approved`,
      html: `<p>Dear ${claimingName},</p>
<p>Your proposed shift swap for <strong>${date} - ${jobType} @ ${location}</strong> has not been approved.</p>
<p><strong>Reason:</strong> ${reason}</p>
<p>Please contact your rostering officer if you have any questions.</p>
<p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
    });
    await sendPushNotification(claimingEmail, 'Swap proposal denied', `${date} - ${jobType} @ ${location}`, FRONTEND_URL); // PHASE 3
    return { success: true, message: 'Swap proposal denied and staff notified' };
  } catch (err) {
    console.error('denySwapProposalWithReason error:', err);
    return { error: err.toString() };
  }
}

// ============================================================================
// SETTINGS FUNCTIONS
// ============================================================================

async function updateUserLocations(email, locations, role) {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Users!A2:H'
    });
    const rows = result.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).toLowerCase().trim() === normalizedEmail) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Users!C${i + 2}`,
          valueInputOption: 'RAW',
          resource: { values: [[locations]] }
        });
        console.log(`Updated locations for ${email}: ${locations}`);
        return { success: true, message: 'Locations updated' };
      }
    }
    return { error: 'User not found' };
  } catch (err) {
    console.error('updateUserLocations error:', err);
    return { error: err.toString() };
  }
}

async function updateUserAST(email, astQuals) {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Users!A2:H'
    });
    const rows = result.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).toLowerCase().trim() === normalizedEmail) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Users!G${i + 2}`,
          valueInputOption: 'RAW',
          resource: { values: [[astQuals]] }
        });
        console.log(`Updated AST quals for ${email}: ${astQuals}`);
        return { success: true, message: 'AST qualifications updated' };
      }
    }
    return { error: 'User not found' };
  } catch (err) {
    console.error('updateUserAST error:', err);
    return { error: err.toString() };
  }
}

async function countPendingRequests(email) {
  try {
    const locations = await getOfficerLocations(email);
    if (locations.length === 0) return 0;

    let count = 0;
    const requestsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Requests!A2:G'
    });
    const requestsRows = requestsResponse.data.values || [];
    for (let row of requestsRows) {
      if (row[5] && locations.includes(String(row[5]).trim()) && row[6] && String(row[6]).toUpperCase() === 'PENDING') {
        count++;
      }
    }

    console.log(`Officer ${email} has ${count} pending requests`);
    return count;
  } catch (err) {
    console.error('countPendingRequests error:', err);
    return 0;
  }
}


async function getPendingCounts(email) {
  try {
    const locations = await getOfficerLocations(email);
    if (locations.length === 0) return { shiftRequests: 0, swapProposals: 0 };

    let shiftRequests = 0;
    let swapProposals = 0;

    const [requestsResponse, claimsResponse, listingsResponse] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Requests!A2:G' }),
      sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Marketplace Claims!A2:M' }),
      sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Marketplace Listings!A2:F' })
    ]);

    for (let row of (requestsResponse.data.values || [])) {
      if (row[5] && locations.includes(String(row[5]).trim()) && String(row[6] || '').toUpperCase() === 'PENDING') {
        shiftRequests++;
      }
    }

    for (let row of (claimsResponse.data.values || [])) {
      const type = String(row[12] || '').trim();
      const status = String(row[8] || '').trim().toUpperCase();
      if (type === 'swap_proposal' && status === 'PENDING' && row[6] && locations.includes(String(row[6]).trim())) {
        swapProposals++;
      }
    }

    let swapListings = 0;
    for (let row of (listingsResponse.data.values || [])) {
      if (row[4] && locations.includes(String(row[4]).trim()) && String(row[5] || '').trim() === 'Pending Verification') {
        swapListings++;
      }
    }

    return { shiftRequests, swapProposals, swapListings };
  } catch (err) {
    console.error('getPendingCounts error:', err);
    return { shiftRequests: 0, swapProposals: 0 };
  }
}


async function getOfficerPastSwapProposals(email) {
  try {
    const locations = await getOfficerLocations(email);

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Marketplace Claims!A2:M'
    });
    const rows = result.data.values || [];
    const past = [];

    for (let row of rows) {
      const type = String(row[12] || '').trim();
      const status = String(row[8] || '').trim().toUpperCase();
      if (
        type === 'swap_proposal' &&
        (status === 'APPROVED' || status === 'DENIED') &&
        row[6] && locations.includes(String(row[6]).trim())
      ) {
        past.push({
          claimingEmail: row[0], claimingName: row[1],
          originalEmail: row[2], originalName: row[3],
          date: normaliseDate(row[4]), jobType: row[5], location: row[6],
          submittedTimestamp: row[7],
          status: status,
          resolvedTimestamp: row[9] || row[7],
          offeredDate: normaliseDate(row[10] || ''), offeredJobType: row[11] || ''
        });
      }
    }

    // Sort by resolvedTimestamp descending (most recent first)
    past.sort((a, b) => {
      const parse = s => {
        if (!s) return 0;
        // Handle DD/MM/YYYY HH:MM:SS or similar locale string
        const d = new Date(s);
        return isNaN(d) ? 0 : d.getTime();
      };
      return parse(b.resolvedTimestamp) - parse(a.resolvedTimestamp);
    });

    return past;
  } catch (err) {
    console.error('getOfficerPastSwapProposals error:', err);
    return [];
  }
}



async function addShiftType(officerEmail, location, jobType, startTime, endTime, astRequired) {
  try {
    // Verify officer has access to this location
    const locations = await getOfficerLocations(officerEmail);
    if (!locations.includes(location)) {
      return { error: 'You do not have access to that location' };
    }
    if (!jobType || !jobType.trim()) return { error: 'Job type name is required' };

    // Check for duplicate
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Shift Types!A2:D'
    });
    for (let row of (existing.data.values || [])) {
      if (String(row[0]).trim() === jobType.trim() && String(row[1]).trim() === location) {
        return { error: `"${jobType}" already exists for ${location}` };
      }
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Shift Types!A2:E',
      valueInputOption: 'RAW',
      resource: { values: [[jobType.trim(), location, startTime || '', endTime || '', astRequired || '']] }
    });
    console.log(`addShiftType: ${jobType} @ ${location} (AST: ${astRequired}) added by ${officerEmail}`);
    return { success: true };
  } catch (err) {
    console.error('addShiftType error:', err);
    return { error: err.toString() };
  }
}

async function getShiftTypesForOfficer(email) {
  try {
    const locations = await getOfficerLocations(email);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Shift Types!A2:E'
    });
    const rows = response.data.values || [];
    const types = rows
      .filter(row => row[0] && locations.includes(String(row[1]).trim()))
      .map(row => ({
        jobType:     String(row[0] || '').trim(),
        location:    String(row[1] || '').trim(),
        startTime:   String(row[2] || '').trim(),
        endTime:     String(row[3] || '').trim(),
        astRequired: String(row[4] || '').trim()
      }));

    return types;
  } catch (err) {
    console.error('getShiftTypesForOfficer error:', err);
    return { types: [], astOptions: ['None', 'Emergency', 'Anaesthetics', 'O&G'] };
  }
}


async function checkShiftApplicants(shifts) {
  // Returns which of the provided shifts already have Pending/Backup applicants
  try {
    const reqResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: 'Requests!A2:G'
    });
    const rows = reqResp.data.values || [];
    return shifts.map(s => {
      const hasPending = rows.some(row => {
        const st = String(row[6]||'').toUpperCase();
        return (st === 'PENDING' || st === 'BACKUP') &&
          normaliseDate(String(row[3]||'').trim()) === normaliseDate(s.date) &&
          String(row[4]||'').trim() === s.jobType &&
          String(row[5]||'').trim() === s.location;
      });
      return { ...s, hasPendingApplicants: hasPending };
    });
  } catch (err) {
    console.error('checkShiftApplicants error:', err);
    return shifts.map(s => ({ ...s, hasPendingApplicants: false }));
  }
}

async function reofferShift(officerEmail, officerName, staffEmail, staffName, date, jobType, location) {
  try {
    // Look up who was previously approved for this shift
    const reqResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: 'Requests!A2:I'
    });
    const rows = reqResp.data.values || [];
    let withdrawnName = 'the previous applicant';
    for (const row of rows) {
      if (String(row[6]||'').toUpperCase() === 'APPROVED' &&
          normaliseDate(String(row[3]||'').trim()) === normaliseDate(date) &&
          String(row[4]||'').trim() === jobType &&
          String(row[5]||'').trim() === location) {
        withdrawnName = String(row[2]||'').trim() || withdrawnName;
        break;
      }
    }

    // Generate ICS for the shift
    const times = await getShiftTimes(location, jobType);
    const icsContent = generateICS(date, jobType, location, times.start, times.end, `${jobType} @ ${location}`);

    const shiftLabel = `${date} - ${jobType} @ ${location}`;
    const reapplyBody = encodeURIComponent(
      `Dear ${officerName},

Thank you for offering me this shift.

I am happy to cover:
${shiftLabel}

Sincerely,
${staffName}`
    );
    const declineBody = encodeURIComponent(
      `Dear ${officerName},

Thank you for thinking of me for this shift. Unfortunately, I am no longer able to cover:
${shiftLabel}

Sincerely,
${staffName}`
    );
    const reapplyLink = `mailto:${officerEmail}?subject=Re-Apply%3A%20${encodeURIComponent(shiftLabel)}&body=${reapplyBody}`;
    const declineLink = `mailto:${officerEmail}?subject=Unable%20to%20Cover%3A%20${encodeURIComponent(shiftLabel)}&body=${declineBody}`;

    const mailOptions = {
      from: GMAIL_USER,
      to: staffEmail,
      cc: GMAIL_USER,
      subject: `[Rural Rosters] Shift Re-offer: ${shiftLabel}`,
      html: `<p>Dear ${staffName},</p>
<p>The previous applicant for the following shift:</p>
<p><strong>${shiftLabel}</strong></p>
<p><strong>${withdrawnName}</strong> has withdrawn their application.</p>
<p>If you are still able to take this shift and are happy to do so, please use the button below:</p>
<p>
  <a href="${reapplyLink}" style="background:#28a745;color:white;padding:12px 24px;border-radius:4px;text-decoration:none;display:inline-block;margin:8px 4px;">Re-Apply for Shift</a>
  <a href="${declineLink}" style="background:#dc3545;color:white;padding:12px 24px;border-radius:4px;text-decoration:none;display:inline-block;margin:8px 4px;">I Can No Longer Cover This Shift</a>
</p>
<p style="color:#666;font-size:13px;">These buttons will open a pre-filled email in your email app addressed to ${officerName}.</p>
<p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
    };

    if (icsContent) {
      mailOptions.attachments = [{
        filename: `shift-${date.replace(/\//g,'-')}.ics`,
        content: icsContent,
        contentType: 'text/calendar; charset=utf-8; method=PUBLISH'
      }];
    }

    // Update Auto-Denied row to Re-offered so it reappears in Outstanding Requests
    const reqRows = (await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: 'Requests!A2:G'
    })).data.values || [];
    for (let i = 0; i < reqRows.length; i++) {
      const st = String(reqRows[i][6]||'').toUpperCase();
      if ((st === 'AUTO-DENIED' || st === 'BACKUP') &&
          reqRows[i][1] === staffEmail &&
          normaliseDate(String(reqRows[i][3]||'').trim()) === normaliseDate(date) &&
          String(reqRows[i][4]||'').trim() === jobType &&
          String(reqRows[i][5]||'').trim() === location) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Requests!G${i + 2}`,
          valueInputOption: 'RAW',
          resource: { values: [['Re-offered']] }
        });
        console.log(`Status updated to Re-offered for ${staffEmail}`);
        break;
      }
    }

    await transporter.sendMail(mailOptions);
    console.log(`Re-offer email sent to ${staffEmail} for ${shiftLabel}`);
    await sendPushNotification(staffEmail, 'Shift re-offered to you', `${date} - ${jobType} @ ${location}`, FRONTEND_URL); // PHASE 3
    return { success: true };
  } catch (err) {
    console.error('reofferShift error:', err);
    return { error: err.toString() };
  }
}


async function getAllLocations() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Rostering Officers!A2:A'
    });
    const rows = response.data.values || [];
    const locations = [...new Set(rows.map(r => String(r[0]||'').trim()).filter(Boolean))].sort();
    return locations;
  } catch (err) {
    console.error('getAllLocations error:', err.message);
    return [];
  }
}


async function updateUserPrimaryLocations(email, primaryLocations) {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Users!A2:H'
    });
    const rows = result.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).toLowerCase().trim() === normalizedEmail) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Users!H${i + 2}`,
          valueInputOption: 'RAW',
          resource: { values: [[primaryLocations]] }
        });
        console.log(`Updated primary locations for ${email}: ${primaryLocations}`);
        return { success: true };
      }
    }
    return { error: 'User not found' };
  } catch (err) {
    console.error('updateUserPrimaryLocations error:', err);
    return { error: err.toString() };
  }
}

// ── ICS / SHIFT TYPES HELPERS ─────────────────────────────────────────────────

async function getShiftTimes(location, jobType) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Shift Types!A2:D'
    });
    const rows = response.data.values || [];
    for (let row of rows) {
      if (String(row[0]).trim() === jobType && String(row[1]).trim() === location) {
        return { start: String(row[2] || '').trim(), end: String(row[3] || '').trim() };
      }
    }
    return { start: '', end: '' };
  } catch (err) {
    console.error('getShiftTimes error:', err.message);
    return { start: '', end: '' };
  }
}

function generateICS(date, jobType, location, startTime, endTime, summary) {
  // date is DD/MM/YYYY
  const parts = String(date).split('/');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  const dateStr = `${yyyy}${mm.padStart(2,'0')}${dd.padStart(2,'0')}`;
  const uid = `rural-rosters-${dateStr}-${jobType.replace(/\s+/g,'-')}-${Date.now()}@ruralrosters`;

  let dtStart, dtEnd;
  if (startTime && endTime && startTime.includes(':') && endTime.includes(':')) {
    const [sh, sm] = startTime.split(':');
    const [eh, em] = endTime.split(':');
    dtStart = `${dateStr}T${sh.padStart(2,'0')}${sm.padStart(2,'0')}00`;

    // Overnight shift: if end time is earlier than start time, end date is next day
    const startMins = parseInt(sh) * 60 + parseInt(sm);
    const endMins   = parseInt(eh) * 60 + parseInt(em);
    let endDateStr = dateStr;
    if (endMins <= startMins) {
      const d = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
      d.setDate(d.getDate() + 1);
      endDateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    }
    dtEnd = `${endDateStr}T${eh.padStart(2,'0')}${em.padStart(2,'0')}00`;
  } else {
    // Fall back to all-day event
    dtStart = `${dateStr}`;
    dtEnd   = `${dateStr}`;
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Rural Rosters//CHHHS//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART;VALUE=DATE:${dtStart}`,
      `DTEND;VALUE=DATE:${dtEnd}`,
      `SUMMARY:${summary || jobType + ' @ ' + location}`,
      `LOCATION:${location}`,
      'DESCRIPTION:Rural Rosters — Approved Shift',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
  }

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rural Rosters//CHHHS//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary || jobType + ' @ ' + location}`,
    `LOCATION:${location}`,
    'DESCRIPTION:Rural Rosters — Approved Shift',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

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

// ============================================================================
// UTILITY
// ============================================================================

function formatDate(dateVal) {
  if (!dateVal) return '';
  if (dateVal instanceof Date) {
    const d = dateVal.getDate();
    const m = dateVal.getMonth() + 1;
    const y = dateVal.getFullYear();
    return (d < 10 ? '0' + d : d) + '/' + (m < 10 ? '0' + m : m) + '/' + y;
  }
  return String(dateVal);
}

// Returns a short AST label: (ED) if Emergency only, otherwise lists extras
function formatASTLabel(astQuals) {
  const quals = String(astQuals || 'Emergency').split(',').map(q => q.trim());
  const extras = quals.filter(q => q && q !== 'Emergency');
  if (extras.length === 0) return '(ED)';
  return '(' + extras.join(', ') + ')';
}

// Normalises any date string to DD/MM/YYYY regardless of input format
function normaliseDate(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).trim();
  if (s.includes('/')) return s; // already DD/MM/YYYY
  if (s.includes('-')) {
    // YYYY-MM-DD
    const [y, m, d] = s.split('-');
    return d.padStart(2,'0') + '/' + m.padStart(2,'0') + '/' + y;
  }
  return s;
}

// ============================================================================
// SERVER START
// ============================================================================

const PORT = process.env.PORT || 8080;

console.log(`[STARTUP] Attempting to listen on port ${PORT}...`);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[SUCCESS] Rural Rosters Backend V2 Staging listening on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
});
