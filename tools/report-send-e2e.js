/* 지필고사 리포트 보내기(2026-10-02, 043) — 제출 결과(t.html)의 [리포트 보내기]/[보내기 취소]와
 * 학생 페이지(s.html)에서 보내기 전 리포트를 숨기는지 확인한다.
 *   NODE_PATH=$(npm root -g) node tools/report-send-e2e.js
 */
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
  let perr = 0;

  // ── 선생님 화면 t.html ──
  const SUBS = [
    { id: 11, submitted_at: '2026-09-23T01:00:00Z', exam: '26-2-중간-화정고2-문학', school: '화정고', grade: '2학년', name: '박보검',
      wrong_count: 2, wrong_text: '', vow: '', teacher_note: '', score: '90', parent_phone: '12345678', sent_at: null },
    { id: 12, submitted_at: '2026-09-23T02:00:00Z', exam: '26-2-중간-화정고2-문학', school: '화정고', grade: '2학년', name: '김하늘',
      wrong_count: 1, wrong_text: '', vow: '', teacher_note: '좋아요', score: '95', parent_phone: '87654321', sent_at: '2026-10-01T05:30:00Z' }];
  const patches = [];
  const tp = await (await br.newContext()).newPage();
  tp.on('pageerror', e => { perr++; console.log('  ✗ pageerror(t.html)', e.message); });
  tp.on('dialog', d => d.accept());
  await tp.route('**/*', rt => {
    const u = rt.request().url(), m = rt.request().method();
    const j = (o, st) => rt.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
    if (/\/auth\/v1\/token/.test(u)) return j({ access_token: 'tok', expires_in: 3600 });
    if (/\/rest\/v1\/submissions/.test(u)){
      if (m === 'PATCH'){
        const b = JSON.parse(rt.request().postData()); patches.push({ u, b });
        const id = +(/id=eq\.(\d+)/.exec(u) || [])[1]; const row = SUBS.find(x => x.id === id);
        Object.assign(row, b); return j([row]);
      }
      return j(SUBS);
    }
    if (/\/rest\/v1\/students/.test(u)) return j([{ student_id: '12345678', name: '박보검', code: 'tok-park' }, { student_id: '87654321', name: '김하늘', code: 'tok-kim' }]);
    if (/\/rest\/v1\/exams/.test(u)) return j([{ report_id: 'r1', title: '26-2-중간-화정고2-문학', school: '화정고', grade: '2', review: '', scope: '' }]);
    if (/\/rest\/v1\/exam_questions/.test(u)) return j([]);
    if (/script\.google/.test(u)) return j({ result: 'success', students: [] });
    return rt.fulfill({ status: 204, body: '' });
  });
  await tp.goto('http://127.0.0.1:' + port + '/t.html', { waitUntil: 'domcontentloaded' });
  await tp.evaluate(() => loadStudents('ALL'));
  await tp.waitForFunction(() => (window.STUDENTS || []).length === 2 || document.querySelectorAll('#studentSel option').length === 3, null, { timeout: 8000 });
  let r = await tp.evaluate(() => [...document.querySelectorAll('#studentSel option')].map(o => o.textContent));
  ok('학생 목록 — 보낸 학생에 "· 보냄"', r.some(t => /김하늘.*· 보냄$/.test(t)) && r.some(t => /^박보검/.test(t) && !/보냄/.test(t)), JSON.stringify(r));
  await tp.selectOption('#studentSel', '0');
  r = await tp.evaluate(() => ({ st: document.getElementById('sendState').textContent, btn: document.getElementById('sendBtn').textContent, dis: document.getElementById('sendBtn').disabled }));
  ok('안 보낸 학생 — "아직 학생에게 보내지 않았어요" · [리포트 보내기] 켜짐', /아직 학생에게 보내지 않았어요/.test(r.st) && r.btn === '리포트 보내기' && !r.dis, JSON.stringify(r));
  await tp.click('#sendBtn');
  await tp.waitForTimeout(300);
  ok('한 마디가 비면 보내지 않는다', patches.length === 0 && /한 마디를 먼저/.test(await tp.textContent('#status')));
  await tp.fill('#teacherNote', '문학 지문 정리가 좋았습니다.');
  await tp.click('#sendBtn');
  await tp.waitForFunction(() => /보냄/.test(document.getElementById('sendState').textContent), null, { timeout: 5000 });
  ok('보내기 — 한 마디와 sent_at 을 함께 PATCH(id·이름 조건)', patches.length === 1 && /id=eq\.11/.test(patches[0].u) && /name=eq\./.test(patches[0].u) &&
     patches[0].b.teacher_note === '문학 지문 정리가 좋았습니다.' && !!patches[0].b.sent_at, JSON.stringify(patches));
  r = await tp.evaluate(() => ({ st: document.getElementById('sendState').textContent, btn: document.getElementById('sendBtn').textContent,
    opt: document.querySelector('#studentSel option[value="0"]').textContent, status: document.getElementById('status').textContent }));
  ok('보낸 뒤 — "학생 페이지에 보냄 · 시각" · [보내기 취소] · 버튼 "다시 보내기" · 목록 "· 보냄"', /학생 페이지에 보냄 · \d+\/\d+ \d\d:\d\d/.test(r.st) && /보내기 취소/.test(r.st) &&
     r.btn === '다시 보내기' && /· 보냄/.test(r.opt) && /리포트를 보냈어요/.test(r.status), JSON.stringify(r));
  await tp.click('#sendState button');
  await tp.waitForFunction(() => /아직 학생에게/.test(document.getElementById('sendState').textContent), null, { timeout: 5000 });
  ok('보내기 취소 — sent_at null 만 PATCH(한 마디는 그대로)', patches.length === 2 && patches[1].b.sent_at === null && !('teacher_note' in patches[1].b), JSON.stringify(patches[1]));
  await tp.selectOption('#studentSel', '1');
  ok('이미 보낸 학생을 고르면 보냄 상태', /학생 페이지에 보냄/.test(await tp.textContent('#sendState')));

  // ── 학생 페이지 s.html — 보내기 전 리포트 숨김 ──
  const sp = await (await br.newContext()).newPage();
  sp.on('pageerror', e => { perr++; console.log('  ✗ pageerror(s.html)', e.message); });
  await sp.route('**/*', rt => rt.request().url().startsWith('http://127.0.0.1:' + port) ? rt.continue() : rt.fulfill({ status: 204, body: '' }));
  await sp.goto('http://127.0.0.1:' + port + '/s.html', { waitUntil: 'domcontentloaded' });
  r = await sp.evaluate(() => {
    STATE.info = { name: '박보검' };
    const base = { title: '26-2-중간-화정고2-문학', school: '화정고', grade: '2학년', submittedAt: '2026-09-23 10:00', wrongCount: 1, wrongText: '', vow: '다짐', review: ['총평'], questions: [] };
    const card = x => { const d = document.createElement('div'); d.innerHTML = examCardHtml(Object.assign({}, base, x)); return d.textContent; };
    STATE.exams = [Object.assign({}, base, { sent: false, teacherNote: '' }), Object.assign({}, base, { title: '독서', sent: true, teacherNote: '잘했어요' })];
    drawGrades();
    return {
      unsent: card({ sent: false, teacherNote: '' }),
      sent: card({ sent: true, teacherNote: '잘했어요' }),
      legacyNo: card({ teacherNote: '' }), legacyYes: card({ teacherNote: '좋아요' }),
      tabs: [...document.querySelectorAll('.exam-tab')].map(b => b.textContent)
    };
  });
  ok('보내기 전 — "선생님이 리포트를 준비하고 있습니다" 카드만, 총평·다짐 없음', /선생님이 리포트를 준비하고 있습니다/.test(r.unsent) && /2026-09-23 10:00/.test(r.unsent) && !/총평/.test(r.unsent) && !/다짐/.test(r.unsent), r.unsent);
  ok('보낸 뒤 — 리포트 전체 + 선생님의 한 마디', /시험 총평/.test(r.sent) && /선생님의 한 마디잘했어요/.test(r.sent), r.sent.slice(0, 200));
  ok('보냄 여부를 모르면(043 전·옛 경로) 한 마디가 있을 때만 리포트', /준비하고 있습니다/.test(r.legacyNo) && /시험 총평/.test(r.legacyYes));
  ok('시험 탭 — 준비 중 표시', r.tabs.length === 2 && /· 준비 중$/.test(r.tabs[0]) && !/준비 중/.test(r.tabs[1]), JSON.stringify(r.tabs));

  ok('페이지 오류 없음', perr === 0);
  console.log((fail ? '실패 ' + fail + ' / ' : '') + '통과 ' + pass + '건');
  await br.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
