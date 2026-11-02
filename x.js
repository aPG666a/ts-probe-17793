const { chromium } = require('playwright-core');
const fs = require('fs');
const SK = '0x4AAAAAAEGBqst_6XV04SLn';
const T = process.env.RUNNER_TEMP;
const targets = [
  ['edge_signin', 'https://foxrouter.org/sign-in'],
  ['src3000_ip', 'http://63.141.242.130:3000/sign-in'],
  ['ip80', 'http://63.141.242.130/'],
  ['apihost80', 'http://api.foxrouter.org/'],
];
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York' });
  for (const [name, url] of targets) {
    const page = await ctx.newPage();
    const pats = [];
    page.on('response', async r => { const u = r.url(); if (/challenge-platform\/h\/g\/(pat|fo)/.test(u)) pats.push(r.status() + ' ' + u.slice(0, 90)); });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) { console.log(name, 'GOTO_ERR', String(e).slice(0, 120)); await page.close(); continue; }
    console.log('==', name, url, 'origin=', await page.evaluate(() => location.origin), 'title=', await page.title());
    const res = await page.evaluate(async (SK) => {
      const out = { errs: [], tok: '', api: !!window.turnstile, container: false };
      const c = document.createElement('div');
      c.id = 'xts';
      document.body.appendChild(c);
      out.container = true;
      if (!window.turnstile) { await new Promise(r => setTimeout(r, 4000)); }
      out.api2 = !!window.turnstile;
      if (!window.turnstile) return out;
      try {
        window.turnstile.render('#xts', { sitekey: SK, callback: t => { out.tok = t; },
          'error-callback': e => out.errs.push(String(e)), 'timeout-callback': () => out.errs.push('TIMEOUT'),
          'unsupported-callback': () => out.errs.push('UNSUPPORTED') });
      } catch (e) { out.errs.push('THROW:' + String(e).slice(0, 80)); }
      for (let i = 0; i < 30 && !out.tok; i++) await new Promise(r => setTimeout(r, 2000));
      out.html = document.getElementById('xts').innerHTML.slice(0, 400);
      return out;
    }, SK);
    console.log(name, 'RESULT', JSON.stringify(res).slice(0, 700));
    console.log(name, 'PATS', pats.slice(0, 6).join(' | '));
    fs.writeFileSync(`${T}/x_${name}.html`, await page.content());
    await page.close();
  }
  await browser.close();
})();
