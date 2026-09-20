#!/usr/bin/env node
/* 직전보강 표시 검증 (timetable.html, 2026-09-20 사용자 요청 — 2안: tt_classes.kind 열).
 *   NODE_PATH=$(npm root -g) node tools/tt-jikbo-test.js
 * 확인 대상 —
 * ① 오늘의 시간표 카드: kind='직보' 반에만 빨간 동그라미 '직'(.jb)
 * ② 주차별 개요 카드·확대 그리드 카드·옆 요일 막대(.jb-bar)
 * ③ [이 주만 반 추가] 창의 수업 종류 알약 → 저장 POST 본문에 kind:'직보'
 * ④ '이 주만 있는 반' 창의 [직전보강 표시 지우기]/[직전보강으로 표시] → PATCH kind
 * ⑤ 출석 현황 판정 asIsJikbo가 kind를 본다
 * ⑥ kind 열이 없는 DB(400) → 옛 열로 다시 읽어 시간표가 그대로 뜨고, 저장 때 kind를 빼서 보낸다 */
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
const WID = 'w' + TODAYSTR.slice(2).replace(/-/g, '');
const OTHER = ['월','화','수','목','금','토','일'].filter(d => d !== TODAY)[3];   // 옆 요일 막대 검사용 다른 요일
const row = (id, day, st, en, loc, t, name, roster, kind) => ({ class_id: id, day, start_time: st, end_time: en, location: loc, teacher: t, name, roster, kind });
const ROWS = [
  row('r001', TODAY, '3:30', '5:00', '화정센터', '지원', '고1 가', '가 나 다', ''),
  row(WID + 'a', TODAY, '5:30', '7:00', '화정센터', '지원', '고1 화정고 직전보강', '라 마', '직보'),
  row(WID + 'b', TODAY, '7:30', '9:00', '본원', '현지', '고2 보충', '바', ''),
  row('r002', OTHER, '5:30', '7:00', '본원', '은지', '고3 직보반', '사 아', '직보'),   // 다른 요일 — 개요 카드·옆 막대
];
(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
  const posts = [];
  /* 가짜 수파베이스 — noKind=true 면 kind 열이 없는 DB 흉내(select에 kind가 있으면 400) */
  async function ctxOf(noKind){
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
    await ctx.route(/fonts\.g/, r => r.abort());
    await ctx.route(/script\.google\.com|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' }));
    await ctx.route(/supabase\.co/, r => {
      const u = r.request().url(), m = r.request().method();
      const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (/\/auth\/v1\//.test(u)) return json(200, { access_token: 't', expires_in: 3600 });
      if (m === 'POST' || m === 'PATCH'){
        let body = null; try { body = JSON.parse(r.request().postData() || 'null'); } catch (e) {}
        if (noKind && body && 'kind' in body) return json(400, { message: "column 'kind' does not exist" });
        posts.push({ m, u, body });
        return json(201, []);
      }
      if (/\/tt_classes\?/.test(u)){
        if (/class_id=like\./.test(u)) return json(200, []);         // freshWeekId
        if (noKind && /select=[^&]*kind/.test(u)) return json(400, { message: "column tt_classes.kind does not exist" });
        if (/book=eq\.%EC%A0%95%EA%B7%9C/.test(u)) return json(200, noKind ? ROWS.map(x => { const y = Object.assign({}, x); delete y.kind; return y; }) : ROWS);
        return json(200, []);
      }
      return json(200, []);
    });
    return ctx;
  }
  async function open(ctx, mode){
    const page = await ctx.newPage();
    await page.addInitScript((mode) => {
      sessionStorage.setItem('tt_mode', mode); sessionStorage.setItem('tt_book', '정규');
      sessionStorage.removeItem('tt_allteacher');
      localStorage.clear();
    }, mode);
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    return page;
  }
  const ctx = await ctxOf(false);

  // ① 오늘의 시간표 — 직보 반에만 '직'
  let page = await open(ctx, 'today');
  await page.waitForSelector('.grid.fitgrid .blk', { timeout: 15000 });
  let r = await page.evaluate(() => {
    const blks = [...document.querySelectorAll('.grid.fitgrid .blk')];
    const by = t => blks.find(e => e.textContent.indexOf(t) >= 0);
    const jb = by('직전보강'), plain = by('고1 가'), other = by('고2 보충');
    const badge = jb && jb.querySelector('.nm .jb');
    const cs = badge && getComputedStyle(badge);
    return { n: blks.length, has: !!badge, txt: badge && badge.textContent, bg: cs && cs.backgroundColor, radius: cs && cs.borderRadius,
             w: badge && badge.getBoundingClientRect().width, h: badge && badge.getBoundingClientRect().height,
             plainHas: !!(plain && plain.querySelector('.jb')), otherHas: !!(other && other.querySelector('.jb')),
             wkflag: jb && /이 주만/.test(jb.querySelector('.nm').textContent) };
  });
  ok('오늘: 카드 3장(다른 요일 반 제외)', r.n === 3, JSON.stringify(r));
  ok('오늘: 직보 반 이름 옆 빨간 동그라미 직', r.has && r.txt === '직' && r.bg === 'rgb(200, 70, 63)' && r.radius === '50%', JSON.stringify(r));
  ok('오늘: 동그라미 크기 17px', Math.abs(r.w - 17) < 1 && Math.abs(r.h - 17) < 1, JSON.stringify([r.w, r.h]));
  ok('오늘: 보통 반·보통 이 주만 반에는 없음', !r.plainHas && !r.otherHas);
  ok('오늘: 이 주만 배지도 함께', r.wkflag);
  // ⑤ 출석 현황 판정
  r = await page.evaluate(() => [asIsJikbo({ cls: '고1 A', kind: '직보' }), asIsJikbo({ cls: '고1 A', kind: '' }), asIsJikbo({ cls: '고1 직보' })]);
  ok('asIsJikbo: kind 직보 참 / 보통 거짓 / 이름 직보 참(종전)', r[0] === true && r[1] === false && r[2] === true, JSON.stringify(r));
  await page.close();

  // ② 주차별 — 개요 카드 → 확대 카드·옆 막대
  page = await open(ctx, 'week');
  await page.waitForSelector('.wk-mini', { timeout: 15000 });
  r = await page.evaluate(() => {
    const minis = [...document.querySelectorAll('.wk-mini')];
    const jbs = minis.filter(x => /직전보강|직보반/.test(x.textContent));
    return { n: minis.length, has: jbs.length === 2 && jbs.every(x => x.querySelector('b .jb')), others: minis.filter(x => jbs.indexOf(x) < 0).some(x => x.querySelector('.jb')) };
  });
  ok('개요: 직보 미니 카드 2장에 직, 다른 카드엔 없음', r.n === 4 && r.has && !r.others, JSON.stringify(r));
  await page.evaluate((d) => { weekZoomDay = d; keepScroll = false; render(); }, TODAY);
  await page.waitForSelector('.wk-tgrid .blk', { timeout: 15000 });
  r = await page.evaluate(() => {
    const blks = [...document.querySelectorAll('.wk-tgrid .blk')];
    const jb = blks.find(x => x.textContent.indexOf('직전보강') >= 0);
    const bars = [...document.querySelectorAll('.wk-bar')];
    return { has: !!(jb && jb.querySelector('.nm .jb')), others: blks.filter(x => x !== jb).some(x => x.querySelector('.jb')),
             bars: bars.length, jbBars: bars.filter(x => x.classList.contains('jb-bar')).map(x => x.title) };
  });
  ok('확대: 직보 카드에 직, 다른 카드엔 없음', r.has && !r.others, JSON.stringify(r));
  ok('확대: 옆 요일 막대 — 직보 반만 빨간 테두리 + title [직전보강]', r.bars === 1 && r.jbBars.length === 1 && /^\[직전보강\] 고3 직보반/.test(r.jbBars[0]), JSON.stringify(r));

  // ③ [이 주만 반 추가] — 알약 → POST kind  (상태 문구는 load(true)가 곧 덮어쓰므로 setStatus를 감싸 기록)
  const hook = () => page.evaluate(() => { window.__st = []; const o = setStatus; setStatus = function(m, k){ window.__st.push(String(m || '')); o(m, k); }; });
  const waitSt = re => page.waitForFunction(re2 => (window.__st || []).some(x => new RegExp(re2).test(x)), re.source, { timeout: 15000 });
  const lastSt = re => page.evaluate(re2 => (window.__st || []).filter(x => new RegExp(re2).test(x)).pop() || '', re.source);
  const reset = async () => { posts.length = 0; await page.evaluate(() => { window.__st = []; }); };
  await hook();
  await reset();
  await page.evaluate(() => { openAddWeekClass(); });
  r = await page.evaluate(() => {
    const radios = [...document.querySelectorAll('#modal input[name="nc-kind"]')];
    return { n: radios.length, vals: radios.map(x => x.value), def: kindSelVal(), pillJb: !!document.querySelector('#modal .nc-kind .jb') };
  });
  ok('반 추가 창: 수업 종류 알약 2개(보통/직보), 기본 보통, 직보 알약에 동그라미', r.n === 2 && r.vals.join() === ',직보' && r.def === '' && r.pillJb, JSON.stringify(r));
  await page.evaluate((day) => {
    document.querySelector('#modal input[name="nc-kind"][value="직보"]').checked = true;
    document.getElementById('nc-day').value = day;
    document.getElementById('nc-cls').value = '고1 능곡고 직보';
    document.getElementById('nc-teacher').value = '은지';
    document.getElementById('nc-start').value = '오전9:00'; document.getElementById('nc-end').value = '10:30';
    submitAddWeekClass();
  }, TODAY);
  await waitSt(/만들었어요|실패/);
  r = await lastSt(/만들었어요|실패/);
  let ins = posts.find(p => p.m === 'POST' && /\/tt_classes/.test(p.u));
  ok('반 추가: tt_classes POST에 kind 직보', !!ins && ins.body && ins.body.kind === '직보' && ins.body.name === '고1 능곡고 직보', JSON.stringify(ins && ins.body));
  ok('반 추가: 안내문에 직전보강 표시(직)', /직전보강 표시\(직\)/.test(r), r);
  // 보통 수업으로 만들면 kind 없음
  await reset();
  await page.evaluate((day) => {
    openAddWeekClass();
    document.getElementById('nc-day').value = day;
    document.getElementById('nc-cls').value = '고1 보통 보충';
    document.getElementById('nc-start').value = '오전9:00'; document.getElementById('nc-end').value = '10:30';
    submitAddWeekClass();
  }, TODAY);
  await waitSt(/만들었어요|실패/);
  ins = posts.find(p => p.m === 'POST' && /\/tt_classes/.test(p.u));
  ok('반 추가(보통): POST에 kind 없음', !!ins && !('kind' in ins.body), JSON.stringify(ins && ins.body));
  // 보충·옮기기 창에도 알약이 있고 kind가 실린다
  await reset();
  await page.evaluate((day) => {
    const c = classes.find(x => x.id === 'r001');
    openWeekClassExtra(c);
    document.querySelector('#modal input[name="nc-kind"][value="직보"]').checked = true;
    document.getElementById('nc-start').value = '오전9:00'; document.getElementById('nc-end').value = '10:30';
    submitWeekClassExtra('r001', ymdOf(weekDates()[day]));
  }, TODAY);
  await waitSt(/열었어요|실패/);
  ins = posts.find(p => p.m === 'POST' && /\/tt_classes/.test(p.u));
  ok('보충 추가: POST에 kind 직보 (복사본)', !!ins && ins.body.kind === '직보' && ins.body.name === '고1 가', JSON.stringify(ins && ins.body));
  r = await page.evaluate(() => { const c = classes.find(x => x.id === 'r001'); openWeekClassMove(c); return document.querySelectorAll('#modal input[name="nc-kind"]').length; });
  ok('옮기기 창에도 수업 종류 알약', r === 2, String(r));
  await page.evaluate(() => closeModal());

  // ④ 이 주만 있는 반 창 — 표시 지우기 / 표시 붙이기
  await reset();
  r = await page.evaluate((id) => { openWeekClassManage(classes.find(x => x.id === id)); return document.getElementById('modal').textContent; }, WID + 'a');
  ok('관리 창(직보): 표시 안내 + [직전보강 표시 지우기]', /직전보강 수업으로 표시돼 있어요/.test(r) && /직전보강 표시 지우기/.test(r), r.slice(0, 120));
  await page.evaluate(() => { [...document.querySelectorAll('#modal button')].find(b => /표시 지우기/.test(b.textContent)).click(); });
  await waitSt(/표시를 지웠어요|실패/);
  let pt = posts.find(p => p.m === 'PATCH' && /\/tt_classes/.test(p.u));
  ok('관리 창: PATCH kind "" (그 반만)', !!pt && pt.body.kind === '' && new RegExp('class_id=eq\\.' + WID + 'a').test(pt.u), JSON.stringify(pt));
  await reset();
  r = await page.evaluate((id) => { openWeekClassManage(classes.find(x => x.id === id)); return document.getElementById('modal').textContent; }, WID + 'b');
  ok('관리 창(보통): [직전보강으로 표시]', /직전보강으로 표시/.test(r) && !/표시 지우기/.test(r), r.slice(0, 120));
  await page.evaluate(() => { [...document.querySelectorAll('#modal button')].find(b => /직전보강으로 표시/.test(b.textContent)).click(); });
  await waitSt(/표시\(직\)를 붙였어요|실패/);
  pt = posts.find(p => p.m === 'PATCH' && /\/tt_classes/.test(p.u));
  ok('관리 창: PATCH kind 직보', !!pt && pt.body.kind === '직보' && new RegExp('class_id=eq\\.' + WID + 'b').test(pt.u), JSON.stringify(pt));
  await page.close(); await ctx.close();

  // ⑥ kind 열이 없는 DB — 옛 열로 다시 읽어 시간표가 뜨고, 저장 때 kind를 빼서 보낸다
  const ctx2 = await ctxOf(true);
  posts.length = 0;
  page = await open(ctx2, 'today');
  await page.waitForSelector('.grid.fitgrid .blk', { timeout: 15000 });
  r = await page.evaluate(() => ({ n: document.querySelectorAll('.grid.fitgrid .blk').length, jb: document.querySelectorAll('.jb').length }));
  ok('열 없음: 400 뒤 옛 열로 다시 읽어 카드 3장, 직 표시 없음', r.n === 3 && r.jb === 0, JSON.stringify(r));
  await page.evaluate(() => { sessionStorage.setItem('tt_mode', 'week'); });
  await hook(); await reset();
  await page.evaluate((day) => {
    setMode('week');
    openAddWeekClass();
    document.querySelector('#modal input[name="nc-kind"][value="직보"]').checked = true;
    document.getElementById('nc-day').value = day;
    document.getElementById('nc-cls').value = '고1 직보 시험';
    document.getElementById('nc-start').value = '오전9:00'; document.getElementById('nc-end').value = '10:30';
    submitAddWeekClass();
  }, TODAY);
  await waitSt(/만들었어요|실패/);
  ins = posts.find(p => p.m === 'POST' && /\/tt_classes/.test(p.u));
  ok('열 없음: 직보를 골라도 POST에 kind를 싣지 않아 저장은 된다', !!ins && !('kind' in ins.body), JSON.stringify(ins && ins.body));
  await reset();
  r = await page.evaluate((id) => { openWeekClassManage(classes.find(x => x.id === id));
    [...document.querySelectorAll('#modal button')].find(b => /직전보강으로 표시/.test(b.textContent)).click(); return 1; }, WID + 'b');
  await waitSt(/표시 변경 실패/);
  r = await lastSt(/표시 변경 실패/);
  ok('열 없음: 표시 바꾸기는 마이그레이션 안내로 실패', /마이그레이션 030/.test(r), r);
  await page.close(); await ctx2.close();

  await b.close(); srv.close();
  console.log('통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
