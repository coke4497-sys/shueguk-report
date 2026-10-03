#!/usr/bin/env node
/* 오늘의 시간표·주차별 '센터별·강사별 보기' 검증 (timetable.html, 2026-10-03 사용자 요청
 *   "오늘의 시간표, 주차별 시간표에 각 센터만 보는 기능, 담당 선생님별 수업만 보는 기능")
 *   NODE_PATH=$(npm root -g) node tools/tt-viewfilter-test.js
 * 가짜 반 목록(localStorage 캐시)으로 실제 페이지를 띄워 — 드롭다운 구성·카드/강사 열/센터 묶음
 * 거르기·출석 요약·빈 안내·휴대폰 목록·새로고침 유지·전체 시간표와 강사 공유·검색 해제를 확인한다. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
const TODAY = new Intl.DateTimeFormat('ko-KR', { weekday: 'narrow', timeZone: 'Asia/Seoul' }).format(new Date());
const OTHER = { '월':'화','화':'수','수':'목','목':'금','금':'토','토':'일','일':'월' }[TODAY];
const mk = (id, day, st, en, loc, t, cls, stu) => ({ id, day, start: st, end: en, loc, teacher: t, cls, students: stu });
const CLASSES = [
  mk('r01', TODAY, '5:30', '7:00', '본원', '승연', '고2 가', ['가나', '다라']),
  mk('r02', TODAY, '7:00', '9:00', '본원', '은지', '중2 나', ['마바']),
  mk('r03', TODAY, '5:30', '7:00', '화정센터', '지원', '고1 가', ['사아', '자차']),
  mk('r04', TODAY, '2:00', '4:00', '정리정독', '덕기', '고1 나', ['카타']),
  mk('r05', OTHER, '3:00', '5:00', '민트초코', '현지', '중3 가', ['파하']),   // 오늘은 수업 없는 센터
];
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const b = await chromium.launch();
  async function open(ctx, mode, pre){
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGE ERROR', e.message));
    await page.addInitScript(({ cls, mode, pre }) => {
      sessionStorage.setItem('tt_mode', mode); sessionStorage.setItem('tt_book', '정규');
      sessionStorage.setItem('tt_vmopen', '0'); sessionStorage.setItem('tt_chopen', '0');
      Object.keys(pre || {}).forEach(k => sessionStorage.setItem(k, pre[k]));
      localStorage.setItem('ttc:list:정규', JSON.stringify({ t: Date.now(), d: { classes: cls, onceMoves: [] } }));
    }, { cls: CLASSES, mode, pre: pre || {} });
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    await page.waitForSelector('.vfil', { timeout: 15000 });
    await page.waitForTimeout(500);
    return page;
  }
  const wide = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
  await wide.route(/script\.google\.com|supabase\.co|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' }));
  await wide.route(/fonts\.g/, r => r.abort());

  /* ① 오늘의 시간표 — 드롭다운 구성 */
  let page = await open(wide, 'today');
  const locOpts = await page.$$eval('#vf-loc option', o => o.map(x => x.value));
  const locTxt = await page.$$eval('#vf-loc option', o => o.map(x => x.textContent));
  ok('오늘: 센터 드롭다운 = 모든 센터 + 센터 순서', JSON.stringify(locOpts) === JSON.stringify(['', '본원', '화정센터', '민트초코', '정리정독']), JSON.stringify(locOpts));
  ok('오늘: 민트초코는 민초센터로 표기', locTxt.indexOf('민초센터') >= 0, JSON.stringify(locTxt));
  ok('오늘: 강사 드롭다운도 함께', (await page.$$('#vf-teacher option')).length === 6);
  ok('오늘: 처음엔 카드 4개', (await page.$$('.grid.fitgrid .blk')).length === 4);
  ok('오늘: 처음엔 [모두 보기] 없음', !(await page.$('.vfil-clear')));

  /* ② 센터만 보기 */
  await page.selectOption('#vf-loc', '본원');
  await page.waitForFunction(() => document.querySelectorAll('.grid.fitgrid .blk').length === 2);
  let cids = await page.$$eval('.grid.fitgrid .blk', e => e.map(x => x.getAttribute('data-cid')).sort());
  let ths = await page.$$eval('.stickhead .thead b', e => e.map(x => x.textContent));
  ok('오늘: 본원 수업만 r01·r02', JSON.stringify(cids) === JSON.stringify(['r01', 'r02']), JSON.stringify(cids));
  ok('오늘: 강사 열도 본원 강사만', JSON.stringify(ths.slice().sort()) === JSON.stringify(['승연', '은지']), JSON.stringify(ths));
  ok('오늘: 드롭다운 on 표시', await page.$eval('#vf-loc', s => s.classList.contains('on')));
  ok('오늘: sessionStorage 저장', await page.evaluate(() => sessionStorage.getItem('tt_vloc')) === '본원');
  ok('오늘: [모두 보기] 버튼 생김', !!(await page.$('.vfil-clear')));

  /* ③ 센터 + 강사 함께 */
  await page.selectOption('#vf-teacher', '은지');
  await page.waitForFunction(() => document.querySelectorAll('.grid.fitgrid .blk').length === 1);
  cids = await page.$$eval('.grid.fitgrid .blk', e => e.map(x => x.getAttribute('data-cid')));
  ths = await page.$$eval('.stickhead .thead b', e => e.map(x => x.textContent));
  ok('오늘: 본원 + 은지T = r02만', JSON.stringify(cids) === JSON.stringify(['r02']), JSON.stringify(cids));
  ok('오늘: 강사 열 하나', JSON.stringify(ths) === JSON.stringify(['은지']), JSON.stringify(ths));

  /* ④ 출석 요약도 보이는 수업만 */
  await page.evaluate(() => {
    attend[attKey('r01', '가나')] = { status: '출석', memo: '' };
    attend[attKey('r02', '마바')] = { status: '지각', memo: '늦음' };
    keepScroll = false; render();
  });
  let sum = await page.textContent('.today-sum');
  ok('오늘: 요약이 은지T 반 것만(출석 0 · 지각 1)', /출석\s*0/.test(sum) && /지각\s*1/.test(sum), sum);
  await page.evaluate(() => { setViewLoc(''); });
  await page.waitForTimeout(100);
  await page.selectOption('#vf-teacher', '');
  await page.waitForFunction(() => document.querySelectorAll('.grid.fitgrid .blk').length === 4);
  sum = await page.textContent('.today-sum');
  ok('오늘: 거르기를 풀면 요약도 전부(출석 1 · 지각 1)', /출석\s*1/.test(sum) && /지각\s*1/.test(sum), sum);

  /* ⑤ 그 날 수업이 없는 센터 → 안내 문구 */
  await page.selectOption('#vf-loc', '민트초코');
  await page.waitForSelector('.empty-day');
  ok('오늘: 빈 안내에 센터 이름', (await page.textContent('.empty-day')).includes('민초센터 수업이 없어요'), await page.textContent('.empty-day'));
  ok('오늘: 빈 화면에도 거르기 줄은 남는다', !!(await page.$('#vf-loc')));
  await page.click('.vfil-clear');
  await page.waitForFunction(() => document.querySelectorAll('.grid.fitgrid .blk').length === 4);
  ok('오늘: [모두 보기]로 전부 복원', await page.evaluate(() => viewLoc === '' && allTeacher === '' && !sessionStorage.getItem('tt_vloc')));
  await page.close();

  /* ⑥ 주차별 개요 */
  page = await open(wide, 'week');
  ok('주차별: 거르기 줄이 주차 이동 줄 아래', await page.evaluate(() => {
    var n = document.querySelector('.weeknav-tt'), v = document.querySelector('.vfil');
    return !!n && !!v && (n.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
  }));
  const miniAll = await page.$$eval('.wk-mini', e => e.length);
  await page.selectOption('#vf-loc', '화정센터');
  await page.waitForFunction(() => document.querySelectorAll('.wk-mini').length === 1);
  let ctrs = await page.$$eval('.wk-ctr', e => e.map(x => x.textContent));
  ok('주차별 개요: 처음엔 카드 5개', miniAll === 5, String(miniAll));
  ok('주차별 개요: 화정센터 카드 1개', (await page.$$('.wk-mini')).length === 1);
  ok('주차별 개요: 센터 라벨도 화정센터만', JSON.stringify(ctrs) === JSON.stringify(['화정센터']), JSON.stringify(ctrs));

  /* ⑦ 주차별 확대 */
  await page.click('.wk-mini');
  await page.waitForSelector('.wk-big');
  let zths = await page.$$eval('.wk-big .wk-th', e => e.map(x => x.textContent));
  let zblk = await page.$$eval('.wk-big .blk', e => e.map(x => x.getAttribute('data-cid')));
  ok('확대: 강사 열 지원T만', JSON.stringify(zths) === JSON.stringify(['지원T']), JSON.stringify(zths));
  ok('확대: 반 블록 r03만', JSON.stringify(zblk) === JSON.stringify(['r03']), JSON.stringify(zblk));
  ok('확대: 옆 요일 막대도 거른다', (await page.$$('.wk-slim .wk-bar')).length === 0);
  await page.selectOption('#vf-loc', '민트초코');
  await page.waitForFunction(() => !!document.querySelector('.wk-big .wk-empty'));
  ok('확대: 빈 요일 문구에 센터 이름', (await page.textContent('.wk-big .wk-empty')).includes('민초센터 수업이 없어요'));
  /* ⑧ 강사만 보기 */
  await page.evaluate(() => { setViewLoc(''); });
  await page.waitForTimeout(150);
  await page.selectOption('#vf-teacher', '승연');
  await page.waitForFunction(() => document.querySelectorAll('.wk-big .blk').length === 1);
  zblk = await page.$$eval('.wk-big .blk', e => e.map(x => x.getAttribute('data-cid')));
  ok('확대: 승연T 반만 r01', JSON.stringify(zblk) === JSON.stringify(['r01']), JSON.stringify(zblk));
  ok('확대: 센터 제목도 본원 하나', (await page.$$eval('.wk-big .wk-ch', e => e.map(x => x.textContent))).join() === '본원');

  /* ⑨ 검색 — 가려진 수업이면 거르기를 푼다 */
  await page.evaluate(() => gotoSearchHit('r03'));
  await page.waitForFunction(() => !!document.querySelector('.blk[data-cid="r03"]'), null, { timeout: 5000 });
  ok('검색: 거르기가 풀리고 그 수업으로', await page.evaluate(() => allTeacher === '' && viewLoc === ''));
  ok('검색: 드롭다운도 모두 보기로', (await page.inputValue('#vf-teacher')) === '' && (await page.inputValue('#vf-loc')) === '');
  await page.close();

  /* ⑩ 전체 시간표에서 고른 강사가 오늘·주차별에도 이어진다 + 새로고침 유지 */
  page = await open(wide, 'today', { tt_allteacher: '지원', tt_vloc: '화정센터' });
  ok('유지: 새로고침 뒤에도 센터·강사 그대로', (await page.inputValue('#vf-loc')) === '화정센터' && (await page.inputValue('#vf-teacher')) === '지원');
  ok('유지: 카드 1개(r03)', (await page.$$eval('.grid.fitgrid .blk', e => e.map(x => x.getAttribute('data-cid')))).join() === 'r03');
  await page.evaluate(() => setMode('all'));
  await page.waitForSelector('#all-teacher');
  ok('전체 시간표도 같은 강사 값', (await page.inputValue('#all-teacher')) === '지원');
  ok('전체 시간표는 센터를 거르지 않는다', (await page.$$('.wk-mini')).length === 1);   // 지원T 반 하나
  await page.close();

  /* ⑪ 휴대폰 목록 보기 */
  const narrow = await b.newContext({ viewport: { width: 390, height: 780 }, timezoneId: 'Asia/Seoul' });
  await narrow.route(/script\.google\.com|supabase\.co|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' }));
  await narrow.route(/fonts\.g/, r => r.abort());
  page = await open(narrow, 'today');
  await page.selectOption('#vf-loc', '본원');
  await page.waitForFunction(() => document.querySelectorAll('.daylist .blk').length === 2);
  ok('휴대폰 오늘 목록: 본원 카드 2개', (await page.$$('.daylist .blk')).length === 2);
  ok('휴대폰 오늘 목록: 센터 제목도 본원만', (await page.$$eval('.daylist .dl-time', e => e.map(x => x.textContent))).join() === '본원');
  await page.close();
  page = await open(narrow, 'week', { tt_vloc: '본원' });
  await page.waitForTimeout(400);
  const wtimes = await page.$$eval('.daylist .dl-time', e => e.map(x => x.textContent));
  ok('휴대폰 주차별 목록: 센터 제목 본원만', wtimes.length > 0 && wtimes.every(t => t === '본원'), JSON.stringify(wtimes));
  await page.close();

  await b.close(); srv.close();
  console.log(fail ? ('통과 ' + pass + ' / 실패 ' + fail) : ('✓ ' + pass + '건 통과'));
  process.exit(fail ? 1 : 0);
})();
