const { chromium, firefox } = require('playwright-core');
const fs = require('fs');
const SK = '0x4AAAAAAEGBqst_6XV04SLn';
const TEST_SK = '1x00000000000000000000AA';
const T = process.env.RUNNER_TEMP;

async function tryOne(label, browserType, args, url, sitekey, extra) {
  let browser;
  try {
    browser = await browserType.launch({ executablePath: browserType === chromium ? '/usr/bin/google-chrome' : undefined,
      headless: false, args: args || [] });
  } catch (e) { console.log(label, 'LAUNCH_ERR', String(e).slice(0, 150)); return; }
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York', ...(extra || {}) });
  const page = await ctx.newPage();
  const log = [];
  page.on('response', async r => {
    const u = r.url();
    if (!/challenge-platform/.test(u)) return;
    let b = ''; try { b = (await r.text()).slice(0, 600); } catch (e) {}
    log.push(r.status() + ' ' + r.request().method() + ' ' + u.slice(60, 150) + ' :: ' + b.replace(/\s+/g, ' ').slice(0, 300));
  });
  page.on('requestfailed', r => { if (/challenge/.test(r.url())) log.push('FAILED ' + r.url().slice(60, 120) + ' ' + (r.failure() || {}).errorText); });
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 }); } catch (e) { console.log(label, 'GOTO_ERR'); await browser.close(); return; }
  const res = await page.evaluate(async (sk) => {
    const out = { errs: [], tok: '' };
    for (let i = 0; i < 40 && !window.turnstile; i++) await new Promise(r => setTimeout(r, 500));
    if (!window.turnstile) { out.errs.push('NO_API'); return out; }
    const c = document.createElement('div'); c.id = 'xts'; document.body.appendChild(c);
    try {
      window.turnstile.render('#xts', { sitekey: sk, callback: t => { out.tok = t; },
        'error-callback': e => out.errs.push(String(e)), 'timeout-callback': () => out.errs.push('TIMEOUT') });
    } catch (e) { out.errs.push('THROW:' + String(e).slice(0, 60)); }
    for (let i = 0; i < 35 && !out.tok; i++) await new Promise(r => setTimeout(r, 1000));
    return out;
  }, sitekey);
  console.log(label, 'RES', JSON.stringify(res).slice(0, 300));
  if (res.errs.length || !res.tok) console.log(label, 'NET', log.slice(0, 8).join('\n   '));
  if (res.tok) fs.writeFileSync(`${T}/tok_${label}.txt`, res.tok);
  await browser.close();
}

(async () => {
  const cookieArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled',
    '--disable-features=ThirdPartyStoragePartitioning,TrackingProtection3pcd,PrivacySandboxSettings4'];
  await tryOne('testkey_edge', chromium, cookieArgs, 'https://foxrouter.org/sign-in', TEST_SK);
  await tryOne('realkey_edge_3pc', chromium, cookieArgs, 'https://foxrouter.org/sign-in', SK);
  await tryOne('realkey_edge_plain', chromium, ['--no-sandbox', '--disable-dev-shm-usage'], 'https://foxrouter.org/sign-in', SK);
  await tryOne('realkey_firefox', firefox, [], 'https://foxrouter.org/sign-in', SK);
})();
