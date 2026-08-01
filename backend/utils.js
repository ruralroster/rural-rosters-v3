const BRISBANE_TZ = 'Australia/Brisbane';
const brisTime = () => new Date().toLocaleString('en-AU', { timeZone: BRISBANE_TZ, hour12: true,
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const SIGN_OFF = '<p style="margin-top:16px;">Many Thanks,<br><strong>Rural Rosters Support Team</strong></p>';

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


module.exports = { BRISBANE_TZ, brisTime, formatDate, normaliseDate, formatASTLabel, SIGN_OFF };
