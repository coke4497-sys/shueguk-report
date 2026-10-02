#!/usr/bin/env node
/* 슈퍼스타 주간 리포트 검증 (2026-09-28, 수파베이스 034).
 *   NODE_PATH=$(npm root -g) node tools/class-report-e2e.js
 * ① 정규 가 수업 — 카드 [수업 기록] → 왼쪽 창(가 수업 표시·학생·출석·숙제 검사 별점·코멘트)
 *    별을 누르면 hwcheck_records 저장(최근 수요일 주차·모든 항목·%) + 시트 사본 hwcheckSave,
 *    쓰던 진도가 별을 눌러도 남음, 미제출 → 대책 칸, [저장] class_notes(part 가), [리포트 생성] 요청 글에 '가 수업'
 * ② 내신 진도 수업 — 시험범위 입력(공유 키 공유:고2|화정) → 단원 고르기(클리어) → [저장] 시 naeshin 주차 기록 + units, 안내 문구
 * ③ 내신 확인 수업 — '확인 수업'·'숙제 검사', 진도 없이도 생성 가능
 * ④ 수정 요청 목록에서 '수업 리포트' 요청은 뺀다
 * ⑦ 수업 태도 3단계 알약 — comments.__태도 저장·다시 누르면 지움·닫아도 저장
 * ⑧-1·⑧-3 출석 기록 탭(041 attendance_history) — 요약·줄·보충 표시·거르기·더 보기·탭 기억·리포트 없이 출석만 있을 때
 * ⑧ 학생 페이지 수업 리포트(040 — 주간 리포트와 합침, 클로슈가 쓴 수업별 카드) — 허브 카드·요약·달별·수업 카드·더 보기·주간 리포트 카드 없음 */
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
        const ins = (u.match(/class_id=in\.\(([^)]*)\)/) || [])[1];
        if (ins){
          const ids = ins.split(',').map(x => x.replace(/"/g, ''));
          if (/progress/.test(u)){ (st.sibGets = st.sibGets || []).push(u); return json(200, Object.values(st.notes).filter(n => ids.includes(n.class_id))); }
          (st.srcGets = st.srcGets || []).push(u);   // 지난 과제 조회(과제별 검사)
          return json(200, (opt.prev || []).filter(n => ids.includes(n.class_id)));
        }
        return json(200, Object.values(st.notes).filter(n => !cid || n.class_id === cid));
      }
      if (/\/naeshin_records/.test(u)){ if (m === 'GET') return json(200, st.ns); return r.fulfill({ status: 201, body: '' }); }
      if (/\/hwcheck_records/.test(u) && m === 'POST' && opt.noMissCol && body && body[0] && 'missing_items' in body[0])
        return json(400, { code: 'PGRST204', message: "Could not find the 'missing_items' column of 'hwcheck_records' in the schema cache" });
      if (/\/hwcheck_records/.test(u)){ if (m === 'GET'){ (st.hwGets = st.hwGets || []).push(decodeURIComponent(u)); return json(200, opt.hw || []); } return r.fulfill({ status: 201, body: '' }); }
      if (/\/tt_log\?/.test(u) && m === 'GET') return json(200, opt.log || []);
      if (/\/report_config/.test(u)) return json(200, [{ value: '숙제 수행, 오답 처리' }]);
      if (/\/students\?/.test(u)) return json(200, STUDENTS);
      if (/\/tt_period/.test(u)) return json(200, WEDS.map(w => ({ week_wednesday: w, book: opt.book })));
      if (/\/attendance\?/.test(u)) return json(200, opt.att.map(a => Object.assign({ date: TODAYSTR, book: opt.book, memo: '' }, a)));
      if (m !== 'GET') return json(201, []);
      if (/\/tt_classes\?/.test(u)){
        if (/name=eq\./.test(u)) { (st.twinGets = st.twinGets || []).push(decodeURIComponent(u)); return json(200, opt.twin || []); }
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

  // ① 정규 가 수업 — 지난주 같은 반 과제를 과제별로 검사(2026-09-29)
  const LASTWK = (() => { const d = new Date(T0); d.setDate(d.getDate() - 7); return ymd(d); })();
  let { ctx, page, st } = await ctxOf({ book: '정규',
    rows: [row('r001', '고2 가', '지원', '박보검 김하늘 최다은')],
    att: [{ class_id: 'r001', student: '박보검', status: '출석' }, { class_id: 'r001', student: '김하늘', status: '지각' }],
    prev: [{ class_id: 'r001', ymd: LASTWK, homework: '관동별곡 학습지\n오답 노트' }],
    hw: [{ token: 'k-kim', scores: { '관동별곡 학습지 (학습량)': 5, '관동별곡 학습지 (채점)': 2, '관동별곡 학습지 (학습 분석)': 2, '관동별곡 학습지 (오답 분석)': 2, '오답 노트 (학습량)': 0 }, pct: 50, pub: '옛 공개 메모', priv: '', missing: false, plan: '' }] });
  await openCard(page, '고2 가');
  let r = await page.evaluate(() => ({ kind: document.getElementById('cr-kind').textContent, left: document.getElementById('crpanel').getBoundingClientRect().left,
    cards: [...document.querySelectorAll('.cr-card')].map(c => ({ nm: c.querySelector('.cr-top b').textContent, at: c.querySelector('.cr-chip').textContent,
      pct: c.querySelector('.cr-top').textContent, rows: c.querySelectorAll('.cr-item').length, tasks: [...c.querySelectorAll('.cr-tname')].map(x => x.textContent),
      src: (c.querySelector('.cr-src') || {}).textContent || '', stars: c.querySelectorAll('.cr-stars button').length, on: c.querySelectorAll('.cr-stars .on').length,
      lv: c.querySelectorAll('.cr-lvp').length, lvOn: [...c.querySelectorAll('.cr-lvp.on')].map(x => x.textContent), cp: c.querySelectorAll('.cr-cpb').length })),
    hint: (document.querySelector('.cr-hint') || {}).textContent, head: document.querySelector('.cr-sh').textContent }));
  ok('정규 가: 왼쪽 창·"가 수업" 표시', r.kind === '가 수업' && r.left === 0, JSON.stringify(r));
  const card = n => r.cards.find(x => x.nm === n) || {};
  ok('학생 3명·출석 칩', r.cards.length === 3 && card('박보검').at === '출석' && card('김하늘').at === '지각' && card('최다은').at === '미체크', JSON.stringify(r.cards));
  ok('지난주 같은 반 과제 2개 × 학습량·채점·학습 분석·오답 분석 = 8줄, 학습량 별 5개 + 3단계 알약 3개씩 + 베낌 의심', card('박보검').tasks.join('|') === '관동별곡 학습지|오답 노트' && card('박보검').rows === 8 && card('박보검').stars === 10 &&
     card('박보검').lv === 18 && card('박보검').cp === 2 && card('박보검').lvOn.length === 0 &&
     /과제/.test(card('박보검').src), JSON.stringify(card('박보검')));
  ok('지난 과제 조회 = 같은 반·지난 3주', (st.srcGets || []).some(u => /class_id=in\.\("r001"\)/.test(u) && /ymd=gte\./.test(u)), JSON.stringify(st.srcGets));
  ok('기존 기록 50%·별 5개·완벽 3개 켜짐(없는 3단계 키는 미체크) · 없는 학생 미검사', /50%/.test(card('김하늘').pct) && card('김하늘').on === 5 && card('김하늘').lvOn.join() === '완벽,완벽,완벽' && /미검사/.test(card('박보검').pct), JSON.stringify(r.cards));
  ok('창에 "숙제"라는 말이 없다', await page.$eval('#crpanel', e => !/숙제/.test(e.textContent)));
  ok('안내·머리 문구', /이 수업 과제 검사/.test(r.head) && /학습량을 별 5개로/.test(r.hint) && /안함\/일부함\/완벽/.test(r.hint) && /별 5개·완벽이면 슈퍼스타 별/.test(r.hint), r.hint);
  await page.fill('#cr-prog', '문학 — 「사미인곡」');
  await page.fill('#cr-task', '비교 학습지 1장\n오답 노트');
  const iPark = await page.evaluate(() => CR.names.map(x => x.p).indexOf('박보검'));
  await page.fill('#cr-c-' + iPark, '정서 변화를 정확히 짚음');
  await page.click(`[data-star="${iPark}|0|5"]`);
  await page.click(`[data-hlv="${iPark}|1|1"]`);
  r = await page.evaluate(i => ({ prog: document.getElementById('cr-prog').value, cm: document.getElementById('cr-c-' + i).value }), iPark);
  ok('별을 눌러도 쓰던 진도·코멘트가 남는다', r.prog === '문학 — 「사미인곡」' && r.cm === '정서 변화를 정확히 짚음', JSON.stringify(r));
  await page.waitForFunction(() => /저장됨/.test(document.querySelector('.cr-dot.ok') ? document.querySelector('.cr-dot.ok').textContent : ''), null, { timeout: 5000 });
  let hwW = st.writes.filter(w => /hwcheck_records/.test(w.u)).pop();
  const CID = await page.evaluate(() => CR.c.id);
  ok('과제 검사는 이 수업 것만 읽는다(class_id)', (st.hwGets || []).some(g => g.includes('class_id=eq.' + CID)), JSON.stringify(st.hwGets));
  ok('수업마다 한 줄 — 반ID·가·반이름, on_conflict=week,token,class_id', hwW && /on_conflict=week,token,class_id/.test(hwW.u) && hwW.body[0].class_id === CID && hwW.body[0].part === '가' && !!hwW.body[0].class_name, JSON.stringify(hwW && hwW.body));
  ok('별·3단계 → 과제별 키·만점 22·27%(고르지 않은 3단계는 저장 안 함)', hwW && hwW.body[0].week === PREVWED && hwW.body[0].token === 'k-park' &&
     hwW.body[0].scores['관동별곡 학습지 (학습량)'] === 5 && hwW.body[0].scores['관동별곡 학습지 (채점)'] === 1 && hwW.body[0].scores['오답 노트 (학습량)'] === 0 &&
     !('관동별곡 학습지 (학습 분석)' in hwW.body[0].scores) && !('오답 노트 (채점)' in hwW.body[0].scores) &&
     hwW.body[0].max === 22 && hwW.body[0].pct === 27, JSON.stringify(hwW && hwW.body));
  ok('시트 사본 hwcheckSave(반ID·수업·항목별 만점 maxes)', st.gas.some(g => g.action === 'hwcheckSave' && g.token === 'k-park' && g.week === PREVWED && g.cls === CID && g.part === '가' &&
     g.maxes && g.maxes['관동별곡 학습지 (학습량)'] === 5 && g.maxes['관동별곡 학습지 (채점)'] === 2), JSON.stringify(st.gas.filter(g => g.action === 'hwcheckSave').pop()));
  await page.evaluate(() => { const o = window.crBurst; window.crBurst = function(el, opt){ if (opt && opt.plus) window.__sb = { n: opt.n, plus: opt.plus, at: el && el.id }; return o.apply(this, arguments); }; });
  await page.click(`[data-hlv="${iPark}|1|2"]`); await page.click(`[data-hlv="${iPark}|2|2"]`); await page.click(`[data-hlv="${iPark}|3|2"]`);
  await page.click(`[data-star="${iPark}|4|5"]`); await page.click(`[data-hlv="${iPark}|5|2"]`); await page.click(`[data-hlv="${iPark}|6|2"]`); await page.click(`[data-hlv="${iPark}|7|2"]`);
  await page.waitForTimeout(1000);
  hwW = st.writes.filter(w => /hwcheck_records/.test(w.u) && w.body[0].token === 'k-park').pop();
  r = await page.evaluate(i => document.getElementById('cr-pct-' + i).textContent, iPark);
  const sbBurst = await page.evaluate(() => window.__sb);
  ok('모든 과제 별 5개·완벽 → 100% 🏆(슈퍼스타 별 대상)', hwW && hwW.body[0].pct === 100 && /100%/.test(r) && /🏆/.test(r), JSON.stringify([hwW && hwW.body[0].pct, r]));
  ok('100%가 되는 순간 — "★ 별 +1" 칩(팡) + 금색 별과 "★ +1"', /★ 별 \+1/.test(r) && await page.evaluate(i => !!document.querySelector('#cr-star1-' + i), iPark) && sbBurst.at === 'cr-star1-' + iPark &&
     sbBurst && sbBurst.n === 12 && sbBurst.plus === '★ +1', JSON.stringify(sbBurst));
  const iKim = await page.evaluate(() => CR.names.map(x => x.p).indexOf('김하늘'));
  await page.click(`[data-star="${iKim}|4|1"]`);
  await page.waitForTimeout(1000);
  hwW = st.writes.filter(w => /hwcheck_records/.test(w.u) && w.body[0].token === 'k-kim').pop();
  ok('기존 공개 메모는 그대로 싣는다', hwW && hwW.body[0].pub === '옛 공개 메모' && hwW.body[0].scores['오답 노트 (학습량)'] === 1, JSON.stringify(hwW && hwW.body));
  // 과제마다 미제출(2026-10-01)
  r = await page.evaluate(i => [...document.querySelectorAll(`[data-tmiss^="${i}|"]`)].map(x => x.textContent), iKim);
  ok('과제마다 [미제출] 버튼(과제 2개 → 2개) + 카드 [전체 미제출]', r.length === 2 && r.every(t => t === '미제출') && /전체 미제출/.test(await page.$eval(`[data-miss="${iKim}"]`, e => e.textContent)), JSON.stringify(r));
  await page.click(`[data-tmiss="${iKim}|1"]`);
  await page.waitForTimeout(1000);
  hwW = st.writes.filter(w => /hwcheck_records/.test(w.u) && w.body[0].token === 'k-kim').pop();
  r = await page.evaluate(i => ({ plan: !document.getElementById('cr-plan-' + i).hidden, pct: document.getElementById('cr-pct-' + i).textContent,
    dim: document.querySelectorAll('.cr-card[data-i="' + i + '"] .cr-task.miss').length }), iKim);
  ok('오답 노트만 미제출 → missing_items·그 과제 0점·나머지로 50%·전체 미제출 아님', hwW && JSON.stringify(hwW.body[0].missing_items) === '["오답 노트"]' &&
     hwW.body[0].scores['오답 노트 (학습량)'] === 0 && hwW.body[0].scores['오답 노트 (채점)'] === 0 && hwW.body[0].scores['관동별곡 학습지 (채점)'] === 2 && hwW.body[0].pct === 50 && hwW.body[0].missing === false, JSON.stringify(hwW && hwW.body));
  ok('화면 — 대책 칸 열림·"미제출 1"·그 과제 흐림', r.plan && /50%/.test(r.pct) && /미제출 1/.test(r.pct) && r.dim === 1, JSON.stringify(r));
  await page.click(`[data-hlv="${iKim}|5|0"]`);
  await page.waitForTimeout(1000);
  hwW = st.writes.filter(w => /hwcheck_records/.test(w.u) && w.body[0].token === 'k-kim').pop();
  ok('그 과제에 3단계(안함)를 고르면 미제출이 풀리고 안함=0이 저장된다', hwW && hwW.body[0].missing_items.length === 0 && hwW.body[0].scores['오답 노트 (채점)'] === 0, JSON.stringify(hwW && hwW.body));
  await page.click(`[data-hlv="${iKim}|5|0"]`);
  await page.click(`[data-star="${iKim}|4|3"]`);
  await page.waitForTimeout(1000);
  hwW = st.writes.filter(w => /hwcheck_records/.test(w.u) && w.body[0].token === 'k-kim').pop();
  ok('같은 알약을 다시 누르면 미체크(키 없음) · 별 3개', hwW && !('오답 노트 (채점)' in hwW.body[0].scores) && hwW.body[0].scores['오답 노트 (학습량)'] === 3, JSON.stringify(hwW && hwW.body));
  // 베낌 의심(비공개) — 과제 검사 기록이 아니라 class_notes.comments['__베낌']
  const nCp = st.writes.filter(w => /class_notes/.test(w.u)).length;
  await page.click(`[data-cp="${iKim}|0"]`);
  await page.waitForTimeout(1300);
  let cpW = st.writes.filter(w => /class_notes/.test(w.u)).slice(nCp).pop();
  ok('베낌 의심 → class_notes.comments.__베낌 = {김하늘:[관동별곡 학습지]} · 과제 검사 기록에는 없음', cpW && JSON.stringify(cpW.body[0].comments['__베낌']) === '{"김하늘":["관동별곡 학습지"]}' &&
     !st.writes.filter(w => /hwcheck_records/.test(w.u)).some(w => /베낌/.test(JSON.stringify(w.body))) &&
     await page.$eval(`[data-cp="${iKim}|0"]`, e => e.classList.contains('on')), JSON.stringify(cpW && cpW.body[0].comments));
  const iChoi = await page.evaluate(() => CR.names.map(x => x.p).indexOf('최다은'));
  await page.click(`[data-miss="${iChoi}"]`);
  r = await page.evaluate(i => ({ plan: !document.getElementById('cr-plan-' + i).hidden, pct: document.getElementById('cr-pct-' + i).textContent }), iChoi);
  ok('미제출 → 대책 칸·"미제출" 표시', r.plan && /미제출/.test(r.pct), JSON.stringify(r));
  r = await page.evaluate(i => ({ note: (document.getElementById('cr-auto-' + i) || {}).textContent || '', hid: (document.getElementById('cr-auto-' + i) || {}).hidden,
    ph: document.getElementById('cr-c-' + i).placeholder }), iChoi);
  ok('전체 미제출·코멘트 비면 "최다은 친구는 과제 제출을 하지 않았습니다!!!!"로 기록된다고 표시', /최다은 친구는 과제 제출을 하지 않았습니다!!!!로 기록됩니다/.test(r.note) && !r.hid && /비워 두면/.test(r.ph), JSON.stringify(r));
  await page.evaluate(i => crPvOpen(i), iChoi);
  ok('미리보기 코멘트에도 그 문장', /선생님 코멘트최다은 친구는 과제 제출을 하지 않았습니다!!!!/.test(await page.$eval('#crpv-box', e => e.textContent)));
  await page.evaluate(() => crPvClose());
  await page.type('#cr-c-' + iChoi, '다음엔 꼭');
  ok('코멘트를 적으면 안내 줄이 숨는다', await page.evaluate(i => document.getElementById('cr-auto-' + i).hidden, iChoi));
  await page.fill('#cr-c-' + iChoi, '');
  await page.type('#cr-c-' + iChoi, 'a'); await page.keyboard.press('Backspace');
  ok('다시 비우면 안내 줄이 보인다', await page.evaluate(i => !document.getElementById('cr-auto-' + i).hidden, iChoi));
  await page.fill('#cr-plan-' + iChoi, '9/30 재검사');
  await page.click('#cr-save');
  await page.waitForFunction(() => /저장했어요/.test(document.getElementById('cr-msg').textContent), null, { timeout: 8000 });
  hwW = st.writes.filter(w => /hwcheck_records/.test(w.u) && w.body[0].token === 'k-choi').pop();
  ok('전체 미제출·대책 저장(0%, 과제 2개 모두 목록에)', hwW && hwW.body[0].missing === true && hwW.body[0].plan === '9/30 재검사' && hwW.body[0].pct === 0 && hwW.body[0].missing_items.length === 2, JSON.stringify(hwW && hwW.body));
  let nw = st.writes.filter(w => /class_notes/.test(w.u)).pop();
  ok('저장 → class_notes(part 가·진도·과제·코멘트 하나)', nw && nw.body[0].part === '가' && /사미인곡/.test(nw.body[0].progress) && nw.body[0].homework.split('\n').length === 2 &&
     nw.body[0].comments['박보검'] === '정서 변화를 정확히 짚음' && Object.keys(nw.body[0].comments).filter(k => k[0] !== '_').length === 1 && !!nw.body[0].comments['__베낌'] && !('report_status' in nw.body[0]), JSON.stringify(nw && nw.body));
  ok('정규는 naeshin 기록을 안 건드림', !st.writes.some(w => /naeshin_records/.test(w.u)));
  await page.click('#cr-gen');
  await page.waitForFunction(() => /마쳤습니다/.test(document.getElementById('cr-msg').textContent), null, { timeout: 8000 });
  const rq = st.gas.filter(g => g.action === 'editReqAdd').pop();
  ok('생성 → 요청 글(가 수업·반ID·날짜)', rq && rq.screen === '수업 리포트' && rq.text.indexOf('[수업 리포트] 정규 r001 ' + TODAYSTR) === 0 && /가 수업/.test(rq.text), rq && rq.text);
  ok('생성 성공 → 창의 [리포트 생성] 버튼에서 하트 14개', await page.evaluate(() => { const l = document.querySelector('.cr-hb'); return !!l && l.querySelectorAll('.heart svg').length === 14; }));
  ok('창 안내 = 수업 기록을 마쳤습니다', /수업 기록을 마쳤습니다/.test(await page.$eval('#crpanel', e => e.textContent)));
  await page.waitForTimeout(1900);
  ok('하트는 잠시 뒤 사라진다', !(await page.$('.cr-hb')));
  await page.evaluate(() => crClose());
  r = await page.evaluate(() => { const b = document.querySelector('.blk .crbtn'); const l = document.querySelector('.cr-hb');
    return { t: b.textContent, fin: b.classList.contains('fin'), pop: b.classList.contains('popin'), hearts: l ? l.querySelectorAll('.heart').length : 0 }; });
  ok('창을 닫으면 카드 버튼 [기록 완료 ✓]·완료 색·팡 + 하트', r.t === '기록 완료 ✓' && r.fin && r.pop && r.hearts === 14, JSON.stringify(r));
  await page.evaluate(() => render());
  r = await page.evaluate(() => document.querySelector('.blk .crbtn').classList.contains('popin'));
  ok('다시 그리면 팡은 한 번만(완료 표시는 유지)', !r && await page.$eval('.blk .crbtn', e => e.textContent) === '기록 완료 ✓');
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
  ok('확인 수업: 표시·숙제 검사·앞 괄호 뗀 이름·시험범위 칸 없음', r.kind === '확인 수업' && /과제 검사/.test(r.head) && !/숙제/.test(r.head) && r.names.join() === '김하늘,박보검' && !r.scope && !/진도/.test(r.chk), JSON.stringify(r));
  ok('확인 수업에도 다음 수업까지 숙제 칸', !!(await page.$('#cr-task')) && /다음 수업까지 과제/.test(await page.$eval('label[for=cr-task]', e => e.textContent)));
  await page.fill('#cr-task', '서술형 오답 다시 쓰기');
  await page.click('#cr-gen');
  await page.waitForFunction(() => /마쳤습니다/.test(document.getElementById('cr-msg').textContent), null, { timeout: 8000 });
  ok('확인 수업 숙제도 저장', st.writes.some(w => /class_notes/.test(w.u) && w.body && w.body[0] && w.body[0].homework === '서술형 오답 다시 쓰기'));
  ok('확인 수업은 진도 없이도 생성', st.gas.some(g => g.action === 'editReqAdd' && /n002/.test(g.text) && /확인 수업/.test(g.text)));
  await ctx.close();

  // ②-2 내신 — 확인 수업이 학생마다 지난 진도 수업 과제를 검사한다(2026-09-29)
  {
    const D3 = (() => { const d = new Date(T0); d.setDate(d.getDate() - 3); return ymd(d); })();
    ({ ctx, page, st } = await ctxOf({ book: '내신',
      rows: [row('n001', '고2 화정A(비상 문학)', '주혜', '박보검'), Object.assign(row('n002', '고2 확인', '연주', '(화정)박보검 (화정)김하늘'), { start_time: '7:30', end_time: '9:00' })],
      att: [], hw: [], prev: [{ class_id: 'n001', ymd: D3, homework: '교과서 1~6번\n서술형 정리' }] }));
    await openCard(page, '고2 확인');
    r = await page.evaluate(() => [...document.querySelectorAll('.cr-card')].map(c => ({ nm: c.querySelector('.cr-top b').textContent,
      tasks: [...c.querySelectorAll('.cr-tname')].map(x => x.textContent), rows: c.querySelectorAll('.cr-item').length,
      src: (c.querySelector('.cr-src') || {}).textContent || '', txt: c.textContent })));
    const pk = r.find(x => x.nm === '박보검') || {}, kh = r.find(x => x.nm === '김하늘') || {};
    ok('내신 확인: 박보검은 진도 수업 과제 2개 × 4줄', pk.tasks.join('|') === '교과서 1~6번|서술형 정리' && pk.rows === 8 && /진도/.test(pk.src), JSON.stringify(pk));
    ok('내신 확인: 진도 반이 없는 김하늘은 검사할 과제 없음 안내', kh.rows === 0 && /지난 수업에 적힌 과제가 없습니다/.test(kh.txt), JSON.stringify(kh));
    ok('내신 과제 조회 = 학생들의 내신 반 전체', (st.srcGets || []).some(u => /"n001"/.test(u) && /"n002"/.test(u)), JSON.stringify(st.srcGets));
    await ctx.close();
  }

  // ②-4 중3·고3은 내신 기간에도 정규 수업(2026-10-01 사용자) — 진도/확인 구분·시험범위 없음, 지난 과제는 정규 짝 반에서도 찾는다
  {
    const D7 = (() => { const d = new Date(T0); d.setDate(d.getDate() - 7); return ymd(d); })();
    const base = row('n015', '고3파이널A', '슈', '박보검 김하늘');
    ({ ctx, page, st } = await ctxOf({ book: '내신', rows: [base],
      twin: [{ class_id: 'r020', day: base.day, start_time: base.start_time, teacher: '슈' }],
      att: [], hw: [], prev: [{ class_id: 'r020', ymd: D7, homework: '2-4회차 모의고사' }] }));
    await openCard(page, '고3파이널A');
    r = await page.evaluate(() => ({ kind: document.getElementById('cr-kind').textContent, scope: !!document.getElementById('cr-scope'),
      tasks: [...document.querySelectorAll('.cr-card')][0] ? [...[...document.querySelectorAll('.cr-card')][0].querySelectorAll('.cr-tname')].map(x => x.textContent) : [] }));
    ok('고3 내신 주: "정규 수업"(진도 아님)·시험범위 칸 없음', r.kind === '정규 수업' && !r.scope, JSON.stringify(r));
    ok('고3 내신 주: 지난주 정규 짝 반(r020) 과제로 검사', r.tasks.join('|') === '2-4회차 모의고사', JSON.stringify(r));
    ok('짝 반 찾기 = 정규 같은 이름 반 · 과제 조회 = 두 시간표·두 반', (st.twinGets || []).some(u => /book=eq\.정규/.test(u) && /name=eq\.고3파이널A/.test(u)) &&
       (st.srcGets || []).some(u => /"n015"/.test(u) && /"r020"/.test(u) && /book=in\./.test(u)), JSON.stringify([st.twinGets, st.srcGets]));
    await ctx.close();
  }

  // ②-3 반 전체 검사 과제 추가(교재 데일리 과제 등) — 지난 과제가 없는 진도 수업(2026-09-29)
  {
    const D7 = (() => { const d = new Date(T0); d.setDate(d.getDate() - 7); return ymd(d); })();
    ({ ctx, page, st } = await ctxOf({ book: '내신',
      rows: [row('n001', '고2 화정A(비상 문학)', '주혜', '박보검 김하늘')],
      att: [], hw: [], prev: [{ class_id: 'n001', ymd: D7, homework: '', comments: { '__검사과제': '데일리 독해 1회\n어휘 10개' } }] }));
    await openCard(page, '화정A');
    r = await page.evaluate(() => ({ box: !!document.querySelector('.cr-xt'), last: (document.getElementById('cr-xt-last') || {}).textContent || '',
      rows: document.querySelectorAll('.cr-item').length, note: [...document.querySelectorAll('.cr-card .cr-note')].length }));
    ok('반 전체 과제 칸·지난번 과제 버튼·처음엔 별 칸 없음', r.box && /데일리 독해 1회/.test(r.last) && r.rows === 0 && r.note === 2, JSON.stringify(r));
    await page.fill('#cr-xt', '교재 p.12~15');
    await page.click('#cr-xt-add');
    await page.waitForFunction(() => /추가했습니다/.test(document.getElementById('cr-msg').textContent), null, { timeout: 8000 });
    let nw2 = st.writes.filter(w => /class_notes/.test(w.u)).pop();
    r = await page.evaluate(() => ({ rows: document.querySelectorAll('.cr-item').length, head: (document.querySelector('.cr-src') || {}).textContent || '',
      chips: [...document.querySelectorAll('.cr-xt .cr-unit')].map(x => x.firstChild.textContent) }));
    ok('추가 → 학생마다 과제당 4줄 · 반 전체 추가 과제 표시', r.rows === 8 && /반 전체에 추가한 과제/.test(r.head) && r.chips.join() === '교재 p.12~15', JSON.stringify(r));
    ok('추가한 과제는 class_notes.comments 예약 키에 저장', nw2 && nw2.body[0].comments['__검사과제'] === '교재 p.12~15', JSON.stringify(nw2 && nw2.body));
    await page.click('#cr-xt-last');
    await page.waitForFunction(() => document.querySelectorAll('.cr-xt .cr-unit').length === 3, null, { timeout: 8000 });
    nw2 = st.writes.filter(w => /class_notes/.test(w.u)).pop();
    ok('지난번 과제 다시 넣기 → 3개', nw2.body[0].comments['__검사과제'] === '교재 p.12~15\n데일리 독해 1회\n어휘 10개' && !(await page.$('#cr-xt-last')), JSON.stringify(nw2.body[0].comments));
    const iP = await page.evaluate(() => CR.names.map(x => x.p).indexOf('박보검'));
    await page.click(`[data-star="${iP}|0|5"]`);
    await page.waitForFunction(() => /저장됨/.test(document.querySelector('.cr-dot.ok') ? document.querySelector('.cr-dot.ok').textContent : ''), null, { timeout: 5000 });
    const hw2 = st.writes.filter(w => /hwcheck_records/.test(w.u)).pop();
    ok('추가 과제 별 저장 — 키·만점 33(과제 3개 × 11)', hw2 && hw2.body[0].scores['교재 p.12~15 (학습량)'] === 5 && hw2.body[0].max === 33 && hw2.body[0].class_id === 'n001', JSON.stringify(hw2 && hw2.body));
    await ctx.close();
  }


  // ⑥ 같은 이름 반 기록 가져오기 (2026-09-29)
  ({ ctx, page, st } = await ctxOf({ book: '정규',
    rows: [row('r001', '고2 가', '지원', '박보검 김하늘'), Object.assign(row('r002', '고2 가', '은지', '최다은'), { start_time: '7:30', end_time: '9:00' }),
           Object.assign(row('r003', '고1 가', '슈', '최다은'), { start_time: '2:00', end_time: '3:30' })],
    att: [{ class_id: 'r001', student: '박보검', status: '출석' }] }));
  st.notes['정규|r002'] = { id: 2, book: '정규', class_id: 'r002', ymd: TODAYSTR, progress: '문학 — 관동별곡 1~3연', homework: '관동별곡 학습지', report_status: '' };
  st.notes['정규|r003'] = { id: 3, book: '정규', class_id: 'r003', ymd: TODAYSTR, progress: '다른 반 진도', homework: '', report_status: '' };
  await page.waitForSelector('.blk[data-cid="r001"] .crbtn', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('.blk[data-cid="r001"] .crbtn').click());
  await page.waitForSelector('#crpanel:not([hidden]) .cr-card', { timeout: 8000 });
  r = await page.evaluate(() => ({ bar: (document.querySelector('.cr-sib') || {}).textContent || '', opts: document.querySelectorAll('#cr-sib-sel option').length,
    p: document.getElementById('cr-prog').value, t: document.getElementById('cr-task').value }));
  ok('빈 반은 같은 이름 반 기록을 미리 채운다(2026-10-02)', r.p === '문학 — 관동별곡 1~3연' && r.t === '관동별곡 학습지' && /불러왔습니다/.test(r.bar), JSON.stringify(r));
  ok('미리 채우기만으로는 저장하지 않는다', !st.writes.some(w => /class_notes/.test(w.u)));
  ok('같은 이름 반(고2 가 · 은지T) 기록만 보이고 다른 반(고1 가)은 없다', /같은 이름 반 기록/.test(r.bar) && /은지T/.test(r.bar) && /관동별곡/.test(r.bar) && r.opts === 1 && !/다른 반 진도/.test(r.bar), JSON.stringify(r));
  ok('조회는 같은 이름 반 ID만 · 이번 주 범위', (st.sibGets || []).some(u => /class_id=in\.\("r002"\)/.test(u) && /ymd=gte\./.test(u) && /ymd=lte\./.test(u)), JSON.stringify(st.sibGets));
  await page.fill('#cr-prog', '임시로 적은 내용');
  await page.click('#cr-sib-go');
  r = await page.evaluate(() => ({ p: document.getElementById('cr-prog').value, t: document.getElementById('cr-task').value, msg: document.getElementById('cr-msg').textContent }));
  ok('[가져오기] → 수업 내용·과제가 채워진다(덮어쓰기 확인 뒤)', r.p === '문학 — 관동별곡 1~3연' && r.t === '관동별곡 학습지' && /가져왔습니다/.test(r.msg), JSON.stringify(r));
  ok('가져오기만으로는 저장하지 않는다', !st.writes.some(w => /class_notes/.test(w.u)));
  await page.click('#cr-save');
  await page.waitForFunction(() => /저장했어요/.test(document.getElementById('cr-msg').textContent), null, { timeout: 8000 });
  const sibW = st.writes.filter(w => /class_notes/.test(w.u)).pop();
  ok('[저장] → 이 반(r001)에만 저장, 원래 반(r002)은 그대로', sibW && sibW.body[0].class_id === 'r001' && sibW.body[0].progress === '문학 — 관동별곡 1~3연' && st.notes['정규|r002'].homework === '관동별곡 학습지', JSON.stringify(sibW && sibW.body));
  await ctx.close();
  ({ ctx, page, st } = await ctxOf({ book: '정규',
    rows: [row('r001', '고2 가', '지원', '박보검'), Object.assign(row('r002', '고2 가', '은지', '최다은'), { start_time: '7:30', end_time: '9:00' })], att: [] }));
  st.notes['정규|r001'] = { id: 1, book: '정규', class_id: 'r001', ymd: TODAYSTR, progress: '이 반이 적은 진도', homework: '', report_status: '' };
  st.notes['정규|r002'] = { id: 2, book: '정규', class_id: 'r002', ymd: TODAYSTR, progress: '문학 — 관동별곡 1~3연', homework: '관동별곡 학습지', report_status: '' };
  await page.waitForSelector('.blk[data-cid="r001"] .crbtn', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('.blk[data-cid="r001"] .crbtn').click());
  await page.waitForSelector('#crpanel:not([hidden]) .cr-card', { timeout: 8000 });
  r = await page.evaluate(() => ({ p: document.getElementById('cr-prog').value, bar: (document.querySelector('.cr-sib') || {}).textContent || '' }));
  ok('이미 적은 반은 미리 채우지 않는다', r.p === '이 반이 적은 진도' && !/불러왔습니다/.test(r.bar) && /같은 이름 반 기록/.test(r.bar), JSON.stringify(r));
  await ctx.close();
  ({ ctx, page, st } = await ctxOf({ book: '정규', rows: [row('r001', '고2 가', '지원', '박보검')], att: [] }));
  await page.waitForSelector('.blk[data-cid="r001"] .crbtn', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('.blk[data-cid="r001"] .crbtn').click());
  await page.waitForSelector('#crpanel:not([hidden]) .cr-card', { timeout: 8000 });
  ok('같은 이름 반이 없으면 가져오기 줄도 없다', !(await page.$('.cr-sib')) && !(st.sibGets || []).length);
  await ctx.close();

  // ⑦ 수업 태도 3단계 알약(2026-10-01) — 누르면 comments.__태도 로 저장, 다시 누르면 지움
  ({ ctx, page, st } = await ctxOf({ book: '정규', rows: [row('r001', '고2 가', '지원', '박보검 김하늘')], att: [{ class_id: 'r001', student: '박보검', status: '출석' }] }));
  await openCard(page, '고2 가');
  r = await page.evaluate(() => [...document.querySelectorAll('.cr-card')].map(c => [...c.querySelectorAll('.cr-attp')].map(x => x.textContent).join('|')));
  ok('학생마다 태도 알약 3개', r.length === 2 && r.every(x => x === '매우 좋음|좋음|노력 필요'), JSON.stringify(r));
  ok('코멘트 칸 안내 — 학생 페이지에 보여요', await page.$eval('.cr-card input[id^="cr-c-"]', e => /학생 페이지에 보여요/.test(e.placeholder)));
  const iA = await page.evaluate(() => CR.names.map(x => x.p).indexOf('박보검'));
  const iB = await page.evaluate(() => CR.names.map(x => x.p).indexOf('김하늘'));
  await page.fill('#cr-prog', '태도 저장 전에 쓰던 진도');
  await page.click(`[data-att="${iA}"][data-lv="0"]`);
  await page.click(`[data-att="${iB}"][data-lv="2"]`);
  await page.waitForFunction(() => /수업 태도를 저장했어요/.test(document.getElementById('cr-msg').textContent), null, { timeout: 6000 });
  let aw = st.writes.filter(w => /class_notes/.test(w.u));
  ok('두 번 눌러도 한 번에 저장(0.7초 모음)', aw.length === 1, aw.length);
  aw = aw.pop();
  ok('comments.__태도 = {박보검: 매우 좋음, 김하늘: 노력 필요} + 진도도 함께', aw && aw.body[0].comments['__태도']['박보검'] === '매우 좋음' && aw.body[0].comments['__태도']['김하늘'] === '노력 필요' &&
     aw.body[0].progress === '태도 저장 전에 쓰던 진도' && !aw.body[0].report_status, JSON.stringify(aw && aw.body));
  r = await page.evaluate(i => ({ on: document.querySelector(`[data-att="${i}"].on`).textContent, prog: document.getElementById('cr-prog').value }), iA);
  ok('고른 알약 표시·쓰던 진도 유지', r.on === '매우 좋음' && r.prog === '태도 저장 전에 쓰던 진도', JSON.stringify(r));
  await page.click(`[data-att="${iA}"][data-lv="0"]`);
  await page.waitForFunction(n => document.querySelectorAll('.cr-attp.on').length === 1, null, { timeout: 3000 });
  await page.waitForTimeout(1200);
  aw = st.writes.filter(w => /class_notes/.test(w.u)).pop();
  ok('같은 알약을 다시 누르면 지운다', !aw.body[0].comments['__태도']['박보검'] && aw.body[0].comments['__태도']['김하늘'] === '노력 필요', JSON.stringify(aw.body[0].comments));
  await page.click(`[data-att="${iA}"][data-lv="1"]`);
  await page.evaluate(() => crClose());
  await page.waitForTimeout(800);
  aw = st.writes.filter(w => /class_notes/.test(w.u)).pop();
  ok('창을 바로 닫아도 태도가 저장된다', aw.body[0].comments['__태도']['박보검'] === '좋음', JSON.stringify(aw.body[0].comments));
  await ctx.close();

  // ⑦-2 039 적용 전(missing_items 열 없음) — 한 번 실패하면 열을 빼고 다시 저장, 점수는 남는다
  ({ ctx, page, st } = await ctxOf({ book: '정규', noMissCol: true, rows: [row('r001', '고2 가', '지원', '박보검')], att: [{ class_id: 'r001', student: '박보검', status: '출석' }],
    prev: [{ class_id: 'r001', ymd: LASTWK, homework: '관동별곡 학습지\n오답 노트' }] }));
  await openCard(page, '고2 가');
  await page.click('[data-tmiss="0|1"]');
  await page.waitForFunction(() => /저장됨/.test((document.getElementById('cr-dot-0') || {}).textContent || ''), null, { timeout: 6000 });
  let hw3 = st.writes.filter(w => /hwcheck_records/.test(w.u));
  ok('열이 없으면 빼고 다시 저장(점수 0·missing 거짓)·안내', hw3.length === 2 && !('missing_items' in hw3[1].body[0]) && hw3[1].body[0].scores['오답 노트 (채점)'] === 0 &&
     /039/.test(await page.$eval('#cr-msg', e => e.textContent)), JSON.stringify(hw3.map(w => w.body[0])));
  await ctx.close();

  // ⑦-3 학생별 리포트 미리보기 — 저장 전 입력값으로 학습 이력 카드를 그린다
  ({ ctx, page, st } = await ctxOf({ book: '정규', rows: [row('r001', '고2 가', '지원', '박보검 김하늘 최다은')],
    att: [{ class_id: 'r001', student: '박보검', status: '출석' }, { class_id: 'r001', student: '김하늘', status: '지각' }],
    prev: [{ class_id: 'r001', ymd: LASTWK, homework: '관동별곡 학습지\n오답 노트' }] }));
  await openCard(page, '고2 가');
  const iP2 = await page.evaluate(() => CR.names.map(x => x.p).indexOf('박보검'));
  await page.fill('#cr-prog', '「사미인곡」 정리');
  await page.fill('#cr-task', '비교 학습지 1장');
  await page.fill('#cr-c-' + iP2, '집중이 좋았어요');
  await page.click(`[data-att="${iP2}"][data-lv="0"]`);
  await page.click(`[data-star="${iP2}|0|5"]`);
  await page.click(`[data-tmiss="${iP2}|1"]`);
  const wBefore = st.writes.length;
  await page.click(`[data-pv="${iP2}"]`);
  r = await page.evaluate(() => ({ open: !document.getElementById('crpv').hidden, t: document.getElementById('crpv-box').textContent,
    z: +getComputedStyle(document.getElementById('crpv')).zIndex }));
  ok('카드의 [리포트 미리보기] → 그 학생 카드(진도·과제·태도·코멘트·과제 검사·과제별 미제출)', r.open && /박보검/.test(r.t) && /사미인곡/.test(r.t) && /비교 학습지 1장/.test(r.t) &&
     /수업 태도 ?매우 좋음/.test(r.t) && /집중이 좋았어요/.test(r.t) && /관동별곡 학습지5\/5/.test(r.t) && /오답 노트미제출/.test(r.t) && /과제 검사23%2건 중 1건 미제출/.test(r.t) && r.z > 81, r.t);
  await page.waitForTimeout(900);
  ok('미리보기는 리포트를 요청하지 않는다', !st.gas.some(g => g.action === 'editReqAdd') && st.writes.slice(wBefore).every(w => !w.body || !w.body[0] || !w.body[0].report_status));
  await page.keyboard.press('Escape');
  ok('Esc → 미리보기만 닫힘(창은 그대로)', await page.evaluate(() => document.getElementById('crpv').hidden && !document.getElementById('crpanel').hidden));
  await page.click('#cr-pv');
  r = await page.evaluate(() => document.getElementById('crpv-box').textContent);
  ok('아래 [미리보기] → 첫 학생부터 · 1 / 3명', /1 \/ 3명/.test(r), r);
  const iC = await page.evaluate(() => CR.names.map(x => x.p).indexOf('최다은'));
  await page.evaluate(i => crPvOpen(i), iC);
  r = await page.evaluate(() => document.getElementById('crpv-box').textContent);
  ok('출석 미체크 학생은 "리포트에서 빠져요" 안내', /출석을 체크하지 않아/.test(r) && /최다은/.test(r), r);
  await page.click('.crpv-nav button[aria-label="앞 학생"]');
  r = await page.evaluate(() => document.querySelector('.crpv-nav b').textContent);
  ok('‹ 로 앞 학생', !/최다은/.test(r), r);
  await page.evaluate(() => crClose());
  ok('창을 닫으면 미리보기도 닫힘', await page.evaluate(() => document.getElementById('crpv').hidden));
  await ctx.close();

  // ⑦-4 학생마다 과제 + 정규 1회 이동 학생은 원래 반 과제(2026-10-01 원장님)
  ({ ctx, page, st } = await ctxOf({ book: '정규',
    rows: [row('r001', '고2 가', '지원', '박보검 김하늘'), Object.assign(row('r002', '고2 가', '은지', '최다은'), { start_time: '7:30', end_time: '9:00' })],
    att: [{ class_id: 'r001', student: '박보검', status: '출석' }, { class_id: 'r001', student: '최다은', status: '출석' }],
    log: [{ id: 9, kind: '1회', at: new Date().toISOString(), apply_date: TODAYSTR, student: '최다은', from_class_id: 'r002', to_class_id: 'r001', reason: '개인 사정', book: '정규' }],
    prev: [{ class_id: 'r001', ymd: LASTWK, homework: '반 과제 A', comments: { '__개별과제': { '박보검': '오답 노트 다시 쓰기' } } },
           { class_id: 'r002', ymd: LASTWK, homework: '원래 반 과제 B' }] }));
  await openCard(page, '고2 가');
  r = await page.evaluate(() => { const o = {}; CR.names.forEach((x, i) => { o[x.p] = [...document.querySelectorAll('.cr-card[data-i="' + i + '"] .cr-tname')].map(e => e.textContent); }); return o; });
  ok('지난주 박보검에게만 준 과제는 박보검 검사 목록에만', JSON.stringify(r['박보검']) === '["반 과제 A","오답 노트 다시 쓰기"]' && JSON.stringify(r['김하늘']) === '["반 과제 A"]', JSON.stringify(r));
  ok('정규 1회 이동해 온 최다은은 원래 반(r002) 과제로 검사', JSON.stringify(r['최다은']) === '["원래 반 과제 B"]', JSON.stringify(r));
  ok('지난 과제 조회에 원래 반 ID도 포함', (st.srcGets || []).some(u => /"r002"/.test(u) && /"r001"/.test(u)), JSON.stringify(st.srcGets));
  const iK = await page.evaluate(() => CR.names.map(x => x.p).indexOf('김하늘'));
  await page.fill('#cr-prog', '진도');
  await page.fill('#cr-task', '비교 학습지 1장');
  await page.fill('#cr-ih-' + iK, '서술형 3문항 다시 쓰기\n\n어휘 정리');
  await page.click('#cr-save');
  await page.waitForFunction(() => /저장했어요/.test(document.getElementById('cr-msg').textContent), null, { timeout: 8000 });
  let nw4 = st.writes.filter(w => /class_notes/.test(w.u)).pop();
  ok('이 학생만 과제 → comments.__개별과제(빈 줄 정리, 그 학생만)', nw4 && JSON.stringify(nw4.body[0].comments['__개별과제']) === JSON.stringify({ '김하늘': '서술형 3문항 다시 쓰기\n어휘 정리' }) && nw4.body[0].homework === '비교 학습지 1장', JSON.stringify(nw4 && nw4.body[0].comments));
  await page.evaluate(i => crPvOpen(i), iK);
  r = await page.evaluate(() => [...document.querySelectorAll('#crpv-box li')].map(e => e.textContent));
  ok('미리보기 과제 = 반 과제 + 그 학생 과제', JSON.stringify(r) === '["비교 학습지 1장","서술형 3문항 다시 쓰기","어휘 정리"]', JSON.stringify(r));
  await page.evaluate(() => crPvClose());
  await page.fill('#cr-ih-' + iK, '');
  await page.click('#cr-save');
  await page.waitForTimeout(800);
  nw4 = st.writes.filter(w => /class_notes/.test(w.u)).pop();
  ok('비우면 개별 과제 키가 사라진다', nw4 && !('__개별과제' in nw4.body[0].comments), JSON.stringify(nw4 && nw4.body[0].comments));
  await ctx.close();

  // ⑧ 학생 페이지 — 학습 이력(039 class_history)
  const B = (o) => o;
  const HIST = [
    { ymd: '2026-09-30', book: '정규', part: '가', cls: '고2 가', teacher: '지원', time: '수 5:30~7:00', body: B({ attend: '출석', attitude: '매우 좋음',
      summary: '「사미인곡」의 표현상 특징을 정리했습니다.', units: [], homework: ['비교 학습지 1장', '오답 노트'],
      hw: { items: [{ name: '관동별곡 학습지 (학습량)', score: 5, max: 5 }, { name: '관동별곡 학습지 (깊이)', score: 4, max: 5 }, { name: '관동별곡 학습지 (채점)', score: 1, max: 2 }, { name: '오답 노트 (학습량)', score: 0, max: 5 }, { name: '오답 노트 (깊이)', score: 0, max: 5 }],
            pct: 45, missing: false, missing_items: ['오답 노트'], text: '학습지는 충실히 해 왔고 오답 노트는 제출하지 않았습니다.' },
      comment: '집중이 좋았습니다.' }) },
    { ymd: '2026-09-28', book: '정규', part: '나', cls: '고2 나', teacher: '현지', time: '월 5:30~7:00', body: B({ attend: '결석', attend_note: '가족 행사로 결석했습니다.',
      summary: '이번 수업에서는 「속미인곡」을 다뤘습니다.', hw: { items: [], pct: 0, missing: true, text: '' }, comment: '박보검 친구는 과제 제출을 하지 않았습니다!!!!' }) },
    { ymd: '2026-08-29', book: '내신', part: '진도', cls: '고2 화정A', teacher: '주혜', time: '토 2:00~4:00', body: B({ attend: '지각', attitude: '노력 필요', units: ['사미인곡'], hw: { none: true, text: '확인할 것이 없습니다.' } }) },
  ];
  const OLD = [{ ymd: '2026-08-20', book: '정규', part: '가', cls: '고2 가', teacher: '지원', time: '목 5:30~7:00', body: { attend: '출석', summary: '옛 수업',
    hw: { items: [{ name: '독서 학습지 (학습량)', score: 5, max: 5 }, { name: '독서 학습지 (채점)', score: 2, max: 2 }, { name: '독서 학습지 (학습 분석)', score: 2, max: 2 }, { name: '독서 학습지 (오답 분석)', score: 2, max: 2 }],
          pct: 100, missing: false, missing_items: [], text: '모든 과제를 완벽하게 했습니다.' } } }];
  const AH = [
    { ymd: '2026-09-30', book: '정규', class_id: 'r010', cls: '고2 가', day: '수', time: '5:30', status: '출석', makeup: null },
    { ymd: '2026-09-28', book: '정규', class_id: 'r011', cls: '고2 나', day: '월', time: '5:30', status: '결석', makeup: false },
    { ymd: '2026-09-26', book: '내신', class_id: 'n050', cls: '고2 확인', day: '토', time: '4:00', status: '지각', makeup: null },
    { ymd: '2026-08-29', book: '내신', class_id: 'w260829a', cls: '', day: '', time: '', status: '결석', makeup: true },
  ];
  const AH_OLD = [{ ymd: '2026-08-20', book: '정규', class_id: 'r010', cls: '고2 가', day: '목', time: '5:30', status: '출석', makeup: null }];
  const acalls = [];
  const c3 = await b.newContext();
  const hp = await c3.newPage();
  const hcalls = [];
  hp.on('pageerror', e => { perr++; console.log('  ✗ pageerror(s.html 학습 이력)', e.message); });
  await hp.route('**/*', rt => {
    const u = rt.request().url();
    const j = (o, stt) => rt.fulfill({ status: stt || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
    if (/\/rpc\/class_history/.test(u)){ const p = JSON.parse(rt.request().postData()).p; hcalls.push(p);
      if (p.key !== 'abc') return j({ ok: false, error: 'no_student' });
      return j(p.before ? { ok: true, items: OLD, more: false } : { ok: true, items: HIST, more: true }); }
    if (/\/rpc\/attendance_history/.test(u)){ const p = JSON.parse(rt.request().postData()).p; acalls.push(p);
      return j(p.before ? { ok: true, items: AH_OLD, more: false, counts: { 출석: 2, 지각: 1, 결석: 2 } } : { ok: true, items: AH, more: true, counts: { 출석: 2, 지각: 1, 결석: 2 } }); }
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
  await hp.goto('http://127.0.0.1:' + port + '/s.html?key=abc', { waitUntil: 'domcontentloaded' });
  await hp.waitForFunction(() => /수업 리포트최근/.test((document.getElementById('menu') || {}).textContent || ''), null, { timeout: 15000 });
  r = await hp.evaluate(() => { const c = [...document.querySelectorAll('#menu .card')].find(x => /수업 리포트/.test(x.textContent)); return c && c.textContent; });
  ok('수업 리포트 카드는 알려드립니다 바로 다음', await hp.evaluate(() => { const t = [...document.querySelectorAll('#menu .card h3')].map(x => x.textContent); return t.indexOf('수업 리포트') === t.indexOf('알려드립니다') + 1; }));
  ok('허브 카드 — 수업 리포트 · 최근 수업', /최근 9\/30 \(수\) · 가 수업/.test(r), r);
  ok('본인 확인은 접근코드', hcalls.length >= 1 && hcalls[0].key === 'abc' && !hcalls[0].before, JSON.stringify(hcalls));
  await hp.evaluate(() => openLearnHist());
  await hp.waitForSelector('#lhList .rc', { timeout: 8000 });
  r = await hp.evaluate(() => ({ sum: [...document.querySelectorAll('.lh-sum > div')].map(x => x.textContent), months: [...document.querySelectorAll('.lh-month')].map(x => x.textContent),
    items: [...document.querySelectorAll('.rc')].map(x => x.textContent), tags: [...document.querySelectorAll('.lh-tag')].map(x => x.className + ':' + x.textContent),
    li: [...document.querySelectorAll('.rc')][0].querySelectorAll('li').length, more: !!document.getElementById('lhMoreBtn') }));
  ok('요약 — 수업 3 · 출석·지각 2 · 과제 검사 평균 23% · 매우 좋음 1', r.sum.join('/') === '3수업 리포트/2출석·지각/23%과제 검사 평균/1태도 매우 좋음', JSON.stringify(r.sum));
  ok('주간 리포트 카드·화면은 없다(수업 리포트로 합침)', await hp.evaluate(() => !document.getElementById('crView') && ![...document.querySelectorAll('#menu .card')].some(x => /주간 리포트/.test(x.textContent))));
  ok('달별 묶음 — 9월·8월', r.months.join('|') === '2026년 9월|2026년 8월', JSON.stringify(r.months));
  ok('9/30 — 날짜·가 수업·반·선생님·출석·태도·클로슈가 쓴 내용·과제 2줄·과제 검사 문장·코멘트', /9\/30수/.test(r.items[0]) && /가 수업/.test(r.items[0]) && /고2 가 · 지원T/.test(r.items[0]) && /출석/.test(r.items[0]) &&
     /수업 태도 ?매우 좋음/.test(r.items[0]) && /표현상 특징을 정리했습니다/.test(r.items[0]) && r.li === 2 && /과제 검사45%2건 중 1건 미제출/.test(r.items[0]) && /관동별곡 학습지깊이 4\/55\/5일부함——오답 노트미제출/.test(r.items[0]) && /이번주 과제 검사과제학습량채점학습 분석오답 분석/.test(r.items[0]) &&
     /충실히 해 왔고/.test(r.items[0]) && /집중이 좋았습니다/.test(r.items[0]), r.items[0]);
  ok('수업 태도 타일 — 매우 좋음 · 노력 필요', /수업 태도매우 좋음/.test(r.items[0]) && r.items.some(t => /수업 태도노력 필요/.test(t)), JSON.stringify(r.items.map(t => t.slice(0, 60))));
  ok('9/28 — 결석·결석 안내·전체 미제출·정해 둔 코멘트, 태도 없으면 줄도 없음', /결석/.test(r.items[1]) && /가족 행사로/.test(r.items[1]) && /미제출/.test(r.items[1]) && !/수업 태도/.test(r.items[1]) &&
     /박보검 친구는 과제 제출을 하지 않았습니다!!!!/.test(r.items[1]), r.items[1]);
  ok('8/29 내신 진도 — 수업 진도 타일·"확인할 것이 없습니다."', /진도 수업/.test(r.items[2]) && /수업 진도사미인곡/.test(r.items[2]) && /확인할 것이 없습니다\./.test(r.items[2]) && !/%/.test(r.items[2]), r.items[2]);
  ok('"숙제"라는 말이 없다', !r.items.some(t => /숙제/.test(t)));
  ok('100% 아닌 수업에는 별 +1 표시·효과가 없다', await hp.evaluate(() => !document.querySelector('.lh-star1') && !document.querySelector('.rc-star1') && !document.querySelector('.lh-sb')));
  await hp.click('#lhMoreBtn');
  await hp.waitForFunction(() => document.querySelectorAll('.rc').length === 4, null, { timeout: 5000 });
  await hp.waitForTimeout(400);
  r = await hp.evaluate(() => ({ chip: [...document.querySelectorAll('.lh-star1')].map(x => x.textContent + (x.classList.contains('popin') ? '/pop' : '')),
    box: (document.querySelector('.rc-star1') || {}).textContent || '', layer: document.querySelectorAll('.lh-sb i').length, plus: (document.querySelector('.lh-sb b') || {}).textContent || '',
    seen: JSON.parse(localStorage.getItem('lh_star_seen') || '[]') }));
  ok('과제 검사 100% 수업 — 머리에 "★ 별 +1"(팡) · 과제 검사 상자에 "슈퍼스타 별 +1" · 금색 별 12개와 "★ +1"이 떠오름 · 본 것으로 기억',
     r.chip.join() === '★ 별 +1/pop' && /슈퍼스타 별 \+1/.test(r.box) && r.layer === 12 && r.plus === '★ +1' && r.seen.length === 1 && /2026-08-20/.test(r.seen[0]), JSON.stringify(r));
  await hp.waitForTimeout(1900);
  await hp.evaluate(() => lhRender());
  await hp.waitForTimeout(400);
  ok('이미 본 별은 다시 그려도 효과가 다시 나오지 않는다', await hp.evaluate(() => !document.querySelector('.lh-sb') && !document.querySelector('.lh-star1.popin') && !!document.querySelector('.lh-star1')));
  ok('[지난 수업 더 보기] — before=마지막 날짜로 이어 받고 버튼이 사라진다', hcalls.some(p => p.before === '2026-08-29') && !(await hp.$('#lhMoreBtn')), JSON.stringify(hcalls));
  // ⑧-1 출석 기록 탭(041 attendance_history — 사용자 "학습이력에 출석 지각 내역도 기록하고 싶어요")
  ok('탭 두 개 — 수업 리포트(선택)·출석 기록', await hp.evaluate(() => [...document.querySelectorAll('#lhTabs button')].map(x => x.textContent + (x.classList.contains('on') ? '*' : '')).join('|') === '수업 리포트*|출석 기록'));
  await hp.click('#lhTabs button[data-t="att"]');
  await hp.waitForSelector('.ah-row', { timeout: 5000 });
  r = await hp.evaluate(() => ({ sum: [...document.querySelectorAll('.lh-sum > div')].map(x => x.textContent), rows: [...document.querySelectorAll('.ah-row')].map(x => x.textContent),
    chips: [...document.querySelectorAll('.ah-row .crp-at')].map(x => x.className), months: [...document.querySelectorAll('.lh-month')].map(x => x.textContent),
    note: (document.querySelector('.ah-note') || {}).textContent || '', items: document.querySelectorAll('.rc').length, more: !!document.getElementById('ahMoreBtn') }));
  ok('출석 기록 요약 — 출석 2 · 지각 1 · 결석 2 · 출석률 60%', r.sum.join('/') === '2출석/1지각/2결석/60%출석률', JSON.stringify(r.sum));
  ok('줄마다 날짜·시간·반·상태 칩(내신 표시·지운 반은 "수업")', r.rows.length === 4 && /^9\/30 \(수\)5:30 · 고2 가출석$/.test(r.rows[0]) && /4:00 · 고2 확인 · 내신지각/.test(r.rows[2]) && /^8\/29 \(토\)수업 · 내신/.test(r.rows[3]) &&
     r.chips.join() === 'crp-at ok,crp-at abs,crp-at late,crp-at abs' && r.items === 0, JSON.stringify(r.rows));
  ok('결석은 보충 전/보충 완료 표시', /보충 전결석/.test(r.rows[1]) && /보충 완료결석/.test(r.rows[3]), JSON.stringify(r.rows));
  ok('달별 묶음·안내 문구·더 보기 버튼', r.months.join('|') === '2026년 9월|2026년 8월' && /선생님이 수업 시간표에 기록한 그대로/.test(r.note) && r.more, JSON.stringify(r));
  await hp.click('.ah-chips button:nth-child(2)');
  r = await hp.evaluate(() => [...document.querySelectorAll('.ah-row')].map(x => x.textContent));
  ok('[지각만] 거르기', r.length === 1 && /고2 확인/.test(r[0]), JSON.stringify(r));
  await hp.click('.ah-chips button:nth-child(1)');
  await hp.click('#ahMoreBtn');
  await hp.waitForFunction(() => document.querySelectorAll('.ah-row').length === 5, null, { timeout: 5000 });
  ok('[지난 기록 더 보기] — before=마지막 날짜, 버튼 사라짐', acalls.some(p => p.before === '2026-08-29' && p.key === 'abc') && !(await hp.$('#ahMoreBtn')), JSON.stringify(acalls));
  ok('고른 탭을 기억', await hp.evaluate(() => sessionStorage.getItem('lh_tab') === 'att'));
  await hp.click('#lhTabs button[data-t="rep"]');
  ok('수업 리포트 탭으로 돌아오면 카드가 다시 보인다', await hp.evaluate(() => document.querySelectorAll('.rc').length === 4 && !document.querySelector('.ah-row')));
  await hp.evaluate(() => closeLearnHist());
  ok('닫으면 허브로', await hp.evaluate(() => document.getElementById('lhView').style.display === 'none' && document.getElementById('hubView').style.display !== 'none'));
  await c3.close();

  // ⑧-2 공개된 리포트가 없으면 같은 자리에 비활성 카드
  {
    const c4 = await b.newContext(), ep = await c4.newPage();
    ep.on('pageerror', e => { perr++; console.log('  ✗ pageerror(s.html 빈 수업 리포트)', e.message); });
    await ep.route('**/*', rt => {
      const u = rt.request().url();
      const j = (o, stt) => rt.fulfill({ status: stt || 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
      if (/\/rpc\/class_history/.test(u)) return j({ ok: true, items: [], more: false });
      if (/\/rpc\//.test(u)) return j({ error: 'nope' }, 500);
      if (/supabase/.test(u)) return rt.fulfill({ status: 204, body: '' });
      if (/script\.google/.test(u) && new URL(u).searchParams.get('key')) return j({ result: 'success', info: { name: '박보검', id: '30000001', school: '화정고', grade: '2026 고등 2학년', teacher: '주혜', enrolled: '재원' },
        authed: false, examCount: 0, notices: [], homework: [], analyses: [], clinic: null, stars: { total: 3 }, mockGates: { grades: [], open: false }, clinicEligible: false, vocaTaken: false, mockSignups: [] });
      return /script\.google/.test(u) ? j({ result: 'success' }) : rt.fulfill({ status: 204, body: '' });
    });
    await ep.goto('http://127.0.0.1:' + port + '/s.html?key=abc', { waitUntil: 'domcontentloaded' });
    await ep.waitForFunction(() => /아직 없음/.test((document.getElementById('menu') || {}).textContent || ''), null, { timeout: 15000 });
    r = await ep.evaluate(() => { const cs = [...document.querySelectorAll('#menu .card')], t = cs.map(x => (x.querySelector('h3') || {}).textContent);
      const c = cs[t.indexOf('수업 리포트')]; return { pos: t.indexOf('수업 리포트') - t.indexOf('알려드립니다'), tag: c.tagName, cls: c.className, txt: c.textContent }; });
    ok('리포트가 없으면 알려드립니다 다음에 비활성 카드(누를 수 없음)', r.pos === 1 && r.tag === 'DIV' && /pending/.test(r.cls) && /아직 없음/.test(r.txt), JSON.stringify(r));
    await c4.close();
  }

  // ⑧-3 리포트는 없지만 출석 기록이 있으면 카드가 열리고 출석 기록 탭부터
  {
    const c5 = await b.newContext(), ap = await c5.newPage();
    ap.on('pageerror', e => { perr++; console.log('  ✗ pageerror(s.html 출석 기록만)', e.message); });
    await ap.route('**/*', rt => {
      const u = rt.request().url();
      const j = (o, stt) => rt.fulfill({ status: stt || 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
      if (/\/rpc\/class_history/.test(u)) return j({ ok: true, items: [], more: false });
      if (/\/rpc\/attendance_history/.test(u)) return j({ ok: true, items: AH.slice(0, 2), more: false, counts: { 출석: 1, 지각: 0, 결석: 1 } });
      if (/\/rpc\//.test(u)) return j({ error: 'nope' }, 500);
      if (/supabase/.test(u)) return rt.fulfill({ status: 204, body: '' });
      if (/script\.google/.test(u) && new URL(u).searchParams.get('key')) return j({ result: 'success', info: { name: '박보검', id: '30000001', school: '화정고', grade: '2026 고등 2학년', teacher: '주혜', enrolled: '재원' },
        authed: false, examCount: 0, notices: [], homework: [], analyses: [], clinic: null, stars: { total: 3 }, mockGates: { grades: [], open: false }, clinicEligible: false, vocaTaken: false, mockSignups: [] });
      return /script\.google/.test(u) ? j({ result: 'success' }) : rt.fulfill({ status: 204, body: '' });
    });
    await ap.goto('http://127.0.0.1:' + port + '/s.html?key=abc', { waitUntil: 'domcontentloaded' });
    await ap.waitForFunction(() => /출석 기록 2회/.test((document.getElementById('menu') || {}).textContent || ''), null, { timeout: 15000 });
    r = await ap.evaluate(() => { const c = [...document.querySelectorAll('#menu .card')].find(x => /수업 리포트/.test(x.textContent)); return { tag: c.tagName, txt: c.textContent }; });
    ok('리포트 없이 출석 기록만 있으면 카드가 열린다 — "출석 기록 2회 · 최근 9/30 (수)"', r.tag === 'BUTTON' && /출석 기록 2회 · 최근 9\/30 \(수\)/.test(r.txt), JSON.stringify(r));
    await ap.evaluate(() => openLearnHist());
    await ap.waitForSelector('.ah-row', { timeout: 5000 });
    ok('열면 출석 기록 탭부터', await ap.evaluate(() => document.querySelector('#lhTabs button.on').getAttribute('data-t') === 'att' && document.querySelectorAll('.ah-row').length === 2));
    await c5.close();
  }

  ok('페이지 오류 없음', perr === 0);
  console.log((fail ? '실패 ' + fail + ' / ' : '') + '통과 ' + pass + '건');
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
