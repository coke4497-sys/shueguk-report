#!/usr/bin/env node
/* 같은 강사·겹치는 시간 카드가 폭을 나눠 나란히 보이는지 (timetable.html spreadOverlaps, 2026-09-13).
 *   NODE_PATH=$(npm root -g) node tools/tt-overlap-test.js
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
const CLASSES = [
  // 같은 강사·같은 시간(3:30~5:00) 두 반 — 카드가 나란히 갈라져야 한다
  mk('rA', TODAY, '3:30', '5:00', '화정센터', '지원', '고1 확인', ['가', '나', '다']),
  mk('rB', TODAY, '3:30', '5:00', '화정센터', '지원', '고1 백양C', ['라', '마']),
  // 안 겹치는 반 — 원래 폭 그대로여야 한다
  mk('rC', TODAY, '7:00', '8:30', '화정센터', '지원', '고1 나', ['바', '사']),
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
  // 카드 위치·클릭 도달 확인 — 그리드 안의 rA·rB가 좌우로 갈라지고 각각 클릭이 닿는지
  async function checkGrid(page, label, sel){
    await page.waitForSelector(sel, { timeout: 15000 });
    const r = await page.evaluate((sel) => {
      const box = (el) => { const q = el.getBoundingClientRect(); return { l: q.left, r: q.right, w: q.width, t: q.top }; };
      const blks = [...document.querySelectorAll(sel)];
      const byCls = (t) => blks.find(e => e.textContent.indexOf(t) >= 0);
      const a = byCls('고1 확인'), c2 = byCls('고1 백양C'), c3 = byCls('고1 나');
      if (!a || !c2 || !c3) return { miss: true, n: blks.length };
      const A = box(a), B = box(c2), C = box(c3);
      const hit = (bx, el) => { const e = document.elementFromPoint(bx.l + bx.w / 2, bx.t + 8); return !!(e && el.contains(e)); };
      return { A, B, C, hitA: hit(A, a), hitB: hit(B, c2) };
    }, sel);
    ok(label + ': 카드 셋 모두 존재', !r.miss, JSON.stringify(r));
    if (r.miss) return;
    const side = r.A.r <= r.B.l + 1 || r.B.r <= r.A.l + 1;
    ok(label + ': 겹친 두 장이 좌우로 갈라짐', side, JSON.stringify([r.A, r.B]));
    ok(label + ': 나뉜 폭이 원폭의 절반쯤', r.A.w < r.C.w * 0.62 && r.B.w < r.C.w * 0.62, JSON.stringify([r.A.w, r.B.w, r.C.w]));
    ok(label + ': 안 겹친 반은 원래 폭', r.C.w > r.A.w * 1.6, JSON.stringify([r.A.w, r.C.w]));
    ok(label + ': 두 장 다 클릭이 닿음', r.hitA && r.hitB, JSON.stringify([r.hitA, r.hitB]));
  }
  // ① 오늘의 시간표
  let page = await open('today');
  await checkGrid(page, '오늘', '.grid.fitgrid .blk');
  await page.close();
  // ② 주차별 확대 (오늘 요일)
  page = await open('week');
  await page.waitForSelector('.wk-mini', { timeout: 15000 });
  await page.evaluate((d) => { weekZoomDay = d; keepScroll = false; render(); }, TODAY);
  await checkGrid(page, '주차별 확대', '.wk-tgrid .blk');
  await page.close();
  // ③ 전체 확대
  page = await open('all');
  await page.waitForSelector('.wk-mini', { timeout: 15000 });
  await page.evaluate((d) => { allZoomDay = d; keepScroll = false; render(); }, TODAY);
  await checkGrid(page, '전체 확대', '.wk-tgrid .blk');
  await page.close();

  // ④ '이 주만' 반 만들기 확인창 (wkOverlapOk) — 같은 강사·겹치는 시간이면 한 번 묻는다
  page = await open('week');
  await page.waitForSelector('.wk-mini', { timeout: 15000 });
  let dlg = [], dlgMode = 'dismiss';
  page.on('dialog', d => { dlg.push(d.message()); if (dlgMode === 'accept') d.accept(); else d.dismiss(); });
  const modalOpen = () => page.evaluate(() => document.getElementById('modal').classList.contains('on'));
  // ④-1 보충 추가: 4:00~5:30은 백양C(3:30~5:00)·원래 수업과 겹침 → 확인창, [취소]면 창 유지
  await page.evaluate(() => openWeekClassExtra(classes.find(c => c.id === 'rA')));
  await page.selectOption('#nc-start', '4:00'); await page.selectOption('#nc-end', '5:30');
  dlg = []; dlgMode = 'dismiss';
  await page.click('text=보충 만들기');
  ok('보충: 겹치면 확인창 + 겹치는 반 명시', dlg.length === 1 && dlg[0].indexOf('이미 수업이 있어요') >= 0 && dlg[0].indexOf('고1 백양C') >= 0, JSON.stringify(dlg));
  ok('보충: [취소]면 만들지 않고 창 유지', await modalOpen());
  dlg = []; dlgMode = 'accept';
  await page.click('text=보충 만들기');
  await page.waitForFunction(() => !document.getElementById('modal').classList.contains('on'));
  ok('보충: [확인]이면 그대로 진행', dlg.length === 1);
  // ④-2 새 반 만들기: 지원T 3:30~5:00 → 두 반 다 명시
  await page.evaluate(() => openAddWeekClass());
  await page.evaluate((d) => { document.getElementById('nc-day').value = d; }, TODAY);
  await page.selectOption('#nc-start', '3:30'); await page.selectOption('#nc-end', '5:00');
  await page.fill('#nc-teacher', '지원'); await page.fill('#nc-cls', '테스트반');
  dlg = []; dlgMode = 'dismiss';
  await page.click('text=이 주만 만들기');
  ok('새 반: 겹치는 두 반 모두 명시', dlg.length === 1 && dlg[0].indexOf('고1 확인') >= 0 && dlg[0].indexOf('고1 백양C') >= 0, JSON.stringify(dlg));
  ok('새 반: [취소]면 창 유지', await modalOpen());
  await page.evaluate(() => closeModal());
  // ④-3 시간 옮기기: 같은 날짜로 옮기면 자기 자신은 어차피 숨어 제외, 백양C만 겹침으로 잡힘
  await page.evaluate(() => openWeekClassMove(classes.find(c => c.id === 'rA')));
  await page.selectOption('#nc-start', '4:00'); await page.selectOption('#nc-end', '5:30');
  dlg = []; dlgMode = 'dismiss';
  await page.click('text=이 주만 옮기기');
  ok('옮기기: 자기 자신 제외 + 백양C만 명시', dlg.length === 1 && dlg[0].indexOf('고1 백양C') >= 0 && dlg[0].indexOf('고1 확인') < 0, JSON.stringify(dlg));
  await page.evaluate(() => closeModal());
  // ④-4 안 겹치는 시간(1:00~2:30)은 묻지 않고 그대로 진행
  await page.evaluate(() => openWeekClassExtra(classes.find(c => c.id === 'rA')));
  await page.selectOption('#nc-start', '1:00'); await page.selectOption('#nc-end', '2:30');
  dlg = []; dlgMode = 'dismiss';
  await page.click('text=보충 만들기');
  await page.waitForFunction(() => !document.getElementById('modal').classList.contains('on'));
  ok('안 겹치면 확인창 없이 진행', dlg.length === 0, JSON.stringify(dlg));
  await page.close();
  console.log('통과 ' + pass + ' / 실패 ' + fail);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
