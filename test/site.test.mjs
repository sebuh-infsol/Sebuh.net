import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const root = new URL('../site/', import.meta.url);

test('Cloudflare deployment serves static assets without a Worker entrypoint or custom DNS changes', () => {
  const path = new URL('../wrangler.json', import.meta.url);
  assert.ok(existsSync(path), 'Worker configuration has not been created');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(config.name, 'sebuh-net');
  assert.equal(config.assets.directory, './site');
  assert.equal(config.preview_urls, true);
  for (const forbidden of ['main', 'routes', 'route', 'kv_namespaces', 'vars', 'secrets_store_secrets']) {
    assert.equal(config[forbidden], undefined);
  }
});

test('support page discloses no payouts before the delegate address', () => {
  assert.ok(existsSync(new URL('index.html', root)), 'support page has not been built');
  const html = readFileSync(new URL('index.html', root), 'utf8');
  assert.match(html, /No delegation reward payouts/);
  assert.ok(html.indexOf('No delegation reward payouts') < html.indexOf('tz1R664EP6wjcM1RSUVJ7nrJisTpBW9QyJzP'));
  assert.match(html, /Restart in progress/);
  assert.match(html, /not an investment or a promise of yield/);
  assert.match(html, /Direct staking is different/);
  assert.doesNotMatch(html, /connect wallet|guaranteed return|earn \d+%|localhost:8732|127\.0\.0\.1:8732/i);
});

test('page includes accessible controls and only local assets', () => {
  assert.ok(existsSync(new URL('index.html', root)), 'support page has not been built');
  const html = readFileSync(new URL('index.html', root), 'utf8');
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /href="#main"/);
  assert.match(html, /id="copy-address"/);
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) {
    assert.ok(existsSync(new URL(match[1], root)), `Missing local asset: ${match[1]}`);
  }
  const js = readFileSync(new URL('site.js', root), 'utf8');
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|eval\(|innerHTML|secret.?key|signPayload/);
  const css = readFileSync(new URL('style.css', root), 'utf8');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
  assert.match(css, /@media/);
});
