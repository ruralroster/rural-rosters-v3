const { sheets, transporter } = require('./clients');
const { SHEET_ID, FRONTEND_URL, GMAIL_USER } = require('./config');
const { brisTime, normaliseDate } = require('./utils');
const { sendPushNotification } = require('./push');
const { getShiftTimes, generateICS } = require('./ics');
const { getOfficerLocations } = require('./users');

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


module.exports = {
  requestShifts,
  approveShiftRequest,
  denyShiftRequest,
  reofferShift,
  checkShiftApplicants,
  countPendingRequests,
  getPendingCounts,
  getOfficerPendingApprovals,
  getOfficerPastApprovals
};
