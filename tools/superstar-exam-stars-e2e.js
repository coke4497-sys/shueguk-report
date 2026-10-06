#!/usr/bin/env node
/* 슈퍼스타 관리 → 별 더하기 → '시험 별 한꺼번에 주기'(2026-10-06) 검증.
 *   NODE_PATH=$(npm root -g) node tools/superstar-exam-stars-e2e.js
 * 가짜 백엔드(roster·addStarBonus)·가짜 수파베이스(star_bonus)로 실제 superstar.html 을 띄워
 * 규칙 표·시험 선택·학교/학년 거르기·중등 성취도 표기·등급 한 개만·상 여러 개·이미 준 별 잠금·
 * 확인 창·POST 본문(사유·별 수)·미러·실패 건 남기기까지 확인한다. */
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
  const ROSTER = [   // 수파베이스 students 표 흉내 — 슈퍼스타 관리의 명단은 여기서 온다
    { name: '박보검', school: '화정고', grade: '2026 고등 1학년', teacher: '이수경' },
    { name: '김하늘', school: '화정고', grade: '2026 고등 1학년', teacher: '이수경' },
    { name: '이서준', school: '화정고', grade: '2026 고등 2학년', teacher: '김현지' },
    { name: '최유리', school: '서정중', grade: '2026 중등 2학년', teacher: '이은지' },
    { name: '정민수', school: '능곡고', grade: '2026 고등 3학년', teacher: '이수경' },
    { name: '이도윤A', school: '능곡고', grade: '2026 고등 3학년', teacher: '이수경' }];   // 동명이인 표기 — 지난 기록은 '이도윤'으로 남아 있다
  let GIVEN = [{ name: '김하늘', school: '화정고', reason: '26년 2학기 중간고사 1등급' },   // 이미 준 별
               { name: '이도윤', school: '능곡고', reason: '26년 2학기 중간고사 2등급' }];   // 표기를 'A'로 바꾸기 전 기록
  let dupNext = 0;   // 백엔드가 '이미 있음'(dup:true)으로 답할 건수
  const posts = [], mirrors = []; let failNext = 0, confirms = [];
  const pg = await (await br.newContext()).newPage();
  let perr = 0; pg.on('pageerror', e => { perr++; console.log('  ✗ pageerror', e.message); });
  pg.on('dialog', d => { confirms.push(d.message()); d.accept(); });
  await pg.route('**/*', rt => {
    const u = rt.request().url(), m = rt.request().method();
    const j = (o, st) => rt.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
    if (/\/auth\/v1\/token/.test(u)) return j({ access_token: 'tok', expires_in: 3600, refresh_token: 'r' });
    if (/\/rest\/v1\/star_bonus/.test(u)){
      if (m === 'POST'){ mirrors.push(JSON.parse(rt.request().postData())); return rt.fulfill({ status: 201, body: '' }); }
      const like = decodeURIComponent((/reason=like\.([^&]*)/.exec(u) || [])[1] || '').replace(/\*$/, '');
      return j(GIVEN.filter(r => !like || r.reason.startsWith(like)));
    }
    if (/\/rest\/v1\/students\?select=\*/.test(u)) return j(ROSTER.map((r, i) => Object.assign({ id: i + 1, seq: i + 1, enrolled: '' }, r)));   // 명단의 원본(SGETS.roster)
    if (/\/rest\/v1\//.test(u)) return j([]);
    if (/script\.google/.test(u)){
      if (m === 'POST'){
        const b = JSON.parse(rt.request().postData());
        if (b.action === 'addStarBonus'){
          posts.push(b);
          if (failNext > 0){ failNext--; return j({ result: 'error', message: '시트 오류' }); }
          if (dupNext > 0){ dupNext--; return j({ result: 'success', dup: true }); }
          return j({ result: 'success' });
        }
        return j({ result: 'success' });
      }
      if (/action=roster/.test(u)) return j({ result: 'success', students: ROSTER });
      if (/action=starBoot|action=starRank/.test(u)) return j({ result: 'success', top: [], log: [] });
      if (/action=starLog/.test(u)) return j({ result: 'success', log: [] });
      return j({ result: 'success', students: [], list: [] });
    }
    return rt.fulfill({ status: 204, body: '' });
  });
  await pg.goto('http://127.0.0.1:' + port + '/superstar.html#star', { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => document.querySelectorAll('#exSchool option').length >= 4, null, { timeout: 8000 });

  // ① 규칙 표·시험 알약
  let r = await pg.evaluate(() => ({ rules: document.getElementById('exRules').textContent, per: [...document.querySelectorAll('#exPeriod button')].map(b => b.textContent),
    sch: [...document.querySelectorAll('#exSchool option')].map(o => o.value), list: document.getElementById('exList').textContent, dis: document.getElementById('exGive').disabled }));
  ok('규칙 다섯 가지와 별 수(2·1·3·5·1)', /1등급\(성취도 A\)[^2]*⭐ 2/.test(r.rules) && /2등급\(성취도 B\)[^1]*⭐ 1/.test(r.rules) && /전교권 슈퍼스타 · 백점 또는 전교 1등상 ⭐ 3/.test(r.rules) && /전우주권 슈퍼스타 ⭐ 5/.test(r.rules) && /내일의 슈퍼스타 · 노력상 ⭐ 1/.test(r.rules), r.rules);
  ok('시험 알약 = 26-2-중간 · 26-2-기말', r.per.join(',') === '26-2-중간,26-2-기말', r.per.join(','));
  ok('학교 드롭다운은 명단의 학교(가나다순)', r.sch.join(',') === ',능곡고,서정중,화정고', r.sch.join(','));
  ok('처음엔 안내만 · 버튼 잠김', /먼저 어느 시험인지/.test(r.list) && r.dis);

  // ② 시험 고르기 → 이미 준 별 조회 → 학교·학년 거르기
  await pg.click('#exPeriod button[data-p="26-2-중간"]');
  await pg.waitForFunction(() => document.getElementById('exNote').textContent === '', null, { timeout: 5000 });
  r = await pg.evaluate(() => document.getElementById('exList').textContent);
  ok('시험만 고르면 "학교를 고르면" 안내', /학교를 고르면/.test(r), r);
  await pg.selectOption('#exSchool', '화정고');
  r = await pg.evaluate(() => ({ gr: [...document.querySelectorAll('#exGrade option')].map(o => o.value), names: [...document.querySelectorAll('#exList .ex-row .nm')].map(e => e.textContent) }));
  ok('학년 드롭다운은 그 학교 학년만', r.gr.join(',') === ',2026 고등 1학년,2026 고등 2학년', r.gr.join(','));
  ok('화정고 학생 3명(학년·이름순)', r.names.join(',') === '김하늘,박보검,이서준', r.names.join(','));
  await pg.selectOption('#exGrade', '2026 고등 1학년');
  r = await pg.evaluate(() => ({
    names: [...document.querySelectorAll('#exList .ex-row .nm')].map(e => e.textContent),
    kim: [...document.querySelectorAll('#exList .ex-row[data-k="김하늘|화정고"] .ex-pill')].map(b => b.textContent + (b.classList.contains('given') ? '(done)' : '') + (b.disabled ? '(dis)' : '')),
    park: [...document.querySelectorAll('#exList .ex-row[data-k="박보검|화정고"] .ex-pill')].map(b => b.textContent) }));
  ok('학년까지 고르면 2명', r.names.join(',') === '김하늘,박보검', r.names.join(','));
  ok('고등 알약 = 1등급·2등급·전교권·전우주권·내일의', r.park.join(',') === '1등급,2등급,전교권 슈퍼스타,전우주권 슈퍼스타,내일의 슈퍼스타', r.park.join(','));
  ok('이미 준 1등급은 ✓ 잠김(김하늘)', r.kim[0] === '✓ 1등급(done)(dis)' && !/done/.test(r.kim[1]), r.kim.join(','));

  // ③ 고르기 — 등급은 하나만, 상은 여러 개, 합계
  const P = '#exList .ex-row[data-k="박보검|화정고"]';
  await pg.click(P + ' .ex-pill[data-a="lv2"]');
  await pg.click(P + ' .ex-pill[data-a="lv1"]');          // 2등급 → 1등급으로 바뀜
  await pg.click(P + ' .ex-pill[data-a="top"]');
  await pg.click(P + ' .ex-pill[data-a="eff"]');
  r = await pg.evaluate((P) => ({ on: [...document.querySelectorAll(P + ' .ex-pill.on')].map(b => b.getAttribute('data-a')), sum: document.querySelector(P + ' .sum').textContent,
    line: document.getElementById('exSum').textContent, dis: document.getElementById('exGive').disabled }), P);
  ok('등급은 하나만(1등급) + 상 둘', r.on.join(',') === 'lv1,top,eff', r.on.join(','));
  ok('줄 합계 ⭐ 6(2+3+1)', r.sum === '⭐ 6', r.sum);
  ok('아래 요약 학생 1명 · 별 6개 · 버튼 켜짐', /학생 1명 · 별 6개/.test(r.line) && !r.dis, r.line);
  await pg.click(P + ' .ex-pill[data-a="eff"]');          // 다시 누르면 해제
  r = await pg.evaluate((P) => document.querySelector(P + ' .sum').textContent, P);
  ok('같은 알약 다시 누르면 해제 → ⭐ 5', r === '⭐ 5', r);
  // 김하늘: 이미 준 1등급 대신 전우주권
  await pg.click('#exList .ex-row[data-k="김하늘|화정고"] .ex-pill[data-a="uni"]');
  r = await pg.evaluate(() => document.getElementById('exSum').textContent);
  ok('학생 2명 · 별 10개', /학생 2명 · 별 10개/.test(r), r);

  // ④ 한꺼번에 주기 — 확인 창 → POST 3건(사유·별 수) → 미러 → 잠김
  await pg.click('#exGive');
  await pg.waitForFunction(() => /✓/.test(document.getElementById('exStatus').textContent), null, { timeout: 8000 });
  ok('확인 창에 시험 이름·인원·별 수·상별 인원', confirms.length === 1 && /26년 2학기 중간고사 — 학생 2명에게 별 10개/.test(confirms[0]) && /1등급 1명/.test(confirms[0]) && /전우주권 슈퍼스타 1명/.test(confirms[0]), confirms[0]);
  const want = [['박보검', '26년 2학기 중간고사 1등급', 2], ['박보검', '26년 2학기 중간고사 전교권 슈퍼스타', 3], ['김하늘', '26년 2학기 중간고사 전우주권 슈퍼스타', 5]];
  const got = posts.map(b => [b.name, b.reason, b.stars]).sort().join(';');
  ok('addStarBonus 3건 — 이름·사유·별 수', got === want.sort().join(';'), got);
  ok('본문에 학교·학년·비밀번호·dedupe', posts.every(b => b.action === 'addStarBonus' && b.pw && b.school === '화정고' && /고등 1학년/.test(b.grade) && b.dedupe === '1'), JSON.stringify(posts[0]));
  await pg.waitForFunction(() => true); await new Promise(r => setTimeout(r, 300));
  ok('수파베이스 star_bonus 미러 3건(사유 같음)', mirrors.length === 3 && mirrors.every(m => /26년 2학기 중간고사/.test(m.reason) && m.stars > 0), JSON.stringify(mirrors.map(m => m.reason)));
  r = await pg.evaluate((P) => ({ st: document.getElementById('exStatus').textContent, done: [...document.querySelectorAll(P + ' .ex-pill.given')].map(b => b.getAttribute('data-a')), on: document.querySelectorAll('#exList .ex-pill.on').length, dis: document.getElementById('exGive').disabled }), P);
  ok('완료 문구 · 준 알약은 ✓ 잠김 · 선택 비움 · 버튼 잠김', /별 10개를 학생 2명에게/.test(r.st) && r.done.join(',') === 'lv1,top' && r.on === 0 && r.dis, JSON.stringify(r));

  // ⑤ 실패 건은 선택이 남는다
  posts.length = 0; confirms = []; failNext = 1;
  await pg.click(P + ' .ex-pill[data-a="eff"]');
  await pg.click('#exList .ex-row[data-k="김하늘|화정고"] .ex-pill[data-a="eff"]');
  await pg.click('#exGive');
  await pg.waitForFunction(() => /실패|✓/.test(document.getElementById('exStatus').textContent), null, { timeout: 8000 });
  r = await pg.evaluate(() => ({ st: document.getElementById('exStatus').textContent, on: [...document.querySelectorAll('#exList .ex-pill.on')].map(b => b.closest('.ex-row').getAttribute('data-k')), done: document.querySelectorAll('#exList .ex-pill.given').length }));
  ok('한 건 실패 → "1건은 실패" + 그 학생 선택만 남음', posts.length === 2 && /1건은 실패/.test(r.st) && r.on.join() === '김하늘|화정고' && r.done === 5, JSON.stringify(r));

  // ⑥ 중등 = 성취도 A·B 표기 + 사유
  posts.length = 0; confirms = [];
  await pg.selectOption('#exSchool', '서정중');
  r = await pg.evaluate(() => [...document.querySelectorAll('#exList .ex-row .ex-pill')].map(b => b.textContent));
  ok('중등은 성취도 A·B 알약', r.slice(0, 2).join(',') === '성취도 A,성취도 B', r.join(','));
  await pg.click('#exList .ex-row[data-k="최유리|서정중"] .ex-pill[data-a="lv1"]');
  await pg.click('#exGive');
  await pg.waitForFunction(() => /✓/.test(document.getElementById('exStatus').textContent), null, { timeout: 8000 });
  ok('중등 1건 — 사유 "26년 2학기 중간고사 성취도 A" · 별 2', posts.length === 1 && posts[0].reason === '26년 2학기 중간고사 성취도 A' && posts[0].stars === 2, JSON.stringify(posts[0]));

  // ⑦ 시험을 바꾸면 선택·잠금이 다시 계산된다
  await pg.click('#exPeriod button[data-p="26-2-기말"]');
  await pg.waitForFunction(() => document.getElementById('exNote').textContent === '', null, { timeout: 5000 });
  await pg.selectOption('#exSchool', '화정고');
  r = await pg.evaluate(() => ({ done: document.querySelectorAll('#exList .ex-pill.given').length, on: document.querySelectorAll('#exList .ex-pill.on').length }));
  ok('기말로 바꾸면 중간고사 잠금이 풀리고 선택 없음', r.done === 0 && r.on === 0, JSON.stringify(r));

  // ⑨ 이름 표기가 바뀌어도 지난 기록과 같은 사람 — '이도윤A'(명단) ↔ '이도윤'(기록)
  await pg.click('#exPeriod button[data-p="26-2-중간"]');
  await pg.waitForFunction(() => document.getElementById('exNote').textContent === '', null, { timeout: 5000 });
  await pg.selectOption('#exSchool', '능곡고');
  r = await pg.evaluate(() => [...document.querySelectorAll('#exList .ex-row[data-k="이도윤|능곡고"] .ex-pill')].map(b => b.textContent + (b.classList.contains('given') ? '(done)' : '')));
  ok('끝 A 를 뗀 키 — 옛 이름으로 남은 2등급이 ✓ 잠김', r.length === 5 && r[1] === '✓ 2등급(done)' && !/done/.test(r[0]), r.join(','));

  // ⑩ 저장 중에는 시험·학교·학년을 못 바꾸고, 백엔드 dup 응답은 '이미 받은 n건'으로
  posts.length = 0; confirms = []; dupNext = 1; mirrors.length = 0;
  let slow; await pg.route(/script\.google.*/, async rt => {   // 저장을 느리게 해 그 사이 시험 버튼을 눌러 본다
    if (rt.request().method() === 'POST' && /addStarBonus/.test(rt.request().postData() || '')){ await new Promise(r => { slow = r; setTimeout(r, 600); }); }
    const b = rt.request().method() === 'POST' ? JSON.parse(rt.request().postData()) : null;
    if (b && b.action === 'addStarBonus'){ posts.push(b); if (dupNext > 0){ dupNext--; return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'success', dup: true }) }); } return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'success' }) }); }
    return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'success', top: [], log: [], students: [], list: [] }) });
  });
  await pg.click('#exList .ex-row[data-k="이도윤|능곡고"] .ex-pill[data-a="lv1"]');
  await pg.click('#exList .ex-row[data-k="정민수|능곡고"] .ex-pill[data-a="eff"]');
  await pg.click('#exGive');
  await pg.waitForFunction(() => /주는 중/.test(document.getElementById('exStatus').textContent), null, { timeout: 3000 });
  r = await pg.evaluate(() => ({ per: [...document.querySelectorAll('#exPeriod button')].every(b => b.disabled), sch: document.getElementById('exSchool').disabled, gr: document.getElementById('exGrade').disabled }));
  ok('저장 중 — 시험 알약·학교·학년 잠김', r.per && r.sch && r.gr, JSON.stringify(r));
  await pg.evaluate(() => { const b = document.querySelector('#exPeriod button[data-p="26-2-기말"]'); b.disabled = false; b.click(); });   // 잠금을 풀고 눌러도 핸들러가 막는다
  r = await pg.evaluate(() => EX.period);
  ok('저장 중 시험 버튼을 눌러도 바뀌지 않음', r === '26-2-중간', r);
  await pg.waitForFunction(() => /✓/.test(document.getElementById('exStatus').textContent), null, { timeout: 8000 });
  r = await pg.evaluate(() => ({ st: document.getElementById('exStatus').textContent, per: [...document.querySelectorAll('#exPeriod button')].some(b => b.disabled), sch: document.getElementById('exSchool').disabled, given: document.querySelectorAll('#exList .ex-pill.given').length }));
  ok('끝나면 잠금 해제 · 사유는 시작 시점 시험 · dup 1건 안내', !r.per && !r.sch && /26년 2학기 중간고사 별 3개/.test(r.st) && /이미 받은 1건/.test(r.st) && posts.every(b => /중간고사/.test(b.reason)) && r.given === 3, JSON.stringify(r) + ' ' + JSON.stringify(posts.map(b => b.reason)));
  await new Promise(r => setTimeout(r, 300));
  ok('dup 응답 건은 수파베이스 미러에 넣지 않음(2건 중 1건만)', mirrors.length === 1, String(mirrors.length));
  await pg.unroute(/script\.google.*/);

  // ⑧ 이미 준 별 조회 실패 → 경고 + 확인 창에도 경고
  await pg.route(/\/rest\/v1\/star_bonus/, rt => rt.request().method() === 'GET' ? rt.fulfill({ status: 500, body: 'x' }) : rt.fulfill({ status: 201, body: '' }));
  await pg.click('#exPeriod button[data-p="26-2-중간"]');
  await pg.waitForFunction(() => /확인하지 못했습니다/.test(document.getElementById('exNote').textContent), null, { timeout: 5000 });
  await pg.selectOption('#exSchool', '능곡고');
  confirms = [];
  await pg.click('#exList .ex-row[data-k="정민수|능곡고"] .ex-pill[data-a="lv2"]');
  await pg.click('#exGive');
  await pg.waitForFunction(() => /✓/.test(document.getElementById('exStatus').textContent), null, { timeout: 8000 });
  ok('조회 실패 — 노란 안내 + 확인 창 경고', /두 번 갈 수 있/.test(confirms[0] || ''), confirms[0]);

  ok('페이지 오류 없음', perr === 0);
  await br.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
