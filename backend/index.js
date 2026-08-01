/**
 * Rural Rosters Backend V2 - Staging
 * Staging credentials + clear-first vacancies + mailto links + checkUserExists fix
 */

const http = require('http');
const push = require('./push');
const users = require('./users');
const vacancies = require('./vacancies');
const requests = require('./requests');
const marketplace = require('./marketplace');
const ics = require('./ics');

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
        case 'checkUserExists':           result = await users.checkUserExists(params.email, params.password); break;
        case 'getOfficerLocations':       result = await users.getOfficerLocations(params.email); break;
        case 'getStaffLocations':         result = await users.getStaffLocations(params.email); break;
        case 'getJobTypesForLocation':    result = await vacancies.getJobTypesForLocation(params.location); break;
        case 'getShiftTimesForJobType':   result = await ics.getShiftTimes(params.location, params.jobType); break;
        case 'getOfficerVacancies':       result = await vacancies.getOfficerVacancies(params.email); break;
        case 'getStaffAvailableShifts':   result = await vacancies.getStaffAvailableShifts(params.email); break;
        case 'requestShifts':             result = await requests.requestShifts(params.email, params.name, params.shifts); break;
        case 'saveOfficerVacancies':      result = await vacancies.saveOfficerVacancies(params.email, params.vacancies); break;
        case 'listShiftForSwap':          result = await marketplace.listShiftForSwap(params.email, params.name, params.date, params.jobType, params.location, params.isServiceDisruption, params.availableDays); break;
        case 'getMarketplaceListings':    result = await marketplace.getMarketplaceListings(params.email); break;
        case 'claimShift':                result = await marketplace.claimShift(params.claimingEmail, params.claimingName, params.originalEmail, params.originalName, params.date, params.jobType, params.location); break;
        case 'getOfficerMarketplaceListings': result = await marketplace.getOfficerMarketplaceListings(params.email); break;
        case 'getOfficerPendingApprovals':    result = await requests.getOfficerPendingApprovals(params.email); break;
        case 'getOfficerPastApprovals':       result = await requests.getOfficerPastApprovals(params.email); break;
        case 'approveSwap':               result = await marketplace.approveSwap(params.claimingEmail, params.claimingName, params.originalEmail, params.originalName, params.officerEmail, params.officerName, params.date, params.jobType, params.location, params.sendEmail !== false); break;
        case 'denySwap':                  result = await marketplace.denySwap(params.claimingEmail, params.claimingName, params.originalEmail, params.originalName, params.officerEmail, params.officerName, params.date, params.jobType, params.location, params.sendEmail !== false); break;
        case 'approvePendingSwap':        result = await marketplace.approvePendingSwap(params.staffEmail, params.staffName, params.date, params.jobType, params.location); break;
        case 'denySwapWithReason':        result = await marketplace.denySwapWithReason(params.staffEmail, params.staffName, params.date, params.jobType, params.location, params.reason); break;
        case 'getOfficerApprovedListings':  result = await marketplace.getOfficerApprovedListings(params.email); break;
        case 'getOfficerSwapProposals':     result = await marketplace.getOfficerSwapProposals(params.email); break;
        case 'getOfficerPastSwapProposals':  result = await marketplace.getOfficerPastSwapProposals(params.email); break;
        case 'removeFromMarketplace':       result = await marketplace.removeFromMarketplace(params.staffEmail, params.staffName, params.date, params.jobType, params.location); break;
        case 'denySwapProposalWithReason':  result = await marketplace.denySwapProposalWithReason(params.claimingEmail, params.claimingName, params.date, params.jobType, params.location, params.reason); break;
        case 'approveShiftRequest':       result = await requests.approveShiftRequest(params.email, params.name, params.date, params.jobType, params.location, params.sendEmail !== false); break;
        case 'denyShiftRequest':          result = await requests.denyShiftRequest(params.email, params.name, params.date, params.jobType, params.location, params.sendEmail !== false); break;
        case 'proposeSwap':               result = await marketplace.proposeSwap(params.claimingEmail, params.claimingName, params.originalEmail, params.originalName, params.date, params.jobType, params.location, params.offeredDate, params.offeredJobType); break;
        case 'approveSwapProposal':       result = await marketplace.approveSwapProposal(params.claimingEmail, params.claimingName, params.originalEmail, params.originalName, params.officerEmail, params.officerName, params.date, params.jobType, params.location, params.offeredDate, params.offeredJobType, params.sendEmail !== false); break;
        case 'denySwapProposal':          result = await marketplace.denySwapProposal(params.claimingEmail, params.claimingName, params.officerEmail, params.officerName, params.date, params.jobType, params.location, params.sendEmail !== false); break;
        case 'updateUserLocations':             result = await users.updateUserLocations(params.email, params.locations, params.role); break;
        case 'updateUserPrimaryLocations':      result = await users.updateUserPrimaryLocations(params.email, params.primaryLocations); break;
        case 'updateUserAST':             result = await users.updateUserAST(params.email, params.astQuals); break;
        case 'changeUserPassword':        result = await users.changeUserPassword(params.email, params.currentPassword, params.newPassword); break;
        case 'requestPasswordReset':      result = await users.requestPasswordReset(params.email); break;
        case 'completePasswordReset':     result = await users.completePasswordReset(params.token, params.newPassword); break;
        case 'countPendingRequests':      result = await requests.countPendingRequests(params.email); break;
        case 'getPendingCounts':           result = await requests.getPendingCounts(params.email); break;
        case 'addShiftType':               result = await vacancies.addShiftType(params.officerEmail, params.location, params.jobType, params.startTime, params.endTime, params.astRequired); break;
        case 'reofferShift':               result = await requests.reofferShift(params.officerEmail, params.officerName, params.staffEmail, params.staffName, params.date, params.jobType, params.location); break;
        case 'checkShiftApplicants':       result = await requests.checkShiftApplicants(params.shifts); break;
        case 'getShiftTypesForOfficer':    result = await vacancies.getShiftTypesForOfficer(params.email); break;
        case 'getAllLocations':              result = await users.getAllLocations(); break;
        case 'savePushSubscription':       result = await push.savePushSubscription(params.email, params.subscription); break; // PHASE 3
        case 'deactivatePushSubscription': result = await push.deactivatePushSubscription(params.email, params.endpoint); break; // PHASE 3
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
