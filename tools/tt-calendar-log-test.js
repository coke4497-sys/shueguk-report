#!/usr/bin/env node
/* 슈국 캘린더 수정 기록(049) — 2026-10-12 원장님 "캘린더의 수정사항들을 누가 했는지 기록으로"
 *   NODE_PATH=$(npm root -g) node tools/tt-calendar-log-test.js
 * ① 기간·학년 예외·메모·지필 기간(새로·고침·지움)을 저장하면 tt_calendar_log에 한 줄(전·후 값 + 작성자)
 * ② 값이 그대로면 기록하지 않는다
 * ③ 표가 없으면(049 전, 404) 저장은 그대로 성공하고 그 뒤로는 기록을 보내지 않는다 */
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
const CLASSES = [{ class_id: 'r01', book: '정규', day: todayDay, start_time: '5:30', end_time: '7:00', location: '본원', teacher: '현정', name: '고2 가', roster: '가나', kind: '' }];
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const b = await chromium.launch();
  async function open(opts){
    opts = opts || {};
    const logs = [];
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
    await ctx.route(/fonts\.g/, r => r.abort());
    await ctx.route(/script\.google\.com|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"success"}' }));
    await ctx.route(/supabase\.co/, r => {
      const req = r.request(), u = req.url(), m = req.method();
      const json = (x, st) => r.fulfill({ status: st || 200, contentType: 'application/json', body: typeof x === 'string' ? x : JSON.stringify(x) });
      if (/\/auth\/v1\/token/.test(u)) return json({ access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u' } });
      if (/tt_calendar_log/.test(u)){
        if (opts.notable) return json({ code: 'PGRST205', message: "Could not find the table 'public.tt_calendar_log'" }, 404);
        logs.push(JSON.parse(req.postData())); return json('', 201);
      }
      if (m !== 'GET') return json(m === 'PATCH' ? '[{"id":5}]' : (/exam_sched/.test(u) ? '[{"id":7}]' : '[]'), m === 'PATCH' ? 200 : 201);
      if (/\/tt_classes/.test(u)) return json(CLASSES);
      if (/\/tt_memo\?date=eq/.test(u)) return json([{ memo: '옛 메모' }]);
      if (/\/tt_period\?week_wednesday=eq/.test(u)) return json([{ book: '정규', overrides: { '중2': '내신' } }]);
      if (/\/exam_sched\?id=eq/.test(u)) return json([{ kind: '기간', school: '화정고', start_date: '2026-10-14', end_date: '2026-10-16', text: '' }]);
      return json([]);
    });
    const page = await ctx.newPage();
    await page.addInitScript(() => { sessionStorage.setItem('tt_mode', 'today'); sessionStorage.setItem('tt_book', '정규');
      sessionStorage.setItem('tt_chopen', '0'); sessionStorage.setItem('tt_vmopen', '0'); localStorage.setItem('tt_task_who', '박언호'); });
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    await page.waitForSelector('.scrollwrap .fitgrid .blk', { timeout: 30000 });
    await page.waitForTimeout(300);
    return { page, ctx, logs };
  }
  const run = (page, body) => page.evaluate(b => new Promise(res => post(b, '', res)), body);
  const settle = page => page.waitForTimeout(250);

  let { page, ctx, logs } = await open();
  let res = await run(page, { action: 'ttPeriodSet', week: '2026-10-21', book: '내신' }); await settle(page);
  ok('① 기간 저장 성공·기록 한 줄', res.result === 'success' && logs.length === 1, JSON.stringify(logs));
  ok('① 기간 기록 내용', logs[0] && logs[0].what === '기간' && logs[0].target === '2026-10-21' && logs[0].before === '정규' && logs[0].after === '내신' && logs[0].author === '박언호', JSON.stringify(logs[0]));
  logs.length = 0;
  await run(page, { action: 'ttPeriodSet', week: '2026-10-21', book: '정규', ov: { '중2': '정규' } }); await settle(page);
  ok('① 학년 예외만 바뀌면 학년 예외 한 줄(기간 그대로 → 기간 기록 없음)', logs.length === 1 && logs[0].what === '학년 예외' && logs[0].before === '중2 내신' && logs[0].after === '중2 정규', JSON.stringify(logs));
  logs.length = 0;
  await run(page, { action: 'ttPeriodSet', week: '2026-10-21', book: '' }); await settle(page);
  ok('① 기간 지움', logs.length === 1 && logs[0].action === '지움' && logs[0].after === '미지정(정규)', JSON.stringify(logs));
  logs.length = 0;
  await run(page, { action: 'ttMemoSet', date: today, memo: '새 메모' }); await settle(page);
  ok('① 메모 저장 전·후', logs.length === 1 && logs[0].what === '메모' && logs[0].before === '옛 메모' && logs[0].after === '새 메모', JSON.stringify(logs));
  logs.length = 0;
  await run(page, { action: 'ttMemoSet', date: today, memo: '옛 메모' }); await settle(page);
  ok('② 같은 메모면 기록 없음', logs.length === 0, JSON.stringify(logs));
  await run(page, { action: 'ttMemoSet', date: today, memo: '' }); await settle(page);
  ok('① 메모 지움', logs.length === 1 && logs[0].action === '지움' && logs[0].before === '옛 메모', JSON.stringify(logs));
  logs.length = 0;
  await run(page, { action: 'examSchedSet', kind: '기간', school: '능곡고', start: '2026-10-20', end: '2026-10-22', text: '' }); await settle(page);
  ok('① 지필 기간 새로', logs.length === 1 && logs[0].what === '지필 기간' && logs[0].before === '' && /능곡고 · 2026-10-20~2026-10-22/.test(logs[0].after), JSON.stringify(logs));
  logs.length = 0;
  await run(page, { action: 'examSchedSet', row: 5, kind: '기간', school: '화정고', start: '2026-10-15', end: '2026-10-16', text: '' }); await settle(page);
  ok('① 지필 기간 고침 전·후', logs.length === 1 && /10-14~2026-10-16/.test(logs[0].before) && /10-15~2026-10-16/.test(logs[0].after), JSON.stringify(logs));
  logs.length = 0;
  await run(page, { action: 'examSchedSet', row: 5, del: 1, school: '화정고' }); await settle(page);
  ok('① 지필 지움', logs.length === 1 && logs[0].action === '지움' && /화정고/.test(logs[0].before) && logs[0].after === '', JSON.stringify(logs));
  await ctx.close();

  ({ page, ctx, logs } = await open({ notable: true }));
  res = await run(page, { action: 'ttMemoSet', date: today, memo: '새 메모' }); await settle(page);
  ok('③ 표 없음: 메모 저장은 성공', res.result === 'success', JSON.stringify(res));
  const off = await page.evaluate(() => typeof calLogOn !== 'undefined' ? calLogOn : 'scoped');
  res = await run(page, { action: 'ttPeriodSet', week: '2026-10-21', book: '내신' });
  ok('③ 그 뒤 저장도 성공', res.result === 'success' && off !== true, JSON.stringify([res, off]));
  await ctx.close();

  await b.close(); srv.close();
  console.log((fail ? '✗ ' : '✓ ') + pass + ' 통과' + (fail ? ' · ' + fail + ' 실패' : ''));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
