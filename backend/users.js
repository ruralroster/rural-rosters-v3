const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sheets, transporter } = require('./clients');
const { SHEET_ID, FRONTEND_URL, GMAIL_USER } = require('./config');

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$/;
const BCRYPT_SALT_ROUNDS = 10;

// Fix: immediate return on first email+password match — no collect-then-prefer logic.
// Rule: a user with two rows (Staff + Officer) must have a unique password per row.
// Staff rows should appear before Officer rows in the sheet as a safe default.
//
// Password column holds either a bcrypt hash ($2a$/$2b$/$2y$ prefix) or a legacy
// plaintext value. A successful legacy match is migrated to a bcrypt hash in place,
// on the spot — this is the only path that writes password values, so it's also the
// only migration path; there is no separate new-user write path in this codebase yet.
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
      const rowRole = String(row[3] || '').trim();

      if (rowEmail !== normalizedEmail) continue;

      const rowPassword = String(row[4] || '').trim();
      const isHashed = BCRYPT_HASH_PATTERN.test(rowPassword);
      const passwordMatch = isHashed
        ? await bcrypt.compare(password, rowPassword)
        : rowPassword === password;

      console.log(`Row ${i}: email="${rowEmail}" role="${rowRole}" passwordMatch=${passwordMatch}`);

      if (passwordMatch) {
        console.log(`Login match at row ${i}: ${normalizedEmail} as ${rowRole}`);

        if (!isHashed) {
          try {
            const newHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
            await sheets.spreadsheets.values.update({
              spreadsheetId: SHEET_ID,
              range: `Users!E${i + 2}`,
              valueInputOption: 'RAW',
              resource: { values: [[newHash]] }
            });
            console.log(`Row ${i}: migrated legacy plaintext password to bcrypt hash`);
          } catch (migrateErr) {
            console.error(`Row ${i}: password migration failed:`, migrateErr.message);
          }
        }

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

// Same hash-or-plaintext detection as checkUserExists — an unmigrated row
// can still change its password, and doing so migrates it to a hash in the
// same step, since newPassword is always written as a fresh bcrypt hash
// regardless of what the old value's format was.
// A user with two rows (Staff + Officer) has a unique password per row;
// currentPassword identifies which row is being changed, same as login does.
async function changeUserPassword(email, currentPassword, newPassword) {
  try {
    if (!currentPassword || !newPassword) return { error: 'Current and new password are required' };

    const normalizedEmail = String(email).toLowerCase().trim();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Users!A2:H'
    });
    const rows = result.data.values || [];
    let emailFound = false;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowEmail = String(row[0] || '').toLowerCase().trim();
      if (rowEmail !== normalizedEmail) continue;
      emailFound = true;

      const rowPassword = String(row[4] || '').trim();
      const isHashed = BCRYPT_HASH_PATTERN.test(rowPassword);
      const currentMatches = isHashed
        ? await bcrypt.compare(currentPassword, rowPassword)
        : rowPassword === currentPassword;

      if (!currentMatches) continue;

      const newHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Users!E${i + 2}`,
        valueInputOption: 'RAW',
        resource: { values: [[newHash]] }
      });
      console.log(`changeUserPassword: password updated for row ${i}`);
      return { success: true };
    }

    return { error: emailFound ? 'Current password is incorrect' : 'User not found' };
  } catch (err) {
    console.error('changeUserPassword error:', err);
    return { error: err.toString() };
  }
}

// Password Resets sheet columns: A email | B token | C expiry (ISO timestamp) | D used TRUE/FALSE
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const GENERIC_RESET_RESPONSE = { success: true, message: 'If that email is registered, a reset link has been sent.' };
const GENERIC_RESET_ERROR = { error: 'This reset link is invalid or has expired. Please request a new one.' };

// Always resolves to the same generic response whether or not the email
// exists, and even on internal error — same no-enumeration stance as the
// rest of this flow, applied consistently rather than just at the "not
// found" branch.
async function requestPasswordReset(email) {
  try {
    const normalizedEmail = String(email || '').toLowerCase().trim();
    if (!normalizedEmail) return GENERIC_RESET_RESPONSE;

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Users!A2:A'
    });
    const rows = result.data.values || [];
    const userExists = rows.some(row => String(row[0] || '').toLowerCase().trim() === normalizedEmail);
    if (!userExists) return GENERIC_RESET_RESPONSE;

    // Invalidate any prior outstanding tokens for this email before issuing
    // a new one — only the newest request should ever be valid at a time.
    // Same used-flag string comparison as completePasswordReset's check.
    const existingResets = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Password Resets!A2:D'
    });
    const resetRows = existingResets.data.values || [];
    for (let i = 0; i < resetRows.length; i++) {
      const row = resetRows[i];
      const rowEmail = String(row[0] || '').toLowerCase().trim();
      const used = String(row[3] || '').toUpperCase() === 'TRUE';
      if (rowEmail !== normalizedEmail || used) continue;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Password Resets!D${i + 2}`,
        valueInputOption: 'RAW',
        resource: { values: [['TRUE']] }
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Password Resets!A2:D',
      valueInputOption: 'RAW',
      resource: { values: [[normalizedEmail, token, expiry, 'FALSE']] }
    });

    const resetLink = `${FRONTEND_URL}?reset=${token}`;
    try {
      await transporter.sendMail({
        from: GMAIL_USER,
        to: normalizedEmail,
        subject: '[Rural Rosters] Password reset request',
        html: `<p>Dear User,</p>
<p>A password reset was requested for your Rural Rosters account. This link expires in 30 minutes:</p>
<p><a href="${resetLink}" style="background: #2c3e50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">Reset your password</a></p>
<p>If you did not request this, you can safely ignore this email — your password will not be changed.</p>
<p>Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>`
      });
      console.log(`requestPasswordReset: email sent to ${normalizedEmail}`);
    } catch (emailErr) {
      console.error('requestPasswordReset email error:', emailErr.message);
    }

    return GENERIC_RESET_RESPONSE;
  } catch (err) {
    console.error('requestPasswordReset error:', err);
    return GENERIC_RESET_RESPONSE;
  }
}

// Validates token exists / not expired / not used, then hashes newPassword
// and writes it the same way changeUserPassword does. Unlike changeUserPassword,
// there's no currentPassword here to disambiguate which row belongs to a user
// with two rows (Staff + Officer) — the user forgot their password, so they
// can't prove which row is "theirs" by matching it. Written to every row
// matching the email instead, so a two-role user isn't left locked out of
// one role after resetting the other.
async function completePasswordReset(token, newPassword) {
  try {
    if (!token || !newPassword) return GENERIC_RESET_ERROR;
    const trimmedToken = String(token).trim();

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Password Resets!A2:D'
    });
    const rows = result.data.values || [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (String(row[1] || '').trim() !== trimmedToken) continue;

      const used = String(row[3] || '').toUpperCase() === 'TRUE';
      const expiry = new Date(String(row[2] || '').trim());
      const expired = isNaN(expiry.getTime()) || expiry.getTime() < Date.now();
      if (used || expired) return GENERIC_RESET_ERROR;

      const email = String(row[0] || '').toLowerCase().trim();
      const usersResult = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Users!A2:H'
      });
      const userRows = usersResult.data.values || [];
      const newHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
      let updatedRows = 0;

      for (let j = 0; j < userRows.length; j++) {
        if (String(userRows[j][0] || '').toLowerCase().trim() !== email) continue;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Users!E${j + 2}`,
          valueInputOption: 'RAW',
          resource: { values: [[newHash]] }
        });
        updatedRows++;
      }

      if (updatedRows === 0) return GENERIC_RESET_ERROR;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Password Resets!D${i + 2}`,
        valueInputOption: 'RAW',
        resource: { values: [['TRUE']] }
      });

      console.log(`completePasswordReset: password reset for ${email} (${updatedRows} row(s) updated)`);
      return { success: true };
    }

    return GENERIC_RESET_ERROR;
  } catch (err) {
    console.error('completePasswordReset error:', err);
    return GENERIC_RESET_ERROR;
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
  changeUserPassword,
  requestPasswordReset,
  completePasswordReset,
  getStaffWithLocationSubscribed
};
