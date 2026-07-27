const { sheets } = require('./clients');
const { SHEET_ID, FRONTEND_URL } = require('./config');
const { formatDate, normaliseDate } = require('./utils');
const { getOfficerLocations, getStaffLocations, getStaffWithLocationSubscribed } = require('./users');
const { sendPushNotification } = require('./push');

// ============================================================================
// VACANCY FUNCTIONS
// ============================================================================

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

    const locationsWithAdditions = [];

    for (let location of locations) {
      if (!locationNames.includes(location)) continue;

      const sheetName = `Vacancies - ${location}`;
      const newVacancies = vacanciesByLocation[location] || [];

      try {
        // Read existing rows before clearing, so genuine additions can be detected
        // after the write (key: normaliseDate(date)+'|'+jobType+'|'+location, same
        // pattern used for the pending-applicants cross-reference above).
        const existing = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: `${sheetName}!A2:D`
        });
        const existingKeys = new Set(
          (existing.data.values || [])
            .filter(row => row[0] && row[1])
            .map(row => normaliseDate(formatDate(row[0])) + '|' + String(row[1]).trim() + '|' + location)
        );

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

        const hasGenuineAddition = newVacancies.some(vac =>
          !existingKeys.has(normaliseDate(vac.date) + '|' + vac.jobType + '|' + location)
        );
        if (hasGenuineAddition) locationsWithAdditions.push(location);
      } catch (err) {
        console.error(`Error updating ${sheetName}:`, err);
      }
    }

    // PHASE 3 — notify subscribed staff once per location with genuine additions
    for (const location of locationsWithAdditions) {
      try {
        const staff = await getStaffWithLocationSubscribed(location);
        for (const person of staff) {
          await sendPushNotification(person.email, `New shifts at ${location}`, `New shifts have been posted at ${location}.`, FRONTEND_URL); // PHASE 3
        }
      } catch (err) {
        console.error(`New-shift push notification error for ${location}:`, err.message);
      }
    }

    return { success: true, message: `Saved ${vacancies.length} vacancies` };
  } catch (err) {
    console.error('saveOfficerVacancies error:', err);
    return { error: err.toString() };
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


module.exports = {
  getJobTypesForLocation,
  getOfficerVacancies,
  getStaffAvailableShifts,
  saveOfficerVacancies,
  addShiftType,
  getShiftTypesForOfficer
};
