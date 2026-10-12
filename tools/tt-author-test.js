#!/usr/bin/env node
/* 시간표 이동·출석 기록의 '작성자'(048) — 2026-10-12 원장님 "작성자 칸을 더해 누가 이동했는지 알 수 있게"
 *   NODE_PATH=$(npm root -g) node tools/tt-author-test.js
 * ① 허브 로그인 이름이 있으면 tt_log·attendance 쓰기에 author로 실린다(이 기기 이름보다 우선)
 * ② 로그인이 없으면 이 기기에 적어 둔 이름(tt_task_who), 그것도 없으면 빈 값
 * ③ 변경사항 패널: 작성자 알약, 048 뒤 기록인데 비면 '이름 없음', 그 전 기록은 표시 없음, 검색도 이름으로
 * ④ 048 적용 전(열 없음 PGRST204): author 없이 다시 쓰고 그 뒤 쓰기는 author를 싣지 않는다, 결석 조회도 옛 열로 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': (/\.js$/.test(f) ? 'text/javascript' : 'text/html') + ';charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
const kst = new Date(Date.now() + 9 * 3600e3);
const today = kst.toISOString().slice(0, 10);
const todayDay = ['일','월','화','수','목','금','토'][kst.getUTCDay()];
const CLASSES = [
  { class_id: 'r01', book: '정규', day: todayDay, start_time: '5:30', end_time: '7:00', location: '본원', teacher: '현정', name: '고2 가', roster: '가나 다라', kind: '' },
  { class_id: 'r02', book: '정규', day: todayDay, start_time: '7:00', end_time: '8:30', location: '본원', teacher: '현정', name: '고2 가', roster: '마바', kind: '' }];
const LOGS = [
  { id: 3, at: today + 'T10:00:00+09:00', kind: '영구', student: '가나', from_class_id: 'r01', from_class: '고2 가', to_class_id: 'r02', to_class: '고2 가', reason: '사유 A', book: '정규', apply_date: null, author: '김지원' },
  { id: 2, at: today + 'T09:00:00+09:00', kind: '영구', student: '다라', from_class_id: 'r01', from_class: '고2 가', to_class_id: 'r02', to_class: '고2 가', reason: '사유 B', book: '정규', apply_date: null, author: '' },
  { id: 1, at: '2026-09-01T09:00:00+09:00', kind: '영구', student: '마바', from_class_id: 'r02', from_class: '고2 가', to_class_id: 'r01', to_class: '고2 가', reason: '옛 기록', book: '정규', apply_date: null, author: '' }];
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
const NOCOL = t => JSON.stringify({ code: 'PGRST204', details: null, hint: null, message: "Could not find the 'author' column of '" + t + "' in the schema cache" });

(async () => {
  const b = await chromium.launch();
  async function open(opts){
    opts = opts || {};
    const writes = [], gets = [];
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
    await ctx.route(/fonts\.g/, r => r.abort());
    await ctx.route(/script\.google\.com|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"success"}' }));
    await ctx.route(/supabase\.co/, r => {
      const req = r.request(), u = req.url(), m = req.method();
      const json = (x, st) => r.fulfill({ status: st || 200, contentType: 'application/json', body: typeof x === 'string' ? x : JSON.stringify(x) });
      if (/\/auth\/v1\/token/.test(u)) return json({ access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u-shared' } });
      if (m !== 'GET'){
        let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (e) {}
        const hasAuthor = Array.isArray(body) ? body.some(x => 'author' in x) : !!(body && 'author' in body);
        writes.push({ m, u: u.replace(/^.*\/rest\/v1/, ''), body, hasAuthor });
        if (opts.nocol && hasAuthor) return json(NOCOL(/tt_log/.test(u) ? 'tt_log' : 'attendance'), 400);
        return json(m === 'PATCH' ? '[{"id":1}]' : '[]', m === 'PATCH' ? 200 : 201);
      }
      gets.push(u.replace(/^.*\/rest\/v1/, ''));
      if (/teacher_accounts/.test(u)) return json(opts.login ? [{ display_name: opts.login, login_id: 'x' }] : []);
      if (/\/tt_classes/.test(u)) return json(CLASSES);
      if (/\/tt_log/.test(u)) return json(/order=at\.desc/.test(u) ? LOGS : []);
      if (/\/attendance/.test(u)){
        if (opts.nocol && /author/.test(u)) return json(NOCOL('attendance'), 400);
        return json(/status=eq/.test(u) ? [{ id: 9, date: today, book: '정규', class_id: 'r01', student: '다라', memo: '병결', updated_at: today + 'T11:00:00+09:00', author: /author/.test(u) ? '박언호' : undefined }] : []);
      }
      return json([]);
    });
    const page = await ctx.newPage();
    await page.addInitScript(({ who, login }) => {
      sessionStorage.setItem('tt_mode', 'today'); sessionStorage.setItem('tt_book', '정규');
      sessionStorage.setItem('tt_chopen', '0'); sessionStorage.setItem('tt_vmopen', '0');
      localStorage.removeItem('tt_task_who'); localStorage.removeItem('shueguk_teacher_session_v2');
      if (who) localStorage.setItem('tt_task_who', who);
      if (login) localStorage.setItem('shueguk_teacher_session_v2', JSON.stringify({ access_token: 'a', refresh_token: 'b', expires_at: Math.floor(Date.now() / 1000) + 7200, user: { id: 'u-kim' } }));
    }, { who: opts.who || '', login: opts.login || '' });
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    await page.waitForSelector('.scrollwrap .fitgrid .blk', { timeout: 30000 });
    if (opts.login) await page.waitForFunction(() => typeof alimBy === 'string' && alimBy !== '', null, { timeout: 10000 });
    await page.waitForTimeout(300);
    return { page, ctx, writes, gets };
  }
  const run = (page, body) => page.evaluate(b => new Promise(res => post(b, '', res)), body);
  const att = { action: 'attendSet', date: today, book: '정규', classId: 'r01', student: '가나', status: '출석', memo: '' };
  const once = { action: 'timetableMove', book: '정규', student: '가나', fromId: 'r01', toId: 'r02', moveType: 'once', reason: '테스트', date: today };
  const mk = { action: 'attendMakeupSet', date: today, book: '정규', classId: 'r01', student: '가나', plan: '영상보충', done: '', mkMemo: '' };

  /* ① 허브 로그인 이름 우선 */
  let { page, ctx, writes } = await open({ login: '김지원 선생님', who: '박언호' });
  let res = await run(page, att);
  let w = writes.find(x => /\/attendance/.test(x.u) && x.m === 'POST');
  ok('① 출석 저장 성공', res && res.result === 'success', JSON.stringify(res));
  ok('① 출석 기록 author = 허브 로그인 이름(선생님 뗀 것)', w && w.body[0].author === '김지원' && w.body[0].status === '출석', JSON.stringify(w && w.body));
  res = await run(page, once);
  w = writes.find(x => /\/tt_log/.test(x.u) && x.m === 'POST');
  ok('① 1회 이동 기록 author = 김지원', res && res.result === 'success' && w && w.body.author === '김지원' && w.body.kind === '1회', JSON.stringify(w && w.body));
  writes.length = 0;
  res = await run(page, mk);
  w = writes.find(x => /\/attendance/.test(x.u) && x.m === 'PATCH');
  ok('① 보충 처리 PATCH에도 author', w && w.body.author === '김지원' && w.body.makeup_plan === '영상보충', JSON.stringify(w && w.body));
  await ctx.close();

  /* ② 로그인 없음 → 이 기기 이름 → 빈 값 */
  ({ page, ctx, writes } = await open({ who: '박언호' }));
  await run(page, att);
  w = writes.find(x => /\/attendance/.test(x.u));
  ok('② 로그인 없으면 이 기기에 적어 둔 이름', w && w.body[0].author === '박언호', JSON.stringify(w && w.body));
  await ctx.close();
  ({ page, ctx, writes } = await open({}));
  await run(page, att);
  w = writes.find(x => /\/attendance/.test(x.u));
  ok('② 이름이 없으면 author 빈 값(칸은 보냄)', w && w.hasAuthor && w.body[0].author === '', JSON.stringify(w && w.body));

  /* ③ 변경사항 패널 */
  let gets;
  ({ page, ctx, writes, gets } = await open({ who: '박언호' }));
  await page.evaluate(() => { setMode('all'); chOpenFromBar(); });
  await page.waitForSelector('#ch-list .ch-item', { timeout: 10000 });
  let r = await page.evaluate(() => [...document.querySelectorAll('#ch-list .ch-item')].map(e => ({
    nm: e.querySelector('b') ? e.querySelector('b').textContent : '',
    who: e.querySelector('.lr .who') ? e.querySelector('.lr .who').textContent : null,
    none: !!e.querySelector('.lr .who.none') })));
  const by = n => r.find(x => x.nm === n);
  ok('③ 작성자 알약 김지원', by('가나') && by('가나').who === '김지원' && !by('가나').none, JSON.stringify(r));
  ok('③ 048 뒤 기록인데 비면 이름 없음', by('다라') && /이름 없음/.test(by('다라').who || '') && by('다라').none, JSON.stringify(by('다라')));
  ok('③ 그 전 기록은 표시 없음', by('마바') && by('마바').who === null, JSON.stringify(by('마바')));
  ok('③ 결석 조회에 author 열', gets.some(u => /\/attendance\?status=eq/.test(u) && /author/.test(u)), gets.filter(u => /attendance/.test(u)).join('\n'));
  await page.evaluate(() => { document.getElementById('ch-q').value = '김지원'; document.getElementById('ch-q').dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(200);
  r = await page.evaluate(() => [...document.querySelectorAll('#ch-list .ch-item b')].map(e => e.textContent));
  ok('③ 이름으로 검색', r.length === 1 && r[0] === '가나', JSON.stringify(r));
  await ctx.close();

  /* ④ 열 없음 폴백 */
  ({ page, ctx, writes, gets } = await open({ who: '박언호', nocol: true }));
  res = await run(page, once);
  let ws = writes.filter(x => /\/tt_log/.test(x.u) && x.m === 'POST');
  ok('④ 열 없음: author 있는 쓰기 400 → author 없이 다시 써서 성공', res && res.result === 'success' && ws.length === 2 && ws[0].hasAuthor && !ws[1].hasAuthor, JSON.stringify([res, ws.map(x => x.hasAuthor)]));
  writes.length = 0;
  res = await run(page, att);
  ws = writes.filter(x => /\/attendance/.test(x.u));
  ok('④ 그 뒤 쓰기는 처음부터 author 없이 한 번', res && res.result === 'success' && ws.length === 1 && !ws[0].hasAuthor, JSON.stringify(ws.map(x => x.hasAuthor)));
  await page.evaluate(() => { setMode('all'); chOpenFromBar(); });
  await page.waitForSelector('#ch-list .ch-item', { timeout: 10000 });
  r = await page.evaluate(() => [...document.querySelectorAll('#ch-list .ch-item')].length);
  ok('④ 결석 조회도 옛 열로 다시 받아 패널이 그려진다', r >= 3 && gets.some(u => /\/attendance\?status=eq/.test(u) && !/author/.test(u)), String(r));
  await ctx.close();

  await b.close(); srv.close();
  console.log((fail ? '✗ ' : '✓ ') + pass + ' 통과' + (fail ? ' · ' + fail + ' 실패' : ''));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
