#!/usr/bin/env node
/* 반이 없어도 늘 보이는 강사 칸 EXTRA_COLS (2026-11-27 정리정독 예솔T).
 *   NODE_PATH=$(npm root -g) node tools/tt-extracol-test.js
 * 배경: 9/12 토 3:30 옛 '이 주만' 백양C 반이 같은 시간 확인 수업 카드를 완전히 덮어
 * 한쪽이 안 보이고 클릭도 못 했다. 오늘의 시간표·주차별 확대·전체 확대 세 그리드를 확인한다. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
// 페이지와 같은 한국 시간 기준 오늘 요일 (컨텍스트 timezoneId도 Asia/Seoul로 맞춘다)
const TODAY = new Intl.DateTimeFormat('ko-KR', { weekday: 'narrow', timeZone: 'Asia/Seoul' }).format(new Date());
const mk = (id, day, st, en, loc, t, cls, stu) => ({ id, day, start: st, end: en, loc, teacher: t, cls, students: stu });
const OTHER = TODAY === '토' ? '일' : '토';
const CLASSES = [
  mk('rA', TODAY, '5:30', '7:00', '정리정독', '은지', '정리정독 중2', ['가', '나']),
  mk('rB', OTHER, '3:30', '5:00', '본원', '슈', '고1 가', ['다']),
];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
  await ctx.route(/script\.google\.com|supabase\.co|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' }));
  await ctx.route(/fonts\.g/, r => r.abort());
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
  async function open(mode){
    const page = await ctx.newPage();
    await page.addInitScript(({ cls, mode }) => {
      sessionStorage.setItem('tt_mode', mode); sessionStorage.setItem('tt_book', '정규'); sessionStorage.removeItem('tt_allteacher');
      localStorage.setItem('ttc:list:정규', JSON.stringify({ t: Date.now(), d: { classes: cls, onceMoves: [] } }));
    }, { cls: CLASSES, mode });
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    return page;
  }
  const txt = (page, sel) => page.evaluate(s => [...document.querySelectorAll(s)].map(e => e.textContent).join('|'), sel);
  let page = await open('today');
  await page.waitForSelector('.grid.fitgrid .blk', { timeout: 15000 });
  ok('오늘: 예솔 열', (await page.evaluate(() => document.body.innerText)).indexOf('예솔') >= 0);
  await page.close();
  page = await open('week');
  await page.waitForSelector('.wk-mini', { timeout: 15000 });
  await page.evaluate((d) => { weekZoomDay = d; keepScroll = false; render(); }, TODAY);
  await page.waitForSelector('.wk-tgrid', { timeout: 5000 });
  ok('주차별 확대: 예솔T 열', (await txt(page, '.wk-th')).indexOf('예솔T') >= 0, await txt(page, '.wk-th'));
  await page.evaluate((d) => { weekZoomDay = d; keepScroll = false; render(); }, OTHER);
  await page.waitForTimeout(200);
  ok('반 없는 날도 정리정독 칸', (await txt(page, '.wk-th')).indexOf('예솔T') >= 0 && (await txt(page, '.wk-ch')).indexOf('정리정독') >= 0, await txt(page, '.wk-ch'));
  await page.evaluate(() => { allTeacher = '슈'; keepScroll = false; render(); });
  await page.waitForTimeout(200);
  ok('강사 거르기 중엔 숨김', (await txt(page, '.wk-th')).indexOf('예솔T') < 0);
  await page.evaluate(() => { allTeacher = ''; }); await page.close();
  page = await open('all');
  await page.waitForSelector('.wk-mini', { timeout: 15000 });
  await page.evaluate((d) => { allZoomDay = d; keepScroll = false; render(); }, TODAY);
  await page.waitForTimeout(200);
  ok('전체 확대: 예솔T 열', (await txt(page, '.wk-th')).indexOf('예솔T') >= 0);
  ok('강사 드롭다운에 예솔', await page.evaluate(() => allTeacherList().indexOf('예솔') >= 0));
  await page.close();
  console.log('통과 ' + pass + ' / 실패 ' + fail);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
