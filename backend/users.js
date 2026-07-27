const { sheets } = require('./clients');
const { SHEET_ID } = require('./config');

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


// PHASE 3 — staff covering `location` with an active push subscription.
// Reuses the Push Subscriptions sheet (same columns as push.js: A email, E active)
// rather than tracking subscription state anywhere new.
async function getStaffWithLocationSubscribed(location) {
  try {
    const [usersResult, subsResult] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Users!A2:C' }),
      sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Push Subscriptions!A2:E' })
    ]);

    const subscribedEmails = new Set();
    for (const row of (subsResult.data.values || [])) {
      const rowEmail = String(row[0] || '').toLowerCase().trim();
      const active = String(row[4] || '').toUpperCase() === 'TRUE';
      if (rowEmail && active) subscribedEmails.add(rowEmail);
    }

    const staff = [];
    for (const row of (usersResult.data.values || [])) {
      const email = String(row[0] || '').toLowerCase().trim();
      if (!email || !subscribedEmails.has(email)) continue;
      const locations = (row[2] || '').split(',').map(l => l.trim());
      if (locations.includes(location)) {
        staff.push({ email: row[0], name: row[1] });
      }
    }

    return staff;
  } catch (err) {
    console.error('getStaffWithLocationSubscribed error:', err);
    return [];
  }
}


module.exports = {
  checkUserExists,
  getOfficerLocations,
  getStaffLocations,
  getAllLocations,
  updateUserLocations,
  updateUserPrimaryLocations,
  updateUserAST,
  getStaffWithLocationSubscribed
};
