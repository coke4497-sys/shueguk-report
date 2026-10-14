#!/usr/bin/env node
/* 학생 페이지 별 선물 안내 — 별을 준 선생님 이름(050, 2026-10-14) 검증.
 *   NODE_PATH=$(npm root -g) node tools/star-giver-e2e.js
 * s.html renderStars 가 최근 보너스의 giver 로 '○○ 선생님이 별 n개를 선물하셨어요'를 그리고,
 * 이름이 없는 옛 기록은 '선생님이 …', 15일 넘은 기록은 안 보이는지 확인한다. */
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (m, c, x) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (x ? ' ' + x : ''))); };
(async () => {
  const srv = await new Promise(res => { const s = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, ''));
    fs.readFile(f, (e, b) => e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8' }), r.end(b)));
  }).listen(0, () => res(s)); });
  const port = srv.address().port;
  const br = await chromium.launch();
  const pg = await (await br.newContext()).newPage();
  let perr = 0; pg.on('pageerror', e => { perr++; console.log('  ✗ pageerror', e.message); });
  await pg.route('**/*', rt => rt.request().url().startsWith('http://127.0.0.1:' + port) ? rt.continue() : rt.fulfill({ status: 204, body: '' }));
  await pg.goto('http://127.0.0.1:' + port + '/s.html', { waitUntil: 'domcontentloaded' });
  const msg = latest => pg.evaluate(lb => {
    STATE.info = { name: '박보검', teacher: '이은지' };
    STATE.stars = { total: 5, breakdown: {}, latestBonus: lb };
    renderStars();
    const el = document.querySelector('#starSec .st-bonus');
    return el ? el.textContent : null;
  }, latest);
  const today = new Date().toISOString().slice(0, 10);
  let t = await msg({ stars: 2, reason: '수업 태도', date: today, giver: '김현지' });
  ok('준 선생님 이름', t && /김현지 선생님이 별 2개를 선물하셨어요 · 수업 태도/.test(t), t);
  ok('담당 강사(이은지)·수경쌤이 아님', t && !/이은지|수경쌤/.test(t), t);
  t = await msg({ stars: 1, reason: '', date: today, giver: '' });
  ok('이름 없는 옛 기록 — 선생님이', t && /^💝 선생님이 별 1개를 선물하셨어요$/.test(t.trim()), t);
  t = await msg({ stars: 1, reason: '', date: today, giver: '<b>x</b>' });
  ok('이름은 글자로만(태그 아님)', t && /<b>x<\/b> 선생님이/.test(t), t);
  t = await msg({ stars: 1, reason: '', date: '2026-01-01', giver: '김현지' });
  ok('15일 넘은 기록은 안 보임', t === null, t);
  ok('페이지 오류 없음', perr === 0);
  await br.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
