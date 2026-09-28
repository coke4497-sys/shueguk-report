#!/usr/bin/env node
/* 수업 리포트 검증 (2026-09-28, 수파베이스 034).
 *   NODE_PATH=$(npm root -g) node tools/class-report-e2e.js
 * ① 오늘의 시간표 카드에 [수업 기록] 버튼 → 왼쪽 창(학생·출석·숙제 검사·코멘트)
 * ② [저장] → class_notes upsert 본문(진도·과제·코멘트), 카드 버튼 '기록함'
 * ③ [리포트 생성] → class_notes report_status '요청' + editReqAdd(화면 '수업 리포트'), 버튼 '리포트 작성 중'
 * ④ 진도 없이 [리포트 생성] → 막고 안내
 * ⑤ 수정 요청 목록에는 '수업 리포트' 요청이 안 보인다
 * ⑥ 학생 페이지 — 리포트가 있으면 허브 카드, 열면 주차별 카드(출석·수업 내용·과제·숙제 검사·코멘트), ‹ › 주차 이동 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
const TODAY = new Intl.DateTimeFormat('ko-KR', { weekday: 'narrow', timeZone: 'Asia/Seoul' }).format(new Date());
const TODAYSTR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const ROWS = [
  { class_id: 'r001', day: TODAY, start_time: '5:30', end_time: '7:00', location: '민초센터', teacher: '연주', name: '고2 확인', roster: '박보검 김하늘 이서준(9/1부터) 최다은', kind: '' },
];
const ATT = [
  { date: TODAYSTR, book: '정규', class_id: 'r001', student: '박보검', status: '출석', memo: '' },
  { date: TODAYSTR, book: '정규', class_id: 'r001', student: '김하늘', status: '지각', memo: '버스' },
  { date: TODAYSTR, book: '정규', class_id: 'r001', student: '최다은', status: '결석', memo: '병결' },
];
const HW = [{ name: '박보검', pct: 83, missing: false }, { name: '최다은', pct: 0, missing: true }];

(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0, perr = 0;
  const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
  const writes = [], gas = [];
  let NOTE = null;
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
  await ctx.route(/fonts\.g/, r => r.abort());
  await ctx.route(/script\.google\.com|googleusercontent/, r => {
    const req = r.request();
    if (req.method() === 'POST'){ try { gas.push(JSON.parse(req.postData() || '{}')); } catch (e) {} }
    const u = req.url();
    if (/editReqList/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'success', reqs: [
      { ts: '2026-09-28 17:00', writer: '연주T', screen: '수업 리포트', text: '[수업 리포트] …', status: '접수됨' },
      { ts: '2026-09-28 16:00', writer: '조교', screen: '오늘의 시간표', text: '명단 확인 부탁', status: '접수됨' }] }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"success"}' });
  });
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url(), m = r.request().method();
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (/\/auth\/v1\//.test(u)) return json(200, { access_token: 't', expires_in: 3600 });
    if (/\/class_notes/.test(u)){
      if (m === 'POST'){
        const body = JSON.parse(r.request().postData() || '{}'); writes.push({ u, body });
        NOTE = Object.assign({}, NOTE || { id: 1, report_status: '' }, body);
        return json(201, [NOTE]);
      }
      return json(200, NOTE ? [NOTE] : []);
    }
    if (/\/hwcheck_records/.test(u)) return json(200, HW);
    if (/\/attendance\?/.test(u)) return json(200, ATT);
    if (m === 'POST' || m === 'PATCH') return json(201, []);
    if (/\/tt_classes\?/.test(u)){
      if (/class_id=like\./.test(u)) return json(200, []);
      if (/book=eq\.%EC%A0%95%EA%B7%9C/.test(u)) return json(200, ROWS);
      return json(200, []);
    }
    return json(200, []);
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => { perr++; console.log('  ✗ pageerror', e.message); });
  await page.addInitScript(() => { sessionStorage.setItem('tt_mode', 'today'); sessionStorage.setItem('tt_book', '정규'); localStorage.clear(); });
  await page.goto('http://127.0.0.1:' + port + '/timetable.html');
  await page.waitForSelector('.blk .crbtn', { timeout: 15000 });

  // ①
  let r = await page.evaluate(() => { const bt = document.querySelector('.blk .crbtn'); return { txt: bt.textContent, hidden: document.getElementById('crpanel').hidden }; });
  ok('카드에 [수업 기록] 버튼', r.txt === '수업 기록' && r.hidden, JSON.stringify(r));
  await page.click('.blk .crbtn');
  await page.waitForSelector('#crpanel:not([hidden]) .cr-row', { timeout: 8000 });
  r = await page.evaluate(() => {
    const p = document.getElementById('crpanel'), bx = p.getBoundingClientRect();
    const rows = [...document.querySelectorAll('.cr-row')].map(x => [x.querySelector('b').textContent, x.querySelector('.cr-chip').textContent, x.querySelector('.cr-hw').textContent]);
    return { left: bx.left, w: bx.width, ttl: document.getElementById('cr-ttl').textContent, rows, bg: !document.getElementById('cr-bg').hidden,
             chk: document.querySelector('.cr-check').textContent };
  });
  ok('왼쪽 창이 화면 왼쪽에 붙어 열린다', r.left === 0 && r.w > 300 && r.bg, JSON.stringify(r));
  ok('제목에 반·요일·시간', /고2 확인 · .+ 5:30~7:00/.test(r.ttl), r.ttl);
  ok('학생 4명 — 괄호 뗀 이름·출석 칩', JSON.stringify(r.rows.map(x => x[0])) === JSON.stringify(['김하늘', '박보검', '이서준', '최다은']) || r.rows.length === 4, JSON.stringify(r.rows));
  const row = n => r.rows.find(x => x[0] === n) || [];
  ok('출석·지각·결석·미체크', row('박보검')[1] === '출석' && row('김하늘')[1] === '지각' && row('최다은')[1] === '결석' && row('이서준')[1] === '미체크', JSON.stringify(r.rows));
  ok('숙제 검사 % / 미제출 / —', row('박보검')[2] === '83%' && row('최다은')[2] === '미제출' && row('김하늘')[2] === '—', JSON.stringify(r.rows));
  ok('준비 확인 — 진도 없음·출석 미체크 1명·숙제 검사 2/4', /진도를 아직/.test(r.chk) && /미체크 1명/.test(r.chk) && /2 \/ 4명/.test(r.chk), r.chk);

  // ④ 진도 없이 생성
  await page.click('#cr-gen');
  r = await page.evaluate(() => document.getElementById('cr-msg').textContent);
  ok('진도 없이 리포트 생성 → 막고 안내', /진도를 먼저/.test(r), r);
  ok('진도 없이 → 요청 안 나감', !gas.some(x => x.action === 'editReqAdd'));

  // ②
  await page.fill('#cr-prog', '문학 — 「사미인곡」 표현상 특징');
  await page.fill('#cr-task', '비교 학습지 1장\n오답 노트 5문항');
  const idx = await page.evaluate(() => CR.names.map(x => x.p).indexOf('박보검'));
  await page.fill('#cr-c-' + idx, '정서 변화를 정확히 짚음');
  await page.click('#cr-save');
  await page.waitForFunction(() => /저장했어요/.test(document.getElementById('cr-msg').textContent), null, { timeout: 8000 });
  const w0 = writes[writes.length - 1];
  ok('저장 → class_notes upsert(on_conflict)', /on_conflict=book,class_id,ymd/.test(w0.u));
  ok('저장 본문 — 반·날짜·진도·과제·코멘트', w0.body.class_id === 'r001' && w0.body.ymd === TODAYSTR && w0.body.book === '정규' &&
     /사미인곡/.test(w0.body.progress) && w0.body.homework.split('\n').length === 2 && w0.body.comments['박보검'] === '정서 변화를 정확히 짚음' &&
     Object.keys(w0.body.comments).length === 1 && !('report_status' in w0.body), JSON.stringify(w0.body));
  ok('카드 버튼 → 기록함', await page.$eval('.blk .crbtn', e => e.textContent) === '기록함');

  // ③ 생성 (출석 미체크 확인 창 → 수락)
  page.once('dialog', d => d.accept());
  await page.click('#cr-gen');
  await page.waitForFunction(() => /요청했어요/.test(document.getElementById('cr-msg').textContent), null, { timeout: 8000 });
  const w1 = writes[writes.length - 1];
  const rq = gas.filter(x => x.action === 'editReqAdd').pop();
  ok('생성 → report_status 요청 + requested_at', w1.body.report_status === '요청' && !!w1.body.requested_at, JSON.stringify(w1.body));
  ok('생성 → editReqAdd 화면 수업 리포트', rq && rq.screen === '수업 리포트' && rq.writer === '연주T', JSON.stringify(rq));
  ok('요청 글에 시간표·반ID·날짜', rq && rq.text.indexOf('[수업 리포트] 정규 r001 ' + TODAYSTR) === 0 && /학생 4명/.test(rq.text), rq && rq.text);
  r = await page.evaluate(() => ({ st: document.querySelector('.cr-state') && document.querySelector('.cr-state').textContent, btn: document.querySelector('.blk .crbtn').textContent }));
  ok('창에 작성 중 안내 · 카드 버튼 리포트 작성 중', /쓰고 있어요/.test(r.st) && r.btn === '리포트 작성 중', JSON.stringify(r));
  await page.keyboard.press('Escape');
  ok('Esc로 닫힘', await page.$eval('#crpanel', e => e.hidden));

  // ⑤
  r = await page.evaluate(() => { var d = document.createElement('div'); d.id = 'req-list'; document.body.appendChild(d);
    reqRows = [{ ts: 'a', screen: '수업 리포트', text: 'x', status: '접수됨' }, { ts: 'b', screen: '오늘의 시간표', text: '명단 확인', status: '접수됨' }];
    reqRenderList(); const t = d.textContent; d.remove(); return t; });
  ok('수정 요청 목록에서 수업 리포트 요청은 뺀다', /명단 확인/.test(r) && !/수업 리포트/.test(r), r);
  await page.close();

  // ⑥ 학생 페이지
  const REP = [
    { week: '2026-09-23', ymd: '2026-09-23', cls: '고2 화정A', teacher: '주혜', time: '수 5:30~7:00', book: '내신',
      body: { attend: '출석', summary: '「사미인곡」을 중심으로 화자의 정서를 정리했습니다.', homework: ['비교 학습지 1장'], hw: { pct: 83, missing: false, text: '과제를 기한 안에 제출했습니다.' }, comment: '정서 변화를 정확히 짚었습니다.' } },
    { week: '2026-09-23', ymd: '2026-09-26', cls: '고2 확인', teacher: '연주', time: '토 5:30~7:00', book: '내신',
      body: { attend: '지각', attend_note: '10분 늦게 도착했습니다.', summary: '갈래 복합 지문 두 개를 풀었습니다.', homework: [], comment: '' } },
    { week: '2026-09-16', ymd: '2026-09-17', cls: '고2 화정A', teacher: '주혜', time: '목 5:30~7:00', book: '내신',
      body: { attend: '결석', attend_note: '병결 — 9/20 영상보충 예정', summary: '「관동별곡」 1~3단락을 읽었습니다.', homework: ['단락 요약'], hw: { missing: true, text: '과제를 제출하지 않았습니다.' } } },
  ];
  let calls = 0;
  const sp = await ctx.newPage();
  sp.on('pageerror', e => { perr++; console.log('  ✗ pageerror(s.html)', e.message); });
  await sp.route('**/*', rt => {
    const u = rt.request().url();
    const j = (o, st) => rt.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
    if (/\/rpc\/class_report_list/.test(u)){ calls++; const p = JSON.parse(rt.request().postData()).p; return j(p.key === 'abc' ? { ok: true, items: REP } : { ok: false }); }
    if (/\/rpc\//.test(u)) return j({ error: 'nope' }, 500);
    if (/supabase/.test(u)) return rt.fulfill({ status: 204, body: '' });
    if (/script\.google/.test(u)){
      const q = new URL(u).searchParams;
      if (q.get('key')) return j({ result: 'success', info: { name: '박보검', id: '30000001', school: '화정고', grade: '2026 고등 2학년', teacher: '주혜', enrolled: '재원', classA: '수 5:30', classB: '' },
        authed: false, examCount: 0, notices: [], homework: [], analyses: [], clinic: null, stars: { total: 3 }, mockGates: { grades: [], open: false }, clinicEligible: false, vocaTaken: false, mockSignups: [] });
      return j({ result: 'success' });
    }
    return rt.fulfill({ status: 204, body: '' });
  });
  await sp.goto('http://127.0.0.1:' + port + '/s.html?key=abc', { waitUntil: 'domcontentloaded' });
  await sp.waitForFunction(() => /수업 리포트/.test((document.getElementById('menu') || {}).textContent || ''), null, { timeout: 15000 });
  r = await sp.evaluate(() => { const c = [...document.querySelectorAll('#menu .card')].find(x => /수업 리포트/.test(x.textContent)); return c && c.textContent; });
  ok('허브에 수업 리포트 카드 — 최근 수업 표시', /최근 9\/26 \(토\) 고2 확인/.test(r), r);
  await sp.evaluate(() => openClassReport());
  await sp.waitForSelector('#crList .crp-card', { timeout: 8000 });
  r = await sp.evaluate(() => ({ nav: document.getElementById('crNav').textContent, cards: [...document.querySelectorAll('#crList .crp-card')].map(c => c.textContent),
    who: document.querySelector('.crp-who').textContent, prevDis: document.querySelector('#crNav .crp-nb').disabled, bar: (document.querySelector('.crp-track i') || {}).style }));
  ok('주차 제목 9/21 ~ 9/27 주 · 수업 2회', /9\/21 ~ 9\/27 주/.test(r.nav) && /수업 2회/.test(r.nav), r.nav);
  ok('한 주의 수업 2장 — 날짜순', r.cards.length === 2 && /9\/23 \(수\)/.test(r.cards[0]) && /9\/26 \(토\)/.test(r.cards[1]), JSON.stringify(r.cards));
  ok('카드 1 — 출석·수업 내용·과제·숙제 검사 83%·코멘트', /출석/.test(r.cards[0]) && /사미인곡/.test(r.cards[0]) && /비교 학습지/.test(r.cards[0]) && /83%/.test(r.cards[0]) && /선생님 코멘트/.test(r.cards[0]), r.cards[0]);
  ok('카드 2 — 지각 안내, 빈 과제·코멘트 칸은 안 그림', /지각/.test(r.cards[1]) && /10분 늦게/.test(r.cards[1]) && !/과제/.test(r.cards[1]) && !/코멘트/.test(r.cards[1]), r.cards[1]);
  ok('이름 머리글', /박보검/.test(r.who));
  await sp.click('#crNav .crp-nb');   // ‹ 지난 주
  r = await sp.evaluate(() => ({ nav: document.getElementById('crNav').textContent, card: document.querySelector('#crList .crp-card').textContent, n: document.querySelectorAll('#crList .crp-card').length }));
  ok('‹ 지난 주로 — 9/14 ~ 9/20 주, 결석·보충·미제출', /9\/14 ~ 9\/20/.test(r.nav) && r.n === 1 && /결석/.test(r.card) && /영상보충/.test(r.card) && /미제출/.test(r.card), JSON.stringify(r));
  await sp.evaluate(() => closeClassReport());
  ok('닫으면 허브로', await sp.evaluate(() => document.getElementById('crView').style.display === 'none' && document.getElementById('hubView').style.display !== 'none'));

  ok('페이지 오류 없음', perr === 0);
  console.log((fail ? '실패 ' + fail + ' / ' : '') + '통과 ' + pass + '건');
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
