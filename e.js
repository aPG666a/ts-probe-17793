const { chromium, firefox } = require('playwright-core');
const fs = require('fs');
const SK = '0x4AAAAAAEGBqst_6XV04SLn';
const OUT = process.env.RUNNER_TEMP + '/out';
fs.mkdirSync(OUT, { recursive: true });
const log = s => fs.appendFileSync(OUT + '/log.txt', s + '\n');

async function tryOne(label, bt, args, url, extra) {
  let browser;
  try {
    browser = await bt.launch({ executablePath: bt === chromium ? '/usr/bin/google-chrome' : undefined, headless: false, args: args || [] });
  } catch (e) { log(label + ' LAUNCH_ERR ' + e); return; }
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York', ...(extra || {}) });
  const page = await ctx.newPage();
  page.on('response', async r => {
    const u = r.url();
    if (!/challenge-platform/.test(u)) return;
    let b = ''; try { b = (await r.text()).slice(0, 1500); } catch (e) { b = '<no body>'; }
    log(`${label} RESP ${r.status()} ${u.slice(0, 200)}\n   BODY: ${b.replace(/\s+/g, ' ').slice(0, 700)}`);
  });
  page.on('requestfailed', r => { if (/challenge/.test(r.url())) log(label + ' FAILED ' + r.url().slice(0, 150) + ' ' + (r.failure() || {}).errorText); });
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 }); } catch (e) { log(label + ' GOTO_ERR'); await browser.close(); return; }
  await page.waitForTimeout(3000);
  const res = await page.evaluate(async (sk) => {
    const out = { errs: [], tok: '', iframes: [] };
    for (let i = 0; i < 40 && !window.turnstile; i++) await new Promise(r => setTimeout(r, 500));
    if (!window.turnstile) { out.errs.push('NO_API'); return out; }
    const c = document.createElement('div'); c.id = 'xts'; c.style.cssText = 'width:320px;height:80px'; document.body.appendChild(c);
    try {
      window.turnstile.render('#xts', { sitekey: sk, appearance: 'always', size: 'flexible', callback: t => { out.tok = t; },
        'error-callback': e => out.errs.push(String(e)), 'timeout-callback': () => out.errs.push('TIMEOUT') });
    } catch (e) { out.errs.push('THROW:' + String(e).slice(0, 60)); }
    for (let i = 0; i < 55 && !out.tok; i++) { await new Promise(r => setTimeout(r, 1000)); if (i % 10 === 9) out.iframes.push([...document.querySelectorAll('iframe')].map(f => f.src.slice(0, 200))); }
    out.html = document.getElementById('xts').innerHTML.slice(0, 800);
    return out;
  }, SK);
  log(`${label} RES ${JSON.stringify(res).slice(0, 1500)}`);
  fs.writeFileSync(`${OUT}/${label}.html`, await page.content());
  if (res.tok) fs.writeFileSync(`${OUT}/TOKEN_${label}.txt`, res.tok);
  await browser.close();
}

(async () => {
  const A = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled',
    '--disable-features=ThirdPartyStoragePartitioning,TrackingProtection3pcd,PrivacySandboxSettings4'];
  await tryOne('edge_chrome', chromium, A, 'https://foxrouter.org/sign-in');
  await tryOne('edge_chrome_3pc_off', chromium, A, 'https://foxrouter.org/sign-in', { extraHTTPHeaders: {} });
  await tryOne('edge_firefox', firefox, [], 'https://foxrouter.org/sign-in');
  await tryOne('edge_chrome_plainhttp', chromium, A, 'http://foxrouter.org/sign-in');
  await tryOne('edge_chrome_www', chromium, A, 'https://www.foxrouter.org/sign-in');
  log('DONE');
})();
