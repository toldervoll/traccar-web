import fetchOrThrow from '../../common/util/fetchOrThrow';
import { INTAKE_URL, MARK_TARGET } from './plannedRoutes';

const REQUEST_TIMEOUT_MS = 10000;

// Posts an OsmAnd report body: manual marks and messages share this transport.
const sendReport = async (body) => {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (MARK_TARGET === 'origin' && window.location.protocol === 'https:') {
    await fetchOrThrow(window.location.origin, { method: 'POST', headers, body, signal });
  } else {
    // no-cors gives no status; the websocket echo shows whether it arrived
    await fetch(INTAKE_URL, { method: 'POST', mode: 'no-cors', headers, body, signal });
  }
};

export default sendReport;
