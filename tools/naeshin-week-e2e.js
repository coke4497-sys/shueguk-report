#!/usr/bin/env node
/* 내신대비 피드백 — 반을 열 때 기본 주차 브라우저 검증 (naeshin.html, 2026-09-10).
 *   NODE_PATH=$(npm root -g) node tools/naeshin-week-e2e.js
 * 가짜 백엔드 응답으로 실제 페이지를 띄워: 기본 주차 = 지난 내신 주, 손으로 고른 주차는 같은 날
 * 다른 반에서도 유지, 다른 주에 기억한 값은 버림. 규칙 자체는 tools/naeshin-week-test.js. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
const CLASSES = [
  { id: 'n001', day: '수', start: '5:30', end: '7:00', loc: '화정센터', teacher: '지원', cls: '고1 화정A(비상)', students: ['김철수', '이영희'] },
  { id: 'n002', day: '목', start: '5:30', end: '7:00', loc: '화정센터', teacher: '지원', cls: '고1 화정B(비상)', students: ['박민수'] },
];
const PERIODS = ['2026-08-26', '2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23'].map(w => ({ week: w, book: '내신' }));
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route(/supabase\.co/, r => r.fulfill({ status: 401, body: '{}' }));   // 어댑터 실패 → 옛 백엔드 경로
  await ctx.route(/script\.google\.com|googleusercontent/, r => {
    const u = r.request().url();
    let body = { result: 'error' };
    if (/action=ttPeriodList/.test(u)) body = { result: 'success', periods: PERIODS };
    else if (/action=timetableList/.test(u)) body = { result: 'success', classes: CLASSES };
    else if (/action=naeshinGet/.test(u)) body = { result: 'success', scope: '', weeks: { '2026-08-26': { prog: '1단원', hw: '' } }, notes: {}, cleared: {}, hwdone: {} };
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await ctx.route(/fonts\.g/, r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('http://127.0.0.1:' + port + '/naeshin.html');
  await page.waitForFunction(() => document.querySelectorAll('#f-class option').length >= 2, null, { timeout: 15000 });
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
  await page.selectOption('#f-class', 'n001');
  await page.waitForSelector('#wk-sel');
  const opts = await page.$$eval('#wk-sel option', o => o.map(x => x.value));
  ok('주차 목록 = 캘린더 내신 주 5개', opts.length === 5, JSON.stringify(opts));
  ok('반을 열면 기본 주차 = 9/2 (오늘 9/10, 9/9 주의 직전 주)', (await page.inputValue('#wk-sel')) === '2026-09-02', await page.inputValue('#wk-sel'));
  // 손으로 다른 주차를 고른 뒤 다른 반을 열면 그 주차 유지
  await page.selectOption('#wk-sel', '2026-08-26');
  await page.selectOption('#f-class', 'n002');
  await page.waitForFunction(() => document.querySelector('#wk-sel') && document.querySelector('#wk-sel').value === '2026-08-26', null, { timeout: 5000 }).catch(() => {});
  ok('손으로 고른 8/26이 다른 반에서도 유지', (await page.inputValue('#wk-sel')) === '2026-08-26', await page.inputValue('#wk-sel'));
  ok('sessionStorage 에 기억(날짜 포함)', await page.evaluate(() => { const o = JSON.parse(sessionStorage.getItem('ns_week')); return o && o.w === '2026-08-26' && o.wed === '2026-09-09'; }));
  // 기억이 다른 주의 것이면 무시하고 기본 주차
  await page.evaluate(() => sessionStorage.setItem('ns_week', JSON.stringify({ w: '2026-08-26', wed: '2026-09-02' })));
  await page.selectOption('#f-class', 'n001');
  await page.waitForFunction(() => document.querySelector('#wk-sel') && document.querySelector('#wk-sel').value === '2026-09-02', null, { timeout: 5000 }).catch(() => {});
  ok('지난주에 기억한 주차는 버리고 기본 주차(9/2)', (await page.inputValue('#wk-sel')) === '2026-09-02', await page.inputValue('#wk-sel'));
  console.log('통과 ' + pass + ' / 실패 ' + fail);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
