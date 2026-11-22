#!/usr/bin/env node
/* 슈퍼스타 관리 → 아웃 슈스 → [퇴원 처리] (2026-11-20 원장님 "퇴원생 데이터를 남기고 싶어요").
 *   NODE_PATH=$(npm root -g) LC_ALL=C.UTF-8 node tools/superstar-leave-e2e.js
 * 기록은 지우지 않고 students.enrolled 만 '퇴원'으로, 시간표 명단 정리, 시트 사본 studentEnrolledSet, 학생 페이지 링크,
 * 재원으로 되돌리기, 영구 삭제는 접혀 있음을 확인한다. */
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (m, c, x) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (x ? ' ' + x : ''))); };
const srv = http.createServer((q, r) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, ''));
  fs.readFile(f, (e, b) => e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8' }), r.end(b)));
});
(async () => {
  await new Promise(res => srv.listen(0, res)); const port = srv.address().port;
  const br = await chromium.launch();
  let enrolled = '재원'; let roster = '강구현 박보검';
  const patches = [], dels = [], posts = [], logs = [];
  const pg = await (await br.newContext()).newPage();
  pg.on('pageerror', e => { fail++; console.log('  ✗ pageerror', e.message); });
  pg.on('dialog', d => d.accept());
  await pg.route('**/*', rt => {
    const q = rt.request(), u = q.url(), m = q.method();
    const j = (o, st) => rt.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
    if (/\/auth\/v1\/token/.test(u)) return j({ access_token: 'tok', expires_in: 3600, refresh_token: 'r' });
    if (/\/rest\/v1\//.test(u)){
      if (m === 'DELETE'){ dels.push(u); return j([]); }
      if (m === 'PATCH'){
        const b = JSON.parse(q.postData()); patches.push({ u, b });
        if (/\/students\?/.test(u)){ enrolled = b.enrolled; return j([{ id: 7 }]); }
        if (/\/tt_classes\?/.test(u)){ roster = b.roster; return j([{ class_id: 'r001' }]); }
        return j([]);
      }
      if (m === 'POST'){ if (/tt_log/.test(u)) logs.push(JSON.parse(q.postData())); return j([], 201); }
      if (/\/students\?select=id,name/.test(u)) return j([{ id: 7, name: '강구현', student_id: '12345678', school: '백양고', grade: '고1', teacher: '이수경', enrolled, code: 'Mj9mS2FACpG8' }]);
      if (/\/submissions\?/.test(u)) return j([{ id: 31, name: '강구현', parent_phone: '12345678', submitted_at: '2026-10-01', exam: '26-2-중간', school: '백양고' }]);
      if (/\/tt_classes\?select=book/.test(u)) return j([{ book: '정규', class_id: 'r001', name: '고1 가', day: '수', start_time: '5:30', teacher: '슈', roster }]);
      if (/\/tt_classes\?book/.test(u)) return j([{ roster }]);
      return j([]);
    }
    if (/script\.google/.test(u)){
      if (m === 'POST'){ posts.push(JSON.parse(q.postData())); return j({ result: 'success', done: [] }); }
      return j({ result: 'success', students: [], top: [], log: [], list: [] });
    }
    return rt.fulfill({ status: 204, body: '' });
  });
  await pg.goto('http://127.0.0.1:' + port + '/superstar.html#out', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(800);
  await pg.fill('#x-name', '강구현'); await pg.click('#findBtn');
  await pg.waitForSelector('#leaveBox', { state: 'visible', timeout: 8000 });
  let r = await pg.evaluate(() => ({
    checks: [...document.querySelectorAll('#list .it')].map(l => l.querySelector('.nm').textContent + '|' + l.closest('.grp').querySelector('.gt').textContent.split(' ')[0] + '|' + l.querySelector('input').checked),
    fold: document.getElementById('rmFold').open, links: document.getElementById('leaveLinks').innerHTML,
    back: getComputedStyle(document.getElementById('backBtn')).display }));
  ok('학생정보·시간표 명단만 기본 체크, 지필 제출은 체크 안 함', r.checks.some(c => /학생정보.*\|true$/.test(c)) && r.checks.some(c => /시간표.*\|true$/.test(c)) && r.checks.some(c => /지필.*\|false$/.test(c)), r.checks.join(' / '));
  ok('영구 삭제는 접혀 있음', r.fold === false);
  ok('학생 페이지 보기 링크', /s\.html\?key=Mj9mS2FACpG8/.test(r.links), r.links);
  ok('재원이면 되돌리기 버튼 숨김', r.back === 'none');
  await pg.click('#leaveBtn');
  await pg.waitForFunction(() => /✓/.test(document.getElementById('leaveStatus').textContent), null, { timeout: 8000 });
  await pg.waitForTimeout(500);
  const sp = patches.find(p => /\/students\?/.test(p.u));
  ok('students.enrolled = 퇴원 PATCH (id=7)', sp && sp.b.enrolled === '퇴원' && /id=in\.\(7\)/.test(sp.u), sp && sp.u);
  ok('기록은 하나도 지우지 않음', dels.length === 0, dels.join(' '));
  ok('시트 사본 studentEnrolledSet', posts.some(b => b.action === 'studentEnrolledSet' && b.items[0].code === 'Mj9mS2FACpG8' && b.items[0].enrolled === '퇴원'));
  ok('시간표 명단에서 빠짐 + 빼기 기록', roster === '박보검' && logs.some(l => l.kind === '빼기'), roster);
  r = await pg.evaluate(() => ({ st: document.getElementById('leaveStatus').textContent, back: getComputedStyle(document.getElementById('backBtn')).display }));
  ok('완료 안내 — 기록은 모두 남김', /퇴원 처리 1명/.test(r.st) && /기록은 모두 남겨/.test(r.st), r.st);
  ok('퇴원 뒤 다시 검색하면 [재원으로 되돌리기]가 보임', r.back !== 'none');
  await pg.click('#backBtn');
  await pg.waitForFunction(() => /재원으로 되돌림 1명/.test(document.getElementById('leaveStatus').textContent), null, { timeout: 8000 });
  ok('재원으로 되돌리기 = enrolled 재원', enrolled === '재원');
  await br.close(); srv.close();
  console.log(pass + ' 통과, ' + fail + ' 실패'); process.exit(fail ? 1 : 0);
})();
