import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DONATIONS_NETWORKS } from '../src/donations-config.mjs';

// Invariant: the production CSP must allow the browser to reach every
// donations RPC. A future network/RPC edit in donations-config.mjs fails this
// test until site/_headers connect-src is updated to match — the live site
// otherwise blocks the RPC silently (verified against the deployed CSP).
function connectSrcOf(headers) {
  const csp = headers.match(/Content-Security-Policy:\s*([^\n]+)/)?.[1];
  assert.ok(csp, 'site/_headers must declare a Content-Security-Policy');
  const connectSrc = csp.match(/connect-src\s+([^;]+)/)?.[1];
  assert.ok(connectSrc, 'the CSP must declare an explicit connect-src');
  return connectSrc.trim().split(/\s+/);
}

function rpcCspViolations(networks, allowed) {
  const problems = [];
  for (const [key, network] of Object.entries(networks)) {
    // Fail closed: a non-https (or missing/unparseable) rpcUrl is an error,
    // never a silent skip — the browser would block or downgrade it.
    let url = null;
    try { url = new URL(network.rpcUrl); } catch { /* reported below */ }
    if (!url || url.protocol !== 'https:') { problems.push(`rpcUrl of the "${key}" donations network must be an https URL, got ${JSON.stringify(network.rpcUrl)}`); continue; }
    const origin = url.origin;
    if (!allowed.includes(origin)) problems.push(`connect-src is missing ${origin} (rpcUrl of the "${key}" donations network); the browser would block its RPC in production`);
  }
  return problems;
}

test('every donations RPC origin is allowed by the CSP connect-src in site/_headers', () => {
  const allowed = connectSrcOf(readFileSync(new URL('../site/_headers', import.meta.url), 'utf8'));
  assert.ok(!allowed.includes('*') && !allowed.includes("'unsafe-eval'"), 'connect-src must stay an explicit allowlist');
  assert.deepEqual(rpcCspViolations(DONATIONS_NETWORKS, allowed), []);
});

test('a non-https (or missing) donations rpcUrl is rejected outright instead of skipped', () => {
  const allowed = ['https://rpc.example.test', 'http://rpc.example.test'];
  for (const rpcUrl of ['http://rpc.example.test', 'ws://rpc.example.test', '', undefined, 'not a url']) {
    const problems = rpcCspViolations({ bad: { rpcUrl } }, allowed);
    assert.equal(problems.length, 1, `rpcUrl ${JSON.stringify(rpcUrl)} must be reported`);
    assert.match(problems[0], /"bad"/);
  }
  assert.deepEqual(rpcCspViolations({ ok: { rpcUrl: 'https://rpc.example.test/chains/main' } }, allowed), []);
});
