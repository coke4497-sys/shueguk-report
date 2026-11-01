#!/usr/bin/env node
/* 적용일 변경 검증 (timetable.html, 2026-11-01 원장님 — 정연주T 반을 11/7부터 슈T로, 고3파이널은 11/7부터 없음,
 * 그 전 날짜의 시간표는 그대로) — NODE_PATH=$(npm root -g) LC_ALL=C.UTF-8 node tools/tt-span-test.js
 * 가짜 반 목록(캐시) + window.__ttSpans로 오늘(변경 전)·다음 주(변경 뒤)·전체 시간표를 확인한다. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
const kst = new Date(Date.now() + 9 * 3600e3);
const ymd = d => d.toISOString().slice(0, 10);
const TODAY = ['일','월','화','수','목','금','토'][kst.getUTCDay()];
const TOM = ymd(new Date(kst.getTime() + 86400e3));   // 변경일 = 내일
const mk = (id, t, loc, cls, stu) => ({ id, day: TODAY, start: '5:30', end: '7:00', loc, teacher: t, cls, students: stu });
const CLASSES = [
  mk('r01', '연주', '민트초코', '고2 가', ['가나', '다라']),   // 내일부터 슈T·본원
  mk('r02', '슈', '본원', '고3파이널A', ['마바']),              // 내일부터 없음
  mk('r03', '지원', '화정센터', '고1 가', ['사아']),
];
const SPANS = { '정규': {
  r01: [{ d: TOM, before: { teacher: '연주', location: '민트초코' }, after: { teacher: '슈', location: '본원' } }],
  r02: [{ d: TOM, end: true, snap: null }],
  r09: [{ d: TOM, end: true, snap: { day: TODAY, start: '7:00', end: '9:00', location: '본원', teacher: '슈', name: '고3파이널Z', roster: '자차 카타' } }],
} };
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
  await ctx.route(/script\.google\.com|supabase\.co|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' }));
  await ctx.route(/fonts\.g/, r => r.abort());
  async function open(mode){
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGE ERROR', e.message));
    await page.addInitScript(({ cls, sp, mode }) => {
      sessionStorage.setItem('tt_mode', mode); sessionStorage.setItem('tt_book', '정규');
      sessionStorage.setItem('tt_vmopen', '0'); sessionStorage.setItem('tt_chopen', '0');
      localStorage.setItem('ttc:list:정규', JSON.stringify({ t: Date.now(), d: { classes: cls, onceMoves: [] } }));
      window.__ttSpans = sp;
    }, { cls: CLASSES, sp: SPANS, mode });
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    await page.waitForSelector('.vfil', { timeout: 15000 });
    await page.waitForTimeout(500);
    return page;
  }
  /* ① 오늘(변경 전) — 옛 담당·종강 전 반·지운 반(snap)까지 */
  let page = await open('today');
  let cids = await page.$$eval('.grid.fitgrid .blk', e => e.map(x => x.getAttribute('data-cid')).sort());
  let ths = await page.$$eval('.stickhead .thead b', e => e.map(x => x.textContent).sort());
  ok('오늘: 네 반(지운 r09도 snap으로)', JSON.stringify(cids) === JSON.stringify(['r01','r02','r03','r09']), JSON.stringify(cids));
  ok('오늘: 강사 열 = 연주·슈·지원', JSON.stringify(ths) === JSON.stringify(['슈','연주','지원']), JSON.stringify(ths));
  ok('오늘: r01은 연주 열', await page.evaluate(() => classesOn(viewYmd()).find(c => c.id === 'r01').teacher === '연주'));
  ok('오늘: snap 반 명단', await page.evaluate(() => classesOn(viewYmd()).find(c => c.id === 'r09').students.join() === '자차,카타'));
  /* ② 변경일(내일) 기준 */
  const after = await page.evaluate(t => classesOn(t).map(c => c.id + ':' + c.teacher + ':' + c.loc).sort(), TOM);
  ok('내일: r01 슈·본원, r02·r09 없음', JSON.stringify(after) === JSON.stringify(['r01:슈:본원', 'r03:지원:화정센터']), JSON.stringify(after));
  ok('내일: 원래 반 객체는 그대로(연주)', await page.evaluate(() => classes.find(c => c.id === 'r01').teacher === '연주'));
  ok('날짜 없으면 classes 그대로', await page.evaluate(() => classesOn(null) === classes));
  /* ③ 오늘 날짜를 내일로(지난 날짜 이동 기능 흉내) */
  await page.evaluate(t => { dayYmd = t; keepScroll = false; render(); }, TOM);
  await page.waitForTimeout(300);
  const ths2 = await page.$$eval('.stickhead .thead b', e => e.map(x => x.textContent).sort());
  ok('내일 화면: 연주 열 없음', ths2.indexOf('연주') < 0, JSON.stringify(ths2));
  await page.close();
  /* ④ 주차별 — 다음 주는 바뀐 값 */
  page = await open('week');
  await page.evaluate(() => { weekStart = new Date(weekStart.getTime() + 7 * 86400e3); keepScroll = false; render(); });
  await page.waitForTimeout(300);
  const ids = await page.$$eval('.wk-mini', e => e.map(x => x.textContent));
  ok('다음 주 개요: 고3파이널 없음', !ids.some(t => /고3파이널/.test(t)), JSON.stringify(ids));
  ok('다음 주 개요: 고2 가는 슈T', ids.some(t => /슈T/.test(t) && /고2 가/.test(t)), JSON.stringify(ids));
  await page.close();
  await b.close(); srv.close();
  console.log(fail ? '✗ ' + fail + '건 실패 / ' + pass + '건 통과' : '✓ ' + pass + '건 통과');
  process.exit(fail ? 1 : 0);
})();
