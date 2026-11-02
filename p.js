const { chromium } = require('playwright-core');
const fs = require('fs');
const T = process.env.RUNNER_TEMP;
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, locale: 'en-US', timezoneId: 'America/New_York' });
  const page = await ctx.newPage();
  page.on('console', m => console.log('CONSOLE', m.type(), m.text().slice(0, 300)));
  page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0, 200)));
  page.on('response', async r => {
    const u = r.url();
    if (/challenge-platform|challenges\.cloudflare|turnstile/.test(u)) {
      let b = ''; try { b = (await r.text()).slice(0, 400); } catch (e) {}
      console.log('RESP', r.status(), u.slice(0, 180), b.replace(/\s+/g, ' ').slice(0, 250));
    }
  });
  await page.goto(process.env.URL || 'https://foxrouter.org/sign-in', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('TITLE', await page.title());
  let token = ''; const t0 = Date.now();
  while (Date.now() - t0 < 100000) {
    token = await page.evaluate(() => {
      const el = document.querySelector('input[name="cf-turnstile-response"]');
      if (el && el.value) return el.value;
      try { if (window.turnstile) { const r = window.turnstile.getResponse(); if (r) return r; } } catch (e) {}
      return '';
    });
    if (token) break;
    await page.waitForTimeout(2000);
  }
  console.log('ELAPSED', Date.now() - t0, 'TOKEN_LEN', token.length);
  console.log('TOKEN=' + token);
  fs.writeFileSync(T + '/page.html', await page.content());
  await page.screenshot({ path: T + '/shot.png' });
  await browser.close();
  if (token) fs.writeFileSync(T + '/token.txt', token);
})();
