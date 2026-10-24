#!/usr/bin/env node
/* 슈국 캘린더 학년별 기간 예외(047) — 2026-10-11 사용자 결정 "권장안으로"
 *   "다음주부터 중2는 정규 수업 시간표로 돌아갑니다. 11/4 주차에 다시 내신 시작. 고1, 고2는 기말까지 내신"
 *   NODE_PATH=$(npm root -g) node tools/tt-period-ex-test.js
 * 확인 대상 —
 * ① 오늘의 시간표(내신 주, 중2 → 정규 예외): 중2 정규 반이 섞여 보이고 중2 내신 반은 빠짐 · 기간 칩 '중2 정규' · 정규 출석도 받아 칩 색
 * ② 출석 저장: 중2 정규 반은 book 정규, 고1 내신 반은 book 내신 · 수업 기록 창도 반의 시간표
 * ③ 주차별: 같은 섞임 · 예외 없는 다음 주로 가면 중2 내신 반으로 돌아오고 · 다시 돌아오면 예외
 * ④ 전체 시간표: 순수한 내신 시간표(ov 없이 다시 받음)
 * ⑤ 캘린더: [학년 예외] 표시·설정 창·저장 본문(시트 + 수파베이스 overrides)
 * ⑥ 047 전(overrides 열 없음): 예외 없이 동작, 설정 창은 안내만
 * ⑦ 다른 기간 수업 당기기(2026-10-24 수정 요청 김상우): 중2 정규 예외 주에 중2 내신 반을 옮긴 복사본이 보이고
 *    명단은 원본 내신 반을 따라간다 · [이 주만 시간 옮기기]의 옮길 주는 기간이 달라도 잠기지 않는다 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
const KST = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(ms));
const DAYK = ['일','월','화','수','목','금','토'];
const dayOf = ymd => new Intl.DateTimeFormat('ko-KR', { weekday: 'narrow', timeZone: 'Asia/Seoul' }).format(new Date(ymd + 'T12:00:00+09:00'));
const TS = KST(Date.now()), TD = dayOf(TS);
function wedOf(ymd){ const d = new Date(ymd + 'T12:00:00+09:00'); const dow = DAYK.indexOf(dayOf(ymd)); const off = -((dow + 6) % 7) + 2; return KST(d.getTime() + off * 864e5); }
const W0 = wedOf(TS), W1 = KST(new Date(W0 + 'T12:00:00+09:00').getTime() + 7 * 864e5);
const mk = (book, id, name, st, en, t, loc, roster) => ({ book, class_id: id, day: TD, start_time: st, end_time: en, location: loc, teacher: t, name, roster, kind: '' });
const CLASSES = [
  mk('정규', 'r01', '정리정독 중2', '5:00', '7:00', '은지', '정리정독', '가나 다라'),
  mk('정규', 'r02', '고1 가', '5:30', '7:00', '지원', '본원', '마바'),
  mk('정규', 'r03', '고3파이널A', '7:00', '9:00', '슈', '본원', '자차'),
  mk('내신', 'n01', '중2 서정(비상)', '5:00', '6:30', '은지', '정리정독', '가나'),
  mk('내신', 'n02', '고1 화정A', '5:30', '7:00', '지원', '본원', '마바 사아'),
  mk('내신', 'n03', '고3파이널A', '7:00', '9:00', '슈', '본원', '자차'),
];
const ATT = [{ date: TS, book: '정규', class_id: 'r01', student: '가나', status: '출석', memo: '' },
             { date: TS, book: '내신', class_id: 'n02', student: '마바', status: '출석', memo: '' }];
let LOGS = [];
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const b = await chromium.launch();
  const reqs = [], posts = [], legacy = [];
  let PERIODS;
  async function ctxOf(opts){
    opts = opts || {};
    PERIODS = [{ week_wednesday: W0, book: '내신', overrides: { '중2': '정규' } }, { week_wednesday: W1, book: '내신', overrides: {} }];
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
    await ctx.route(/fonts\.g/, r => r.abort());
    await ctx.route(/script\.google\.com|googleusercontent/, r => {
      if (r.request().method() === 'POST') legacy.push(r.request().postData() || '');
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"success"}' });
    });
    await ctx.route(/supabase\.co/, r => {
      const u = r.request().url(), m = r.request().method();
      reqs.push(u);
      const json = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
      if (m !== 'GET'){
        const body = r.request().postData() || '';
        posts.push({ url: u, body });
        if (/\/tt_period/.test(u)){   // 저장한 예외를 기억한다(upsert 흉내)
          try { JSON.parse(body).forEach(x => { const row = PERIODS.find(p => p.week_wednesday === x.week_wednesday); if (row){ row.book = x.book; if (x.overrides) row.overrides = x.overrides; } else PERIODS.push({ week_wednesday: x.week_wednesday, book: x.book, overrides: x.overrides || {} }); }); } catch(e){}
        }
        return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
      }
      if (/\/tt_period/.test(u)){
        if (/overrides/.test(u) && opts.noCol) return r.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"42703","message":"column tt_period.overrides does not exist"}' });
        return json(/overrides/.test(u) ? PERIODS : PERIODS.map(x => ({ week_wednesday: x.week_wednesday, book: x.book })));
      }
      if (/\/tt_classes/.test(u)){ const bm = /book=eq\.([^&]+)/.exec(u); const bk = bm ? decodeURIComponent(bm[1]) : ''; return json(CLASSES.filter(c => !bk || c.book === bk)); }
      if (/\/attendance/.test(u)){
        const g = /date=gte\.(\d{4}-\d{2}-\d{2})/.exec(u), l = /date=lte\.(\d{4}-\d{2}-\d{2})/.exec(u), bm = /book=eq\.([^&]+)/.exec(u);
        const bk = bm ? decodeURIComponent(bm[1]) : '';
        return json(ATT.filter(a => (!g || a.date >= g[1]) && (!l || a.date <= l[1]) && (!bk || a.book === bk)));
      }
      if (/\/tt_log/.test(u)) return json(LOGS);
      if (/\/tt_tasks/.test(u)) return r.fulfill({ status: 404, contentType: 'application/json', body: '{"code":"42P01"}' });
      return json([]);
    });
    return ctx;
  }
  let pwAns = 'sh'; const dlg = [];
  async function open(ctx, mode){
    const page = await ctx.newPage();
    page.on('dialog', d => { dlg.push(d.type() + ':' + d.message()); d.type() === 'prompt' ? d.accept(pwAns) : d.accept(); });
    await page.addInitScript(m => {
      sessionStorage.setItem('tt_mode', m); sessionStorage.setItem('tt_book', '내신');
      sessionStorage.setItem('tt_vmopen', '0'); sessionStorage.setItem('tt_chopen', '0');
    }, mode);
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    await page.waitForSelector('.today-head, .wk-mini, .calgrid', { timeout: 15000 });
    await page.waitForTimeout(600);
    return page;
  }
  const names = page => page.$$eval('.blk .bt .nm', e => e.map(x => x.textContent.replace(/\s+/g, ' ').trim()));

  /* ① 오늘 */
  let ctx = await ctxOf();
  let page = await open(ctx, 'today');
  await page.waitForFunction(() => document.querySelectorAll('.blk').length >= 3, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  let nm = await names(page);
  ok('① 오늘(내신 주): 중2 정규 반이 섞여 보인다', nm.some(x => /^정리정독 중2/.test(x)), JSON.stringify(nm));
  ok('① 오늘: 중2 내신 반은 빠진다', !nm.some(x => /서정\(비상\)/.test(x)), JSON.stringify(nm));
  ok('① 오늘: 고1·고3 내신 반은 그대로', nm.some(x => /고1 화정A/.test(x)) && nm.some(x => /고3파이널A/.test(x)) && !nm.some(x => /^고1 가/.test(x)), JSON.stringify(nm));
  let r = await page.evaluate(() => ({ badge: document.getElementById('period-badge').textContent, book: book,
    ok: [...document.querySelectorAll('.stus button.at-ok')].map(e => e.textContent), cls: classes.map(c => c.id + ':' + (c.book || '')).sort().join() }));
  ok('① 기간 칩에 "중2 정규"', /내신 주간/.test(r.badge) && /중2 정규/.test(r.badge), r.badge);
  ok('① 전역 시간표는 내신, 반마다 자기 시간표(book)가 적혀 있다', r.book === '내신' && r.cls === 'n02:내신,n03:내신,r01:정규', r.cls);
  ok('① 정규 출석(가나)과 내신 출석(마바) 모두 칩 색', r.ok.sort().join() === '가나,마바', JSON.stringify(r.ok));
  ok('① ttBoot가 정규·내신 출석을 모두 받았다', reqs.some(u => /attendance\?date=gte\./.test(u) && /book=eq\.%EC%A0%95%EA%B7%9C/.test(u)) && reqs.some(u => /attendance\?date=gte\./.test(u) && /book=eq\.%EB%82%B4%EC%8B%A0/.test(u)), JSON.stringify(reqs.filter(u => /attendance/.test(u))));

  /* ② 출석 저장·수업 기록 */
  posts.length = 0;
  await page.evaluate(() => [...document.querySelectorAll('.stus button')].find(e => e.textContent.trim() === '다라').click());
  await page.waitForSelector('.att-btns');
  await page.click('.att-btns .pick-ok');
  await page.waitForFunction(() => /기록 완료/.test(document.getElementById('status').textContent), null, { timeout: 10000 });
  let up = posts.find(p => /\/attendance/.test(p.url));
  ok('② 중2 정규 반 출석 저장 = book 정규', !!up && /"book":"정규"/.test(up.body) && /"class_id":"r01"/.test(up.body), up && up.body);
  posts.length = 0;
  await page.evaluate(() => [...document.querySelectorAll('.stus button')].find(e => e.textContent.trim() === '사아').click());
  await page.waitForSelector('.att-btns');
  await page.click('.att-btns .pick-ok');
  await page.waitForFunction(() => /기록 완료/.test(document.getElementById('status').textContent) && /사아/.test(document.getElementById('status').textContent), null, { timeout: 10000 });
  up = posts.find(p => /\/attendance/.test(p.url));
  ok('② 고1 내신 반 출석 저장 = book 내신', !!up && /"book":"내신"/.test(up.body) && /"class_id":"n02"/.test(up.body), up && up.body);
  await page.evaluate(() => { const blk = [...document.querySelectorAll('.blk')].find(e => /정리정독 중2/.test(e.textContent)); blk.querySelector('.crbtn').click(); });
  await page.waitForFunction(() => !document.getElementById('crpanel').hidden && window.CR && CR.c, null, { timeout: 15000 });
  r = await page.evaluate(() => ({ bk: CR.bk, meta: document.getElementById('cr-meta').textContent }));
  ok('② 중2 정규 반의 수업 기록 창은 정규 시간표로', r.bk === '정규' && /정규 주간/.test(r.meta), JSON.stringify(r));
  await page.evaluate(() => crClose());

  /* ③ 주차별 */
  await page.evaluate(() => setMode('week'));
  await page.waitForFunction(() => document.querySelectorAll('.wk-mini').length >= 3, null, { timeout: 15000 });
  await page.waitForTimeout(900);
  const minis = () => page.$$eval('.wk-mini', e => e.map(x => x.textContent.replace(/\s+/g, ' ')));
  let mn = await minis();
  ok('③ 주차별(이번 주): 중2 정규 반 섞임 · 중2 내신 반 없음', mn.some(x => /정리정독 중2/.test(x)) && !mn.some(x => /서정\(비상\)/.test(x)), JSON.stringify(mn));
  reqs.length = 0;
  await page.evaluate(() => moveWeek(1));
  await page.waitForFunction(() => [...document.querySelectorAll('.wk-mini')].some(e => /서정\(비상\)/.test(e.textContent)), null, { timeout: 15000 });
  await page.waitForTimeout(300);
  mn = await minis();
  r = await page.evaluate(() => ({ badge: document.getElementById('period-badge').textContent, ov: loadedOv }));
  ok('③ 예외 없는 다음 주로 가면 다시 받아 중2 내신 반으로', mn.some(x => /서정\(비상\)/.test(x)) && !mn.some(x => /정리정독 중2/.test(x)) && reqs.some(u => /tt_classes/.test(u)), JSON.stringify(mn));
  ok('③ 다음 주 기간 칩에는 예외 표기 없음', !/중2 정규/.test(r.badge) && r.ov === '', r.badge);
  await page.evaluate(() => moveWeek(-1));
  await page.waitForFunction(() => [...document.querySelectorAll('.wk-mini')].some(e => /정리정독 중2/.test(e.textContent)), null, { timeout: 15000 });
  await page.waitForTimeout(900);   // 캐시 그림 뒤 최신 조회까지
  mn = await minis();
  ok('③ 돌아오면 다시 예외 적용', mn.some(x => /정리정독 중2/.test(x)) && !mn.some(x => /서정\(비상\)/.test(x)), JSON.stringify(mn));

  /* ④ 전체 시간표 — 순수 */
  reqs.length = 0;
  await page.evaluate(() => setMode('all'));
  await page.waitForFunction(() => [...document.querySelectorAll('.wk-mini')].some(e => /서정\(비상\)/.test(e.textContent)), null, { timeout: 15000 });
  await page.waitForTimeout(300);
  mn = await minis();
  ok('④ 전체 시간표(내신)는 순수한 내신 — 중2 정규 반 없음', mn.some(x => /서정\(비상\)/.test(x)) && !mn.some(x => /정리정독 중2/.test(x)), JSON.stringify(mn));
  ok('④ 전체 시간표 조회에는 ov 파라미터가 없다(요청 1회 이상)', reqs.some(u => /tt_classes/.test(u)) && !reqs.some(u => /tt_classes\?book=eq\.%EC%A0%95%EA%B7%9C/.test(u)), JSON.stringify(reqs.filter(u => /tt_classes/.test(u))));

  /* ⑤ 캘린더 */
  await page.evaluate(() => setMode('cal'));
  await page.waitForSelector('.calgrid', { timeout: 15000 });
  await page.waitForTimeout(300);
  r = await page.evaluate(w => {
    const btns = [...document.querySelectorAll('.cal-ov')];
    const has = btns.filter(b => b.classList.contains('has')).map(b => b.textContent);
    return { n: btns.length, has, plain: btns.filter(b => !b.classList.contains('has')).map(b => b.textContent)[0] };
  }, W0);
  ok('⑤ 캘린더 주마다 [학년 예외] 버튼 · 이번 주는 "중2 정규"', r.n >= 4 && r.has.length === 1 && r.has[0] === '중2 정규' && r.plain === '학년 예외', JSON.stringify(r));
  /* 비밀번호(2026-10-15) — 틀리면 창이 안 열리고, 맞으면 열리며 그 뒤 탭 안에서는 다시 묻지 않는다 */
  pwAns = 'xx'; dlg.length = 0;
  await page.evaluate(() => document.querySelector('.cal-ov.has').click());
  await page.waitForTimeout(400);
  r = await page.evaluate(() => ({ modal: !!document.querySelector('.pex-list'), mem: sessionStorage.getItem('tt_period_pw') }));
  ok('⑤ 비밀번호가 틀리면 학년 예외 창이 열리지 않는다', !r.modal && r.mem === null && dlg.some(x => /^prompt:.*비밀번호/.test(x)) && dlg.some(x => /^alert:.*틀렸/.test(x)), JSON.stringify([r, dlg]));
  posts.length = 0; legacy.length = 0; dlg.length = 0;
  await page.evaluate(() => [...document.querySelectorAll('.cal-period button')].find(b => b.textContent === '정규' && !b.classList.contains('on-reg')).click());
  await page.waitForTimeout(400);
  ok('⑤ 비밀번호가 틀리면 [정규] 저장 요청을 보내지 않는다', !posts.some(p => /\/tt_period/.test(p.url)) && !legacy.some(x => /ttPeriodSet/.test(x)), JSON.stringify(posts.map(p => p.url)));
  pwAns = 'sh'; dlg.length = 0;
  await page.evaluate(() => document.querySelector('.cal-ov.has').click());
  await page.waitForSelector('.pex-list');
  ok('⑤ 비밀번호가 맞으면 창이 열리고 이 탭에 기억', dlg.filter(x => /^prompt:/.test(x)).length === 1 && await page.evaluate(() => sessionStorage.getItem('tt_period_pw')) === '1', JSON.stringify(dlg));
  r = await page.evaluate(() => ({ title: document.querySelector('#modal h3').textContent,
    rows: [...document.querySelectorAll('[data-pex]')].map(s => s.getAttribute('data-pex') + '=' + s.value), note: document.querySelector('#modal .mdesc').textContent }));
  ok('⑤ 설정 창: 중1·중2·고1·고2 줄, 중2 = 정규, 주 기준 내신 안내', r.rows.join() === '중1=,중2=정규,고1=,고2=' && /내신/.test(r.note) && /중3·고3/.test(r.note), JSON.stringify(r));
  posts.length = 0; legacy.length = 0;
  await page.selectOption('[data-pex="고1"]', '정규');
  await page.selectOption('[data-pex="고2"]', '내신');   // 주 기준과 같은 값 — 예외가 아니다
  dlg.length = 0;
  await page.evaluate(() => document.querySelector('#modal .mbtns .primary').click());
  await page.waitForFunction(() => /자동 반영/.test(document.getElementById('status').textContent), null, { timeout: 10000 });
  const sbp = posts.find(p => /\/tt_period/.test(p.url));
  const lg = legacy.map(x => { try { return JSON.parse(x); } catch(e){ return {}; } }).find(x => x.action === 'ttPeriodSet');
  ok('⑤ 저장: 시트에 week·book·ov, 수파베이스 upsert에 overrides {중2:정규, 고1:정규} (고2 내신은 빠짐)',
     !!lg && lg.week === W0 && lg.book === '내신' && JSON.stringify(lg.ov) === JSON.stringify({ '중2': '정규', '고1': '정규' }) &&
     !!sbp && /on_conflict=week_wednesday/.test(sbp.url) && /"overrides":\{"중2":"정규","고1":"정규"\}/.test(sbp.body), JSON.stringify([lg, sbp && sbp.body]));
  r = await page.evaluate(() => ({ lab: document.querySelector('.cal-ov.has').textContent, st: document.getElementById('status').textContent }));
  ok('⑤ 한 번 맞힌 뒤에는 다시 묻지 않는다', !dlg.some(x => /^prompt:/.test(x)), JSON.stringify(dlg));
  ok('⑤ 저장 뒤 캘린더 표기 "고1 정규 · 중2 정규"', r.lab === '고1 정규 · 중2 정규' && /고1 정규 · 중2 정규/.test(r.st), JSON.stringify(r));
  await page.evaluate(() => setMode('today'));
  await page.waitForFunction(() => /고1 정규/.test(document.getElementById('period-badge').textContent) && [...document.querySelectorAll('.blk')].some(e => /^고1 가/.test(e.querySelector('.nm').textContent.trim())), null, { timeout: 15000 });
  nm = await names(page);
  ok('⑤ 오늘로 돌아오면 고1도 정규 반으로 섞인다(다시 받음)', nm.some(x => /^고1 가/.test(x)) && !nm.some(x => /고1 화정A/.test(x)) && nm.some(x => /고3파이널A/.test(x)), JSON.stringify(nm));
  await page.close(); await ctx.close();

  /* ⑥ 047 전 */
  ctx = await ctxOf({ noCol: true });
  page = await open(ctx, 'today');
  await page.waitForFunction(() => document.querySelectorAll('.blk').length >= 3, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  nm = await names(page);
  r = await page.evaluate(() => ({ badge: document.getElementById('period-badge').textContent, col: ovColOk }));
  ok('⑥ overrides 열이 없으면 예외 없이 내신 그대로(중2 내신 반)', nm.some(x => /서정\(비상\)/.test(x)) && !nm.some(x => /정리정독 중2/.test(x)) && !/정규/.test(r.badge) && r.col === false, JSON.stringify([nm, r]));
  await page.evaluate(() => setMode('cal'));
  await page.waitForSelector('.calgrid');
  await page.evaluate(() => document.querySelector('.cal-ov').click());
  await page.waitForSelector('.pex-list');
  r = await page.evaluate(() => ({ err: document.querySelector('#modal .merr').textContent, dis: document.querySelector('#modal .mbtns .primary').disabled }));
  ok('⑥ 설정 창은 "마이그레이션 047" 안내 + 저장 잠김', /047/.test(r.err) && r.dis, JSON.stringify(r));
  await page.close(); await ctx.close();

  /* ⑦ 다른 기간 수업 당기기 */
  const CP = 'w' + TS.slice(2).replace(/-/g, '') + 'a';
  CLASSES.push(Object.assign(mk('내신', CP, '중2 서정(비상)', '6:30', '8:00', '은지', '정리정독', ''), {}));
  LOGS = [{ id: 1, kind: '주간반이동', student: '', book: '내신', from_class_id: 'n01', from_class: '중2 서정(비상)',
            to_class_id: CP, to_class: '중2 서정(비상)', reason: '시험 전 당겨서', apply_date: W1, at: TS + 'T01:00:00+00:00' }];
  ctx = await ctxOf();
  page = await open(ctx, 'today');
  await page.waitForFunction(() => document.querySelectorAll('.blk').length >= 4, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  r = await page.evaluate(id => { const c = classes.find(x => x.id === id); return c ? { book: c.book, st: c.students.join(' ') } : null; }, CP);
  nm = await names(page);
  ok('⑦ 정규 예외 주에 옮겨 온 중2 내신 복사본이 오늘 시간표에 보인다', !!r && nm.some(x => /서정\(비상\)/.test(x)), JSON.stringify([r, nm]));
  ok('⑦ 복사본은 내신 시간표 반이고 명단은 원본(n01) 그대로', !!r && r.book === '내신' && r.st === '가나', JSON.stringify(r));
  ok('⑦ 중2 원본 내신 반(n01)은 여전히 빠진다', await page.evaluate(() => !classes.some(c => c.id === 'n01')));
  r = await page.evaluate(() => {
    const c = { id: 'n01', cls: '중2 서정(비상)', book: '내신', day: '토', start: '5:00', end: '6:30', students: [] };
    const lock = weekSelHtml('x', weekStart, c), free = weekSelHtml('x', weekStart, c, true);
    return { lock: /disabled/.test(lock), free: /disabled/.test(free) };
  });
  ok('⑦ 옮길 주 선택: 반 전체 옮기기는 기간이 달라도 잠기지 않는다(학생 옮기기는 그대로 잠금)', r.lock && !r.free, JSON.stringify(r));
  await page.close(); await ctx.close();

  await b.close(); srv.close();
  console.log(fail ? ('통과 ' + pass + ' / 실패 ' + fail) : ('✓ ' + pass + '건 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
