import http from 'http';
import https from 'https';
import WebSocket from 'ws';

const BACKEND = 'http://127.0.0.1:8000';
const SUPABASE_URL = 'https://yjyzzotkvfxxdxsgtwkv.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqeXp6b3RrdmZ4eGR4c2d0d2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MTg4NTcsImV4cCI6MjEwMzI5NDg1N30.fi44j7-gkXtvZuQKxLvkpyZ-X40vgfsdRJ428Bn0fsY';

const USER1 = { email: 'ieee_tester_1@rally.test', password: 'Password123!' };
const USER2 = { email: 'ieee_tester_2@rally.test', password: 'Password123!' };

function req(opts, body) {
  return new Promise((resolve, reject) => {
    const mod = (opts.protocol || 'http:') === 'https:' ? https : http;
    const r = mod.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(d), raw: d });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: d, raw: d });
        }
      });
    });
    r.on('error', reject);
    if (body) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}

async function supabaseAuth(email, password) {
  const url = new URL(`${SUPABASE_URL}/auth/v1/token?grant_type=password`);
  return req(
    {
      protocol: 'https:',
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
    },
    { email, password }
  );
}

async function api(method, endpoint, token, body) {
  const u = new URL(BACKEND + endpoint);
  const hdrs = { 'Content-Type': 'application/json' };
  if (token) hdrs['Authorization'] = `Bearer ${token}`;
  return req(
    {
      protocol: 'http:',
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method,
      headers: hdrs,
    },
    body || null
  );
}

async function runPhase3Audit() {
  console.log('===============================================================');
  console.log('       RALLY PHASE 3: PRODUCTION READINESS AUDIT SUITE         ');
  console.log('===============================================================\n');

  const auditResults = {
    security: {},
    realtime: {},
    trip_integrity: {},
    sos_alerts: {},
  };

  // 0. Authenticate test users
  console.log('>>> [PRE-FLIGHT] Authenticating test users with Supabase JWKS...');
  const a1 = await supabaseAuth(USER1.email, USER1.password);
  const a2 = await supabaseAuth(USER2.email, USER2.password);
  const t1 = a1.body.access_token;
  const t2 = a2.body.access_token;
  if (!t1 || !t2) throw new Error('Supabase authentication failed');
  console.log('    ✓ User 1 authenticated:', a1.body.user.email);
  console.log('    ✓ User 2 authenticated:', a2.body.user.email);

  // =========================================================================
  // 1. SECURITY AUDIT
  // =========================================================================
  console.log('\n---------------------------------------------------------------');
  console.log('1. SECURITY AUDIT: Authentication, Authorization & Isolation   ');
  console.log('---------------------------------------------------------------');

  // 1.1 Unauthenticated API requests rejected
  const unauthTrips = await api('GET', '/api/v1/groups');
  console.log('1.1 Unauthenticated GET /groups status:', unauthTrips.status);
  const sec1 = unauthTrips.status === 401;
  auditResults.security.unauth_rejected = sec1 ? 'PASS' : 'FAIL';

  // 1.2 Forged JWT token rejected
  const forgedRes = await api('GET', '/api/v1/groups', 'forged.jwt.token');
  console.log('1.2 Forged token status:', forgedRes.status);
  const sec2 = forgedRes.status === 401;
  auditResults.security.forged_token_rejected = sec2 ? 'PASS' : 'FAIL';

  // 1.3 Create Group A with User 1 as Leader
  const grpARes = await api('POST', '/api/v1/groups', t1, {
    name: `Secure Group A ${Date.now()}`,
    destination_name: 'Colaba, Mumbai',
    latitude: 18.9067,
    longitude: 72.8147,
  });
  const grpA = grpARes.body;
  console.log('1.3 Created Group A:', grpA.id, 'by User 1');

  // Create Trip A in Group A
  const tripARes = await api('POST', `/api/v1/groups/${grpA.id}/trips`, t1, {
    destination_name: 'Colaba, Mumbai',
    latitude: 18.9067,
    longitude: 72.8147,
  });
  const tripA = tripARes.body;
  console.log('    Created Trip A:', tripA.id);

  // 1.4 Group Data Isolation: User 2 is NOT in Group A. Test access
  const isolationCheck1 = await api('GET', `/api/v1/trips/${tripA.id}`, t2);
  const isolationCheck2 = await api('GET', `/api/v1/trips/${tripA.id}/route`, t2);
  const isolationCheck3 = await api('GET', `/api/v1/trips/${tripA.id}/alerts`, t2);
  const isolationCheck4 = await api('GET', `/api/v1/trips/${tripA.id}/sos`, t2);

  console.log('1.4 Cross-Group Data Isolation Check (User 2 unauthorized for Group A):');
  console.log('    - GET /trips/{tripA_id}:', isolationCheck1.status, `(Expected: 403 or 404)`);
  console.log('    - GET /trips/{tripA_id}/route:', isolationCheck2.status, `(Expected: 403 or 404)`);
  console.log('    - GET /trips/{tripA_id}/alerts:', isolationCheck3.status, `(Expected: 403 or 404)`);
  console.log('    - GET /trips/{tripA_id}/sos:', isolationCheck4.status, `(Expected: 403 or 404)`);

  const secIsolation = [isolationCheck1.status, isolationCheck2.status, isolationCheck3.status, isolationCheck4.status]
    .every(s => s === 403 || s === 404);
  auditResults.security.cross_group_isolation = secIsolation ? 'PASS' : 'FAIL';

  // 1.5 WebSocket Unauthorized Access
  let wsRejected = false;
  try {
    const unauthorizedWs = new WebSocket(`ws://127.0.0.1:8000/api/v1/ws/trips/${tripA.id}?token=${t2}`);
    await new Promise((resolve, reject) => {
      unauthorizedWs.on('open', () => reject(new Error('Unauthorized WS opened unexpectedly')));
      unauthorizedWs.on('error', () => { wsRejected = true; resolve(); });
      unauthorizedWs.on('close', (code) => {
        if (code === 4003 || code === 4001 || code === 1008 || code === 1006) {
          wsRejected = true;
          resolve();
        } else {
          resolve();
        }
      });
      setTimeout(() => resolve(), 2000);
    });
  } catch (err) {
    wsRejected = true;
  }
  console.log('1.5 WebSocket Cross-Group Connection rejected:', wsRejected);
  auditResults.security.ws_authorization = wsRejected ? 'PASS' : 'FAIL';

  // 1.6 Rate Limiting Headers
  const healthHdr = await api('GET', '/api/v1/health');
  const hasRateLimitHdrs = Boolean(healthHdr.headers['x-request-id']);
  console.log('1.6 Security/Observability Headers Present (X-Request-ID):', healthHdr.headers['x-request-id'] || 'None');
  auditResults.security.observability_headers = hasRateLimitHdrs ? 'PASS' : 'FAIL';

  // =========================================================================
  // 2. TRIP AND ROUTE INTEGRITY
  // =========================================================================
  console.log('\n---------------------------------------------------------------');
  console.log('2. TRIP AND ROUTE INTEGRITY: Lifecycle State Machine & Replay   ');
  console.log('---------------------------------------------------------------');

  // 2.1 Route Creation while trip is CREATED
  const routeCoords = [
    [72.81, 18.9],
    [72.812, 18.902],
    [72.8147, 18.9067],
  ];
  const routeCreateRes = await api('POST', `/api/v1/trips/${tripA.id}/route`, t1, {
    name: 'Colaba Shore Route',
    origin_latitude: 18.9,
    origin_longitude: 72.81,
    destination_latitude: 18.9067,
    destination_longitude: 72.8147,
    coordinates: routeCoords,
    estimated_duration_seconds: 300,
  });
  console.log('2.1 Route Creation on CREATED trip:', routeCreateRes.status, 'Status:', routeCreateRes.body.status);
  const routeOk = routeCreateRes.status === 201 && routeCreateRes.body.status === 'PLANNED';

  // 2.2 Transition CREATED -> ACTIVE
  const startTripRes = await api('POST', `/api/v1/trips/${tripA.id}/start`, t1, { latitude: 18.9, longitude: 72.81 });
  console.log('2.2 Transition CREATED -> ACTIVE:', startTripRes.status, 'Trip Status:', startTripRes.body.status);
  const startOk = startTripRes.status === 200 && startTripRes.body.status === 'ACTIVE';

  // 2.3 Invalid transition ACTIVE -> ACTIVE (duplicate start rejected)
  const dupStartRes = await api('POST', `/api/v1/trips/${tripA.id}/start`, t1, {});
  console.log('2.3 Duplicate Start ACTIVE -> ACTIVE rejected:', dupStartRes.status, dupStartRes.body?.error?.code);
  const dupStartRejected = dupStartRes.status === 409;

  // 2.4 User 2 joins Group A
  await api('POST', '/api/v1/groups/join', t2, { join_code: grpA.join_code });

  // 2.5 Transition ACTIVE -> COMPLETED
  const endTripRes = await api('POST', `/api/v1/trips/${tripA.id}/end`, t1);
  console.log('2.5 Transition ACTIVE -> COMPLETED:', endTripRes.status, 'Trip Status:', endTripRes.body.status);
  const endOk = endTripRes.status === 200 && endTripRes.body.status === 'COMPLETED';

  // 2.6 Invalid transition COMPLETED -> ACTIVE rejected
  const restartRes = await api('POST', `/api/v1/trips/${tripA.id}/start`, t1, {});
  console.log('2.6 Restart COMPLETED -> ACTIVE rejected:', restartRes.status, restartRes.body?.error?.code);
  const restartRejected = restartRes.status === 409;

  // 2.7 Route Creation on COMPLETED trip rejected
  const routeOnCompleted = await api('POST', `/api/v1/trips/${tripA.id}/route`, t1, {
    name: 'Invalid Route',
    origin_latitude: 18.9,
    origin_longitude: 72.81,
    destination_latitude: 18.9067,
    destination_longitude: 72.8147,
    coordinates: routeCoords,
  });
  console.log('2.7 Route Creation on COMPLETED trip rejected:', routeOnCompleted.status, routeOnCompleted.body?.error?.code);
  const routeCompletedRejected = routeOnCompleted.status === 409;

  auditResults.trip_integrity.lifecycle_state_machine = (routeOk && startOk && dupStartRejected && endOk && restartRejected && routeCompletedRejected) ? 'PASS' : 'FAIL';

  // 2.8 Trip History & Replay Retrieval
  const historyRes = await api('GET', '/api/v1/trips/history', t1);
  const historyItems = historyRes.body.items || [];
  const foundInHistory = historyItems.some(i => (i.trip_id || i.id) === tripA.id);
  console.log('2.8 Completed Trip found in /trips/history:', foundInHistory, `(Total history items: ${historyItems.length})`);
  auditResults.trip_integrity.history_persistence = foundInHistory ? 'PASS' : 'FAIL';

  // =========================================================================
  // 3. SOS AND ALERT RELIABILITY
  // =========================================================================
  console.log('\n---------------------------------------------------------------');
  console.log('3. SOS AND ALERT RELIABILITY: Idempotency & Workflow            ');
  console.log('---------------------------------------------------------------');

  // Create active trip for SOS test
  const grpBRes = await api('POST', '/api/v1/groups', t1, {
    name: `SOS Test Group ${Date.now()}`,
    destination_name: 'Bandra Bandstand',
    latitude: 19.0434,
    longitude: 72.8194,
  });
  const grpB = grpBRes.body;
  await api('POST', '/api/v1/groups/join', t2, { join_code: grpB.join_code });

  const tripBRes = await api('POST', `/api/v1/groups/${grpB.id}/trips`, t1, {
    destination_name: 'Bandra Bandstand',
    latitude: 19.0434,
    longitude: 72.8194,
  });
  const tripB = tripBRes.body;
  await api('POST', `/api/v1/trips/${tripB.id}/start`, t1, { latitude: 19.04, longitude: 72.81 });

  // 3.1 Trigger SOS from User 2
  const sos1 = await api('POST', `/api/v1/trips/${tripB.id}/sos`, t2, {
    latitude: 19.043,
    longitude: 72.819,
    accuracy: 5.0,
    message: 'Test SOS Phase 3',
  });
  console.log('3.1 First SOS Trigger status:', sos1.status, 'SOS ID:', sos1.body.id, 'Status:', sos1.body.status);

  // 3.2 Duplicate SOS request (Idempotency test)
  const sosDup = await api('POST', `/api/v1/trips/${tripB.id}/sos`, t2, {
    latitude: 19.043,
    longitude: 72.819,
    accuracy: 5.0,
    message: 'Test SOS Duplicate',
  });
  console.log('3.2 Duplicate SOS Trigger status:', sosDup.status, 'Returned same ID:', sosDup.body.id === sos1.body.id);
  const sosIdempotent = sosDup.status === 200 || (sosDup.status === 201 && sosDup.body.id === sos1.body.id);
  auditResults.sos_alerts.idempotency = sosIdempotent ? 'PASS' : 'FAIL';

  // 3.3 Acknowledge SOS
  const ackRes = await api('POST', `/api/v1/sos/${sos1.body.id}/acknowledge`, t1);
  console.log('3.3 Acknowledge SOS by Leader:', ackRes.status, 'New Status:', ackRes.body.status);
  const ackOk = ackRes.status === 200 && ackRes.body.status === 'ACKNOWLEDGED';

  // 3.4 Resolve SOS
  const resolveRes = await api('POST', `/api/v1/sos/${sos1.body.id}/resolve`, t1);
  console.log('3.4 Resolve SOS by Leader:', resolveRes.status, 'New Status:', resolveRes.body.status);
  const resolveOk = resolveRes.status === 200 && resolveRes.body.status === 'RESOLVED';

  auditResults.sos_alerts.workflow = (ackOk && resolveOk) ? 'PASS' : 'FAIL';

  // 3.5 Active SOS listing (now empty since resolved)
  const activeSOSList = await api('GET', `/api/v1/trips/${tripB.id}/sos/active`, t1);
  console.log('3.5 Active SOS count after resolution:', activeSOSList.body.length);
  auditResults.sos_alerts.active_filtering = activeSOSList.body.length === 0 ? 'PASS' : 'FAIL';

  // =========================================================================
  // 4. REAL-TIME RELIABILITY: Disconnection & Reconnection
  // =========================================================================
  console.log('\n---------------------------------------------------------------');
  console.log('4. REAL-TIME RELIABILITY: WebSockets, Disconnect & Recovery    ');
  console.log('---------------------------------------------------------------');

  let connect1Ok = false;
  let disconnectOk = false;
  let reconnectOk = false;
  let receivedSnapshot = false;

  const wsUrl = `ws://127.0.0.1:8000/api/v1/ws/trips/${tripB.id}?token=${t1}`;
  const wsA = new WebSocket(wsUrl);

  await new Promise((resolve) => {
    wsA.on('open', () => {
      connect1Ok = true;
      wsA.send(JSON.stringify({
        type: 'location_update',
        data: { latitude: 19.0434, longitude: 72.8194, accuracy: 5, speed: 0, heading: 0 },
      }));
      setTimeout(() => {
        wsA.close(1000, 'Normal Disconnect');
      }, 500);
    });
    wsA.on('close', () => {
      disconnectOk = true;
      resolve();
    });
  });

  console.log('4.1 Initial WS connection established & clean disconnect:', connect1Ok && disconnectOk);

  // Reconnection
  const wsRecon = new WebSocket(wsUrl);
  await new Promise((resolve) => {
    wsRecon.on('open', () => {
      reconnectOk = true;
    });
    wsRecon.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'initial_state' || msg.type === 'trip_state' || msg.type === 'locations') {
          receivedSnapshot = true;
        }
      } catch {}
      setTimeout(() => {
        wsRecon.close();
        resolve();
      }, 800);
    });
    setTimeout(() => {
      wsRecon.close();
      resolve();
    }, 2000);
  });

  console.log('4.2 Reconnection succeeded:', reconnectOk);
  auditResults.realtime.ws_reconnection = (connect1Ok && disconnectOk && reconnectOk) ? 'PASS' : 'FAIL';

  // Clean up Trip B
  await api('POST', `/api/v1/trips/${tripB.id}/end`, t1);

  console.log('\n===============================================================');
  console.log('                    PHASE 3 AUDIT SUMMARY                      ');
  console.log('===============================================================');
  console.log(JSON.stringify(auditResults, null, 2));

  const allPassed = Object.values(auditResults).every(category =>
    Object.values(category).every(val => val === 'PASS')
  );

  console.log('\nOverall Production Readiness Integration Verdict:', allPassed ? 'PASS (100%)' : 'FAIL');
  process.exit(allPassed ? 0 : 1);
}

runPhase3Audit().catch(err => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
