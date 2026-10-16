/* 지필 복기 고치기(051, 2026-10-16 원장님 "학생이 제출한 지필고사 리포트를 수정할 수 있게").
 *   r.html — 이미 낸 복기를 다시 열어 채우고, 보내기 전이면 [수정 제출]로 같은 줄을 고친다(submission_update).
 *            보낸 뒤에는 잠긴다. 051 전(함수 없음)이면 예전처럼 새로 제출한다.
 *   t.html — [학생 복기 고치기] 창: 틀린 문항·반성·다짐을 고치고 점수를 다시 계산해 PATCH(고친 사람 이름).
 *   s.html — 보내기 전 제출은 '복기 고치기' 링크.
 *   NODE_PATH=$(npm root -g) node tools/submission-edit-e2e.js
 */
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (x ? ' — ' + x : ''))); };
function serve(){
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, ''));
      fs.readFile(f, (e, b) => e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8' }), r.end(b)));
    }).listen(0, () => res(s));
  });
}
const Q = (no, pts) => ({ no, area: '문학', qtype: '객관식', lv: '중', txt: '문항 ' + no, detail: '현대시', grp: '', multi: false, pts });
const EXAM = { found: true, title: '26-2-중간-화정고2-문학', scope: '', review: '총평', questions: [Q(1, 10), Q(2, 20), Q(3, 30), Q(4, 40)] };
const OLD_TEXT = '[2번 · 문학·현대시 · 중] 문항 2\n  → 시어를 놓쳤어요\n\n둘째 줄도 있어요\n\n[4번 · 문학·현대시 · 중] 문항 4\n  → (반성 미작성)';
const tap = async (pg, no) => { await pg.click('.q[data-no="' + no + '"] .q-head'); await pg.waitForTimeout(320); };

async function openR(br, port, mine, log, opt){
  opt = opt || {};
  const pg = await br.newContext().then(c => c.newPage());
  pg.on('pageerror', e => ok(false, 'pageerror(r.html) ' + e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/bangdbhqpphqqdwcledg.supabase.co/**', route => {
    const u = route.request().url(), body = route.request().postData();
    const j = (o, st) => route.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.includes('/rpc/exam_bundle')) return j(EXAM);
    if (u.includes('/rpc/mirror_submission')){ log.push({ fn: 'mirror', p: JSON.parse(body).p }); mine.v = { found: true, id: 77, sent: false, submitted_at: '2026-10-16T05:00:00Z', wrong_text: JSON.parse(body).p.wrong_text, vow: JSON.parse(body).p.vow }; return route.fulfill({ status: 204, body: '' }); }
    if (u.includes('/rpc/submission_mine')){ log.push({ fn: 'mine', p: JSON.parse(body).p }); if (opt.noFn) return j({ code: 'PGRST202' }, 404); return j(mine.v); }
    if (u.includes('/rpc/submission_update')){ log.push({ fn: 'update', p: JSON.parse(body).p }); return j(opt.upd || { ok: true }); }
    return j({});
  });
  await pg.route('**/script.google.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"success"}' }));
  await pg.goto(`http://127.0.0.1:${port}/r.html?id=r1&name=${encodeURIComponent('박보검')}&school=${encodeURIComponent('화정고')}&grade=2학년&p8=12345678`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(300);
  return pg;
}
async function submit(pg){ await pg.click('#formBar .btn-primary'); await pg.click('#submitBtn'); await pg.waitForTimeout(500); }

(async () => {
  const srv = await serve(), port = srv.address().port;
  const br = await chromium.launch();

  console.log('① r.html — 보내기 전 제출을 다시 열고 고치기');
  let log = [], mine = { v: { found: true, id: 55, sent: false, submitted_at: '2026-10-15T01:00:00Z', edited_at: null, wrong_text: OLD_TEXT, vow: '옛 다짐', score: '40' } };
  let pg = await openR(br, port, mine, log);
  ok(log[0] && log[0].fn === 'mine' && log[0].p.exam_id === 'r1' && log[0].p.title === EXAM.title && log[0].p.name === '박보검' && log[0].p.phone === '12345678', '이름·8자리·시험으로 이미 낸 복기를 찾는다', JSON.stringify(log[0]));
  let r = await pg.evaluate(() => ({ w: [...document.querySelectorAll('.q.wrong')].map(d => d.dataset.no), t2: document.querySelector('.q[data-no="2"] textarea').value,
    t4: document.querySelector('.q[data-no="4"] textarea').value, vow: document.getElementById('f_vow').value, sc: document.getElementById('scoreView').textContent,
    note: document.getElementById('editNote').textContent, vis: getComputedStyle(document.getElementById('editNote')).display, btn: document.getElementById('submitBtn').textContent }));
  ok(JSON.stringify(r.w) === '["2","4"]', '틀린 문항 2·4번이 다시 표시된다', JSON.stringify(r.w));
  ok(r.t2 === '시어를 놓쳤어요\n\n둘째 줄도 있어요' && r.t4 === '', '반성이 채워진다(빈 줄 있는 반성·반성 미작성)', JSON.stringify([r.t2, r.t4]));
  ok(r.vow === '옛 다짐' && r.sc === '40점', '다짐과 점수(자동 계산)', JSON.stringify(r));
  ok(r.vis !== 'none' && /이미 제출한 복기입니다 · 10\/15 10:00 제출/.test(r.note) && /리포트를 보내기 전까지/.test(r.note), '안내 줄', r.note);
  ok(r.btn === '수정 제출', '버튼 이름 [수정 제출]', r.btn);
  await tap(pg, 4); await tap(pg, 1);
  await pg.fill('.q[data-no="1"] textarea', '선지를 잘못 읽었어요');
  await pg.fill('#f_vow', '새 다짐');
  await submit(pg);
  const up = log.find(x => x.fn === 'update');
  ok(up && up.p.id === 55 && up.p.name === '박보검' && up.p.phone === '12345678', 'submission_update — 그 줄(id·이름·8자리)', JSON.stringify(up));
  ok(up && up.p.score === '70' && up.p.wrong_count === '2' && up.p.vow === '새 다짐', '점수 70·틀린 수 2·다짐', JSON.stringify(up && up.p));
  ok(up && /^\[1번 · 문학·현대시 · 중\] 문항 1\n  → 선지를 잘못 읽었어요\n\n\[2번 /.test(up.p.wrong_text) && !/4번/.test(up.p.wrong_text), '틀린 문항 글이 같은 형식으로', up && up.p.wrong_text);
  ok(!log.some(x => x.fn === 'mirror'), '새 줄을 넣지 않는다(mirror_submission 없음)');
  ok(/고친 복기를/.test(await pg.textContent('#doneMark')), '완료 표시', await pg.textContent('#doneMark'));
  await pg.close();

  console.log('② r.html — 리포트를 보낸 뒤에는 잠긴다');
  log = []; mine = { v: { found: true, id: 56, sent: true, submitted_at: '2026-10-15T01:00:00Z', wrong_text: OLD_TEXT, vow: '옛 다짐' } };
  pg = await openR(br, port, mine, log);
  await tap(pg, 1);
  r = await pg.evaluate(() => ({ w: [...document.querySelectorAll('.q.wrong')].map(d => d.dataset.no), ro: document.getElementById('f_vow').readOnly,
    note: document.getElementById('editNote').textContent, dis: document.getElementById('submitBtn').disabled }));
  ok(JSON.stringify(r.w) === '["2","4"]' && r.ro, '문항을 눌러도 바뀌지 않고 칸은 읽기 전용', JSON.stringify(r));
  ok(/선생님이 리포트를 보냈습니다/.test(r.note) && r.dis, '안내 + 제출 버튼 잠금', JSON.stringify(r));
  await pg.close();

  console.log('③ r.html — 처음 제출 뒤 이어서 고치면 같은 줄을 고친다');
  log = []; mine = { v: { found: false } };
  pg = await openR(br, port, mine, log);
  ok(await pg.textContent('#submitBtn') === '선생님께 제출' && await pg.$eval('#editNote', e => e.style.display) === 'none', '처음엔 예전 화면');
  await tap(pg, 3);
  await submit(pg);
  ok(log.filter(x => x.fn === 'mirror').length === 1, '처음은 새 줄(mirror_submission)');
  await pg.waitForTimeout(1200);
  await pg.click('#resultBar .btn-ghost');   // 수정
  await tap(pg, 2);
  await submit(pg);
  ok(log.filter(x => x.fn === 'mirror').length === 1 && log.some(x => x.fn === 'update' && x.p.id === 77), '두 번째는 같은 줄을 고친다', JSON.stringify(log.map(x => x.fn)));
  await pg.close();

  console.log('④ r.html — 그 사이 선생님이 보냈으면 거절 안내 · 051 전이면 예전처럼');
  log = []; mine = { v: { found: true, id: 58, sent: false, submitted_at: '2026-10-15T01:00:00Z', wrong_text: '', vow: '' } };
  pg = await openR(br, port, mine, log, { upd: { ok: false, reason: 'sent' } });
  await submit(pg);
  r = await pg.evaluate(() => ({ t: document.getElementById('toast').textContent, dis: document.getElementById('submitBtn').disabled }));
  ok(/이미 리포트를 보내서/.test(r.t) && r.dis, '거절 안내 + 잠금', JSON.stringify(r));
  await pg.close();
  log = []; mine = { v: {} };
  pg = await openR(br, port, mine, log, { noFn: true });
  await tap(pg, 1); await submit(pg);
  ok(log.some(x => x.fn === 'mirror') && !log.some(x => x.fn === 'update'), '함수가 없으면 새로 제출');
  await pg.close();

  console.log('⑤ t.html — 선생님이 고치기');
  const SUBS = [{ id: 11, submitted_at: '2026-10-15T01:00:00Z', exam: EXAM.title, school: '화정고', grade: '2학년', name: '박보검',
    wrong_count: '2', wrong_text: OLD_TEXT, vow: '옛 다짐', teacher_note: '', score: '40', parent_phone: '12345678', sent_at: '2026-10-15T06:00:00Z', teacher_name: '', edited_at: null, edited_by: '' }];
  const patches = []; let NO_COL = false;
  const tctx = await br.newContext();
  await tctx.addInitScript(() => { try { localStorage.setItem('shueguk_teacher_session_v2', JSON.stringify({ access_token: 'me', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u' } })); } catch (e) {} });
  const tp = await tctx.newPage();
  tp.on('pageerror', e => ok(false, 'pageerror(t.html) ' + e.message));
  tp.on('dialog', d => d.accept());
  const tRoute = rt => {
    const u = rt.request().url(), m = rt.request().method();
    const j = (o, st) => rt.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
    if (/\/auth\/v1\/token/.test(u)) return j({ access_token: 'tok', expires_in: 3600 });
    if (/\/rest\/v1\/submissions/.test(u)){
      if (m === 'PATCH'){
        const b = JSON.parse(rt.request().postData()); patches.push({ u, b });
        if (NO_COL && 'edited_at' in b) return j({ code: 'PGRST204', message: "Could not find the 'edited_at' column of 'submissions' in the schema cache" }, 400);
        Object.assign(SUBS[0], b); return j([SUBS[0]]);
      }
      return j(SUBS);
    }
    if (/\/rest\/v1\/teacher_accounts/.test(u)) return j([{ display_name: '김현지', login_id: 'hyunji' }]);
    if (/\/rest\/v1\/students/.test(u)) return j([{ student_id: '12345678', name: '박보검', code: 'tok-park' }]);
    if (/\/rest\/v1\/exams/.test(u)) return j([{ report_id: 'r1', title: EXAM.title, school: '화정고', grade: '2', review: '', scope: '' }]);
    if (/\/rest\/v1\/exam_questions/.test(u)) return j(EXAM.questions.map((x, i) => Object.assign({ seq: i + 1 }, x)));
    if (/script\.google/.test(u)) return j({ result: 'success', students: [] });
    return rt.fulfill({ status: 204, body: '' });
  };
  await tp.route('**/*', tRoute);
  await tp.goto('http://127.0.0.1:' + port + '/t.html', { waitUntil: 'domcontentloaded' });
  await tp.evaluate(() => loadStudents('r1'));
  await tp.waitForFunction(() => document.querySelectorAll('#studentSel option').length === 2, null, { timeout: 8000 });
  await tp.selectOption('#studentSel', '0');
  await tp.waitForFunction(() => document.getElementById('teacherName').value === '김현지', null, { timeout: 5000 }).catch(() => {});
  ok(!(await tp.$eval('#editSubBtn', b => b.disabled)), '[학생 복기 고치기] 켜짐');
  await tp.click('#editSubBtn');
  r = await tp.evaluate(() => ({ on: [...document.querySelectorAll('#seList .se-q.on')].map(d => d.dataset.no), sc: document.getElementById('seScore').textContent,
    vow: document.getElementById('seVow').value, sub: document.getElementById('seSub').textContent }));
  ok(JSON.stringify(r.on) === '["2","4"]' && r.sc === '40점' && r.vow === '옛 다짐', '창에 지금 복기가 채워진다', JSON.stringify(r));
  ok(/이미 학생에게 보낸 리포트/.test(r.sub), '보낸 리포트 안내', r.sub);
  await tp.click('#seList .se-q[data-no="4"] .se-qh');
  await tp.click('#seList .se-q[data-no="3"] .se-qh');
  await tp.fill('#seList .se-q[data-no="3"] textarea', '시간이 부족했어요');
  ok(await tp.textContent('#seScore') === '50점', '점수 다시 계산(2·3번 틀림 = 50점)', await tp.textContent('#seScore'));
  ok(/김현지 선생님이 기록됩니다/.test(await tp.textContent('#seWho')), '창에 고친 선생님 안내', await tp.textContent('#seWho'));
  await tp.fill('#teacherName', '이수경');   // 리포트 담당 칸이 달라도 고친 사람은 로그인한 선생님
  await tp.fill('#seVow', '선생님이 고친 다짐');
  await tp.click('#seSave');
  await tp.waitForFunction(() => !document.getElementById('subEdit').classList.contains('show'), null, { timeout: 5000 });
  const pb = patches[patches.length - 1];
  ok(pb && /id=eq\.11/.test(pb.u) && pb.b.score === '50' && pb.b.wrong_count === '2' && pb.b.vow === '선생님이 고친 다짐' && pb.b.edited_by === '김현지 선생님' && !!pb.b.edited_at,
     'PATCH — 점수·틀린 수·다짐·고친 사람', JSON.stringify(pb && pb.b));
  ok(pb && /\[3번 · 문학·현대시 · 중\] 문항 3\n  → 시간이 부족했어요/.test(pb.b.wrong_text) && !/4번/.test(pb.b.wrong_text) && /\(가\)|2번/.test(pb.b.wrong_text), '틀린 문항 글', pb && pb.b.wrong_text);
  r = await tp.evaluate(() => ({ st: document.getElementById('editState').textContent, sc: document.getElementById('rScore').textContent, wc: document.getElementById('rWc').textContent }));
  ok(/김현지 선생님이 .* 고쳤어요/.test(r.st) && r.sc === '50점' && r.wc === '2개', '보고서·상태 줄 갱신', JSON.stringify(r));
  NO_COL = true;
  const before = patches.length; let alertMsg = '';
  tp.removeAllListeners('dialog'); tp.on('dialog', d => { alertMsg = d.message(); d.accept(); });
  await tp.click('#editSubBtn'); await tp.click('#seSave'); await tp.waitForTimeout(600);
  ok(patches.length === before + 1 && 'edited_by' in patches[before].b && /051/.test(alertMsg) &&
     await tp.$eval('#subEdit', e => e.classList.contains('show')), '051 전 DB — 고친 선생님 없이 저장하지 않고 알린다', alertMsg);
  await tctx.close();

  console.log('⑤-2 t.html — 로그인하지 않았으면 이름을 묻는다');
  NO_COL = false;
  const t2 = await br.newContext().then(c => c.newPage());
  const asks = [];
  t2.on('dialog', d => { asks.push(d.type() + ':' + d.message()); d.type() === 'prompt' ? d.accept(asks.length === 1 ? '' : '박언호') : d.accept(); });
  await t2.route('**/*', tRoute);
  await t2.goto('http://127.0.0.1:' + port + '/t.html', { waitUntil: 'domcontentloaded' });
  await t2.evaluate(() => loadStudents('r1'));
  await t2.waitForFunction(() => document.querySelectorAll('#studentSel option').length === 2, null, { timeout: 8000 });
  await t2.selectOption('#studentSel', '0');
  await t2.click('#editSubBtn');
  ok(/로그인하지 않아/.test(await t2.textContent('#seWho')), '로그인 없음 안내');
  const n0 = patches.length;
  await t2.click('#seSave'); await t2.waitForTimeout(400);
  ok(patches.length === n0 && asks.some(a => /^alert:.*이름이 있어야/.test(a)), '이름을 비우면 저장하지 않는다', JSON.stringify(asks));
  await t2.click('#seSave');
  await t2.waitForFunction(() => !document.getElementById('subEdit').classList.contains('show'), null, { timeout: 5000 });
  ok(patches.length === n0 + 1 && patches[n0].b.edited_by === '박언호 선생님', '물어본 이름으로 기록', JSON.stringify(patches[n0] && patches[n0].b.edited_by));
  await t2.close();

  console.log('⑥ s.html — 보내기 전이면 복기 고치기 링크');
  const sp = await br.newContext().then(c => c.newPage());
  await sp.route('**/*', rt => rt.request().url().startsWith('http://127.0.0.1:' + port) ? rt.continue() : rt.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await sp.goto('http://127.0.0.1:' + port + '/s.html', { waitUntil: 'domcontentloaded' });
  r = await sp.evaluate(() => ({ a: analysisNoticeHtml({ id: 'r1', title: 'T', done: true, sent: false }), b: analysisNoticeHtml({ id: 'r1', title: 'T', done: true, sent: true }),
    c: analysisNoticeHtml({ id: 'r1', title: 'T', done: true }), w: examWaitHtml({ title: 'T', submittedAt: '10/15', reportId: 'r1' }) }));
  ok(/복기 고치기/.test(r.a) && /보내기 전까지/.test(r.a), '보내기 전 — 복기 고치기', r.a);
  ok(/다시 보기/.test(r.b) && !/복기 고치기/.test(r.b) && /다시 보기/.test(r.c), '보낸 뒤·모름 — 다시 보기');
  ok(/복기 고치기/.test(r.w) && /r\.html\?id=r1/.test(r.w), '준비 중 카드에도 고치기 링크', r.w);

  await br.close(); srv.close();
  console.log(`\nsubmission-edit-e2e: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
