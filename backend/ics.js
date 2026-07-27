const { sheets } = require('./clients');
const { SHEET_ID } = require('./config');

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


module.exports = { getShiftTimes, generateICS };
