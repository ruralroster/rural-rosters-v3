const { sheets, transporter } = require('./clients');
const { SHEET_ID, FRONTEND_URL, GMAIL_USER } = require('./config');
const { brisTime, normaliseDate, formatASTLabel } = require('./utils');
const { sendPushNotification } = require('./push');
const { getShiftTimes, generateICS } = require('./ics');
const { getOfficerLocations, getStaffLocations } = require('./users');

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


module.exports = {
  listShiftForSwap,
  getMarketplaceListings,
  claimShift,
  getOfficerMarketplaceListings,
  getOfficerApprovedListings,
  approveSwap,
  denySwap,
  approvePendingSwap,
  denySwapWithReason,
  removeFromMarketplace,
  proposeSwap,
  approveSwapProposal,
  denySwapProposal,
  denySwapProposalWithReason,
  getOfficerSwapProposals,
  getOfficerPastSwapProposals
};
