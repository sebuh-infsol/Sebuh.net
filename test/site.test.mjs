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
  assert.deepEqual(config.previews, {}, 'wrangler preview requires its own explicit previews block; preview_urls is not enough');
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
  assert.doesNotMatch(html, /guaranteed return|earn \d+%|localhost:8732|127\.0\.0\.1:8732|inMemorySigner/i);
});

test('wallet UI keeps pairing separate from policy review and wallet approval', () => {
  const html=readFileSync(new URL('index.html',root),'utf8');
  for(const id of ['wallet-connect','wallet-disconnect','delegation-consent','delegation-review','delegation-confirm','wallet-status']) {
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/type="checkbox" id="delegation-consent"/);
  assert.match(html,/Connecting does not request a transaction/);
  assert.match(html,/src="\.\/wallet-ui\.js"/);
  const headers=readFileSync(new URL('_headers',root),'utf8');
  assert.match(headers,/https:\/\/rpc\.tzkt\.io/);
  assert.doesNotMatch(headers,/unsafe-eval|connect-src[^;]*\*/);
  assert.doesNotMatch(headers,/pulse\.walletconnect|beacon-metrics/);
  const adapter=readFileSync(new URL('../src/octez-client.mjs',import.meta.url),'utf8');
  assert.match(adapter,/disableWalletConnect:true/);
  assert.match(adapter,/enableMetrics:false/);
  assert.match(adapter,/NetworkType\.MAINNET/);
  const build=readFileSync(new URL('../scripts/build-wallet.mjs',import.meta.url),'utf8');
  assert.match(build,/inject:\['src\/buffer-shim\.mjs'\]/);
  const config=JSON.parse(readFileSync(new URL('../wrangler.json',import.meta.url),'utf8'));
  assert.equal(config.build.command,'npm run build');
});

test('donation suggestions distinguish an irreversible gift from delegation and staking',()=>{
  const html=readFileSync(new URL('index.html',root),'utf8');
  const donation=html.match(/<section\b[^>]*id="donate"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(donation,/Help grow the baker/);
  for(const amount of ['10','100','1000'])assert.match(donation,new RegExp('>'+amount+' XTZ<'));
  assert.match(donation,/transfer ownership/);
  assert.match(donation,/not delegation or direct staking/);
  assert.match(donation,/no entitlement to repayment or rewards/);
  assert.match(donation,/do not automatically stake funds, activate the baker or guarantee baking rights/);
  assert.ok(donation.indexOf('transfer ownership')<donation.indexOf('id="copy-donation-address"'));
  assert.match(donation,/<code id="donation-address">tz1R664EP6wjcM1RSUVJ7nrJisTpBW9QyJzP<\/code>/);
  assert.match(donation,/Send.*wallet/);
  assert.doesNotMatch(donation,/tezos:\/\/|requestOperation|type="submit"/);
  assert.match(html,/With ordinary delegation, your XTZ stay in your wallet/);
});

test('header wallet controls and all support actions are immediately after the hero',()=>{
  const html=readFileSync(new URL('index.html',root),'utf8');
  const header=html.match(/<header\b[\s\S]*?<\/header>/)?.[0] || '';
  for(const id of ['wallet-connect','wallet-disconnect','wallet-refresh']){
    assert.match(header,new RegExp('id="'+id+'"'));
    assert.equal([...html.matchAll(new RegExp('id="'+id+'"','g'))].length,1);
  }
  assert.match(html,/<\/aside>\s*<\/section>\s*<section[^>]*id="support-actions"/);
  const actions=html.slice(html.indexOf('id="support-actions"'),html.indexOf('id="policy"'));
  for(const id of ['delegate-with-wallet','stake','donate'])assert.match(actions,new RegExp('id="'+id+'"'));
  assert.match(actions,/>Delegate<\/h2>/);
  assert.match(actions,/>Stake<\/h2>/);
  assert.match(actions,/>Donate<\/h2>/);
  assert.match(actions,/id="staking-unavailable" disabled/);
  assert.match(actions,/Staking is not enabled in this connector/);
});

test('broadsheet redesign retains functioning support UI without export placeholders',()=>{
  const html=readFileSync(new URL('index.html',root),'utf8');
  assert.match(html,/class="masthead"/);
  assert.match(html,/class="cmyk-head/);
  assert.match(html,/id="code"/);
  assert.match(html,/id="governance"/);
  assert.doesNotMatch(html,/donation address — to add|Contact link — to add|no wallet connection|does not ask you to connect a wallet/);
  const css=readFileSync(new URL('style.css',root),'utf8');
  assert.match(css,/@font-face/);
  assert.match(css,/source-serif-4-latin-roman\.woff2/);
  assert.match(css,/source-serif-4-latin-italic\.woff2/);
  for(const name of ['source-serif-4-latin-roman.woff2','source-serif-4-latin-italic.woff2','OFL.txt'])assert.ok(existsSync(new URL('fonts/'+name,root)));
  assert.doesNotMatch(css,/@import|https?:\/\//);
});

test('hero field-note starts level with the headline instead of bottom-aligning the right panel',()=>{
  const css=readFileSync(new URL('style.css',root),'utf8');
  const rule=css.match(/\.field-note\{([^}]+)\}/)?.[1] || '';
  assert.match(rule,/align-self:start(?:;|$)/);
  assert.doesNotMatch(rule,/align-self:end/);
});

test('hero Tezos logo scales prominently on desktop without oversizing mobile',()=>{
  const css=readFileSync(new URL('style.css',root),'utf8');
  assert.match(css,/\.big-glyph\{font-size:clamp\(160px,20vw,320px\)\}/);
  assert.match(css,/\.field-note \.big-glyph\{margin-bottom:20px\}/);
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
