#!/usr/bin/env node
/* 학생 페이지 '학력평가 성적'(057, 2026-10-21) 검증.
 *   LC_ALL=C.UTF-8 NODE_PATH=$(npm root -g) node tools/smock-e2e.js
 * 가짜 수파베이스(smock_mine/smock_submit)로 허브 카드(고등만·입력할 회차 점)·목록·입력 창(점수·체감·
 * 선택과목·틀린 문항·후기)·저장 본문·별 +1·고치기·오류 안내·점수 흐름을 확인한다. */
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const SHOT = process.env.SHOT || '';
const shot = (pg, n, sel) => SHOT ? (sel ? pg.locator(sel).screenshot({ path: path.join(SHOT, n + '.png') }) : pg.screenshot({ path: path.join(SHOT, n + '.png'), fullPage: true })) : Promise.resolve();   // SHOT=폴더면 화면 캡처
const ok = (m, c, x) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (x ? ' ' + x : ''))); };

const EXAMS = {
  '2026-10-고1': { key: '2026-10-고1', year: 2026, month: 10, grade: '고1', layout: '통합', title: '2026년 10월 고1 학력평가', open: true },
  '2026-09-고1': { key: '2026-09-고1', year: 2026, month: 9,  grade: '고1', layout: '통합', title: '2026년 9월 고1 모의평가', open: false },
  '2026-10-고3': { key: '2026-10-고3', year: 2026, month: 10, grade: '고3', layout: '고3', title: '2026년 10월 고3 학력평가', open: true }
};
let ENTRIES = [], CALLS = [], GRADE = '고1';
function mine(){
  return { ok: true, grade: GRADE,
    open: Object.values(EXAMS).filter(e => e.open && e.grade === GRADE),
    entries: ENTRIES.map(x => Object.assign({}, EXAMS[x.exam], x, { exam: x.exam }))
      .sort((a, b) => b.year - a.year || b.month - a.month) };
}
let submit = function(p){
  const e = EXAMS[p.exam];
  if (!e) return { ok: false, error: 'no_exam' };
  if (!e.open) return { ok: false, error: 'closed' };
  if (!String(p.score || '').trim()) return { ok: false, error: 'no_score' };
  const old = ENTRIES.find(x => x.exam === p.exam);
  const n = /^\d+(\.\d)?$/.test(p.score) ? Number(p.score) : null;
  const row = { exam: p.exam, score: n, score_text: p.score, feel: p.feel, subject: p.subject, wrong: p.wrong, review: p.review, src: '학생' };
  if (old) Object.assign(old, row); else ENTRIES.push(row);
  return { ok: true, first: !old, exam: p.exam };
};

(async () => {
  const srv = await new Promise(res => { const s = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, ''));
    fs.readFile(f, (e, b) => e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8' }), r.end(b)));
  }).listen(0, () => res(s)); });
  const port = srv.address().port;
  const br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  let perr = 0; pg.on('pageerror', e => { perr++; console.log('  ✗ pageerror', e.message); });
  await pg.route('**/*', rt => {
    const u = rt.request().url();
    if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u);
    if (m && m[1] === 'smock_mine') return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mine()) });
    if (m && m[1] === 'smock_submit'){
      const p = JSON.parse(rt.request().postData() || '{}').p || {};
      CALLS.push(p);
      return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(submit(p)) });
    }
    if (m) return rt.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false}' });
    return rt.fulfill({ status: 204, body: '' });
  });
  await pg.goto('http://127.0.0.1:' + port + '/s.html', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(300);
  const hub = grade => pg.evaluate(g => {
    KEY = 'tok-kim'; IS_ID = false;
    STATE.info = { name: '김철수', school: '화정고', grade: g, id: '12345678' };
    STATE.notices = []; STATE.analyses = []; STATE.homework = []; STATE.lhist = []; STATE.ahist = []; STATE.review = []; STATE.plan = null;
    STATE.stars = { total: 3, breakdown: { voca: 3 } };
    delete STATE.smock;
    renderHub();
  }, grade);
  const card = () => pg.evaluate(() => {
    const c = [...document.querySelectorAll('#menu .card')].find(x => /모의고사 리포트/.test(x.textContent));
    return c ? { text: c.textContent.replace(/\s+/g, ' '), pending: c.classList.contains('pending'), dot: (c.querySelector('.new-dot') || {}).textContent || '' } : null;
  });

  // ① 중학생에게는 카드 없음
  await hub('2026 중등 3학년'); await pg.waitForTimeout(200);
  ok('중학생은 카드 없음', (await card()) === null);

  // ② 고1 — 입력할 회차 있음
  await hub('2026 고등 1학년'); await pg.waitForTimeout(300);
  let c = await card();
  ok('고1 카드: 입력 안내·별 +1', c && /10월 고1 모의고사 성적을 입력해 주세요 · 별 \+1/.test(c.text), c && c.text);
  ok('입력할 회차 수 점', c && c.dot === '1', c && c.dot);
  await shot(pg, '1-학생-메뉴카드', '#menu');

  // ③ 화면 열기 → 입력하기
  await pg.evaluate(() => openSmock()); await pg.waitForTimeout(300);
  let t = await pg.textContent('#smBody');
  ok('입력할 회차 목록', /2026년 10월 고1 학력평가/.test(t) && /아직 입력하지 않았어요/.test(t), t.slice(0, 120));
  ok('기록 없음 안내', /아직 기록이 없어요/.test(t));
  await pg.click('[data-sm-open="2026-10-고1"]');
  const areas = await pg.$$eval('#smView .sm-area .an', a => a.map(x => x.textContent));
  ok('통합형 다섯 영역', areas.length === 5 && /화법1~6번/.test(areas[0]) && /문학31~45번/.test(areas[4]), JSON.stringify(areas));
  ok('선택과목 칸 없음(통합)', (await pg.$$('[data-sm-subj]')).length === 0);
  // 빈 점수 → 안내
  await pg.click('#smSave');
  ok('점수 비면 안내', /점수를 적어 주세요/.test(await pg.textContent('#smErr')));
  ok('빈 점수는 서버로 안 보냄', CALLS.length === 0);
  await pg.fill('#smScore', '84');
  await pg.click('[data-sm-feel="중"]'); await pg.click('[data-sm-feel="최상"]');
  await pg.click('[data-sm-q="13"]'); await pg.click('[data-sm-q="12"]'); await pg.click('[data-sm-q="40"]');
  await pg.click('[data-sm-q="40"]');   // 다시 누르면 해제
  ok('누른 문항 표시·틀림 수', (await pg.textContent('#smView .sm-area:nth-child(n) .an >> nth=2')).includes('틀림 2'));
  ok('후기 안내 문구', (await pg.textContent('.sm-guide')).indexOf('슈스 여러분의 솔직한 마음을 들려주세요. 귀 기울여 듣겠습니다.') >= 0
     && (await pg.textContent('.sm-guide')).indexOf('시험 운영, 난도, 반성 및 다짐, 도움 요청 등') >= 0
     && ((await pg.getAttribute('#smReview', 'placeholder')) || '').indexOf('도움 요청') >= 0);
  await pg.fill('#smReview', '시간이 부족했어요');
  await pg.click('[data-sm-q="7"]');     // 다른 칸을 눌러도 쓴 글이 남는지
  ok('다시 그려도 점수·후기 유지', (await pg.inputValue('#smScore')) === '84' && (await pg.inputValue('#smReview')) === '시간이 부족했어요');
  if (SHOT){ await pg.evaluate(() => { smKeep(); SM.form.err = ''; smRender(); window.scrollTo(0, 0); }); await shot(pg, '2-학생-입력창'); }
  await pg.click('#smSave'); await pg.waitForTimeout(400);
  const p1 = CALLS[0] || {};
  ok('저장 본문: 회차·점수·키', p1.exam === '2026-10-고1' && p1.score === '84' && p1.key === 'tok-kim', JSON.stringify(p1));
  ok('저장 본문: 체감 난이도 순서', p1.feel === '최상, 중', p1.feel);
  ok('저장 본문: 틀린 문항(정렬·해제 반영)', JSON.stringify(p1.wrong && { 언어: p1.wrong['언어'], 독서: p1.wrong['독서'], n: Object.keys(p1.wrong).length }) === JSON.stringify({ 언어: [7], 독서: [12, 13], n: 2 }), JSON.stringify(p1.wrong));
  ok('저장 본문: 후기', p1.review === '시간이 부족했어요');
  t = await pg.textContent('#smBody');
  ok('저장 뒤 별 +1 안내', /별 \+1을 받았어요/.test(t), t.slice(0, 80));
  ok('별 합계 +1', await pg.evaluate(() => STATE.stars.total === 4 && STATE.stars.breakdown.smock === 1));
  ok('기록 카드: 점수·체감·틀린 문항', /84점/.test(t) && /체감 난이도 최상, 중/.test(t) && /독서1213/.test(t.replace(/\s+/g, '')), t.slice(0, 300));
  ok('다 맞은 영역은 모두 맞음', /화법모두맞음/.test(t.replace(/\s+/g, '')));

  // ④ 고치기 → 미채점, first 아님
  await pg.click('.sm-ent [data-sm-open="2026-10-고1"]');
  ok('고치기: 지난 값 채움', (await pg.inputValue('#smScore')) === '84' && (await pg.$$('.sm-n.on')).length === 3);
  await pg.click('[data-sm-nos]');
  await pg.click('#smSave'); await pg.waitForTimeout(400);
  ok('미채점 저장', CALLS[1] && CALLS[1].score === '미채점');
  t = await pg.textContent('#smBody');
  ok('고친 뒤 안내(별 없음)', /고친 내용을 저장했습니다/.test(t) && await pg.evaluate(() => STATE.stars.total === 4));
  ok('숫자 아닌 점수는 글로', /미채점/.test(t));

  // ⑤ 지난 기록(닫힌 회차)과 점수 흐름
  ENTRIES[0].score = 84; ENTRIES[0].score_text = '84';
  ENTRIES.push({ exam: '2026-09-고1', score: 77, score_text: '77', feel: '상', subject: '', wrong: { '문학': [36] }, review: '', src: '설문' });
  await pg.evaluate(() => smRefresh()); await pg.waitForTimeout(300);
  t = await pg.textContent('#smBody');
  ok('점수 흐름 두 회차', (await pg.$$('.sm-trend .r')).length === 2);
  ok('설문에서 옮겨 온 기록 표시', /구글 설문에서 옮겨 온 기록/.test(t));
  await pg.evaluate(() => { SM.ok = ''; smRender(); window.scrollTo(0, 0); });
  await shot(pg, '3-학생-내기록');
  ok('닫힌 회차는 고치기 없음', (await pg.$$('.sm-ent [data-sm-open="2026-09-고1"]')).length === 0);
  await pg.evaluate(() => smBack()); await pg.waitForTimeout(200);
  c = await card();
  ok('허브 카드: 기록 회수·최근 점수', c && /기록 2회 · 최근 10월 고1 84점/.test(c.text), c && c.text);

  // ⑥ 고3 — 선택과목 필수, 세 영역
  GRADE = '고3'; ENTRIES = []; CALLS = [];
  await hub('2026 고등 3학년'); await pg.waitForTimeout(300);
  ok('고3은 허브 카드 없음(원장님 — 고3은 이 메뉴를 쓰지 않음)', (await card()) === null);
  await pg.evaluate(() => openSmock()); await pg.waitForTimeout(300);
  await pg.click('[data-sm-open="2026-10-고3"]');
  const a3 = await pg.$$eval('#smView .sm-area .an', a => a.map(x => x.textContent));
  ok('고3 세 영역(독서·문학·선택과목)', a3.length === 3 && /독서1~17번/.test(a3[0]) && /선택과목35~45번/.test(a3[2]), JSON.stringify(a3));
  await pg.fill('#smScore', '91');
  await pg.click('#smSave');
  ok('선택과목 안 고르면 안내', /선택과목을 골라 주세요/.test(await pg.textContent('#smErr')) && CALLS.length === 0);
  await pg.click('[data-sm-subj="언어와매체"]'); await pg.click('[data-sm-q="40"]');
  await pg.click('#smSave'); await pg.waitForTimeout(400);
  ok('고3 저장 본문: 선택과목·선택 영역', CALLS[0] && CALLS[0].subject === '언어와매체' && JSON.stringify(CALLS[0].wrong) === '{"선택":[40]}', JSON.stringify(CALLS[0]));

  // ⑦ 서버 거절 안내
  EXAMS['2026-10-고3'].open = false;
  await pg.evaluate(() => { SM.form = { exam: { key: '2026-10-고3', layout: '고3', title: 'x' }, score: '90', feel: [], subject: '언어와매체', wrong: {}, review: '', err: '', had: true }; smRender(); });
  await pg.click('#smSave'); await pg.waitForTimeout(400);
  ok('마감된 회차 안내', /입력이 마감되었습니다/.test(await pg.textContent('#smErr')));

  // ⑦-2 정답·배점·등급컷이 있는 회차(058) — 점수 자동 계산·등급·틀린 문항 살펴보기
  const INFO = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/smock-info/2026-10-고1.json'), 'utf8'));
  GRADE = '고1'; ENTRIES = []; CALLS = [];
  EXAMS['2026-10-고1'].info = INFO; EXAMS['2026-10-고1'].open = true;
  const sub0 = submit;
  submit = p => { if (EXAMS[p.exam].info){ let lost = 0; Object.values(p.wrong || {}).forEach(a => a.forEach(n => { lost += INFO.points[n - 1]; })); p = Object.assign({}, p, { score: String(100 - lost) }); } return sub0(p); };
  await hub('2026 고등 1학년'); await pg.waitForTimeout(300);
  await pg.evaluate(() => openSmock()); await pg.waitForTimeout(300);
  await pg.click('[data-sm-open="2026-10-고1"]');
  ok('점수 칸 대신 자동 계산 상자', (await pg.$$('#smScore')).length === 0 && /100점/.test(await pg.textContent('#smLive')));
  ok('3점 문항 표시', await pg.$eval('[data-sm-q="14"]', b => b.classList.contains('p3')) && !(await pg.$eval('[data-sm-q="13"]', b => b.classList.contains('p3'))));
  ok('번호에 영역·출제 의도', (await pg.getAttribute('[data-sm-q="14"]', 'title')) === '14번 · 독서(과학) · 세부 내용 적용하기');
  for (const n of [14, 21, 45, 33, 32, 7, 13, 5]) await pg.click('[data-sm-q="' + n + '"]');
  let live = (await pg.textContent('#smLive')).replace(/\s+/g, '');
  ok('자동 점수 100−(3+2+3+3+2+2+2+2)=81 · 2등급 · 표준점수 135', /^81점2등급·표준점수135·백분위약9[0-9]/.test(live), live);
  await pg.click('[data-sm-q="7"]');
  live = (await pg.textContent('#smLive')).replace(/\s+/g, '');
  ok('다시 누르면 83점 · 1등급(컷 83)', /^83점1등급·표준점수137·백분위약96/.test(live), live);
  await pg.click('#smSave'); await pg.waitForTimeout(400);
  ok('자동 계산 회차는 점수를 보내지 않음', CALLS[0] && CALLS[0].score === '', JSON.stringify(CALLS[0]));
  t = (await pg.textContent('#smBody')).replace(/\s+/g, ' ');
  ok('기록에 등급 줄', /1등급 · 표준점수 137 · 백분위 약 96/.test(t), t.slice(0, 300));
  await pg.click('.sm-det summary');
  const det = (await pg.textContent('.sm-det')).replace(/\s+/g, ' ');
  ok('틀린 문항 살펴보기: 영역·의도·배점·정답·전국 오답률', /틀린 문항 살펴보기 7개/.test(det) && /14번독서\(과학\) · 세부 내용 적용하기3점 · 정답 ③ · 전국 오답률 69.9%/.test(det), det.slice(0, 260));

  // ⑧ 별 내역 목록
  const src = await pg.evaluate(() => { STATE.stars = { total: 2, breakdown: { smock: 2 } }; renderStars(); return (document.querySelector('#starSec .st-src') || {}).textContent || ''; });
  ok('내 별 내역에 모의고사 리포트 입력', /모의고사 리포트 입력\s*2회/.test(src), src);

  ok('페이지 오류 없음', perr === 0);
  await br.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
