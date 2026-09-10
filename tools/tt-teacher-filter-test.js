#!/usr/bin/env node
/* 전체 시간표 '강사별 보기' 드롭다운 검증 (timetable.html, 2026-09-10).
 *   NODE_PATH=$(npm root -g) node tools/tt-teacher-filter-test.js
 * 가짜 반 목록(localStorage 캐시)으로 실제 페이지를 띄워 — 드롭다운 구성·개요/요일 확대/시간 그리드/
 * 모바일 목록의 거르기·요약 문구·새로고침 유지·검색 이동 시 필터 해제를 확인한다. 네트워크는 전부 가짜 응답. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html;charset=utf-8' : 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
const mk = (id, day, st, en, loc, t, cls, stu) => ({ id, day, start: st, end: en, loc, teacher: t, cls, students: stu });
const CLASSES = [
  mk('r001','금','4:30','6:30','본원','승연','정리정독 중3',['김리한','방주원']),
  mk('r010','금','5:30','7:00','화정센터','지원','고1 가',['박지우','최민하','정서현']),
  mk('r020','토','2:00','3:30','본원','은지','중2 가',['이유림']),
  mk('r021','토','4:00','5:30','본원','은지','중2 나',['이유림','오하랑']),
  mk('r030','일','11:00','1:00','본원','슈','고3파이널A',['전민성']),
  mk('r031','일','1:30','3:30','정리정독','덕기','고1 나',['김강우']),
];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.route(/script\.google\.com|supabase\.co|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' }));
  await ctx.route(/fonts\.g/, r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await page.addInitScript(({ cls }) => {
    sessionStorage.setItem('tt_mode', 'all'); sessionStorage.setItem('tt_book', '정규');
    localStorage.setItem('ttc:list:정규', JSON.stringify({ t: Date.now(), d: { classes: cls, onceMoves: [] } }));
  }, { cls: CLASSES });
  await page.goto('http://127.0.0.1:' + port + '/timetable.html');
  await page.waitForSelector('#all-teacher', { timeout: 15000 });
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
  const opts = await page.$$eval('#all-teacher option', o => o.map(x => x.value));
  ok('옵션 = 모든 강사 + TEACHER_ORDER 순', JSON.stringify(opts) === JSON.stringify(['', '슈', '승연', '지원', '덕기', '은지']), JSON.stringify(opts));
  ok('처음엔 전체 카드 6개', (await page.$$('.wk-mini')).length === 6);
  // 강사 선택
  await page.selectOption('#all-teacher', '은지');
  await page.waitForFunction(() => document.querySelectorAll('.wk-mini').length === 2);
  const minis = await page.$$eval('.wk-mini small', s => s.map(x => x.textContent));
  ok('은지T 선택 → 카드 2개 모두 은지T', minis.length === 2 && minis.every(t => t.includes('은지T')), JSON.stringify(minis));
  ok('요약 문구 없음(반 n개·주 h시간 표기 제거)', !(await page.$('.tsel-note')));
  ok('드롭다운 on 표시', await page.$eval('#all-teacher', s => s.classList.contains('on')));
  ok('sessionStorage 저장', await page.evaluate(() => sessionStorage.getItem('tt_allteacher')) === '은지');
  // 요일 확대
  await page.click('.wk-mini');
  await page.waitForSelector('.wk-big');
  const ths = await page.$$eval('.wk-big .wk-th', s => s.map(x => x.textContent));
  const blks = await page.$$eval('.wk-big .blk', s => s.map(x => x.getAttribute('data-cid')));
  ok('확대: 강사 열 은지T만', JSON.stringify(ths) === JSON.stringify(['은지T']), JSON.stringify(ths));
  ok('확대: 반 블록 r020·r021', JSON.stringify(blks.sort()) === JSON.stringify(['r020', 'r021']), JSON.stringify(blks));
  const bars = await page.$$eval('.wk-slim .wk-bar', s => s.length);
  ok('옆 요일 막대는 은지T 반 없음 → 0', bars === 0, String(bars));
  // 확대 빈 요일 문구
  await page.evaluate(() => { allZoomDay = '금'; keepScroll = false; render(); });
  ok('빈 요일 문구에 강사 이름', (await page.textContent('.wk-big .wk-empty')).includes('은지T 수업이 없어요'));
  // 시간 그리드
  await page.evaluate(() => { sessionStorage.setItem('tt_allview', 'grid'); allZoomDay = null; render(); });
  await page.waitForSelector('.fullgrid');
  const gths = await page.$$eval('.stickhead .thead b', s => s.map(x => x.textContent));
  const gblk = await page.$$eval('.scrollwrap .blk', s => s.map(x => x.getAttribute('data-cid')));
  ok('그리드: 강사 열 전부 은지(월·화 빈 열 — 제외)', gths.length > 0 && gths.filter(t => t !== '—').every(t => t === '은지'), JSON.stringify(gths));
  ok('그리드: 반 블록 r020·r021', JSON.stringify(gblk.sort()) === JSON.stringify(['r020', 'r021']), JSON.stringify(gblk));
  await page.evaluate(() => { sessionStorage.setItem('tt_allview', 'ov'); render(); });
  // 검색 결과 → 다른 강사 반이면 필터 해제
  await page.evaluate(() => gotoSearchHit('r010'));
  await page.waitForFunction(() => !sessionStorage.getItem('tt_allteacher') && document.querySelector('.blk[data-cid="r010"]'), null, { timeout: 5000 });
  ok('검색 이동: 필터 풀리고 지원T 반으로 확대', await page.evaluate(() => allTeacher === '' && allZoomDay === '금'));
  ok('드롭다운도 모든 강사로', (await page.inputValue('#all-teacher')) === '');
  // 새로고침 뒤 유지
  await page.waitForTimeout(400);   // 검색 이동의 rAF 연쇄가 끝난 뒤
  await page.selectOption('#all-teacher', '슈');
  await page.reload(); await page.waitForSelector('#all-teacher');
  const rv = await page.inputValue('#all-teacher'), rn = (await page.$$('.wk-mini')).length, rt = await page.evaluate(() => [allTeacher, sessionStorage.getItem('tt_allteacher'), allView(), allZoomDay]);
  ok('새로고침 뒤 유지(슈)', rv === '슈' && rn === 1, rv + ' minis=' + rn + ' ' + JSON.stringify(rt));
  // 모바일 목록
  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => { keepScroll = false; render(); });
  await page.waitForSelector('#all-teacher');
  await page.evaluate(() => { allListDay = '일'; setAllTeacher('덕기'); });
  await page.waitForFunction(() => document.querySelectorAll('.daylist .blk, .blk').length >= 1);
  const mob = await page.$$eval('.blk', s => s.map(x => x.getAttribute('data-cid')));
  const listMode = await page.evaluate(() => useListView());
  ok('모바일(목록 보기) 덕기T → r031만', listMode ? JSON.stringify(mob) === JSON.stringify(['r031']) : mob.indexOf('r031') >= 0, JSON.stringify(mob) + ' list=' + listMode);
  
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.evaluate(() => { setAllTeacher('은지'); });
  await page.waitForSelector('.wk-mini');
  
  console.log('통과 ' + pass + ' / 실패 ' + fail);
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
