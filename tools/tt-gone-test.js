#!/usr/bin/env node
/* 사라진 수업(휴강·이동해 나감)은 시간 축 버튼 하나로 — 2026-10-02 사용자 요청
 *   "오늘 5:30 수업처럼 삭제되는 수업이 있을때 겹치지 말고 5:30 라인에 사라진 수업보기 버튼"
 *   NODE_PATH=$(npm root -g) node tools/tt-gone-test.js
 * 배경: 같은 강사 열에 흐린 '오늘 이동' 카드 두 장과 실제 수업이 겹쳐 셋이 1/3씩 쪼개져
 * 반이름도 학생 칩도 못 읽었다(원장님 캡처 10/2 5:30). 확인 대상 —
 * ① 오늘의 시간표: 이동·휴강 카드 없음 · 실제 수업이 원래 폭 · 5:30 줄에 '사라진 3' 버튼
 * ② 버튼 창: 반이름·시간·담당T·어디로 갔는지·사유, 줄 클릭 = 기존 이동 안내 창
 * ③ 주차별 확대: 같은 동작 + 휴강 줄은 [되돌리기]
 * ④ 모바일 목록·주간 개요는 종전 그대로(흐린 카드) · 검색 결과도 안내 창으로
 * ⑤ 학생이 모두 빠진 수업도 사라진 수업(2026-10-08 원장님 "없어진 수업은 칸을 나눠서 처리하지 않기로")
 *    — 카드 없이 버튼으로, 같은 칸의 실제 수업이 원래 폭 · 한 명이라도 남으면 카드 유지 · 창에 학생·사유 · 주차별은 되돌리기
 * ⑥ 다른 날짜의 '이 주만' 반은 오늘의 시간표에 열을 만들지 않는다(2026-10-08 원장님 "은지쌤은 본원에서 수업하지 않아요") */
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
const OLD_TS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() - 9 * 864e5));
const OLD_WID = 'w' + OLD_TS.replace(/-/g, '').slice(2);
// 'w'+yyMMdd 반은 페이지가 캐시에 담아 두는 모양 그대로 wk(날짜)를 붙인다
const mk = (id, st, en, loc, t, cls, stu) => ({ id, day: TODAY, start: st, end: en, loc, teacher: t, cls, students: stu,
  wk: id[0] === 'w' ? ('20' + id.slice(1, 3) + '-' + id.slice(3, 5) + '-' + id.slice(5, 7)) : '' });
// 승연T 열: 5:30 수업 셋 중 둘이 이동해 나감 → 남은 한 반이 원래 폭을 써야 한다
const CLASSES = [
  mk('r03', '5:30', '7:00', '본원', '승연', '고2 확수(확인)', ['가나', '다라']),
  mk('r05', '5:30', '7:00', '본원', '승연', '고2 능곡(화인)', ['마바', '사아', '자차']),
  mk('r04', '5:30', '7:00', '본원', '승연', '고2 백양A(비상 독작)', ['바사', '아자']),
  mk('r07', '5:30', '7:00', '화정센터', '지원', '고1 백양A', ['노솔율', '박가빈']),
  mk('r09', '7:00', '9:00', '화정센터', '지원', '고1 나', ['이도윤']),
  mk(WID + 'c', '2:00', '5:00', '본원', '선주', '고2 확수 직보', ['가나', '다라']),
  // ⑤ 덕기T 열: 4:00~7:00 '이 주만' 수업 + 5:30 고2 확인(전원 이 주 빠짐) → 확인 반은 버튼으로, 화정A가 원래 폭
  mk(WID + 'f', '4:00', '7:00', '화정센터', '덕기', '고2 화정A(비상 화언)', ['하나', '두리']),
  mk('r11', '5:30', '7:00', '화정센터', '덕기', '고2 확인', ['김소은(화정)', '채정후(화정)']),
  // ⑤ 은지T 열: 5:30 고2 확인 중 한 명만 빠짐 → 카드 그대로
  mk('r12', '5:30', '7:00', '정리정독', '은지', '중2 확인', ['문준승', '양준겸']),
  // ⑥ 9일 전 날짜의 '이 주만' 반(본원·은지) — 오늘 열을 만들면 안 된다
  mk(OLD_WID + 'a', '8:00', '밤10:00', '본원', '은지', '중2 직전대비', []),
];
const LOGS = [
  { row: 1, kind: '주간반이동', date: TS, ymd: TS, student: '', fromId: 'r03', toId: WID + 'c', reason: '9/28 직전대비' },
  { row: 2, kind: '주간반이동', date: TS, ymd: TS, student: '', fromId: 'r04', toId: WID + 'd', reason: '서해 직전보강' },
  { row: 3, kind: '주간반이동', date: TS, ymd: TS, student: '', fromId: 'r07', toId: WID + 'e', reason: '시험 대비 직보' },
  { row: 4, kind: '주간반휴강', date: TS, ymd: TS, student: '', fromId: 'r09', toId: '', reason: '시험 주간' },
  { row: 5, kind: '주간빼기', date: TS, ymd: TS, student: '김소은(화정)', fromId: 'r11', toId: '', reason: '10/8 목4:00-7:00' },
  { row: 6, kind: '주간빼기', date: TS, ymd: TS, student: '채정후(화정)', fromId: 'r11', toId: '', reason: '10/8 목4:00-7:00' },
  { row: 7, kind: '주간빼기', date: TS, ymd: TS, student: '문준승', fromId: 'r12', toId: '', reason: '시험 전 미리 진행' },
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
    const colOf = e => e.style.gridColumn || (e.closest('.blk') ? e.closest('.blk').style.gridColumn : '');
    const gone = [...document.querySelectorAll('.grid.fitgrid .gonebtn')]
      .map(e => ({ el: e, col: colOf(e), row: e.style.gridRow,
                   inblk: !!e.closest('.blk'), first: e.parentElement && e.parentElement.firstChild === e,
                   host: e.closest('.blk') ? e.closest('.blk').textContent.slice(0, 20) : '' }));
    const cell = document.querySelector('.grid.fitgrid .cell[style*="grid-column: 4"]');
    return { n: blks.length, txt: blks.map(e => e.textContent.slice(0, 10)),
             live: by('고2 능곡') ? W(by('고2 능곡')) : 0, cell: cell ? W(cell) : 0,
             gone: gone.map(x => ({ t: x.el.textContent, title: x.el.title, col: x.col, row: x.row,
                                   inblk: x.inblk, first: x.first, host: x.host,
                                   w: Math.round(x.el.getBoundingClientRect().width) })),
             moved: blks.some(e => /오늘 이동/.test(e.textContent)),
             off: blks.some(e => /오늘 휴강/.test(e.textContent)),
             band: document.querySelectorAll('.blk.wkband').length };
  });
  ok('오늘: 흐린 "오늘 이동" 카드 없음', !r.moved, JSON.stringify(r.txt));
  ok('오늘: "오늘 휴강" 카드·띠 없음', !r.off && r.band === 0);
  ok('오늘: 살아남은 수업만 카드 4개(전원 빠진 확인 반은 카드 없음)', r.n === 4 && !r.txt.some(t => /고2 확인/.test(t)), JSON.stringify(r.txt));
  // 2026-10-02 원장님 "시간표 칸이 얇아지지 않게" — 남은 수업은 열 폭을 그대로 쓴다
  ok('오늘: 남은 수업이 열 폭을 그대로 쓴다', r.live > r.cell * 0.9, JSON.stringify([r.live, r.cell]));
  // 2026-10-02 원장님 선택: 시간 축이 아니라 '그 선생님 칸' 안에 버튼
  ok('오늘: 칸마다 버튼 4개(승연T 5:30 · 지원T 5:30 · 지원T 7:00 · 덕기T 5:30)', r.gone.length === 4, JSON.stringify(r.gone));
  const b530 = r.gone.find(x => /고2 확수/.test(x.title));
  ok('오늘: 승연T 칸 5:30에 "사라진 2"', !!b530 && b530.t === '사라진 2' && /^5:30/.test(b530.title), JSON.stringify(r.gone));
  ok('오늘: 버튼이 그 수업 열(승연T)에 있다', !!b530 && b530.col === '3', b530 && b530.col);
  // 2026-10-02 원장님 "새로 생긴 반 이름 위로" — 그 자리 수업 카드 안 맨 위
  ok('오늘: 버튼이 새 수업 카드 안 맨 위', !!b530 && b530.inblk && b530.first && /고2 능곡/.test(b530.host),
     b530 && JSON.stringify([b530.inblk, b530.first, b530.host]));
  ok('오늘: 버튼 설명에 반이름·이동', !!b530 && /고2 확수\(확인\) 이동/.test(b530.title), b530 && b530.title);
  ok('오늘: 지원T 칸은 따로 "사라진 1" 둘(5:30·7:00)', r.gone.filter(x => x.col === '4' && x.t === '사라진 1').length === 2, JSON.stringify(r.gone.map(x => [x.col, x.t])));

  /* ⑤ 학생이 모두 빠진 수업 = 사라진 수업 */
  r = await page.evaluate(() => {
    const W = el => Math.round(el.getBoundingClientRect().width);
    const blks = [...document.querySelectorAll('.grid.fitgrid .blk')];
    const by = t => blks.find(e => e.textContent.indexOf(t) >= 0);
    const g = [...document.querySelectorAll('.grid.fitgrid .gonebtn')].find(e => /고2 확인/.test(e.title));
    const live = by('고2 화정A'), keep = by('중2 확인');
    const heads = [...document.querySelectorAll('.stickhead .thead')].map(e => e.textContent.trim());
    return { has: !!g, t: g && g.textContent, title: g && g.title, inblk: !!(g && g.closest('.blk')),
             first: !!(g && g.parentElement.firstChild === g), host: g && g.closest('.blk') ? g.closest('.blk').textContent.slice(0, 12) : '',
             live: live ? W(live) : 0, cell: W(document.querySelector('.grid.fitgrid .cell')),
             keep: !!keep, keepAway: keep ? keep.querySelectorAll('.stus button.away').length : -1,
             keepAll: keep ? keep.querySelectorAll('.stus button').length : -1, heads };
  });
  ok('⑤ 오늘: 전원 빠진 반은 카드 대신 "사라진 1"', r.has && r.t === '사라진 1' && /전원 빠짐/.test(r.title), JSON.stringify([r.t, r.title]));
  ok('⑤ 오늘: 버튼이 같은 칸 4:00~7:00 수업 카드 안 맨 위', r.inblk && r.first && /고2 화정A/.test(r.host), JSON.stringify([r.inblk, r.first, r.host]));
  ok('⑤ 오늘: 4:00~7:00 수업이 열 폭을 그대로 쓴다(반으로 안 나뉨)', r.live > r.cell * 0.9, JSON.stringify([r.live, r.cell]));
  ok('⑤ 오늘: 한 명이라도 남으면 카드 유지(빠진 칩 1 · 전체 2)', r.keep && r.keepAway === 1 && r.keepAll === 2, JSON.stringify([r.keep, r.keepAway, r.keepAll]));
  ok('⑥ 오늘: 다른 날짜 "이 주만" 반은 열을 만들지 않음(은지 본원 없음)', !r.heads.some(h => /은지/.test(h) && /본원/.test(h)) && r.heads.some(h => /은지/.test(h) && /정리정독/.test(h)), JSON.stringify(r.heads));
  await page.evaluate(() => [...document.querySelectorAll('.gonebtn')].find(x => /고2 확인/.test(x.title)).click());
  r = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#gone-list button')].map(x => x.textContent),
    kinds: [...document.querySelectorAll('#gone-list em')].map(x => x.textContent),
    acts: [...document.querySelectorAll('#gone-list .gl-act')].map(x => x.textContent) }));
  ok('⑤ 창: 종류 배지 "전원 빠짐" · 인원·사유 · [자세히]', r.kinds[0] === '전원 빠짐' && /학생 2명이 모두 빠졌어요/.test(r.rows[0]) &&
     /이 주만 빠짐 \(10\/8 목4:00-7:00\)/.test(r.rows[0]) && r.acts[0] === '자세히', JSON.stringify([r.rows, r.acts]));
  await page.evaluate(() => document.querySelector('#gone-list button').click());
  r = await page.evaluate(() => ({ txt: document.getElementById('modal').textContent,
    rows: [...document.querySelectorAll('#gone-empty button')].map(x => x.textContent),
    plain: document.querySelectorAll('#gone-empty button.plain').length,
    acts: document.querySelectorAll('#gone-empty .gl-act').length }));
  ok('⑤ 학생 창: 제목·학생 2줄·사유 · 오늘은 되돌리기 없음', /학생이 모두 빠졌어요/.test(r.txt) && r.rows.length === 2 &&
     /김소은/.test(r.rows[0]) && /이 주 빠짐/.test(r.rows[0]) && /10\/8 목4:00-7:00/.test(r.rows[0]) && r.plain === 2 && r.acts === 0 && /주차별 시간표/.test(r.txt),
     JSON.stringify([r.rows, r.plain, r.acts]));
  await page.evaluate(() => closeModal());

  /* ② 버튼 창 */
  await page.evaluate(() => [...document.querySelectorAll('.gonebtn')].find(x => /고2 확수/.test(x.title)).click());
  r = await page.evaluate(() => ({
    on: document.getElementById('modal').classList.contains('on'),
    txt: document.getElementById('modal').textContent,
    rows: [...document.querySelectorAll('#gone-list button')].map(x => x.textContent),
    kinds: [...document.querySelectorAll('#gone-list em')].map(x => x.textContent),
    acts: [...document.querySelectorAll('#gone-list .gl-act')].map(x => x.textContent) }));
  ok('창 제목·건수·담당T', /사라진 수업/.test(r.txt) && /2개입니다/.test(r.txt) && /승연T/.test(r.txt), r.txt.slice(0, 60));
  ok('창: 두 줄(그 칸 것만)', r.rows.length === 2, JSON.stringify(r.rows.map(x => x.slice(0, 12))));
  ok('창: 종류 배지 = 이동', JSON.stringify(r.kinds) === JSON.stringify(['이동', '이동']), JSON.stringify(r.kinds));
  ok('창: 시간·담당T·위치', /5:30~7:00 · 승연T · 본원/.test(r.rows[0]), r.rows[0]);
  ok('창: 어디로 갔는지 + 사유', /에서 해요/.test(r.rows[0]) && /9\/28 직전대비/.test(r.rows[0]), r.rows[0]);
  ok('오늘은 되돌리기 없이 [자세히]만', JSON.stringify(r.acts) === JSON.stringify(['자세히', '자세히']), JSON.stringify(r.acts));
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
    const gone = [...document.querySelectorAll('.wk-tgrid .gonebtn')];
    const blks = [...document.querySelectorAll('.wk-tgrid .blk')];
    return { gone: gone.map(e => ({ t: e.textContent, title: e.title })),
             mvd: blks.some(e => /이 주 이동/.test(e.textContent)),
             off: blks.some(e => /이 주 휴강/.test(e.textContent)),
             band: document.querySelectorAll('.wk-tgrid .blk.wkband').length };
  });
  ok('주차별 확대: 이동·휴강 카드/띠 없음', !r.mvd && !r.off && r.band === 0, JSON.stringify(r));
  // 센터별 그리드 × 담당T 칸 (본원 승연 5:30 2건 / 화정센터 지원 5:30 1건 · 7:00 1건)
  ok('주차별 확대: 칸마다 버튼 4개(전원 빠진 반 포함)', r.gone.length === 4 && r.gone.some(x => /고2 확인 전원 빠짐/.test(x.title)), JSON.stringify(r.gone));
  ok('주차별 확대: 5:30은 2건·1건으로 나뉨',
     r.gone.filter(x => /^5:30/.test(x.title)).map(x => x.t).sort().join() === ['사라진 1','사라진 1','사라진 2'].join(),
     JSON.stringify(r.gone.map(x => x.t)));
  await page.evaluate(() => [...document.querySelectorAll('.wk-tgrid .gonebtn')].find(x => /휴강/.test(x.title)).click());
  r = await page.evaluate(() => ({ txt: document.getElementById('modal').textContent,
                                   acts: [...document.querySelectorAll('#gone-list .gl-act')].map(x => x.textContent),
                                   kinds: [...document.querySelectorAll('#gone-list em')].map(x => x.textContent) }));
  ok('주차별: 휴강 줄은 [되돌리기]', JSON.stringify(r.acts) === JSON.stringify(['되돌리기']) && r.kinds[0] === '휴강', JSON.stringify([r.acts, r.kinds]));
  await page.evaluate(() => document.querySelector('#gone-list button').click());
  r = await page.evaluate(() => document.getElementById('modal').textContent);
  ok('주차별: 줄 클릭 = 휴강 되돌리기 창', /휴강/.test(r) && !/사라진 수업/.test(r), r.slice(0, 60));
  await page.evaluate(() => closeModal());
  /* ⑤ 주차별: 전원 빠진 반 → 학생 줄마다 [되돌리기] → 기존 '이 주만 빠진 학생' 창 */
  await page.evaluate(() => [...document.querySelectorAll('.wk-tgrid .gonebtn')].find(x => /고2 확인/.test(x.title)).click());
  await page.evaluate(() => document.querySelector('#gone-list button').click());
  r = await page.evaluate(() => ({ rows: document.querySelectorAll('#gone-empty button:not(.plain)').length,
                                   acts: [...document.querySelectorAll('#gone-empty .gl-act')].map(x => x.textContent),
                                   txt: document.getElementById('modal').textContent }));
  ok('⑤ 주차별 학생 창: 줄마다 [되돌리기]', r.rows === 2 && JSON.stringify(r.acts) === JSON.stringify(['되돌리기', '되돌리기']) && /학생 줄을 누르세요/.test(r.txt), JSON.stringify([r.rows, r.acts]));
  await page.evaluate(() => document.querySelector('#gone-empty button').click());
  r = await page.evaluate(() => document.getElementById('modal').textContent);
  ok('⑤ 주차별: 학생 줄 클릭 = "이 주만 빠진 학생" 되돌리기 창', /이 주만 빠진 학생/.test(r) && /되돌리기/.test(r) && /김소은/.test(r), r.slice(0, 80));
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
