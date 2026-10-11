#!/usr/bin/env node
/* 오늘의 시간표 — 지난 날짜로 돌아가기(최대 4주 전) · 2026-10-11 사용자 요청
 *   "오늘의 시간표에서 이전 날짜를 선택해 돌아갈 수 있게 해주세요. 이전 4주까지"
 *   NODE_PATH=$(npm root -g) node tools/tt-daynav-test.js
 * 확인 대상 —
 * ① 오늘: 머리 '오늘의 시간표' · 날짜 줄([‹ 전날][드롭다운 29개][다음날 ›]) · [다음날] 잠김 · 안내 줄 없음
 * ② [‹ 전날]: 머리 '지난 시간표 — 어제' · 안내 줄 · [오늘로] · ttBoot가 그 날짜의 출석·휴무를 받음 · 출석 칩 색 · 교사 휴무 줄
 * ③ 드롭다운으로 4주 전 → [‹ 전날] 잠김 · 29일 전은 거절
 * ④ 지난 날짜에서 학생을 누르면 출석 창이 그 날짜 · [출석]을 누르면 그 날짜로 저장
 * ⑤ [오늘로] → 오늘 · 탭을 옮겼다 돌아오면 오늘(출석도 다시 받음) · 지난 날짜의 [수업 기록]은 지난 수업 창
 * ⑥ 휴대폰 목록 보기도 같은 날짜 줄 */
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
const ago = n => KST(Date.now() - n * 864e5);
const TS = ago(0), Y1 = ago(1), Y28 = ago(28), Y29 = ago(29);
const label = y => (+y.slice(5,7)) + '/' + (+y.slice(8,10)) + ' (' + dayOf(y) + ')';
// 요일마다 반 하나(지원T 본원) — 어느 날짜를 봐도 수업 카드가 있다
const CLASSES = DAYK.map((d, i) => ({ class_id: 'r0' + (i + 1), book: '정규', day: d, start_time: '5:30', end_time: '7:00',
  location: '본원', teacher: '지원', name: '고1 가', roster: '가나 다라', kind: '' }));
const cidOf = ymd => 'r0' + (DAYK.indexOf(dayOf(ymd)) + 1);
const ATT = [{ date: Y1, book: '정규', class_id: cidOf(Y1), student: '가나', status: '출석', memo: '' },
             { date: Y1, book: '정규', class_id: cidOf(Y1), student: '다라', status: '결석', memo: '병결' }];
const OFFS = [{ off_date: Y1, teacher: '지원', reason: '월 직보' }];
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const b = await chromium.launch();
  const reqs = [];   // 수파베이스 요청 기록
  const posts = [];
  async function ctxOf(w){
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, timezoneId: 'Asia/Seoul' });
    await ctx.route(/fonts\.g/, r => r.abort());
    await ctx.route(/script\.google\.com|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"success"}' }));
    await ctx.route(/supabase\.co/, r => {
      const u = r.request().url(), m = r.request().method();
      reqs.push(u);
      const json = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
      if (m !== 'GET'){ posts.push({ url: u, body: r.request().postData() || '' }); return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' }); }
      if (/\/tt_classes/.test(u)) return json(CLASSES);
      if (/\/attendance/.test(u)){
        const g = /date=gte\.(\d{4}-\d{2}-\d{2})/.exec(u), l = /date=lte\.(\d{4}-\d{2}-\d{2})/.exec(u);
        return json(ATT.filter(a => (!g || a.date >= g[1]) && (!l || a.date <= l[1])));
      }
      if (/\/tt_teacher_days_off/.test(u)){
        const g = /off_date=gte\.(\d{4}-\d{2}-\d{2})/.exec(u), l = /off_date=lte\.(\d{4}-\d{2}-\d{2})/.exec(u);
        return json(OFFS.filter(a => (!g || a.off_date >= g[1]) && (!l || a.off_date <= l[1])));
      }
      return json([]);   // tt_log · tt_memo · tt_period · class_notes · tt_tasks …
    });
    return ctx;
  }
  async function open(ctx){
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      sessionStorage.setItem('tt_mode', 'today'); sessionStorage.setItem('tt_book', '정규');
      sessionStorage.setItem('tt_vmopen', '0'); sessionStorage.setItem('tt_chopen', '0');
    });
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    await page.waitForSelector('.today-head', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('.blk').length > 0, null, { timeout: 15000 });
    await page.waitForTimeout(400);
    return page;
  }
  const head = page => page.$eval('.today-head', e => ({ t: e.textContent, past: e.classList.contains('past') }));
  const attReqDates = () => reqs.filter(u => /\/attendance\?date=gte/.test(u)).map(u => /date=gte\.(\d{4}-\d{2}-\d{2})/.exec(u)[1]);

  const wide = await ctxOf(1300);
  /* ① 오늘 */
  let page = await open(wide);
  let h = await head(page);
  ok('① 머리 = 오늘의 시간표 — 오늘 날짜 · 정규', h.t === '오늘의 시간표 — ' + label(TS) + ' · 정규' && !h.past, h.t);
  let nav = await page.evaluate(() => {
    const n = document.querySelector('.daynav'); if (!n) return null;
    const sel = n.querySelector('#dn-sel');
    return { opts: [...sel.options].map(o => o.textContent), vals: [...sel.options].map(o => o.value), cur: sel.value,
             prev: n.querySelector('.dn-prev').disabled, next: n.querySelector('.dn-next').disabled,
             today: !!n.querySelector('.dn-today'), note: !!document.querySelector('.day-note') };
  });
  ok('① 날짜 줄이 있다', !!nav);
  ok('① 드롭다운 29개(오늘~4주 전) · 첫 줄 "· 오늘" · 마지막 "· 4주 전"', nav && nav.opts.length === 29 && /· 오늘$/.test(nav.opts[0]) && /· 4주 전$/.test(nav.opts[28]) && nav.vals[0] === TS && nav.vals[28] === Y28, nav && JSON.stringify([nav.opts[0], nav.opts[28], nav.vals[28]]));
  ok('① 오늘: [다음날] 잠김 · [전날] 열림 · [오늘로] 없음 · 안내 줄 없음', nav && nav.next && !nav.prev && !nav.today && !nav.note, JSON.stringify(nav));
  ok('① 오늘: ttBoot가 오늘 출석을 받았다', attReqDates().indexOf(TS) >= 0, JSON.stringify(attReqDates()));

  /* ② 전날 */
  reqs.length = 0;
  await page.click('.daynav .dn-prev');
  await page.waitForFunction(y => /지난 시간표/.test(document.querySelector('.today-head').textContent) && document.querySelector('.stus button.at-ok'), Y1, { timeout: 15000 });
  await page.waitForTimeout(300);
  h = await head(page);
  ok('② 머리 = 지난 시간표 — 어제 날짜 (붉은 표시)', h.t === '지난 시간표 — ' + label(Y1) + ' · 정규' && h.past, h.t);
  let r = await page.evaluate(() => ({
    note: (document.querySelector('.day-note') || {}).textContent || '', today: !!document.querySelector('.dn-today'),
    sel: document.querySelector('#dn-sel').value, next: document.querySelector('.dn-next').disabled,
    okChip: [...document.querySelectorAll('.stus button.at-ok')].map(e => e.textContent),
    absChip: [...document.querySelectorAll('.stus button.at-abs')].map(e => e.textContent),
    sum: document.querySelector('.today-sum').textContent,
    off: (document.querySelector('.toff-strip') || {}).textContent || '',
    badge: document.getElementById('period-badge').textContent }));
  ok('② 안내 줄: 그 날짜 시간표를 보고 있다 + 출석은 그 날짜로 저장', /지난 시간표|시간표를 보고 있습니다/.test(r.note) && r.note.indexOf(label(Y1)) >= 0 && /그 날짜의 출석으로 저장/.test(r.note), r.note);
  ok('② [오늘로] 보임 · 드롭다운 = 어제 · [다음날] 열림', r.today && r.sel === Y1 && !r.next, JSON.stringify([r.today, r.sel, r.next]));
  ok('② ttBoot가 어제 날짜로 출석·휴무를 받았다', attReqDates().indexOf(Y1) >= 0 && reqs.some(u => /tt_teacher_days_off\?off_date=gte\./.test(u) && u.indexOf(Y1) >= 0), JSON.stringify(reqs.filter(u => /attendance|days_off/.test(u))));
  ok('② 어제 출석 칩: 가나 출석(초록) · 다라 결석', r.okChip.join() === '가나' && r.absChip.join() === '다라', JSON.stringify([r.okChip, r.absChip]));
  ok('② 출석 요약 = 출석 1 · 지각 0 · 결석 1', /출석 1 · 지각 0 · 결석 1/.test(r.sum), r.sum);
  ok('② 교사 휴무 줄: 그 날짜 표기 + 지원T OFF (월 직보)', r.off.indexOf(label(Y1) + ' 교사 휴무') >= 0 && /지원T OFF \(월 직보\)/.test(r.off), r.off);
  ok('② 기간 칩이 그 날짜의 주를 가리킨다', (() => { const m = /(\d+)\/(\d+)~(\d+)\/(\d+)/.exec(r.badge); if (!m) return false;
       const y = +Y1.slice(0,4), f = new Date(y, +m[1]-1, +m[2]), t = new Date(y, +m[3]-1, +m[4]); const d = new Date(Y1 + 'T00:00:00');
       if (t < f) t.setFullYear(t.getFullYear() + 1); return d >= f && d <= t; })(), r.badge);

  /* ③ 4주 전 · 한계 */
  await page.selectOption('#dn-sel', Y28);
  await page.waitForFunction(l => document.querySelector('.today-head').textContent.indexOf(l) >= 0, label(Y28), { timeout: 15000 });
  await page.waitForTimeout(200);
  r = await page.evaluate(() => ({ prev: document.querySelector('.dn-prev').disabled, next: document.querySelector('.dn-next').disabled, sel: document.querySelector('#dn-sel').value }));
  ok('③ 4주 전: [전날] 잠김 · [다음날] 열림 · 드롭다운 = 4주 전', r.prev && !r.next && r.sel === Y28, JSON.stringify(r));
  await page.evaluate(() => shiftDay(-1));
  await page.waitForTimeout(300);
  r = await page.evaluate(() => ({ head: document.querySelector('.today-head').textContent, st: document.getElementById('status').textContent }));
  ok('③ 29일 전은 거절(안내) · 화면은 4주 전 그대로', r.head.indexOf(label(Y28)) >= 0 && /4주 전까지만/.test(r.st), JSON.stringify(r));
  ok('③ 지난 날짜에서는 "지금 수업 중" 등 시각 표시 없음', (await page.$$('.dl-now, .dl-past')).length === 0);

  /* ④ 지난 날짜의 출석 창·저장 */
  await page.selectOption('#dn-sel', Y1);
  await page.waitForFunction(() => document.querySelector('.stus button.at-abs'), null, { timeout: 15000 });
  await page.waitForTimeout(200);
  await page.click('.stus button.at-abs');
  await page.waitForSelector('.att-btns');
  r = await page.evaluate(() => ({ desc: document.querySelector('.mdesc').textContent, abs: document.querySelector('.att-btns .pick-abs.on') !== null, memo: document.getElementById('att-memo').value }));
  ok('④ 출석 창에 어제 날짜 · 결석 상태 · 메모 "병결"', r.desc.indexOf(Y1) >= 0 && r.abs && r.memo === '병결', JSON.stringify(r));
  posts.length = 0;
  await page.click('.att-btns .pick-ok');
  await page.waitForFunction(() => /기록 완료/.test(document.getElementById('status').textContent), null, { timeout: 10000 });
  const up = posts.find(p => /\/attendance/.test(p.url));
  ok('④ [출석] 저장 = 그 날짜(어제)로 attendance 저장', !!up && up.body.indexOf('"date":"' + Y1 + '"') >= 0 && /"student":"다라"/.test(up.body), up && up.body);
  r = await page.evaluate(() => ({ ok: [...document.querySelectorAll('.stus button.at-ok')].map(e => e.textContent).sort().join(), st: document.getElementById('status').textContent }));
  ok('④ 화면 칩도 바뀜(가나·다라 출석) · 상태 줄에 날짜', r.ok === '가나,다라' && r.st.indexOf(Y1) >= 0, JSON.stringify(r));

  /* ⑤ 오늘로 · 탭 왕복 · 수업 기록 */
  await page.click('.crbtn');
  await page.waitForFunction(() => !document.getElementById('crpanel').hidden && /지난 수업/.test(document.getElementById('cr-meta').textContent), null, { timeout: 15000 });
  r = await page.evaluate(() => document.getElementById('cr-meta').textContent);
  ok('⑤ 지난 날짜의 [수업 기록] = 그 날짜의 지난 수업 창', r.indexOf(label(Y1).replace(' (', ' (')) >= 0 && /지난 수업/.test(r), r);
  await page.evaluate(() => crClose());
  await page.waitForTimeout(200);
  reqs.length = 0;
  await page.click('.dn-today');
  await page.waitForFunction(() => /오늘의 시간표/.test(document.querySelector('.today-head').textContent), null, { timeout: 15000 });
  await page.waitForTimeout(300);
  r = await page.evaluate(() => ({ note: !!document.querySelector('.day-note'), today: !!document.querySelector('.dn-today'), ok: document.querySelectorAll('.stus button.at-ok').length, sel: document.querySelector('#dn-sel').value }));
  ok('⑤ [오늘로]: 오늘 화면 · 안내 줄 없음 · 어제 출석 칩이 남지 않음', !r.note && !r.today && r.ok === 0 && r.sel === TS && attReqDates().indexOf(TS) >= 0, JSON.stringify(r));
  await page.click('.daynav .dn-prev');
  await page.waitForFunction(() => /지난 시간표/.test(document.querySelector('.today-head').textContent) && document.querySelector('.stus button.at-ok'), null, { timeout: 15000 });
  reqs.length = 0;   // 주차별로 가는 순간 오늘 것으로 다시 받는지(어제 기록이 남지 않는지)
  await page.evaluate(() => setMode('week'));
  await page.waitForTimeout(600);
  await page.evaluate(() => setMode('today'));
  await page.waitForFunction(() => /오늘의 시간표/.test(document.querySelector('.today-head').textContent), null, { timeout: 15000 });
  await page.waitForTimeout(400);
  r = await page.evaluate(() => ({ ok: document.querySelectorAll('.stus button.at-ok').length, note: !!document.querySelector('.day-note') }));
  ok('⑤ 지난 날짜를 보다 주차별 → 오늘 탭: 오늘로 돌아오고 오늘 출석을 다시 받는다', r.ok === 0 && !r.note && attReqDates().indexOf(TS) >= 0, JSON.stringify([r, attReqDates()]));
  await page.close();

  /* ⑥ 휴대폰 */
  const narrow = await ctxOf(390);
  page = await open(narrow);
  ok('⑥ 휴대폰: 날짜 줄 있음', !!(await page.$('.daynav')));
  await page.click('.daynav .dn-prev');
  await page.waitForFunction(() => /지난 시간표/.test(document.querySelector('.today-head').textContent) && document.querySelector('.daylist .stus button.at-ok'), null, { timeout: 15000 });
  r = await page.evaluate(() => ({ list: !!document.querySelector('.daylist'), ok: document.querySelectorAll('.daylist .stus button.at-ok').length,
                                   fits: document.documentElement.scrollWidth <= window.innerWidth + 1 }));
  ok('⑥ 휴대폰 목록 보기도 어제 출석 칩 · 가로 넘침 없음', r.list && r.ok === 1 && r.fits, JSON.stringify(r));
  await page.close();

  await b.close(); srv.close();
  console.log(fail ? ('통과 ' + pass + ' / 실패 ' + fail) : ('✓ ' + pass + '건 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
