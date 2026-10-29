#!/usr/bin/env node
/* 슈퍼스타 관리 → 대기 슈스(2026-10-29 원장님 — 예비 슈스 대기 명단 · 재원 슈스 반 이동 대기 명단) 검증.
 *   NODE_PATH=$(npm root -g) node tools/superstar-waitlist-e2e.js
 * 가짜 수파베이스(student_waitlist·tt_classes·students)·가짜 백엔드(roster·addStudent)로 실제 superstar.html 을 띄워
 * 메뉴 카드·종류 알약·반 드롭다운 인원·정원 자동 채움·저장 본문·대기 시작일 순서·이동 가능 초록 줄·재원 학생 고르기·
 * 고치기(PATCH)·취소·지난 기록·다시 대기로·등록으로 전환(신입 폼 채움 → 등록 → 완료)·표 없음 안내까지 확인한다. */
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (m, c, x) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (x ? ' ' + x : ''))); };
function serve(){
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, ''));
      fs.readFile(f, (e, b) => e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8' }), r.end(b)));
    }).listen(0, () => res(s));
  });
}
(async () => {
  const srv = await serve(), port = srv.address().port;
  const br = await chromium.launch();
  const STU = [   // 수파베이스 students — 명단(SGETS.roster)과 재원 학생 찾기가 같은 표를 읽는다
    { id: 1, name: '박보검', school: '화정고', grade: '2026 고등 1학년', teacher: '이수경', enrolled: '', phone_parent1: '01011112222', class_a: '금5:30', class_b: '일11:00', naeshin_a: '', naeshin_b: '' },
    { id: 2, name: '김하늘', school: '화정고', grade: '2026 고등 1학년', teacher: '이수경', enrolled: '', phone_parent1: '01033334444', class_a: '금5:30', class_b: '', naeshin_a: '', naeshin_b: '' },
    { id: 3, name: '최유리', school: '서정중', grade: '2026 중등 2학년', teacher: '이은지', enrolled: '', phone_parent1: '', class_a: '', class_b: '', naeshin_a: '', naeshin_b: '' },
    { id: 4, name: '이퇴원', school: '능곡고', grade: '2026 고등 3학년', teacher: '이수경', enrolled: '퇴원', phone_parent1: '', class_a: '', class_b: '', naeshin_a: '', naeshin_b: '' }];
  const TT = [
    { book: '정규', class_id: 'r001', name: '고1 가', day: '금', start_time: '5:30', teacher: '지원', roster: '박보검 김하늘 a b c d e f g h i j' },   // 12명
    { book: '정규', class_id: 'r002', name: '고1 나', day: '일', start_time: '11:00', teacher: '승연', roster: '박보검 a b' },                       // 3명
    { book: '내신', class_id: 'n001', name: '고1 화정A(천재 공통국어2)', day: '수', start_time: '5:30', teacher: '현지', roster: 'a b c d' },        // 4명
    { book: '내신', class_id: 'n002', name: '고1 확인', day: '토', start_time: '2:00', teacher: '지원', roster: 'a' },
    { book: '정규', class_id: 'w261101a', name: '이 주만', day: '일', start_time: '1:00', teacher: '슈', roster: 'x' }];   // w* 는 안 보여야
  let WL = [   // 이미 있는 대기 줄 — 대기 시작일이 늦은 줄을 먼저 넣어 순서 검사
    { id: 11, kind: '예비', name: '늦은대기', year: 2027, grade: '고1', school: '백양고', phone_parent: '01055556666', student_id: null, want_book: '정규', want_class_id: 'r001', want_class_name: '고1 가 · 금 5:30 · 지원T', cap: 12, memo: '', started_on: '2026-10-20', status: '대기', done_at: null, done_by_name: '', done_note: '', author_name: '고희주', created_at: '2026-10-20T01:00:00Z', updated_at: '2026-10-20T01:00:00Z', updated_by_name: '' },
    { id: 12, kind: '예비', name: '이른대기', year: 2027, grade: '고1', school: '화수고', phone_parent: '', student_id: null, want_book: '정규', want_class_id: 'r001', want_class_name: '고1 가 · 금 5:30 · 지원T', cap: 13, memo: '슈톡에서 올림', started_on: '2026-10-01', status: '대기', done_at: null, done_by_name: '', done_note: '', author_name: '이은지', created_at: '2026-10-01T01:00:00Z', updated_at: '2026-10-01T01:00:00Z', updated_by_name: '' },
    { id: 13, kind: '재원', name: '김하늘', year: 2026, grade: '고1', school: '화정고', phone_parent: '01033334444', student_id: 2, want_book: '정규', want_class_id: 'r002', want_class_name: '고1 나 · 일 11:00 · 승연T', cap: 3, memo: '일요일로 옮기고 싶어요', started_on: '2026-10-15', status: '대기', done_at: null, done_by_name: '', done_note: '', author_name: '고희주', created_at: '2026-10-15T01:00:00Z', updated_at: '2026-10-15T01:00:00Z', updated_by_name: '' },
    { id: 14, kind: '예비', name: '지난완료', year: 2026, grade: '중2', school: '서정중', phone_parent: '', student_id: null, want_book: '', want_class_id: '', want_class_name: '', cap: null, memo: '', started_on: '2026-09-01', status: '완료', done_at: '2026-09-20T01:00:00Z', done_by_name: '고희주', done_note: '신입 등록 전환', author_name: '고희주', created_at: '2026-09-01T01:00:00Z', updated_at: '2026-09-20T01:00:00Z', updated_by_name: '고희주' }];
  let wlMissing = false, nextId = 100;
  const posts = [], patches = [], regs = [], acts = []; let dialogs = [], promptAnswer = '';
  const pg = await (await br.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  let perr = 0; pg.on('pageerror', e => { perr++; console.log('  ✗ pageerror', e.message); });
  pg.on('dialog', d => { dialogs.push(d.message()); d.type() === 'prompt' ? d.accept(promptAnswer) : d.accept(); });
  await pg.route('**/*', rt => {
    const u = rt.request().url(), m = rt.request().method();
    const j = (o, st) => rt.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
    if (/\/auth\/v1\/token/.test(u)) return j({ access_token: 'tok', expires_in: 3600, refresh_token: 'r' });
    if (/\/functions\/v1\/activity/.test(u)){ acts.push(JSON.parse(rt.request().postData() || '{}')); return j({ digest: 'none' }); }
    if (/\/rest\/v1\/teacher_accounts/.test(u)) return j([{ display_name: '김현지', login_id: 'hj' }]);
    if (/\/rest\/v1\/students/.test(u)) return j(STU);
    if (/\/rest\/v1\/tt_classes/.test(u)) return j(/not\.like\.w/.test(u) ? TT.filter(c => !/^w/.test(c.class_id)) : TT);
    if (/\/rest\/v1\/student_waitlist/.test(u)){
      if (wlMissing) return j({ code: 'PGRST205', message: "Could not find the table 'public.student_waitlist' in the schema cache" }, 404);
      if (m === 'POST'){ const b = JSON.parse(rt.request().postData()); posts.push(b); const row = Object.assign({ id: nextId++, status: '대기', done_at: null, done_by_name: '', done_note: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), updated_by_name: '' }, b); WL.push(row); return j([row], 201); }
      if (m === 'PATCH'){ const id = +(/id=eq\.(\d+)/.exec(u) || [])[1], b = JSON.parse(rt.request().postData()); patches.push([id, b]); const r = WL.find(x => x.id === id); if (!r) return j([]);
        if (b.status && b.status !== r.status){ if (b.status === '대기'){ b.done_at = null; b.done_by_name = ''; b.done_note = ''; } else b.done_at = new Date().toISOString(); }   // 트리거 흉내
        Object.assign(r, b, { updated_at: new Date().toISOString() }); return j([r]); }
      return j(WL.slice().sort((a, b) => a.started_on.localeCompare(b.started_on) || a.id - b.id));
    }
    if (/\/rest\/v1\//.test(u)) return j([]);
    if (/script\.google/.test(u)){
      if (m === 'POST'){
        const b = JSON.parse(rt.request().postData());
        if (b.action === 'addStudent'){ regs.push(b); return j({ result: 'success', name: b.name, token: 'tok-' + regs.length }); }
        return j({ result: 'success' });
      }
      if (/action=roster/.test(u)) return j({ result: 'success', students: STU.filter(s => !s.enrolled).map(s => ({ name: s.name, school: s.school, grade: s.grade, teacher: s.teacher })) });
      if (/action=newStudents/.test(u)) return j({ result: 'success', students: [] });
      return j({ result: 'success', students: [], list: [] });
    }
    return rt.fulfill({ status: 204, body: '' });
  });
  await pg.addInitScript(() => { try { localStorage.setItem('shueguk_teacher_session_v2', JSON.stringify({ access_token: 'me', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600, user: { id: 'u-hj' } })); } catch (e) {} });
  await pg.goto('http://127.0.0.1:' + port + '/superstar.html', { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => document.querySelectorAll('#schoolList option').length >= 2, null, { timeout: 8000 });
  const today = await pg.evaluate(() => todayYmdKST());

  // ① 첫 화면 메뉴 → 대기 슈스
  let r = await pg.evaluate(() => [...document.querySelectorAll('#menuGrid .mcard .mt')].map(e => e.textContent));
  ok('첫 화면 메뉴 5개 — 다섯째가 대기 슈스', r.length === 5 && r[4] === '대기 슈스', r.join(','));
  await pg.click('#menuGrid .mcard[data-tab="wait"]');
  await pg.waitForFunction(() => document.querySelectorAll('#wtList .wt-row').length >= 2, null, { timeout: 8000 });
  r = await pg.evaluate(() => ({ hash: location.hash, on: document.querySelector('#wtKinds button.on').textContent, title: document.getElementById('wtListTitle').textContent, tab: document.getElementById('tabWaitBtn').classList.contains('on'),
    names: [...document.querySelectorAll('#wtList .wt-row .wt-l1 b')].map(e => e.textContent), no: [...document.querySelectorAll('#wtList .wt-row .wt-no')].map(e => e.textContent),
    can: [...document.querySelectorAll('#wtList .wt-row')].map(e => e.classList.contains('can')), cnt: document.getElementById('wtCount').textContent,
    who: document.getElementById('wt-who').value, year: document.getElementById('wt-year').value, start: document.getElementById('wt-start').value, past: document.getElementById('wtPast').textContent }));
  ok('주소 #wait · 예비 슈스가 기본 · 탭 켜짐', r.hash === '#wait' && /^예비 슈스 대기 명단/.test(r.on) && r.title === '예비 슈스 대기 명단' && r.tab, JSON.stringify(r));
  ok('예비 대기 2명 — 대기 시작일 빠른 순(이른대기 → 늦은대기), 완료 줄은 안 보임', r.names.join(',') === '이른대기,늦은대기' && r.no.join(',') === '1,2', r.names.join(','));
  ok('이른대기(정원 13 > 12명)는 초록 줄, 늦은대기(정원 12)는 아님', r.can.join(',') === 'true,false', r.can.join(','));
  ok('머리 "대기 2명 · 이동 가능 1명 · 지난 기록 1건"', /대기 2명 · 이동 가능 1명 · 지난 기록 1건/.test(r.cnt), r.cnt);
  ok('적는 사람 = 허브 로그인 이름 · 연도 올해 · 대기 시작일 오늘', r.who === '김현지' && +r.year === new Date().getFullYear() && r.start === today, JSON.stringify([r.who, r.year, r.start]));
  ok('[지난 기록 보기 (1)]', r.past === '지난 기록 보기 (1)', r.past);
  r = await pg.evaluate(() => document.querySelector('#wtList .wt-row[data-id="12"] .wt-l2').textContent);
  ok('희망 반 줄 — 반 이름·시간·담당T·12명 / 정원 13 · 자리 있음', /정규 고1 가 · 금 5:30 · 지원T/.test(r) && /12명 \/ 정원 13 · 자리 있음/.test(r), r);

  // ② 반 드롭다운(인원) · 정원 자동
  r = await pg.evaluate(() => [...document.querySelectorAll('#wt-class option')].map(o => o.textContent));
  ok('정규 반 드롭다운 = 미정 + 정규 반(인원 표시, w* 제외)', r.join('|') === '미정|고1 가 · 금 5:30 · 지원T · 12명|고1 나 · 일 11:00 · 승연T · 3명', r.join('|'));
  await pg.selectOption('#wt-class', 'r001');
  r = await pg.evaluate(() => document.getElementById('wt-cap').value);
  ok('반을 고르면 정원 칸이 지금 인원(12)으로', r === '12', r);
  await pg.click('#wtBook button[data-book="내신"]');
  r = await pg.evaluate(() => ({ opts: [...document.querySelectorAll('#wt-class option')].map(o => o.textContent), cap: document.getElementById('wt-cap').value }));
  ok('내신으로 바꾸면 내신 반만 · 정원 비움', r.opts.length === 3 && /고1 화정A.*4명/.test(r.opts[1]) && r.cap === '', JSON.stringify(r));
  await pg.selectOption('#wt-class', 'n001');
  await pg.fill('#wt-cap', '6');
  await pg.selectOption('#wt-class', 'n002');
  r = await pg.evaluate(() => document.getElementById('wt-cap').value);
  ok('정원을 손으로 고친 뒤에는 반을 바꿔도 그대로(6)', r === '6', r);

  // ③ 예비 저장 — 빈 이름 거절 → POST 본문
  await pg.click('#wtSave');
  r = await pg.evaluate(() => document.getElementById('wtStatus').textContent);
  ok('이름 없이 올리면 거절', /이름을 적어/.test(r), r);
  await pg.fill('#wt-name', '새대기'); await pg.fill('#wt-school', '능곡고'); await pg.selectOption('#wt-grade', '고2'); await pg.fill('#wt-year', '2027');
  await pg.fill('#wt-phone', '010-7777-8888'); await pg.fill('#wt-memo', '2월 입학 희망'); await pg.fill('#wt-start', '2026-10-10');
  await pg.click('#wtSave');
  await pg.waitForFunction(() => /✓/.test(document.getElementById('wtStatus').textContent), null, { timeout: 5000 });
  const b = posts[0];
  ok('POST 본문 — 예비·연도·학년·학교·연락처(숫자만)·희망 반(내신 n002)·정원 6·메모·적은 사람·대기 시작일', b && b.kind === '예비' && b.year === 2027 && b.grade === '고2' && b.school === '능곡고' && b.phone_parent === '01077778888' && b.want_book === '내신' && b.want_class_id === 'n002' && /고1 확인/.test(b.want_class_name) && b.cap === 6 && b.memo === '2월 입학 희망' && b.author_name === '김현지' && b.started_on === '2026-10-10' && b.student_id === null, JSON.stringify(b));
  r = await pg.evaluate(() => ({ names: [...document.querySelectorAll('#wtList .wt-row .wt-l1 b')].map(e => e.textContent), name: document.getElementById('wt-name').value, memo: document.getElementById('wt-memo').value, cls: document.getElementById('wt-class').value, can: document.querySelector('#wtList .wt-row[data-id="100"]').classList.contains('can') }));
  ok('목록에 대기 시작일 순으로 끼어듦(이른대기 → 새대기 → 늦은대기) · 칸 비움', r.names.join(',') === '이른대기,새대기,늦은대기' && r.name === '' && r.memo === '' && r.cls === '', JSON.stringify(r));
  ok('새대기(고1 확인 1명 < 정원 6)는 초록 줄', r.can);
  await pg.waitForTimeout(900);   // activity.js 는 0.5초 모아 보낸다
  ok('활동 알림 묶음(urgent false)으로 보냄', acts.length >= 1 && /대기 슈스/.test(JSON.stringify(acts)) && !/"urgent":true/.test(JSON.stringify(acts)), JSON.stringify(acts[0]));

  // ④ 고치기 → PATCH → 줄 색
  await pg.click('#wtList .wt-row[data-id="11"] button[data-act="edit"]');
  r = await pg.evaluate(() => ({ sel: document.querySelector('#wtList .wt-row[data-id="11"] .e-cls').value, cap: document.querySelector('#wtList .wt-row[data-id="11"] .e-cap').value }));
  ok('고치기 폼에 지금 희망 반·정원이 채워짐', r.sel === 'r001' && r.cap === '12', JSON.stringify(r));
  await pg.fill('#wtList .wt-row[data-id="11"] .e-cap', '14');
  await pg.fill('#wtList .wt-row[data-id="11"] .e-memo', '정원 늘려 주심');
  await pg.click('#wtList .wt-row[data-id="11"] button[data-act="save"]');
  await pg.waitForFunction(() => document.querySelector('#wtList .wt-row[data-id="11"]').classList.contains('can'), null, { timeout: 5000 });
  let p = patches[patches.length - 1];
  ok('PATCH 정원 14·메모 → 늦은대기도 초록 줄', p[0] === 11 && p[1].cap === 14 && p[1].memo === '정원 늘려 주심' && p[1].want_class_id === 'r001' && p[1].updated_by_name === '김현지', JSON.stringify(p));

  // ⑤ 대기 취소(사유) → 지난 기록 → 다시 대기로
  promptAnswer = '다른 학원 등록'; dialogs = [];
  await pg.click('#wtList .wt-row[data-id="11"] button[data-act="cancel"]');
  await pg.waitForFunction(() => !document.querySelector('#wtList .wt-row[data-id="11"]'), null, { timeout: 5000 });
  p = patches[patches.length - 1];
  ok('취소 → 사유 묻고 PATCH status 취소·사유·누가', /사유/.test(dialogs[0] || '') && p[0] === 11 && p[1].status === '취소' && p[1].done_note === '다른 학원 등록' && p[1].done_by_name === '김현지', JSON.stringify(p));
  await pg.click('#wtPast');
  r = await pg.evaluate(() => [...document.querySelectorAll('#wtList .wt-row.done')].map(e => e.getAttribute('data-id') + ':' + e.querySelector('.wt-st').textContent));
  ok('지난 기록 — 취소(최근 먼저)·완료 줄에 상태 알약', r.length === 2 && /^11:취소 · 다른 학원 등록 \(김현지\)/.test(r[0]) && /^14:완료 · 신입 등록 전환/.test(r[1]), r.join('|'));
  await pg.click('#wtList .wt-row[data-id="11"] button[data-act="restore"]');
  await pg.waitForFunction(() => { const e = document.querySelector('#wtList .wt-row[data-id="11"]'); return e && !e.classList.contains('done'); }, null, { timeout: 5000 });
  ok('[다시 대기로] → status 대기', patches[patches.length - 1][1].status === '대기');

  // ⑥ 재원 슈스 반 이동 대기
  await pg.click('#wtKinds button[data-kind="재원"]');
  r = await pg.evaluate(() => ({ title: document.getElementById('wtListTitle').textContent, stu: document.getElementById('wtStuRow').style.display, names: [...document.querySelectorAll('#wtList .wt-row .wt-l1 b')].map(e => e.textContent),
    l2: document.querySelector('#wtList .wt-row[data-id="13"] .wt-l2').textContent, can: document.querySelector('#wtList .wt-row[data-id="13"]').classList.contains('can'), opts: [...document.querySelectorAll('#wtStuList option')].map(o => o.value) }));
  ok('재원 명단 — 김하늘 1명 · 이동 희망 반 + 지금 반 · 정원 3 = 3명이라 아직 아님', r.title === '재원 슈스 반 이동 대기 명단' && r.names.join(',') === '김하늘' && /이동 희망: 정규 고1 나 · 일 11:00 · 승연T 3명 \/ 정원 3/.test(r.l2) && /지금 가 금5:30/.test(r.l2) && !r.can, JSON.stringify(r));
  ok('학생 찾기 목록 = 재원생만(퇴원 제외) 이름 · 학교 · 학년', r.stu === 'block' && r.opts.join('|') === '박보검 · 화정고 · 고1|김하늘 · 화정고 · 고1|최유리 · 서정중 · 중2', r.opts.join('|'));
  await pg.click('#wtSave');
  r = await pg.evaluate(() => document.getElementById('wtStatus').textContent);
  ok('학생을 안 고르면 거절', /학생을 골라/.test(r), r);
  await pg.fill('#wt-stu', '박보검 · 화정고 · 고1');
  await pg.dispatchEvent('#wt-stu', 'change');
  r = await pg.evaluate(() => ({ name: document.getElementById('wt-name').value, school: document.getElementById('wt-school').value, grade: document.getElementById('wt-grade').value, phone: document.getElementById('wt-phone').value, info: document.getElementById('wtStuInfo').textContent }));
  ok('학생을 고르면 이름·학교·학년·학부모님 연락처·지금 반이 채워짐', r.name === '박보검' && r.school === '화정고' && r.grade === '고1' && r.phone === '01011112222' && /지금 반: 가 금5:30 · 나 일11:00/.test(r.info), JSON.stringify(r));
  await pg.click('#wtBook button[data-book="정규"]');
  await pg.selectOption('#wt-class', 'r002');
  await pg.fill('#wt-memo', '승연T 반으로');
  await pg.click('#wtSave');
  await pg.waitForFunction(() => /✓|거절|주세요|못했/.test(document.getElementById('wtStatus').textContent), null, { timeout: 5000 });
  console.log('    상태:', await pg.evaluate(() => document.getElementById('wtStatus').textContent));
  const b2 = posts[posts.length - 1];
  ok('POST — 재원·student_id 1·이동 희망 r002·정원 = 지금 인원 3', b2.kind === '재원' && b2.student_id === 1 && b2.want_class_id === 'r002' && b2.cap === 3 && b2.memo === '승연T 반으로', JSON.stringify(b2));
  // 반에서 한 명 빠지면(명단 갱신) 초록으로
  TT[1].roster = '박보검 a';
  await pg.click('#wtListCard .refresh:last-child');
  await pg.waitForFunction(() => document.querySelector('#wtList .wt-row[data-id="13"]') && document.querySelector('#wtList .wt-row[data-id="13"]').classList.contains('can'), null, { timeout: 5000 });
  r = await pg.evaluate(() => ({ l2: document.querySelector('#wtList .wt-row[data-id="13"] .wt-l2').textContent, btn: document.querySelector('#wtList .wt-row[data-id="13"] button[data-act="moved"]').className, cnt: document.getElementById('wtCount').textContent }));
  ok('새로고침 뒤 고1 나 2명 < 정원 3 → 초록 줄 · 자리 있음 · [이동 완료] 초록', /2명 \/ 정원 3 · 자리 있음/.test(r.l2) && /ok/.test(r.btn) && /이동 가능 2명/.test(r.cnt), JSON.stringify(r));
  dialogs = [];
  await pg.click('#wtList .wt-row[data-id="13"] button[data-act="moved"]');
  await pg.waitForFunction(() => document.querySelector('#wtList .wt-row[data-id="13"].done'), null, { timeout: 5000 });   // 지난 기록을 펼쳐 둔 상태라 완료 줄로 남는다
  p = patches[patches.length - 1];
  ok('[이동 완료] → 확인 창(전체 시간표에서 따로) → status 완료 · 반 이동 완료', /전체 시간표/.test(dialogs[0] || '') && p[0] === 13 && p[1].status === '완료' && p[1].done_note === '반 이동 완료', JSON.stringify(p));

  // ⑦ 등록으로 전환 → 신입 폼 → 등록 → 완료
  await pg.click('#wtKinds button[data-kind="예비"]');
  await pg.click('#wtList .wt-row[data-id="12"] button[data-act="conv"]');
  r = await pg.evaluate(() => ({ hash: location.hash, name: document.getElementById('f-name').value, school: document.getElementById('f-school').value, grade: document.getElementById('f-grade').value, pp1: document.getElementById('f-pp1').value, clsA: document.getElementById('f-classA').value, memo: document.getElementById('f-memo').value, st: document.getElementById('regStatus').textContent, open: document.querySelector('#formCard details.extra').open }));
  ok('[등록으로 전환] → 신입 슈스 폼에 이름·학교·2027 고등 1학년·희망 반(정규 가 r001) 채움 + 안내', r.hash === '#new' && r.name === '이른대기' && r.school === '화수고' && r.grade === '2027 고등 1학년' && r.clsA === 'r001' && r.memo === '슈톡에서 올림' && r.open && /학생 휴대폰 번호를 넣고/.test(r.st), JSON.stringify(r));
  await pg.fill('#f-pstu', '01099990000'); await pg.fill('#f-pp1', '01012341234');
  await pg.click('#regBtn');
  await pg.waitForFunction(() => /완료로 바꿨/.test(document.getElementById('doneWait').textContent), null, { timeout: 8000 });
  p = patches[patches.length - 1];
  ok('등록 성공 → 대기 줄 12 완료(신입 등록 전환) + 등록 완료 카드 안내', regs.length === 1 && regs[0].name === '이른대기' && p[0] === 12 && p[1].status === '완료' && p[1].done_note === '신입 등록 전환', JSON.stringify(p));
  await pg.click('#tabWaitBtn');
  await pg.waitForFunction(() => document.querySelectorAll('#wtList .wt-row').length >= 2, null, { timeout: 5000 });   // 탭을 다시 열면 새로 받는다
  r = await pg.evaluate(() => [...document.querySelectorAll('#wtList .wt-row:not(.done) .wt-l1 b')].map(e => e.textContent));
  ok('대기 슈스로 돌아오면 전환한 학생은 대기 명단에서 빠짐', r.join(',') === '새대기,늦은대기', r.join(','));

  // ⑧ 표 없음(마이그레이션 전)
  wlMissing = true;
  await pg.click('#wtListCard .refresh:last-child');
  await pg.waitForFunction(() => /202610290001/.test(document.getElementById('wtList').textContent), null, { timeout: 5000 });
  r = await pg.evaluate(() => document.getElementById('wtSave').disabled);
  ok('표가 없으면 마이그레이션 안내 + 올리기 잠김', r);

  ok('페이지 오류 없음', perr === 0);
  await br.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
