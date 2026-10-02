#!/usr/bin/env node
/* 사라진 수업(휴강·이동해 나감)은 시간 축 버튼 하나로 — 2026-10-02 사용자 요청
 *   "오늘 5:30 수업처럼 삭제되는 수업이 있을때 겹치지 말고 5:30 라인에 사라진 수업보기 버튼"
 *   NODE_PATH=$(npm root -g) node tools/tt-gone-test.js
 * 배경: 같은 강사 열에 흐린 '오늘 이동' 카드 두 장과 실제 수업이 겹쳐 셋이 1/3씩 쪼개져
 * 반이름도 학생 칩도 못 읽었다(원장님 캡처 10/2 5:30). 확인 대상 —
 * ① 오늘의 시간표: 이동·휴강 카드 없음 · 실제 수업이 원래 폭 · 5:30 줄에 '사라진 3' 버튼
 * ② 버튼 창: 반이름·시간·담당T·어디로 갔는지·사유, 줄 클릭 = 기존 이동 안내 창
 * ③ 주차별 확대: 같은 동작 + 휴강 줄은 [되돌리기]
 * ④ 모바일 목록·주간 개요는 종전 그대로(흐린 카드) · 검색 결과도 안내 창으로 */
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
const TS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const WID = 'w' + TS.replace(/-/g, '').slice(2);
const mk = (id, st, en, loc, t, cls, stu) => ({ id, day: TODAY, start: st, end: en, loc, teacher: t, cls, students: stu });
// 승연T 열: 5:30 수업 셋 중 둘이 이동해 나감 → 남은 한 반이 원래 폭을 써야 한다
const CLASSES = [
  mk('r03', '5:30', '7:00', '본원', '승연', '고2 확수(확인)', ['가나', '다라']),
  mk('r05', '5:30', '7:00', '본원', '승연', '고2 능곡(화인)', ['마바', '사아', '자차']),
  mk('r04', '5:30', '7:00', '본원', '승연', '고2 백양A(비상 독작)', ['바사', '아자']),
  mk('r07', '5:30', '7:00', '화정센터', '지원', '고1 백양A', ['노솔율', '박가빈']),
  mk('r09', '7:00', '9:00', '화정센터', '지원', '고1 나', ['이도윤']),
  mk(WID + 'c', '2:00', '5:00', '본원', '선주', '고2 확수 직보', ['가나', '다라']),
];
const LOGS = [
  { row: 1, kind: '주간반이동', date: TS, ymd: TS, student: '', fromId: 'r03', toId: WID + 'c', reason: '9/28 직전대비' },
  { row: 2, kind: '주간반이동', date: TS, ymd: TS, student: '', fromId: 'r04', toId: WID + 'd', reason: '서해 직전보강' },
  { row: 3, kind: '주간반이동', date: TS, ymd: TS, student: '', fromId: 'r07', toId: WID + 'e', reason: '시험 대비 직보' },
  { row: 4, kind: '주간반휴강', date: TS, ymd: TS, student: '', fromId: 'r09', toId: '', reason: '시험 주간' },
];
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const b = await chromium.launch();
  async function open(ctx, mode){
    const page = await ctx.newPage();
    await page.addInitScript(({ cls, logs, mode }) => {
      sessionStorage.setItem('tt_mode', mode); sessionStorage.setItem('tt_book', '정규');
      sessionStorage.setItem('tt_vmopen', '0'); sessionStorage.setItem('tt_chopen', '0');
      localStorage.setItem('ttc:list:정규', JSON.stringify({ t: Date.now(), d: { classes: cls, onceMoves: logs } }));
    }, { cls: CLASSES, logs: LOGS, mode });
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    await page.waitForSelector('.blk, .wk-mini', { timeout: 15000 });
    await page.waitForTimeout(500);
    return page;
  }
  const wide = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
  await wide.route(/script\.google\.com|supabase\.co|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' }));
  await wide.route(/fonts\.g/, r => r.abort());

  /* ① 오늘의 시간표 */
  let page = await open(wide, 'today');
  let r = await page.evaluate(() => {
    const W = el => Math.round(el.getBoundingClientRect().width);
    const blks = [...document.querySelectorAll('.grid.fitgrid .blk')];
    const by = t => blks.find(e => e.textContent.indexOf(t) >= 0);
    const gone = [...document.querySelectorAll('.grid.fitgrid .tlab .gonebtn')];
    const cell = document.querySelector('.grid.fitgrid .cell[style*="grid-column: 4"]');
    return { n: blks.length, txt: blks.map(e => e.textContent.slice(0, 10)),
             live: by('고2 능곡') ? W(by('고2 능곡')) : 0, cell: cell ? W(cell) : 0,
             gone: gone.map(e => ({ t: e.textContent, title: e.title })),
             moved: blks.some(e => /오늘 이동/.test(e.textContent)),
             off: blks.some(e => /오늘 휴강/.test(e.textContent)),
             band: document.querySelectorAll('.blk.wkband').length };
  });
  ok('오늘: 흐린 "오늘 이동" 카드 없음', !r.moved, JSON.stringify(r.txt));
  ok('오늘: "오늘 휴강" 카드·띠 없음', !r.off && r.band === 0);
  ok('오늘: 살아남은 수업만 카드 2개', r.n === 2, JSON.stringify(r.txt));
  ok('오늘: 남은 수업이 열 폭을 그대로 쓴다(쪼개짐 없음)', r.live > r.cell * 0.9, JSON.stringify([r.live, r.cell]));
  ok('오늘: 버튼 2개(5:30·7:00)', r.gone.length === 2, JSON.stringify(r.gone));
  const b530 = r.gone.find(x => /^5:30/.test(x.title));
  ok('오늘: 5:30 줄에 "사라진 3"', !!b530 && b530.t === '사라진 3', JSON.stringify(r.gone));
  ok('오늘: 버튼 설명에 반이름·이동', !!b530 && /고2 확수\(확인\) 이동/.test(b530.title), b530 && b530.title);

  /* ② 버튼 창 */
  await page.evaluate(() => [...document.querySelectorAll('.tlab .gonebtn')].find(x => /^5:30/.test(x.title)).click());
  r = await page.evaluate(() => ({
    on: document.getElementById('modal').classList.contains('on'),
    txt: document.getElementById('modal').textContent,
    rows: [...document.querySelectorAll('#gone-list button')].map(x => x.textContent),
    kinds: [...document.querySelectorAll('#gone-list em')].map(x => x.textContent),
    acts: [...document.querySelectorAll('#gone-list .gl-act')].map(x => x.textContent) }));
  ok('창 제목·건수', /사라진 수업/.test(r.txt) && /3개예요/.test(r.txt), r.txt.slice(0, 60));
  ok('창: 세 줄', r.rows.length === 3, JSON.stringify(r.rows.map(x => x.slice(0, 12))));
  ok('창: 종류 배지 = 이동', JSON.stringify(r.kinds) === JSON.stringify(['이동', '이동', '이동']), JSON.stringify(r.kinds));
  ok('창: 시간·담당T·위치', /5:30~7:00 · 승연T · 본원/.test(r.rows[0]), r.rows[0]);
  ok('창: 어디로 갔는지 + 사유', /에서 해요/.test(r.rows[0]) && /9\/28 직전대비/.test(r.rows[0]), r.rows[0]);
  ok('오늘은 되돌리기 없이 [자세히]만', JSON.stringify(r.acts) === JSON.stringify(['자세히', '자세히', '자세히']), JSON.stringify(r.acts));
  await page.evaluate(() => document.querySelector('#gone-list button').click());
  r = await page.evaluate(() => document.getElementById('modal').textContent);
  ok('창: 줄을 누르면 기존 이동 안내 창', /이 주만 옮긴 수업/.test(r) && /고2 확수/.test(r), r.slice(0, 60));
  await page.evaluate(() => closeModal());

  /* ④-1 검색 결과가 사라진 수업이면 안내 창 */
  await page.evaluate(() => gotoSearchHit('r03'));
  r = await page.evaluate(() => ({ m: document.getElementById('modal').textContent, mode: mode }));
  ok('검색: 사라진 수업은 안내 창(전체 시간표로 튀지 않음)', /사라진 수업/.test(r.m) && r.mode === 'today', r.m.slice(0, 50));
  await page.evaluate(() => closeModal());
  await page.close();

  /* ③ 주차별 확대 */
  page = await open(wide, 'week');
  await page.evaluate(({ logs, d }) => { weekOnce = logs; weekZoomDay = d; keepScroll = false; render(); }, { logs: LOGS, d: TODAY });
  await page.waitForSelector('.wk-tgrid', { timeout: 15000 });
  await page.waitForTimeout(300);
  r = await page.evaluate(() => {
    const gone = [...document.querySelectorAll('.wk-tgrid .wk-tlab .gonebtn')];
    const blks = [...document.querySelectorAll('.wk-tgrid .blk')];
    return { gone: gone.map(e => ({ t: e.textContent, title: e.title })),
             mvd: blks.some(e => /이 주 이동/.test(e.textContent)),
             off: blks.some(e => /이 주 휴강/.test(e.textContent)),
             band: document.querySelectorAll('.wk-tgrid .blk.wkband').length };
  });
  ok('주차별 확대: 이동·휴강 카드/띠 없음', !r.mvd && !r.off && r.band === 0, JSON.stringify(r));
  // 주차별 확대는 센터마다 그리드가 따로라 버튼도 센터별(본원 5:30 / 화정센터 5:30 · 7:00)
  ok('주차별 확대: 센터별 버튼 3개', r.gone.length === 3, JSON.stringify(r.gone));
  ok('주차별 확대: 본원 5:30은 2건·화정센터 5:30은 1건',
     r.gone.filter(x => /^5:30/.test(x.title)).map(x => x.t).sort().join() === ['사라진 1','사라진 2'].join(),
     JSON.stringify(r.gone.map(x => x.t)));
  await page.evaluate(() => [...document.querySelectorAll('.wk-tgrid .wk-tlab .gonebtn')].find(x => /휴강/.test(x.title)).click());
  r = await page.evaluate(() => ({ txt: document.getElementById('modal').textContent,
                                   acts: [...document.querySelectorAll('#gone-list .gl-act')].map(x => x.textContent),
                                   kinds: [...document.querySelectorAll('#gone-list em')].map(x => x.textContent) }));
  ok('주차별: 휴강 줄은 [되돌리기]', JSON.stringify(r.acts) === JSON.stringify(['되돌리기']) && r.kinds[0] === '휴강', JSON.stringify([r.acts, r.kinds]));
  await page.evaluate(() => document.querySelector('#gone-list button').click());
  r = await page.evaluate(() => document.getElementById('modal').textContent);
  ok('주차별: 줄 클릭 = 휴강 되돌리기 창', /휴강/.test(r) && !/사라진 수업/.test(r), r.slice(0, 60));
  await page.evaluate(() => closeModal());

  /* ④-2 주간 개요는 종전대로 */
  await page.evaluate(() => { weekZoomDay = null; keepScroll = false; render(); });
  await page.waitForSelector('.wk-mini', { timeout: 15000 });
  r = await page.evaluate(() => ({
    mvd: [...document.querySelectorAll('.wk-mini.mvd')].length,
    offm: [...document.querySelectorAll('.wk-mini.offm, .wk-mini.wkoffsum')].length }));
  ok('개요: 이동 미니 카드는 그대로(3개)', r.mvd === 3, String(r.mvd));
  ok('개요: 휴강 표시도 그대로', r.offm >= 1, String(r.offm));
  await page.close();

  /* ④-3 휴대폰 목록 보기는 종전대로 흐린 카드 */
  const narrow = await b.newContext({ viewport: { width: 420, height: 860 }, timezoneId: 'Asia/Seoul' });
  await narrow.route(/script\.google\.com|supabase\.co|googleusercontent/, r2 => r2.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' }));
  await narrow.route(/fonts\.g/, r2 => r2.abort());
  page = await open(narrow, 'today');
  r = await page.evaluate(() => ({
    moved: [...document.querySelectorAll('.daylist .blk')].filter(e => /오늘 이동/.test(e.textContent)).length,
    gone: document.querySelectorAll('.gonebtn').length }));
  ok('휴대폰 목록: 이동 카드 그대로 3개', r.moved === 3, String(r.moved));
  ok('휴대폰 목록: 시간 축 버튼 없음(그리드 전용)', r.gone === 0, String(r.gone));
  await b.close(); srv.close();
  console.log(fail ? ('통과 ' + pass + ' / 실패 ' + fail) : ('✓ ' + pass + '건 통과'));
  process.exit(fail ? 1 : 0);
})();
