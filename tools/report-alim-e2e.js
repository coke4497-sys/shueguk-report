/* 지필고사 리포트 복기 안내 알림톡(2026-10-02) — 분석지 배정(analyses.html)의 [복기 안내 알림톡].
 * 배정 대상만·복기 낸 학생 빼기·받는 분·제목·확인 창·POST 본문(50건씩)·템플릿 준비 전 잠금·배정 없는 리포트 버튼 없음.
 *   NODE_PATH=$(npm root -g) node tools/report-alim-e2e.js
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
      fs.readFile(f, (e, b) => e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }), r.end(b)));
    }).listen(0, () => res(s));
  });
}
const TPL = { label: '지필고사 리포트 제작 안내', ready: true, notice: true, vars: ['학생명', '제목', '접근코드'],
  text: '[이수경국어학원] 지필고사 리포트 제작 안내\n#{학생명} 학생에게 지필고사 리포트 제작 안내가 도착했어요.\n\n▶ #{제목}\n\n학생 페이지의 지필고사 데이터 메뉴에서 시험 복기를 입력해 주세요.',
  buttons: [{ name: '학생 페이지 링크' }] };
const TPL_UP = { label: '지필고사 리포트 업데이트 안내', ready: true, notice: true, vars: ['학생명', '제목', '접근코드'],
  text: '[이수경국어학원] 지필고사 리포트 업데이트 안내\n#{학생명} 학생에게 지필고사 리포트 업데이트 안내가 도착했어요.\n\n▶ #{제목}\n\n학생 페이지의 지필고사 데이터 메뉴에서 새로 올라온 리포트를 확인해 주세요.',
  buttons: [{ name: '학생 페이지 링크' }] };
const STUS = [
  { name: '박보검', school: '화정고', grade: '2026 고등 1학년', student_id: '11111111', code: 'c1', enrolled: '재원', teacher: '이현지', phone_student: '01011112222', phone_parent1: '01033334444', phone_parent2: '' },
  { name: '김하늘', school: '화정고', grade: '2026 고등 1학년', student_id: '22222222', code: 'c2', enrolled: '재원', phone_student: '', phone_parent1: '01055556666', phone_parent2: '01077778888' },
  { name: '이미낸', school: '화정고', grade: '2026 고등 1학년', student_id: '33333333', code: 'c3', enrolled: '재원', teacher: '이은지', phone_student: '01099990000', phone_parent1: '01099991111', phone_parent2: '' },
  { name: '피드백전', school: '화정고', grade: '2026 고등 1학년', student_id: '77777777', code: 'c7', enrolled: '재원', phone_student: '01015151515', phone_parent1: '', phone_parent2: '' },
  { name: '코드없음', school: '화정고', grade: '2026 고등 1학년', student_id: '44444444', code: '', enrolled: '재원', phone_student: '01012121212', phone_parent1: '', phone_parent2: '' },
  { name: '다른학교', school: '서정고', grade: '2026 고등 1학년', student_id: '55555555', code: 'c5', enrolled: '재원', phone_student: '01013131313', phone_parent1: '', phone_parent2: '' },
  { name: '퇴원생', school: '화정고', grade: '2026 고등 1학년', student_id: '66666666', code: 'c6', enrolled: '퇴원', phone_student: '01014141414', phone_parent1: '', phone_parent2: '' }];
(async () => {
  const srv = await serve(), port = srv.address().port;
  const br = await chromium.launch();
  let perr = 0, ready = true;
  const posts = [], dialogs = [];
  const pg = await (await br.newContext()).newPage();
  pg.on('pageerror', e => { perr++; console.log('  ✗ pageerror', e.message); });
  let dismissNext = false, taAuth = '';
  pg.on('dialog', d => { dialogs.push(d.message()); if (dismissNext){ dismissNext = false; d.dismiss(); } else d.accept(); });
  await pg.route('**/*', rt => {
    const u = rt.request().url(), m = rt.request().method();
    const j = o => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
    if (/\/auth\/v1\/token/.test(u)) return j({ access_token: 'tok', expires_in: 3600 });
    if (/\/rest\/v1\/students/.test(u)) return j(/offset=0/.test(u) ? STUS : []);
    if (/\/rest\/v1\/teacher_accounts/.test(u)){ taAuth = rt.request().headers()['authorization'] || ''; return j(/user_id=eq\.u-kim/.test(u) ? [{ display_name: '김현지', login_id: 'hyunji' }] : []); }
    if (/\/rest\/v1\/tt_classes/.test(u)) return j(/offset=0/.test(u) && /book=eq/.test(u) && /not\.like\.w/.test(u) ? [
      { class_id: 'n001', name: '고1 화정A', teacher: '현지', roster: '박보검 이미낸(8/30부터)' },
      { class_id: 'n002', name: '고1 확인', teacher: '지원', roster: '(화정)이미낸 박보검' }] : []);
    if (/\/rest\/v1\/submissions/.test(u)) return j(/offset=0/.test(u) ? [{ exam: '26-2-중간-화정고1-공통국어2', name: '이미낸', parent_phone: '33333333', sent_at: '2026-10-02T05:00:00Z', teacher_note: '잘했어요' },
      { exam: '26-2-중간-화정고1-공통국어2', name: '피드백전', parent_phone: '77777777', sent_at: null, teacher_note: '' }] : []);
    if (/\/rest\/v1\//.test(u)) return rt.fulfill({ status: 204, body: '' });
    if (/script\.google/.test(u)){
      if (m === 'POST'){ const b = JSON.parse(rt.request().postData()); posts.push(b);
        if (b.action === 'alimSend') return j({ result: 'success', okCount: b.items.length - 1, sent: b.items.map((x, i) => ({ student: x.student, who: x.who, ok: i > 0, dup: i === 0 })) });
        return j({ result: 'success' }); }
      const q = new URL(u).searchParams;
      if (q.get('list')) return j({ result: 'success', reports: [{ id: '26-2-중간-화정고1-공통국어2', title: '26-2-중간-화정고1-공통국어2' }, { id: 'r-none', title: '26-2-중간-능곡고2-문학' }] });
      if (q.get('action') === 'assignList') return j({ result: 'success', assignments: [{ item: '26-2-중간-화정고1-공통국어2', type: '일부', target: '박보검|화정고|2026고등1학년, 김하늘, 이미낸, 피드백전, 코드없음, 퇴원생' }] });
      if (q.get('action') === 'alimConfig') return j({ result: 'success', ready: true, templates: { notice_report: Object.assign({}, TPL, { ready }), notice_reportup: Object.assign({}, TPL_UP, { ready }) } });
      return j({ result: 'success' });
    }
    return rt.fulfill({ status: 204, body: '' });
  });
  await pg.goto('http://127.0.0.1:' + port + '/analyses.html', { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('.a-item', { timeout: 8000 });
  let r = await pg.evaluate(() => [...document.querySelectorAll('.a-item')].map(x => !!x.querySelector('.a-alim')));
  ok('배정된 리포트에만 [복기 안내 알림톡]', r.join() === 'true,false', JSON.stringify(r));
  await pg.click('.a-alim');
  await pg.waitForSelector('#alSum b', { timeout: 8000 });
  r = await pg.evaluate(() => ({ sum: document.getElementById('alSum').textContent, title: document.getElementById('alTitle').value,
    prev: document.getElementById('alPrev').textContent, go: document.getElementById('alGo').textContent, dis: document.getElementById('alGo').disabled }));
  ok('제목은 학생이 읽기 쉽게 — "2학기 중간고사 화정고1 공통국어2"', r.title === '2학기 중간고사 화정고1 공통국어2', r.title);
  ok('대상 = 배정된 재원생 중 복기 안 낸 학생(박보검·김하늘) — 2명, 연락처 있는 분마다 4건', /2명/.test(r.sum) && /4건/.test(r.sum) && r.go === '알림톡 보내기 (4건)' && !r.dis, r.sum);
  ok('복기 낸 학생은 빼고, 접근코드 없는 학생은 안내', /이미 제출한 2명은 빼고 보냅니다/.test(r.sum) && /접근코드\)가 없는 학생 1명: 코드없음/.test(r.sum) && !/퇴원생|다른학교/.test(r.sum), r.sum);
  let q = await pg.evaluate(() => ({ t: (document.querySelector('.al-skip') || {}).textContent || '', on: (document.querySelector('input[name="alSkip"]:checked') || {}).value }));
  ok('"이미 제출한 친구가 있어요 · 1명이 이미 복기를 제출했어요. 빼고 보낼까요?" + 이름 + 기본 = 빼고', /이미 제출한 친구가 있어요/.test(q.t) && /2명이 이미 복기를 제출했어요\. 빼고 보낼까요\?/.test(q.t) && /이미낸/.test(q.t) && /피드백전/.test(q.t) && q.on === '1', JSON.stringify(q));
  await pg.check('input[name="alSkip"][value="0"]');
  q = await pg.evaluate(() => ({ sum: document.getElementById('alSum').textContent, go: document.getElementById('alGo').textContent }));
  ok('"아니요, 함께 보낼게요" — 제출한 친구도 포함(4명 · 7건)', /배정된 학생 4명/.test(q.sum) && /7건/.test(q.sum) && !/빼고 보냅니다/.test(q.sum) && q.go === '알림톡 보내기 (7건)', JSON.stringify(q));
  await pg.check('input[name="alSkip"][value="1"]');
  ok('미리보기 — 템플릿 문구에 학생명·제목·버튼', /박보검 학생에게 지필고사 리포트 제작 안내/.test(r.prev) && /▶ 2학기 중간고사 화정고1 공통국어2/.test(r.prev) && /학생 페이지 링크/.test(r.prev), r.prev);
  await pg.uncheck('.alW[value="학생"]');
  r = await pg.evaluate(() => document.getElementById('alSum').textContent);
  ok('받는 분에서 학생을 빼면 학부모님만 — 3건', /3건/.test(r) && /학부모님1·학부모님2/.test(r), r);
  await pg.check('.alW[value="학생"]');
  await pg.fill('#alTitle', '2학기 중간 공통국어2 리포트');
  await pg.click('#alGo');
  await pg.waitForFunction(() => /보냈습니다/.test(document.getElementById('alRes').textContent), null, { timeout: 8000 });
  const sp = posts.filter(p => p.action === 'alimSend');
  ok('확인 창을 거쳐 보낸다', dialogs.some(d => /지필고사 리포트 제작 안내.*2명에게 4건/s.test(d)), JSON.stringify(dialogs));
  ok('POST — kind notice_report · pw · 중복 키 N:날짜|제목 · 변수(학생명·제목·접근코드)', sp.length === 1 && sp[0].kind === 'notice_report' && sp[0].pw === 'sh' && sp[0].items.length === 4 &&
     sp[0].items.every(it => /^N:\d{4}-\d{2}-\d{2}\|2학기 중간 공통국어2 리포트$/.test(it.date) && it.vars['제목'] === '2학기 중간 공통국어2 리포트' && it.vars['접근코드'] && it.vars['학생명'] === it.student) &&
     sp[0].items.filter(it => it.student === '박보검').map(it => it.who).join() === '학생,학부모1' && sp[0].items.filter(it => it.student === '김하늘').map(it => it.who).join() === '학부모1,학부모2', JSON.stringify(sp[0]));
  r = await pg.evaluate(() => ({ res: document.getElementById('alRes').textContent, go: document.getElementById('alGo').textContent }));
  ok('결과 — 보낸 건수·이미 받은 건 건너뜀 안내', /알림톡 3건을 보냈습니다/.test(r.res) && /이미 받은 1건은 건너뛰었어요/.test(r.res) && r.go === '보냈습니다', JSON.stringify(r));
  await pg.keyboard.press('Escape');
  ok('Esc로 닫힘', await pg.evaluate(() => !document.getElementById('alBg').classList.contains('on')));
  // 피드백 확인 안내 — 선생님이 리포트를 보낸 학생만
  await pg.click('.a-alim');
  await pg.waitForSelector('#alSum b', { timeout: 8000 });
  r = await pg.evaluate(() => [...document.querySelectorAll('.al-kind')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')));
  ok('알림톡 종류 알약 두 개 — 기본 = 리포트 제작 안내', r.length === 2 && /리포트 제작 안내/.test(r[0]) && /\*$/.test(r[0]) && /피드백 확인 안내/.test(r[1]), JSON.stringify(r));
  await pg.click('.al-kind[data-mode="up"]');
  r = await pg.evaluate(() => ({ sum: document.getElementById('alSum').textContent, box: document.getElementById('alBox').textContent, prev: document.getElementById('alPrev').textContent,
    go: document.getElementById('alGo').textContent, on: (document.querySelector('.al-kind.on') || {}).dataset.mode }));
  ok('피드백 확인 안내 = 리포트를 보낸 학생(이미낸)만 — 1명 · 2건', r.on === 'up' && /선생님 피드백을 보낸 학생 1명/.test(r.sum) && /2건/.test(r.sum) && r.go === '알림톡 보내기 (2건)', JSON.stringify(r));
  ok('"피드백이 완성되지 않은 친구가 있어요 · 빼고 보낼까요?" + 이름(피드백전) + 기본 = 빼고, 복기 안 낸 친구 수 안내', /피드백이 완성되지 않은 친구가 있어요/.test(r.box) && /1명은 복기를 냈지만.*빼고 보낼까요\?/.test(r.box) && /피드백전/.test(r.box) &&
     (await pg.evaluate(() => (document.querySelector('input[name="alWait"]:checked') || {}).value)) === '1' && /피드백이 완성되지 않은 1명은 빼고 보냅니다/.test(r.sum) && /아직 복기를 내지 않은 3명은 받지 않습니다/.test(r.sum), r.sum);
  await pg.check('input[name="alWait"][value="0"]');
  q = await pg.evaluate(() => ({ sum: document.getElementById('alSum').textContent, go: document.getElementById('alGo').textContent }));
  ok('"아니요, 함께 보낼게요" — 피드백 전 친구도 포함(2명 · 3건)', /복기를 낸 학생 2명/.test(q.sum) && /3건/.test(q.sum) && !/완성되지 않은 1명은 빼고/.test(q.sum) && q.go === '알림톡 보내기 (3건)', JSON.stringify(q));
  await pg.check('input[name="alWait"][value="1"]');
  ok('미리보기 = 업데이트 안내 문구', /이미낸 학생에게 지필고사 리포트 업데이트 안내/.test(r.prev) && /새로 올라온 리포트/.test(r.prev), r.prev);
  ok('피드백 확인 안내 제목 = "… 담당 선생님 피드백…" · 내신 진도 수업 담당T(현지 → 이현지 선생님, 확인반 지원T·슈스 링크 담당 이은지는 아님)', (await pg.inputValue('#alTitle')) === '2학기 중간고사 화정고1 공통국어2 리포트에 담당 선생님 피드백이 등록되었습니다' &&
     /▶ 2학기 중간고사 화정고1 공통국어2 리포트에 이현지 선생님 피드백이 등록되었습니다/.test(r.prev) && /내신 진도 수업을 맡은 선생님 이름이 들어갑니다/.test(r.prev), r.prev);
  await pg.click('.al-kind[data-mode="make"]');
  ok('제작 안내로 돌아가면 기본 제목도 돌아온다', (await pg.inputValue('#alTitle')) === '2학기 중간고사 화정고1 공통국어2');
  await pg.fill('#alTitle', '직접 고친 제목');
  await pg.click('.al-kind[data-mode="up"]');
  ok('직접 고친 제목은 종류를 바꿔도 그대로', (await pg.inputValue('#alTitle')) === '직접 고친 제목');
  await pg.fill('#alTitle', '2학기 중간고사 화정고1 공통국어2 리포트에 담당 선생님 피드백이 등록되었습니다');
  dialogs.length = 0;
  await pg.click('#alGo');
  await pg.waitForFunction(() => /보냈습니다/.test(document.getElementById('alRes').textContent), null, { timeout: 8000 });
  const up = posts.filter(p => p.action === 'alimSend').pop();
  ok('확인 창·POST — kind notice_reportup · 이미낸 학생·학부모님1', dialogs.some(d => /지필고사 리포트 업데이트 안내.*1명에게 2건/s.test(d)) && up.kind === 'notice_reportup' &&
     up.items.map(it => it.student + ':' + it.who).join() === '이미낸:학생,이미낸:학부모1' &&
     up.items.every(it => it.vars['제목'] === '2학기 중간고사 화정고1 공통국어2 리포트에 이현지 선생님 피드백이 등록되었습니다') &&
     up.items.every(it => /\|2학기 중간고사 화정고1 공통국어2 리포트에 담당 선생님 피드백이 등록되었습니다$/.test(it.date)), JSON.stringify(up));
  ok('확인 창에도 선생님 이름이 들어간 제목', dialogs.some(d => /이현지 선생님 피드백/.test(d)), JSON.stringify(dialogs));
  await pg.keyboard.press('Escape');
  // 허브에 로그인한 선생님(김현지)이 보내면 — 제목에 그 이름 + '김현지 선생님이 맞으신가요?' 확인
  await pg.evaluate(() => localStorage.setItem('shueguk_teacher_session_v2', JSON.stringify({ access_token: 'hubtok', refresh_token: 'rt', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u-kim' } })));
  await pg.click('.a-alim');
  await pg.waitForSelector('#alSum b', { timeout: 8000 });
  await pg.click('.al-kind[data-mode="up"]');
  r = await pg.evaluate(() => ({ me: (document.querySelector('.al-me') || {}).textContent || '', prev: document.getElementById('alPrev').textContent }));
  ok('로그인한 선생님 확인 — 허브 로그인 신분으로 계정을 묻는다(공용 계정 아님)', taAuth === 'Bearer hubtok', taAuth);
  ok('창에 "보내는 선생님 김현지 선생님 (로그인한 계정)" + 미리보기 제목에 김현지 선생님', /김현지 선생님 \(로그인한 계정\)/.test(r.me) && /김현지 선생님으로 표시됩니다/.test(r.me) &&
     /▶ 2학기 중간고사 화정고1 공통국어2 리포트에 김현지 선생님 피드백이 등록되었습니다/.test(r.prev) && /로그인한 김현지 선생님 이름이 들어갑니다/.test(r.prev), JSON.stringify(r));
  dialogs.length = 0; dismissNext = true;
  const before = posts.length;
  await pg.click('#alGo');
  await pg.waitForFunction(() => /보내지 않았습니다/.test(document.getElementById('alRes').textContent), null, { timeout: 8000 });
  ok('"김현지 선생님이 맞으신가요? 김현지 선생님으로 알림톡에 표시됩니다." — [취소]면 보내지 않음', dialogs.length === 1 && dialogs[0] === '김현지 선생님이 맞으신가요?\n김현지 선생님으로 알림톡에 표시됩니다.' && posts.length === before, JSON.stringify(dialogs));
  dialogs.length = 0;
  await pg.click('#alGo');
  await pg.waitForFunction(() => /알림톡 \d+건을 보냈습니다/.test(document.getElementById('alRes').textContent), null, { timeout: 8000 });
  const kim = posts.filter(p => p.action === 'alimSend').pop();
  ok('[확인]이면 두 번째 확인 창을 거쳐 보냄 — 제목 변수에 김현지 선생님', dialogs.length === 2 && /맞으신가요/.test(dialogs[0]) && /업데이트 안내/.test(dialogs[1]) &&
     kim.kind === 'notice_reportup' && kim.items.every(it => it.vars['제목'] === '2학기 중간고사 화정고1 공통국어2 리포트에 김현지 선생님 피드백이 등록되었습니다'), JSON.stringify(kim));
  await pg.keyboard.press('Escape');
  await pg.evaluate(() => localStorage.removeItem('shueguk_teacher_session_v2'));
  // 템플릿 준비 전 — 보내기 잠금
  ready = false;
  await pg.evaluate(() => { AL.cfg = null; });
  await pg.click('.a-alim');
  await pg.waitForSelector('#alSum b', { timeout: 8000 });
  r = await pg.evaluate(() => ({ dis: document.getElementById('alGo').disabled, txt: document.getElementById('alBox').textContent }));
  ok('템플릿 준비 전이면 잠금과 안내', r.dis && /아직 준비되지 않았습니다/.test(r.txt));
  ok('페이지 오류 없음', perr === 0);
  console.log((fail ? '실패 ' + fail + ' / ' : '') + '통과 ' + pass + '건');
  await br.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
