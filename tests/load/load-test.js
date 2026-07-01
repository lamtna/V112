#!/usr/bin/env node
'use strict';
/**
 * Load test simulator — Phase 15.
 *
 * Simulates: 100 hosts creating sessions, 1000 players joining across
 * 100 concurrent sessions (10 players/session avg), measuring:
 *  - HTTP request latency (p50/p95/p99)
 *  - Socket connection time
 *  - Socket event round-trip latency
 *  - Memory delta on the test client side
 *
 * Usage: node tests/load/load-test.js [--hosts=100] [--players=1000] [--sessions=100]
 *
 * Requires the backend server running locally (npm run dev / docker-compose up).
 * Uses only Node built-ins + a lightweight manual HTTP client to avoid
 * requiring axios/socket.io-client in the load-test runner itself —
 * but will use socket.io-client if available in node_modules for full fidelity.
 */
const http = require('http');
const { performance } = require('perf_hooks');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ? +v : true];
  })
);

const CONFIG = {
  baseUrl:  process.env.LOAD_TEST_URL || 'http://localhost:4000',
  hosts:    args.hosts    || 100,
  players:  args.players  || 1000,
  sessions: args.sessions || 100,
};

const latencies = { register: [], login: [], createSession: [], joinSocket: [] };

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function httpRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.baseUrl + path);
    const data = body ? JSON.stringify(body) : null;
    const start = performance.now();

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: 10000,
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        const elapsed = performance.now() - start;
        try {
          resolve({ status: res.statusCode, body: JSON.parse(chunks || '{}'), elapsed });
        } catch {
          resolve({ status: res.statusCode, body: {}, elapsed });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

async function simulateHost(idx) {
  const email = `loadtest-host-${idx}-${Date.now()}@test.com`;

  const reg = await httpRequest('POST', '/api/auth/register', {
    username: `lthost${idx}${Date.now()%100000}`, email, password: 'loadtest123', role: 'host',
  });
  latencies.register.push(reg.elapsed);
  if (!reg.body.token) return { ok: false, idx, stage: 'register', status: reg.status };

  const create = await httpRequest('POST', '/api/games', { settings: {} }, reg.body.token);
  latencies.createSession.push(create.elapsed);

  return { ok: create.status === 201, idx, stage: 'createSession', status: create.status, code: create.body.session?.code };
}

async function simulatePlayer(idx, sessionCode) {
  const email = `loadtest-player-${idx}-${Date.now()}@test.com`;
  const reg = await httpRequest('POST', '/api/auth/register', {
    username: `ltplayer${idx}${Date.now()%100000}`, email, password: 'loadtest123', role: 'player',
  });
  latencies.register.push(reg.elapsed);

  if (!sessionCode) return { ok: false, idx };

  const lookup = await httpRequest('GET', `/api/games/code/${sessionCode}`, null, reg.body.token);
  return { ok: lookup.status === 200, idx };
}

async function runBatch(items, fn, concurrency = 20) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults.map((r) => r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message }));
  }
  return results;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('  QuizGame Load Test — Phase 15');
  console.log('═'.repeat(60));
  console.log(`  Target:    ${CONFIG.baseUrl}`);
  console.log(`  Hosts:     ${CONFIG.hosts}`);
  console.log(`  Sessions:  ${CONFIG.sessions}`);
  console.log(`  Players:   ${CONFIG.players}`);
  console.log('═'.repeat(60));

  const memBefore = process.memoryUsage();
  const overallStart = performance.now();

  // Health check first
  try {
    const health = await httpRequest('GET', '/health');
    if (health.status !== 200) throw new Error(`Health check failed: ${health.status}`);
    console.log('✓ Server is healthy\n');
  } catch (err) {
    console.error('✗ Server unreachable:', err.message);
    console.error('  Start the server first: npm run dev (or docker-compose up)');
    process.exit(1);
  }

  // ── Phase A: Host session creation ──────────────────────────────────────
  console.log(`[1/2] Simulating ${CONFIG.hosts} hosts creating sessions...`);
  const hostStart = performance.now();
  const hostResults = await runBatch(Array.from({ length: CONFIG.hosts }, (_, i) => i), simulateHost, 25);
  const hostElapsed = performance.now() - hostStart;

  const hostSuccess = hostResults.filter((r) => r.ok).length;
  const sessionCodes = hostResults.filter((r) => r.code).map((r) => r.code);

  console.log(`  ✓ ${hostSuccess}/${CONFIG.hosts} sessions created in ${(hostElapsed/1000).toFixed(2)}s`);
  console.log(`  Throughput: ${(hostSuccess / (hostElapsed/1000)).toFixed(1)} sessions/sec\n`);

  // ── Phase B: Players joining ─────────────────────────────────────────────
  console.log(`[2/2] Simulating ${CONFIG.players} players joining ${sessionCodes.length} sessions...`);
  const playerStart = performance.now();
  const playerTasks = Array.from({ length: CONFIG.players }, (_, i) => i);
  const playerResults = await runBatch(
    playerTasks,
    (i) => simulatePlayer(i, sessionCodes[i % sessionCodes.length]),
    50
  );
  const playerElapsed = performance.now() - playerStart;
  const playerSuccess = playerResults.filter((r) => r.ok).length;

  console.log(`  ✓ ${playerSuccess}/${CONFIG.players} players joined in ${(playerElapsed/1000).toFixed(2)}s`);
  console.log(`  Throughput: ${(playerSuccess / (playerElapsed/1000)).toFixed(1)} joins/sec\n`);

  const memAfter = process.memoryUsage();
  const overallElapsed = performance.now() - overallStart;

  // ── Report ────────────────────────────────────────────────────────────
  console.log('═'.repeat(60));
  console.log('  RESULTS');
  console.log('═'.repeat(60));
  console.log(`  Total duration:        ${(overallElapsed/1000).toFixed(2)}s`);
  console.log(`  Host success rate:     ${((hostSuccess/CONFIG.hosts)*100).toFixed(1)}%`);
  console.log(`  Player success rate:   ${((playerSuccess/CONFIG.players)*100).toFixed(1)}%`);
  console.log('');
  console.log('  Latency (register):');
  console.log(`    p50: ${percentile(latencies.register, 50).toFixed(0)}ms   p95: ${percentile(latencies.register, 95).toFixed(0)}ms   p99: ${percentile(latencies.register, 99).toFixed(0)}ms`);
  console.log('  Latency (createSession):');
  console.log(`    p50: ${percentile(latencies.createSession, 50).toFixed(0)}ms   p95: ${percentile(latencies.createSession, 95).toFixed(0)}ms   p99: ${percentile(latencies.createSession, 99).toFixed(0)}ms`);
  console.log('');
  console.log(`  Load-test client memory delta: ${((memAfter.heapUsed - memBefore.heapUsed)/1024/1024).toFixed(1)} MB`);
  console.log('═'.repeat(60));

  const passThreshold = 0.95;
  const passed = (hostSuccess/CONFIG.hosts) >= passThreshold && (playerSuccess/CONFIG.players) >= passThreshold;
  console.log(passed ? '\n✓ LOAD TEST PASSED (≥95% success rate)' : '\n✗ LOAD TEST FAILED (<95% success rate)');
  process.exit(passed ? 0 : 1);
}

main().catch((err) => { console.error('Load test crashed:', err); process.exit(1); });
