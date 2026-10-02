#!/usr/bin/env node
/* 휴강 표시 정리 검증 (timetable.html, 2026-09-18 사용자 '1안' 승인).
 *   NODE_PATH=$(npm root -g) node tools/tt-offbundle-test.js
 * 배경: 10월 내신 주에 중2 내신 반 15개가 '이 주 휴강' 흐린 카드로 남아
 * 새 정리정독 수업과 겹쳐 가독성이 떨어졌다(이은지T 신고). 확인 대상 —
 * ① 그리드: 휴강은 얇은 띠(.wkband)로 자리 다툼에서 빠지고 실제 수업이 원래 폭
 * ② 개요: 같은 센터 휴강 2건 이상 = 묶음 카드(.wkoffsum), 1건 = 흐린 카드(.offm)
 * ③ 목록(모바일): 2건 이상 = 묶음 카드(.wksum, 행 클릭 = 되돌리기 창), 1건 = 기존 낱장
 * ④ 회귀: 살아 있는 수업끼리의 겹침 분할(spreadOverlaps)은 그대로 */
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
const TODAYSTR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const mk = (id, day, st, en, loc, t, cls, stu) => ({ id, day, start: st, end: en, loc, teacher: t, cls, students: stu });
const CLASSES = [
  // 살아 있는 수업 — rA·rF는 같은 시간(회귀: 반씩 분할), rD는 안 겹침(원폭 대조)
  mk('rA', TODAY, '3:30', '5:00', '화정센터', '지원', '고1 확인', ['가', '나', '다']),
  mk('rF', TODAY, '3:30', '5:00', '화정센터', '지원', '고1 확인B', ['자', '차']),
  mk('rD', TODAY, '11:00', '12:30', '화정센터', '지원', '고1 가', ['아', '자']),
  // 휴강 — rB·rC는 화정센터(묶음 2건), rE는 본원(1건 = 낱장 유지)
  mk('rB', TODAY, '4:00', '5:30', '화정센터', '지원', '고1 백양C', ['라', '마']),
  mk('rC', TODAY, '7:00', '8:30', '화정센터', '지원', '고1 나', ['바', '사']),
  mk('rE', TODAY, '5:30', '7:00', '본원', '현지', '고2 나', ['카']),
];
const OFFS = [
  { row: 1, kind: '주간반휴강', date: TODAYSTR, ymd: TODAYSTR, student: '', fromId: 'rB', toId: '', reason: '중2 정규수업 주간' },
  { row: 2, kind: '주간반휴강', date: TODAYSTR, ymd: TODAYSTR, student: '', fromId: 'rC', toId: '', reason: '' },
  { row: 3, kind: '주간반휴강', date: TODAYSTR, ymd: TODAYSTR, student: '', fromId: 'rE', toId: '', reason: '' },
];
(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
  async function open(ctx, mode, withOnce){
    const page = await ctx.newPage();
    await page.addInitScript(({ cls, mode, once }) => {
      sessionStorage.setItem('tt_mode', mode); sessionStorage.setItem('tt_book', '정규');
      sessionStorage.removeItem('tt_allteacher');
      localStorage.setItem('ttc:list:정규', JSON.stringify({ t: Date.now(), d: { classes: cls, onceMoves: once } }));
    }, { cls: CLASSES, mode, once: withOnce ? OFFS : [] });
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    return page;
  }
  const wide = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
  await wide.route(/script\.google\.com|supabase\.co|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' }));
  await wide.route(/fonts\.g/, r => r.abort());

  // ① 오늘의 시간표 그리드 — 띠 + 원폭 + 회귀 분할
  let page = await open(wide, 'today', true);
  await page.waitForSelector('.grid.fitgrid .blk', { timeout: 15000 });
  await page.waitForTimeout(500);   // 오늘 보충 패널이 열리며 본문 폭이 .22s 동안 줄어든다 — 그 뒤에 재야 카드 자리가 맞다
  let r = await page.evaluate(() => {
    const box = el => { const q = el.getBoundingClientRect(); return { l: q.left, r: q.right, w: q.width, t: q.top, h: q.height }; };
    const blks = [...document.querySelectorAll('.grid.fitgrid .blk:not(.wkband)')];
    const by = t => blks.find(e => e.textContent.indexOf(t) >= 0);
    const bands = [...document.querySelectorAll('.grid.fitgrid .blk.wkband')];
    const gone = [...document.querySelectorAll('.grid.fitgrid .gonebtn')];
    const a = by('고1 확인'), f2 = by('고1 확인B'), d = by('고1 가');
    a.scrollIntoView({ block: 'center' });   // 클릭 판정은 화면 안에서
    const A = box(a), F = box(f2), D = box(d);
    const hit = (bx, el) => { const e = document.elementFromPoint(bx.l + bx.w / 2, bx.t + 8); return !!(e && el.contains(e)); };
    return { bands: bands.length, gone: gone.map(x => ({ txt: x.textContent, title: x.title })),
             A, F, D, hitA: hit(A, a), hitF: hit(F, f2),
             offCard: blks.some(x => /오늘 휴강/.test(x.textContent)) };
  });
  // 2026-10-02 사용자 요청: 그리드에서 사라진 수업(휴강·이동)은 띠·카드 없이 시간 축 버튼 하나로
  ok('오늘: 휴강 띠 없음(시간 축 버튼으로 대체)', r.bands === 0, String(r.bands));
  ok('오늘: 사라진 수업 버튼 3개(4:00·5:30·7:00)', r.gone.length === 3, JSON.stringify(r.gone));
  ok('오늘: 버튼 글자 = 사라진 1', r.gone.every(x => x.txt === '사라진 1'), JSON.stringify(r.gone.map(x => x.txt)));
  ok('오늘: 버튼 설명에 반이름·휴강', r.gone.every(x => /휴강/.test(x.title)) && r.gone.some(x => /백양C/.test(x.title)), JSON.stringify(r.gone.map(x => x.title)));
  ok('오늘: 휴강 카드 없음', !r.offCard);
  ok('오늘: 살아 있는 두 수업은 반씩 분할(회귀)', r.A.w < r.D.w * 0.62 && r.F.w < r.D.w * 0.62 && (r.A.r <= r.F.l + 1 || r.F.r <= r.A.l + 1), JSON.stringify([r.A, r.F, r.D]));
  ok('오늘: 두 수업 다 클릭 도달(회귀)', r.hitA && r.hitF);
  // 버튼을 누르면 그 시간에 사라진 수업 목록 창
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.grid.fitgrid .gonebtn')]
      .find(x => /백양C/.test(x.title));
    b.click();
  });
  r = await page.evaluate(() => ({ on: document.getElementById('modal').classList.contains('on'),
                                   txt: document.getElementById('modal').textContent,
                                   rows: document.querySelectorAll('#gone-list button').length }));
  ok('오늘: 버튼 클릭 = 사라진 수업 목록 창', r.on && /사라진 수업/.test(r.txt) && r.rows === 1, (r.txt || '').slice(0, 70));
  ok('오늘: 목록에 반이름·휴강 사유', /백양C/.test(r.txt) && /중2 정규수업 주간/.test(r.txt), (r.txt || '').slice(0, 120));
  ok('오늘은 되돌리기 없음(출석 체크 전용 화면)', !/되돌리기/.test(r.txt));
  await page.evaluate(() => closeModal());
  await page.close();

  // ② 주차별 개요 — 묶음(2건)·낱장 흐림(1건)
  page = await open(wide, 'week', false);
  await page.waitForSelector('.wk-mini', { timeout: 15000 });
  await page.evaluate((offs) => { weekOnce = offs; keepScroll = false; render(); }, OFFS);
  r = await page.evaluate(() => {
    const sums = [...document.querySelectorAll('.wk-mini.wkoffsum')];
    const singles = [...document.querySelectorAll('.wk-mini.offm')];
    const lives = [...document.querySelectorAll('.wk-mini:not(.wkoffsum):not(.offm)')];
    return { sums: sums.map(x => x.textContent), singles: singles.map(x => x.textContent),
             liveHasOff: lives.some(x => /백양C|고2 나|^고1 나/.test(x.textContent)) };
  });
  ok('개요: 화정센터 묶음 카드 1개 (이 주 휴강 2건)', r.sums.length === 1 && /이 주 휴강 2건/.test(r.sums[0]), JSON.stringify(r.sums));
  ok('개요: 본원 1건은 흐린 낱장(.offm)', r.singles.length === 1 && /고2 나/.test(r.singles[0]) && /휴강/.test(r.singles[0]), JSON.stringify(r.singles));
  ok('개요: 휴강 반이 보통 카드로 남지 않음', !r.liveHasOff);

  // ③ 주차별 확대 그리드 — 띠 + 클릭 = 되돌리기 창 + 원폭 회귀
  await page.evaluate((d) => { weekZoomDay = d; keepScroll = false; render(); }, TODAY);
  await page.waitForSelector('.wk-tgrid .blk', { timeout: 15000 });
  r = await page.evaluate(() => {
    const box = el => { const q = el.getBoundingClientRect(); return { l: q.left, w: q.width, t: q.top, r: q.right }; };
    const blks = [...document.querySelectorAll('.wk-tgrid .blk:not(.wkband)')];
    const by = t => blks.find(e => e.textContent.indexOf(t) >= 0);
    const bands = [...document.querySelectorAll('.wk-tgrid .blk.wkband')];
    const gone = [...document.querySelectorAll('.wk-tgrid .gonebtn')];
    const a = by('고1 확인'), f2 = by('고1 확인B'), d = by('고1 가');
    return { nBands: bands.length, A: box(a), F: box(f2), D: box(d),
             gone: gone.map(x => ({ txt: x.textContent, title: x.title })) };
  });
  ok('확대: 휴강 띠 없음', r.nBands === 0, String(r.nBands));
  ok('확대: 사라진 수업 버튼 3개', r.gone.length === 3, JSON.stringify(r.gone));
  ok('확대: 살아 있는 두 수업 반씩 분할(회귀)', r.A.w < r.D.w * 0.62 && r.F.w < r.D.w * 0.62, JSON.stringify([r.A.w, r.F.w, r.D.w]));
  await page.evaluate(() => {
    [...document.querySelectorAll('.wk-tgrid .gonebtn')].find(x => /백양C/.test(x.title)).click();
  });
  r = await page.evaluate(() => ({ on: document.getElementById('modal').classList.contains('on'),
                                   txt: document.getElementById('modal').textContent,
                                   act: [...document.querySelectorAll('#gone-list .gl-act')].map(x => x.textContent) }));
  ok('확대: 버튼 클릭 = 사라진 수업 목록 창', r.on && /사라진 수업/.test(r.txt) && /백양C/.test(r.txt), (r.txt || '').slice(0, 70));
  ok('확대: 주차별은 줄마다 [되돌리기]', JSON.stringify(r.act) === JSON.stringify(['되돌리기']), JSON.stringify(r.act));
  await page.evaluate(() => { document.querySelector('#gone-list button').click(); });
  r = await page.evaluate(() => ({ on: document.getElementById('modal').classList.contains('on'),
                                   txt: document.getElementById('modal').textContent }));
  ok('확대: 줄 클릭 = 휴강 되돌리기 창', r.on && /휴강/.test(r.txt) && !/사라진 수업 1개예요/.test(r.txt), (r.txt || '').slice(0, 80));
  await page.evaluate(() => closeModal());
  await page.close();

  // ④ 모바일 목록(주차별) — 묶음 카드 + 행 클릭 = 되돌리기 창, 1건은 낱장
  const narrow = await b.newContext({ viewport: { width: 500, height: 900 }, timezoneId: 'Asia/Seoul' });
  await narrow.route(/script\.google\.com|supabase\.co|googleusercontent/, r2 => r2.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' }));
  await narrow.route(/fonts\.g/, r2 => r2.abort());
  page = await open(narrow, 'week', false);
  await page.waitForSelector('.daylist, .wk-mini', { timeout: 15000 });
  await page.evaluate((offs) => { weekOnce = offs; keepScroll = false; render(); }, OFFS);
  await page.waitForSelector('.daylist .blk', { timeout: 15000 });
  r = await page.evaluate(() => {
    const sums = [...document.querySelectorAll('.daylist .blk.wksum')];
    const offCards = [...document.querySelectorAll('.daylist .blk.wkoff:not(.wksum)')];
    return { sums: sums.map(x => x.textContent), offs: offCards.map(x => x.textContent) };
  });
  ok('목록: 화정센터 묶음 카드 (이 주 휴강 2건)', r.sums.length === 1 && /이 주 휴강 2건/.test(r.sums[0]), JSON.stringify(r.sums));
  ok('목록: 본원 1건은 기존 낱장 카드', r.offs.length === 1 && /고2 나/.test(r.offs[0]), JSON.stringify(r.offs));
  await page.evaluate(() => { document.querySelector('.daylist .blk.wksum').click(); });
  r = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.daylist .blk.wksum .wksum-list button')];
    return { open: !document.querySelector('.daylist .blk.wksum .wksum-list').hidden,
             rows: rows.map(x => x.textContent) };
  });
  ok('목록: 묶음을 누르면 목록이 펼쳐짐', r.open && r.rows.length === 2 && r.rows.every(x => /되돌리기/.test(x)), JSON.stringify(r.rows));
  await page.evaluate(() => { document.querySelector('.daylist .blk.wksum .wksum-list button').click(); });
  r = await page.evaluate(() => ({ on: document.getElementById('modal').classList.contains('on'),
                                   txt: document.getElementById('modal').textContent }));
  ok('목록: 행 클릭 = 휴강 되돌리기 창', r.on && /휴강/.test(r.txt), (r.txt || '').slice(0, 80));
  await page.close();

  console.log('통과 ' + pass + ' / 실패 ' + fail);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
