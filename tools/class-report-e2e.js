#!/usr/bin/env node
/* 슈퍼스타 주간 리포트 검증 (2026-09-28, 수파베이스 034).
 *   NODE_PATH=$(npm root -g) node tools/class-report-e2e.js
 * ① 정규 가 수업 — 카드 [수업 기록] → 왼쪽 창(가 수업 표시·학생·출석·숙제 검사 별점·코멘트)
 *    별을 누르면 hwcheck_records 저장(최근 수요일 주차·모든 항목·%) + 시트 사본 hwcheckSave,
 *    쓰던 진도가 별을 눌러도 남음, 미제출 → 대책 칸, [저장] class_notes(part 가), [리포트 생성] 요청 글에 '가 수업'
 * ② 내신 진도 수업 — 시험범위 입력(공유 키 공유:고2|화정) → 단원 고르기(클리어) → [저장] 시 naeshin 주차 기록 + units, 안내 문구
 * ③ 내신 확인 수업 — '확인 수업'·'숙제 검사', 진도 없이도 생성 가능
 * ④ 수정 요청 목록에서 '수업 리포트' 요청은 뺀다
 * ⑤ 학생 페이지 — 허브 '주간 리포트' 카드, 주간 한 장(출석 칸·가/나 칸·기록 전·숙제 검사 막대·코멘트), 내신 주(나간 범위 칩), ‹ › */
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
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const P = TODAYSTR.split('-'), T0 = new Date(+P[0], +P[1] - 1, +P[2]);
const PREVWED = (() => { const d = new Date(T0); d.setDate(d.getDate() - ((d.getDay() + 4) % 7)); return ymd(d); })();   // 숙제 검사 주차
const WEDS = []; for (let k = -21; k <= 21; k += 7){ const d = new Date(T0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 2 + k); WEDS.push(ymd(d)); }
const row = (id, name, t, roster) => ({ class_id: id, day: TODAY, start_time: '5:30', end_time: '7:00', location: '민초센터', teacher: t, name, roster, kind: '' });
const STUDENTS = [
  { name: '박보검', school: '화정고', grade: '2026 고등 2학년', code: 'k-park', enrolled: '재원' },
  { name: '김하늘', school: '화정고', grade: '2026 고등 2학년', code: 'k-kim', enrolled: '재원' },
  { name: '최다은', school: '화정고', grade: '2026 고등 2학년', code: 'k-choi', enrolled: '재원' },
];

(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0, perr = 0;
  const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
  async function ctxOf(opt){
    const st = { writes: [], gas: [], notes: {}, ns: [] };
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
    await ctx.route(/fonts\.g/, r => r.abort());
    await ctx.route(/script\.google\.com|googleusercontent/, r => {
      const req = r.request();
      if (req.method() === 'POST'){ try { st.gas.push(JSON.parse(req.postData() || '{}')); } catch (e) {} }
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"success"}' });
    });
    await ctx.route(/supabase\.co/, r => {
      const u = decodeURIComponent(r.request().url()), m = r.request().method();
      const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (/\/auth\/v1\//.test(u)) return json(200, { access_token: 't', expires_in: 3600 });
      let body = null; try { body = JSON.parse(r.request().postData() || 'null'); } catch (e) {}
      if (m !== 'GET') st.writes.push({ m, u, body });
      if (/\/class_notes/.test(u)){
        if (m === 'POST'){ const x = body[0]; const k = x.book + '|' + x.class_id; st.notes[k] = Object.assign({ id: 1, report_status: '' }, st.notes[k] || {}, x); return json(201, [st.notes[k]]); }
        const cid = (u.match(/class_id=eq\.([^&]+)/) || [])[1];
        return json(200, Object.values(st.notes).filter(n => !cid || n.class_id === cid));
      }
      if (/\/naeshin_records/.test(u)){ if (m === 'GET') return json(200, st.ns); return r.fulfill({ status: 201, body: '' }); }
      if (/\/hwcheck_records/.test(u)){ if (m === 'GET'){ (st.hwGets = st.hwGets || []).push(decodeURIComponent(u)); return json(200, opt.hw || []); } return r.fulfill({ status: 201, body: '' }); }
      if (/\/report_config/.test(u)) return json(200, [{ value: '숙제 수행, 오답 처리' }]);
      if (/\/students\?/.test(u)) return json(200, STUDENTS);
      if (/\/tt_period/.test(u)) return json(200, WEDS.map(w => ({ week_wednesday: w, book: opt.book })));
      if (/\/attendance\?/.test(u)) return json(200, opt.att.map(a => Object.assign({ date: TODAYSTR, book: opt.book, memo: '' }, a)));
      if (m !== 'GET') return json(201, []);
      if (/\/tt_classes\?/.test(u)){
        if (/class_id=like\./.test(u)) return json(200, []);
        return json(200, u.indexOf('book=eq.' + opt.book) >= 0 ? opt.rows : []);
      }
      return json(200, []);
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => { perr++; console.log('  ✗ pageerror', e.message); });
    page.on('dialog', d => d.accept());
    await page.addInitScript(bk => { sessionStorage.setItem('tt_mode', 'today'); sessionStorage.setItem('tt_book', bk); localStorage.clear(); }, opt.book);
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    return { ctx, page, st };
  }
  const openCard = async (page, name) => {
    await page.waitForFunction(n => [...document.querySelectorAll('.blk')].some(x => x.textContent.indexOf(n) >= 0 && x.querySelector('.crbtn')), name, { timeout: 15000 });
    await page.evaluate(n => [...document.querySelectorAll('.blk')].find(x => x.textContent.indexOf(n) >= 0).querySelector('.crbtn').click(), name);
    await page.waitForSelector('#crpanel:not([hidden]) .cr-card', { timeout: 8000 });
  };

  // ① 정규 가 수업
  let { ctx, page, st } = await ctxOf({ book: '정규',
    rows: [row('r001', '고2 가', '지원', '박보검 김하늘 최다은')],
    att: [{ class_id: 'r001', student: '박보검', status: '출석' }, { class_id: 'r001', student: '김하늘', status: '지각' }],
    hw: [{ token: 'k-kim', scores: { '숙제 수행': 3, '오답 처리': 3 }, pct: 50, pub: '옛 공개 메모', priv: '', missing: false, plan: '' }] });
  await openCard(page, '고2 가');
  let r = await page.evaluate(() => ({ kind: document.getElementById('cr-kind').textContent, left: document.getElementById('crpanel').getBoundingClientRect().left,
    cards: [...document.querySelectorAll('.cr-card')].map(c => ({ nm: c.querySelector('.cr-top b').textContent, at: c.querySelector('.cr-chip').textContent,
      pct: c.querySelector('.cr-top').textContent, rows: c.querySelectorAll('.cr-item').length, on: c.querySelectorAll('.cr-stars .on').length })),
    hint: (document.querySelector('.cr-hint') || {}).textContent, head: document.querySelector('.cr-sh').textContent }));
  ok('정규 가: 왼쪽 창·"가 수업" 표시', r.kind === '가 수업' && r.left === 0, JSON.stringify(r));
  const card = n => r.cards.find(x => x.nm === n) || {};
  ok('학생 3명·출석 칩', r.cards.length === 3 && card('박보검').at === '출석' && card('김하늘').at === '지각' && card('최다은').at === '미체크', JSON.stringify(r.cards));
  ok('숙제 검사 항목 2줄·기존 기록 50%·별 6개 켜짐', card('김하늘').rows === 2 && /50%/.test(card('김하늘').pct) && card('김하늘').on === 6 && /미검사/.test(card('박보검').pct), JSON.stringify(r.cards));
  ok('안내·머리 문구', /이 수업 숙제 검사/.test(r.head) && /바로 저장/.test(r.hint) && /수업마다 따로/.test(r.hint));
  await page.fill('#cr-prog', '문학 — 「사미인곡」');
  await page.fill('#cr-task', '비교 학습지 1장\n오답 노트');
  const iPark = await page.evaluate(() => CR.names.map(x => x.p).indexOf('박보검'));
  await page.fill('#cr-c-' + iPark, '정서 변화를 정확히 짚음');
  await page.click(`[data-star="${iPark}|0|6"]`);
  await page.click(`[data-star="${iPark}|1|4"]`);
  r = await page.evaluate(i => ({ prog: document.getElementById('cr-prog').value, cm: document.getElementById('cr-c-' + i).value }), iPark);
  ok('별을 눌러도 쓰던 진도·코멘트가 남는다', r.prog === '문학 — 「사미인곡」' && r.cm === '정서 변화를 정확히 짚음', JSON.stringify(r));
  await page.waitForFunction(() => /저장됨/.test(document.querySelector('.cr-dot.ok') ? document.querySelector('.cr-dot.ok').textContent : ''), null, { timeout: 5000 });
  let hwW = st.writes.filter(w => /hwcheck_records/.test(w.u)).pop();
  const CID = await page.evaluate(() => CR.c.id);
  ok('숙제 검사는 이 수업 것만 읽는다(class_id)', (st.hwGets || []).some(g => g.includes('class_id=eq.' + CID)), JSON.stringify(st.hwGets));
  ok('수업마다 한 줄 — 반ID·가·반이름, on_conflict=week,token,class_id', hwW && /on_conflict=week,token,class_id/.test(hwW.u) && hwW.body[0].class_id === CID && hwW.body[0].part === '가' && !!hwW.body[0].class_name, JSON.stringify(hwW && hwW.body));
  ok('별 → hwcheck_records 저장(최근 수요일 주차·두 항목·83%)', hwW && hwW.body[0].week === PREVWED && hwW.body[0].token === 'k-park' &&
     hwW.body[0].scores['숙제 수행'] === 6 && hwW.body[0].scores['오답 처리'] === 4 && hwW.body[0].pct === 83 && hwW.body[0].max === 12, JSON.stringify(hwW && hwW.body));
  ok('시트 사본 hwcheckSave(반ID·수업 함께)', st.gas.some(g => g.action === 'hwcheckSave' && g.token === 'k-park' && g.week === PREVWED && g.cls === CID && g.part === '가'));
  const iKim = await page.evaluate(() => CR.names.map(x => x.p).indexOf('김하늘'));
  await page.click(`[data-star="${iKim}|0|1"]`);
  await page.waitForTimeout(1000);
  hwW = st.writes.filter(w => /hwcheck_records/.test(w.u) && w.body[0].token === 'k-kim').pop();
  ok('기존 공개 메모는 그대로 싣는다', hwW && hwW.body[0].pub === '옛 공개 메모' && hwW.body[0].scores['숙제 수행'] === 1, JSON.stringify(hwW && hwW.body));
  const iChoi = await page.evaluate(() => CR.names.map(x => x.p).indexOf('최다은'));
  await page.click(`[data-miss="${iChoi}"]`);
  r = await page.evaluate(i => ({ plan: !document.getElementById('cr-plan-' + i).hidden, pct: document.getElementById('cr-pct-' + i).textContent }), iChoi);
  ok('미제출 → 대책 칸·"미제출" 표시', r.plan && /미제출/.test(r.pct), JSON.stringify(r));
  await page.fill('#cr-plan-' + iChoi, '9/30 재검사');
  await page.click('#cr-save');
  await page.waitForFunction(() => /저장했어요/.test(document.getElementById('cr-msg').textContent), null, { timeout: 8000 });
  hwW = st.writes.filter(w => /hwcheck_records/.test(w.u) && w.body[0].token === 'k-choi').pop();
  ok('미제출·대책 저장(0%)', hwW && hwW.body[0].missing === true && hwW.body[0].plan === '9/30 재검사' && hwW.body[0].pct === 0, JSON.stringify(hwW && hwW.body));
  let nw = st.writes.filter(w => /class_notes/.test(w.u)).pop();
  ok('저장 → class_notes(part 가·진도·과제·코멘트 하나)', nw && nw.body[0].part === '가' && /사미인곡/.test(nw.body[0].progress) && nw.body[0].homework.split('\n').length === 2 &&
     nw.body[0].comments['박보검'] === '정서 변화를 정확히 짚음' && Object.keys(nw.body[0].comments).length === 1 && !('report_status' in nw.body[0]), JSON.stringify(nw && nw.body));
  ok('정규는 naeshin 기록을 안 건드림', !st.writes.some(w => /naeshin_records/.test(w.u)));
  await page.click('#cr-gen');
  await page.waitForFunction(() => /요청했어요/.test(document.getElementById('cr-msg').textContent), null, { timeout: 8000 });
  const rq = st.gas.filter(g => g.action === 'editReqAdd').pop();
  ok('생성 → 요청 글(가 수업·반ID·날짜)', rq && rq.screen === '수업 리포트' && rq.text.indexOf('[수업 리포트] 정규 r001 ' + TODAYSTR) === 0 && /가 수업/.test(rq.text), rq && rq.text);
  ok('카드 버튼 리포트 작성 중', await page.$eval('.blk .crbtn', e => e.textContent) === '리포트 작성 중');
  // ④
  r = await page.evaluate(() => { var d = document.createElement('div'); d.id = 'req-list'; document.body.appendChild(d);
    reqRows = [{ ts: 'a', screen: '수업 리포트', text: 'x', status: '접수됨' }, { ts: 'b', screen: '오늘의 시간표', text: '명단 확인', status: '접수됨' }];
    reqRenderList(); const t = d.textContent; d.remove(); return t; });
  ok('수정 요청 목록에서 수업 리포트 요청은 뺀다', /명단 확인/.test(r) && !/수업 리포트/.test(r), r);
  await ctx.close();

  // ② 내신 진도 수업 + ③ 확인 수업
  ({ ctx, page, st } = await ctxOf({ book: '내신',
    rows: [row('n001', '고2 화정A(비상 문학)', '주혜', '박보검 김하늘'), Object.assign(row('n002', '고2 확인', '연주', '(화정)박보검 (화정)김하늘'), { start_time: '7:30', end_time: '9:00' })],
    att: [{ class_id: 'n001', student: '박보검', status: '출석' }, { class_id: 'n001', student: '김하늘', status: '출석' }], hw: [] }));
  await openCard(page, '화정A');
  r = await page.evaluate(() => ({ kind: document.getElementById('cr-kind').textContent, open: document.getElementById('cr-scope').open,
    sum: document.querySelector('#cr-scope summary').textContent, hint: document.querySelector('.cr-hint').textContent,
    book: document.getElementById('cr-ns-book').value, per: [...document.querySelectorAll('.cr-per button')].map(x => x.textContent) }));
  ok('내신 진도: "진도 수업"·시험범위 비어 있어 펼침', r.kind === '진도 수업' && r.open && /아직 없어요/.test(r.sum), JSON.stringify(r));
  ok('진도 수업 숙제 검사 안내 문구', /비워 두셔도 됩니다/.test(r.hint), r.hint);
  ok('교과서 기본값·기간 두 개', r.book === '비상 문학' && r.per.length === 2 && /^\d\d-[12]-(중간|기말)$/.test(r.per[0]), JSON.stringify(r));
  await page.fill('#cr-ns-in', '사미인곡\n속미인곡');
  await page.click('#cr-ns-save');
  await page.waitForFunction(() => /시험범위를 저장했어요/.test(document.getElementById('cr-msg').textContent), null, { timeout: 8000 });
  let sw = st.writes.filter(w => /naeshin_records/.test(w.u)).pop();
  ok('시험범위 → naeshin_records(공유:고2|화정·범위)', sw && sw.body[0].class_key === '공유:고2|화정' && sw.body[0].kind === '범위' && JSON.parse(sw.body[0].text1).inRange === '사미인곡\n속미인곡', JSON.stringify(sw && sw.body));
  ok('시트 사본 naeshinSet(scopeKey)', st.gas.some(g => g.action === 'naeshinSet' && g.kind === '범위' && g.scopeKey === '공유:고2|화정'));
  await page.selectOption('#cr-ns-unit', '사미인곡');
  await page.waitForFunction(() => document.querySelectorAll('.cr-unit').length === 1, null, { timeout: 5000 });
  sw = st.writes.filter(w => /naeshin_records/.test(w.u)).pop();
  ok('단원 고르기 → 클리어 기록(반ID·이번 주)', sw && sw.body[0].kind === '클리어' && sw.body[0].class_key === 'n001' && JSON.parse(sw.body[0].text1)['사미인곡'].s === PREVWED, JSON.stringify(sw && sw.body));
  await page.fill('#cr-prog', '표현 방식 비교');
  await page.fill('#cr-task', '교과서 1~6번');
  await page.click('#cr-save');
  await page.waitForFunction(() => /저장했어요/.test(document.getElementById('cr-msg').textContent), null, { timeout: 8000 });
  nw = st.writes.filter(w => /class_notes/.test(w.u)).pop();
  ok('저장 → class_notes(part 진도·units)', nw && nw.body[0].part === '진도' && JSON.stringify(nw.body[0].units) === '["사미인곡"]' && nw.body[0].progress === '표현 방식 비교', JSON.stringify(nw && nw.body));
  sw = st.writes.filter(w => /naeshin_records/.test(w.u) && w.body && w.body[0].kind === '주차').pop();
  ok('저장 → 내신 주차 기록(메모·과제)', sw && sw.body[0].week === PREVWED && sw.body[0].text1 === '표현 방식 비교' && sw.body[0].text2 === '교과서 1~6번', JSON.stringify(sw && sw.body));
  await page.click('.cr-x');
  await openCard(page, '고2 확인');
  r = await page.evaluate(() => ({ kind: document.getElementById('cr-kind').textContent, head: document.querySelector('.cr-sh').textContent,
    names: [...document.querySelectorAll('.cr-top b')].map(x => x.textContent), chk: document.querySelector('.cr-check').textContent, scope: !!document.getElementById('cr-scope') }));
  ok('확인 수업: 표시·숙제 검사·앞 괄호 뗀 이름·시험범위 칸 없음', r.kind === '확인 수업' && /숙제 검사/.test(r.head) && !/과제/.test(r.head) && r.names.join() === '김하늘,박보검' && !r.scope && !/진도/.test(r.chk), JSON.stringify(r));
  ok('확인 수업에도 다음 수업까지 숙제 칸', !!(await page.$('#cr-task')) && /다음 수업까지 숙제/.test(await page.$eval('label[for=cr-task]', e => e.textContent)));
  await page.fill('#cr-task', '서술형 오답 다시 쓰기');
  await page.click('#cr-gen');
  await page.waitForFunction(() => /요청했어요/.test(document.getElementById('cr-msg').textContent), null, { timeout: 8000 });
  ok('확인 수업 숙제도 저장', st.writes.some(w => /class_notes/.test(w.u) && w.body && w.body[0] && w.body[0].homework === '서술형 오답 다시 쓰기'));
  ok('확인 수업은 진도 없이도 생성', st.gas.some(g => g.action === 'editReqAdd' && /n002/.test(g.text) && /확인 수업/.test(g.text)));
  await ctx.close();

  // ⑤ 학생 페이지
  const REP = [
    { week: '2026-09-23', book: '정규', body: {
      parts: [
        { part: '가', cls: '고2 가', teacher: '지원', ymd: '2026-09-23', time: '수 5:30~7:00', attend: '출석', summary: '「사미인곡」 표현상 특징을 정리했습니다.', homework: ['비교 학습지 1장'],
          hw: { items: [{ name: '숙제 수행', score: 6 }, { name: '오답 처리', score: 5 }], pct: 92, missing: false, text: '지난 과제를 모두 제출했습니다.' } },
        { part: '나', cls: '고2 나', teacher: '현지', ymd: '2026-09-26', time: '토 2:00~3:30', attend: '', pending: true },
        { part: '', cls: '고2 논술', teacher: '슈', ymd: '2026-09-27', time: '일 11:00~12:30', attend: '출석', summary: '논술 개요를 짰습니다.', hw: { none: true, text: '확인할 것이 없습니다.' } } ],
      comments: [{ teacher: '지원', text: '정서 변화를 정확히 짚었습니다.' }] } },
    { week: '2026-09-16', book: '내신', body: {
      parts: [{ part: '진도', cls: '고2 화정A', teacher: '주혜', ymd: '2026-09-16', time: '수 5:30~7:00', attend: '지각', attend_note: '10분 늦게 도착했습니다.', units: ['사미인곡', '속미인곡'], summary: '표현 방식을 비교했습니다.', homework: [] },
              { part: '확인', cls: '고2 확인', teacher: '연주', ymd: '2026-09-18', time: '금 5:30~7:00', attend: '출석' }],
      hw: { items: [], pct: 0, missing: true, text: '과제를 제출하지 않았습니다.' }, comments: [] } },
  ];
  const c2 = await b.newContext();
  const sp = await c2.newPage();
  sp.on('pageerror', e => { perr++; console.log('  ✗ pageerror(s.html)', e.message); });
  await sp.route('**/*', rt => {
    const u = rt.request().url();
    const j = (o, stt) => rt.fulfill({ status: stt || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
    if (/\/rpc\/class_report_list/.test(u)){ const p = JSON.parse(rt.request().postData()).p; return j(p.key === 'abc' ? { ok: true, items: REP } : { ok: false }); }
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
  await sp.waitForFunction(() => /주간 리포트/.test((document.getElementById('menu') || {}).textContent || ''), null, { timeout: 15000 });
  r = await sp.evaluate(() => { const c = [...document.querySelectorAll('#menu .card')].find(x => /주간 리포트/.test(x.textContent)); return c && c.textContent; });
  ok('허브 카드 — 최근 주', /최근 9\/21 ~ 9\/27 주/.test(r), r);
  await sp.evaluate(() => openClassReport());
  await sp.waitForSelector('#crList .crp-sheet', { timeout: 8000 });
  r = await sp.evaluate(() => ({ nav: document.getElementById('crNav').textContent, brand: document.querySelector('.crp-brand').textContent,
    att: [...document.querySelectorAll('.crp-att > div')].map(x => x.textContent), parts: [...document.querySelectorAll('.crp-part')].map(x => x.textContent),
    rows: document.querySelectorAll('.crp-hwrow').length, bar: document.querySelector('.crp-track i').style.width }));
  ok('주 제목·정규 주간·브랜드', /9\/21 ~ 9\/27/.test(r.nav) && /정규 주간/.test(r.nav) && r.brand === '슈퍼스타 주간 리포트', JSON.stringify(r));
  ok('출석 칸 둘 — 가 출석 / 나 기록 전', r.att.length === 3 && /가 수업/.test(r.att[0]) && /출석/.test(r.att[0]) && /나 수업/.test(r.att[1]) && /기록 전/.test(r.att[1]), JSON.stringify(r.att));
  ok('숙제 검사를 비운 수업은 "확인할 것이 없습니다." 한 줄', /확인할 것이 없습니다\./.test(r.parts[2]) && !/0%/.test(r.parts[2]), r.parts[2]);
  r.parts.splice(2, 1);
  ok('가 수업 칸(내용·과제·그 수업 숙제 검사) · 나 수업 기록 전 · 코멘트', r.parts.length === 3 && /사미인곡/.test(r.parts[0]) && /비교 학습지/.test(r.parts[0]) &&
     /이 수업 숙제 검사92%/.test(r.parts[0]) && /6 \/ 6/.test(r.parts[0]) && /아직 수업 기록 전/.test(r.parts[1]) && !/숙제 검사/.test(r.parts[1]) && /정서 변화/.test(r.parts[2]) && /지원T/.test(r.parts[2]), JSON.stringify(r.parts));
  ok('숙제 검사 막대 2줄(6/6 = 100%)', r.rows === 2 && r.bar === '100%', JSON.stringify([r.rows, r.bar]));
  await sp.click('#crNav .crp-nb');
  r = await sp.evaluate(() => ({ nav: document.getElementById('crNav').textContent, txt: document.getElementById('crList').textContent, units: document.querySelectorAll('.crp-units span').length }));
  ok('‹ 지난 주 — 내신 주간·진도/확인·나간 범위 칩·지각 안내·미제출', /9\/14 ~ 9\/20/.test(r.nav) && /내신 주간/.test(r.nav) && /진도 수업/.test(r.txt) && /확인 수업/.test(r.txt) &&
     r.units === 2 && /10분 늦게/.test(r.txt) && /미제출/.test(r.txt) && !/선생님 코멘트/.test(r.txt), JSON.stringify(r));
  ok('035 이전 리포트(주 단위 body.hw)도 그대로 보인다', /숙제 검사/.test(r.txt) && /과제를 제출하지 않았습니다/.test(r.txt), r.txt);
  await sp.evaluate(() => closeClassReport());
  ok('닫으면 허브로', await sp.evaluate(() => document.getElementById('crView').style.display === 'none'));
  await c2.close();

  ok('페이지 오류 없음', perr === 0);
  console.log((fail ? '실패 ' + fail + ' / ' : '') + '통과 ' + pass + '건');
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
