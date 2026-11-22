#!/usr/bin/env node
/* 내신대비 피드백 시험범위 — 교과서 목차 고르기 검증 (naeshin.html + textbook-toc.js, 2026-10-26 원장님 "교과서 내 범위는 드롭다운 선택 추가, 교과서외는 직접 기록").
 *   LC_ALL=C.UTF-8 NODE_PATH=$(npm root -g) node tools/naeshin-scope-e2e.js   (SHOT=폴더 면 캡처)
 * 가짜 백엔드로 실제 페이지를 띄워: 반이름 괄호(천재수 공통국어2)·학교로 교과서 자동 선택, 대단원 모두 더하기, 칩 빼기, 저장 본문(naeshinSet 범위·공유 키), 목록에 없는 교과서 → 직접 적기 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), SHOT = process.env.SHOT || '';
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };
const srv = http.createServer((req, res) => { const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }).listen(0);
const port = srv.address().port;
const CLASSES = [{ id: 'n001', day: '수', start: '5:30', end: '7:00', loc: '화정센터', teacher: '지원', cls: '고1 화정A(천재수 공통국어2)', students: ['김철수', '이영희'] }];
const PERIODS = ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04'].map(w => ({ week: w, book: '내신' }));
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const posts = [];
  await ctx.route(/supabase\.co/, r => r.fulfill({ status: 401, body: '{}' }));
  await ctx.route(/script\.google\.com|googleusercontent/, r => {
    const u = r.request().url(); let body = { result: 'error' };
    if (r.request().method() === 'POST'){ try { posts.push(JSON.parse(r.request().postData())); } catch (e) {} body = { result: 'success' }; }
    else if (/action=ttPeriodList/.test(u)) body = { result: 'success', periods: PERIODS };
    else if (/action=timetableList/.test(u)) body = { result: 'success', classes: CLASSES };
    else if (/action=naeshinGet/.test(u)) body = { result: 'success', scope: '', weeks: {}, notes: {}, cleared: {}, hwdone: {} };
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await ctx.route(/fonts\.g/, r => r.abort());
  const page = await ctx.newPage(); page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('http://127.0.0.1:' + port + '/naeshin.html');
  await page.waitForFunction(() => document.querySelectorAll('#f-class option').length >= 1, null, { timeout: 15000 });
  await page.selectOption('#f-class', 'n001');
  await page.waitForSelector('#ns-toc select.toc-unit', { timeout: 10000 });
  let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
  let r = await page.evaluate(() => ({ book: document.querySelector('#ns-toc .toc-book').value, txt: document.querySelector('#ns-toc .toc-book option:checked').textContent, oldIn: !!document.getElementById('ns-in'), out: !!document.querySelector('#ns-outp .toc-area') && !document.getElementById('ns-out'), lab: [...document.querySelectorAll('#panel label')].slice(1, 3).map(x => x.textContent) }));
  ok('내신대비 피드백: 교과서 목차 고르기(천재수 공통국어2 → T2) · 옛 입력칸 없음 · 교과서 외 범위 칸', r.book === 'T2' && /천재\(김수학\) 공통국어2/.test(r.txt) && !r.oldIn && r.out && /교과서 내 범위/.test(r.lab[0]) && /교과서 외 범위/.test(r.lab[1]), JSON.stringify(r));
  await page.selectOption('#ns-toc .toc-unit', '__u|1|주체적으로 감상하기, 비판적으로 읽기'.replace(/\|.*$/, '') ).catch(() => {});
  const grp = await page.evaluate(() => [...document.querySelectorAll('#ns-toc .toc-unit option')].map(o => o.value).find(v => /^__u\|/.test(v)));
  await page.selectOption('#ns-toc .toc-unit', grp);
  r = await page.evaluate(() => [...document.querySelectorAll('#ns-toc .toc-chip')].map(x => x.firstChild.textContent));
  ok('"1단원 남은 n개 모두 더하기" → 그 대단원 항목이 모두 칩으로', r.length >= 3 && r.every(x => /^1[(단]/.test(x)), JSON.stringify(r));
  await page.click('#ns-toc .toc-chip button');
  const n1 = r.length; r = await page.evaluate(() => [...document.querySelectorAll('#ns-toc .toc-chip')].map(x => x.firstChild.textContent));
  ok('칩 ×로 하나 빼기', r.length === n1 - 1);
  await page.selectOption('#ns-outp .toc-area', '문법');
  await page.fill('#ns-outp .toc-title', '학습지 4~6');
  await page.press('#ns-outp .toc-title', 'Enter');
  await page.evaluate(() => saveScope());
  await page.waitForFunction(() => /시험범위 저장 완료/.test(document.getElementById('status').textContent), null, { timeout: 8000 }).catch(() => {});
  const p = posts.find(x => x.action === 'naeshinSet' && x.kind === '범위');
  const t1 = p && JSON.parse(p.text1);
  ok('저장 = naeshinSet(범위, 공유 키) · 교과서 천재 공통국어2 · 교과서 내 범위 = 고른 줄 · 외 범위 = [영역] 제목', p && p.scopeKey === '공유:고1|화정' && t1 && t1.book === '천재 공통국어2' && t1.inRange.split('\n').length === r.length && t1.outRange === '[문법] 학습지 4~6', JSON.stringify(p));
  await page.evaluate(() => window.scrollTo(0, 0));
  if (SHOT){ const card = await page.$('#panel .card'); await card.screenshot({ path: path.join(SHOT, '5-내신대비피드백-시험범위-목차고르기.png') }); }
  // 목록에 없는 교과서 → 직접 적기
  await page.selectOption('#ns-toc .toc-book', '');
  r = await page.evaluate(() => ({ free: !!document.querySelector('#ns-toc .toc-free'), name: !!document.querySelector('#ns-toc .toc-bookname') }));
  ok('목록에 없는 교과서 → 교과서 이름 칸 + 직접 적는 칸', r.free && r.name, JSON.stringify(r));
  console.log('통과 ' + pass + ' / 실패 ' + fail);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
