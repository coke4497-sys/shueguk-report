/* 수업 기록 보기(classlog.html, 2026-10-03) — 가짜 수파베이스 응답으로 실제 페이지를 띄워
 * 수업 카드·기록 없는 수업·다섯 가지 보기·과제 검사 표·비공개 항목·칭찬/요주의를 확인한다.
 *   NODE_PATH=$(npm root -g) node tools/classlog-e2e.js
 * 시계는 2026-10-03 (토) 16:00 으로 고정 — 이번 주 = 9/30 (수) ~ 10/6 (화).
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
const CLASSES = [
  { book: '정규', class_id: 'r001', name: '고2 가', day: '수', start_time: '5:30', end_time: '7:00', teacher: '현지', location: '본원', roster: '김하늘 박보검 (화정)이서연' },
  { book: '정규', class_id: 'r002', name: '고1 나', day: '목', start_time: '5:30', end_time: '7:00', teacher: '은지', location: '본원', roster: '최민준 정다은' },
  { book: '정규', class_id: 'r003', name: '정리정독 중3', day: '금', start_time: '4:30', end_time: '6:00', teacher: '승연', location: '본원', roster: '한지우' },
  { book: '정규', class_id: 'r004', name: '고2 나', day: '토', start_time: '오전10:00', end_time: '오전11:30', teacher: '현지', location: '본원', roster: '김하늘' },
  { book: '정규', class_id: 'r005', name: '고1 가', day: '토', start_time: '8:00', end_time: '9:30', teacher: '은지', location: '본원', roster: '최민준' },
  { book: '내신', class_id: 'n001', name: '고2 화정A(천재 문학)', day: '수', start_time: '5:30', end_time: '7:00', teacher: '현지', location: '본원', roster: '김하늘' }
];
const STUDENTS = [
  { name: '김하늘', school: '화정고', grade: '2026 고등 2학년', code: 'c1', teacher: '이현지', enrolled: '' },
  { name: '박보검', school: '서정고', grade: '2026 고등 2학년', code: 'c2', teacher: '이현지', enrolled: '' },
  { name: '이서연', school: '화정고', grade: '2026 고등 2학년', code: 'c3', teacher: '이현지', enrolled: '' },
  { name: '최민준', school: '화수고', grade: '2026 고등 1학년', code: 'c4', teacher: '김지원', enrolled: '' },
  { name: '정다은', school: '화수고', grade: '2026 고등 1학년', code: 'c5', teacher: '김지원', enrolled: '' },
  { name: '한지우', school: '서정중', grade: '2026 중등 3학년', code: 'c6', teacher: '이승연', enrolled: '' }
];
const NOTES = [
  { book: '정규', class_id: 'r001', ymd: '2026-09-30', part: '가', progress: '관동별곡 2강', units: [], homework: '관동별곡 학습지\n문장의 짜임 10문제',
    comments: { '김하늘': '발표를 잘했어요.', '__태도': { '김하늘': '매우 좋음', '박보검': '노력 필요' }, '__베낌': { '박보검': ['서정갈래 데일리'] }, '__검사과제': '서정갈래 데일리' },
    report_status: '공개' },
  { book: '정규', class_id: 'r003', ymd: '2026-10-02', part: '정규', progress: '문장의 짜임', units: [], homework: '', comments: { '__태도': { '한지우': '매우 좋음' } }, report_status: '요청' }
];
const HW = [
  { week: '2026-09-30', token: 'c1', class_id: 'r001', name: '김하늘', school: '화정고', grade: '고2', scores: { '서정갈래 데일리 (학습량)': 5, '서정갈래 데일리 (채점)': 2, '서정갈래 데일리 (학습 분석)': 2, '서정갈래 데일리 (오답 분석)': 2 }, pct: 100, missing: false, missing_items: [], plan: '', priv: '집중력이 좋아짐' },
  { week: '2026-09-30', token: 'c2', class_id: 'r001', name: '박보검', school: '서정고', grade: '고2', scores: {}, pct: 0, missing: true, missing_items: ['서정갈래 데일리'], plan: '다음 수업 재검사', priv: '' },
  { week: '2026-09-30', token: 'c6', class_id: 'r003', name: '한지우', school: '서정중', grade: '중3', scores: { '문장 (학습량)': 5, '문장 (채점)': 2, '문장 (학습 분석)': 2, '문장 (오답 분석)': 2 }, pct: 100, missing: false, missing_items: [], plan: '', priv: '' }
];
const ATT = [
  { date: '2026-09-30', book: '정규', class_id: 'r001', student: '김하늘', status: '출석', memo: '' },
  { date: '2026-09-30', book: '정규', class_id: 'r001', student: '박보검', status: '지각', memo: '10분' },
  { date: '2026-10-02', book: '정규', class_id: 'r003', student: '한지우', status: '출석', memo: '' },
  { date: '2026-10-01', book: '정규', class_id: 'r002', student: '최민준', status: '결석', memo: '병결' }
];
const LOGS = [];
(async () => {
  const srv = await serve(), port = srv.address().port;
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 900, height: 1600 } });
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date('2026-10-03T16:00:00'));
  let perr = 0; const urls = [];
  p.on('pageerror', e => { perr++; console.log('  ✗ pageerror', e.message); });
  await p.route('**/*', rt => {
    const u = rt.request().url();
    const j = o => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
    if (/\/auth\/v1\/token/.test(u)) return j({ access_token: 'tok', expires_in: 3600 });
    if (/\/rest\/v1\//.test(u)) urls.push(decodeURIComponent(u));
    if (/\/rest\/v1\/tt_classes/.test(u)) return j(CLASSES);
    if (/\/rest\/v1\/tt_period/.test(u)) return j([{ week_wednesday: '2026-09-30', book: '정규' }]);
    if (/\/rest\/v1\/students/.test(u)) return j(STUDENTS);
    if (/\/rest\/v1\/class_notes/.test(u)) return j(NOTES);
    if (/\/rest\/v1\/hwcheck_records/.test(u)) return j(HW);
    if (/\/rest\/v1\/attendance/.test(u)) return j(ATT);
    if (/\/rest\/v1\/tt_log/.test(u)) return j(LOGS);
    if (/\/rest\/v1\/teacher_accounts/.test(u)) return j([]);
    return rt.fulfill({ status: 204, body: '' });
  });
  await p.goto('http://127.0.0.1:' + port + '/classlog.html');
  await p.waitForFunction(() => /수업 \d+개/.test(document.getElementById('status').textContent), null, { timeout: 8000 });

  // ① 이번 주 기본 · 요청 범위
  let r = await p.textContent('#status');
  ok('기간 기본 = 이번 주 9/30 (수) ~ 10/6 (화)', /9\/30 \(수\) ~ 10\/6 \(화\)/.test(r), r);
  ok('class_notes 를 이번 주 범위로 조회', urls.some(u => /class_notes\?.*ymd=gte\.2026-09-30&ymd=lte\.2026-10-06/.test(u)));
  ok('과제 검사는 반 구분 있는 기록만(class_id=neq.)', urls.some(u => /hwcheck_records\?.*class_id=neq\.&/.test(u)));

  // ② 카드 — 기록·출석만·기록 없음
  r = await p.$$eval('.card', cs => cs.map(c => c.querySelector('.nm').textContent + '|' + c.querySelector('.right').textContent));
  ok('기록한 수업 카드 + 리포트 공개 표시', r.some(t => /^고2 가\|리포트 공개/.test(t)), JSON.stringify(r));
  ok('출석만 있는 수업 = "수업 기록 없음 · 출석만"', r.some(t => /^고1 나\|수업 기록 없음 · 출석만/.test(t)));
  ok('시간표에만 있는 지난 수업 = "기록 없음" (토 오전 고2 나)', r.some(t => /^고2 나\|기록 없음/.test(t)));
  ok('아직 끝나지 않은 오늘 수업(토 8:00)은 기록 없음으로 안 잡힘', !r.some(t => /^고1 가\|/.test(t)));
  ok('그 주 기간이 정규면 내신 반은 기록 없음으로 안 잡힘', !r.some(t => /화정A/.test(t)));
  r = await p.textContent('#tiles');
  ok('요약 타일 — 기록한 수업 2 · 리포트 공개 1 · 기록 없는 수업 2', /2기록한 수업1리포트 공개2기록 없는 수업/.test(r), r);

  // ③ 펼치기 — 진도·과제·학생 줄
  await p.click('.card[data-key="정규|r001|2026-09-30"] .ch');
  r = await p.textContent('.card[data-key="정규|r001|2026-09-30"]');
  ok('펼치면 수업 내용·다음 수업까지 과제·반 전체 검사 과제', /관동별곡 2강/.test(r) && /다음 수업까지 과제/.test(r) && /반 전체 검사 과제서정갈래 데일리/.test(r), r.slice(0, 300));
  ok('학생 줄 — 출석·태도·과제 검사 100% ★·코멘트', /김하늘화정고 고2출석태도 매우 좋음과제 검사 100% ★/.test(r) && /발표를 잘했어요/.test(r));
  ok('과제 검사 표 — 학습량 5/5 · 완벽', /서정갈래 데일리5\/5완벽완벽완벽/.test(r));
  ok('미제출 학생 — 지각 메모·과제 미제출·대책', /박보검서정고 고2지각 10분태도 노력 필요과제 미제출/.test(r) && /미제출 대책다음 수업 재검사/.test(r));
  ok('베낌 의심·비공개 메모는 "비공개" 표시와 함께', /베낌 의심 1 · 비공개/.test(r) && /베낌 의심 · 비공개서정갈래 데일리/.test(r) && /비공개 메모집중력이 좋아짐/.test(r));
  ok('명단에만 있고 기록 없는 학생 = 출석 미체크 (앞 괄호 학교 뗀 이름)', /이서연화정고 고2출석 미체크/.test(r));
  r = await p.textContent('.card[data-key="정규|r001|2026-09-30"] .prog');
  ok('기록 현황 — 출석 2/3 · 태도 2/3 · 과제 검사 2/3', /출석 2\/3 · 태도 2\/3 · 과제 검사 2\/3/.test(r), r);

  // ④ 다섯 가지 보기
  await p.click('[data-view="teacher"]'); await p.selectOption('#subSel', '현지');
  r = await p.$$eval('.card .nm', a => a.map(x => x.textContent));
  ok('담당 선생님별 — 현지T 수업만', r.length === 2 && r.every(t => /고2/.test(t)), JSON.stringify(r));
  await p.click('[data-view="grade"]'); await p.selectOption('#subSel', '중3');
  r = await p.$$eval('.card .nm', a => a.map(x => x.textContent));
  ok('학년 — 중3 수업만', r.length === 1 && r[0] === '정리정독 중3', JSON.stringify(r));
  await p.click('[data-view="school"]'); await p.selectOption('#subSel', '서정고');
  r = await p.$$eval('.card', cs => cs.map(c => c.querySelector('.nm').textContent + '|' + c.querySelector('.meta').textContent));
  ok('학교 — 서정고 학생이 있는 수업만 · "이 중 1명"', r.length === 1 && /고2 가\|.*이 중 1명/.test(r[0]), JSON.stringify(r));
  if (!(await p.$('.card .cb'))) await p.click('.card .ch');   // ③에서 펼친 카드라 이미 열려 있다
  r = await p.$$eval('.card .stu .sn', a => a.map(x => x.textContent));
  ok('학교 보기 — 펼치면 그 학교 학생 줄만', r.length === 1 && r[0] === '박보검', JSON.stringify(r));
  await p.click('[data-view="person"]'); await p.fill('#subIn', '한지우');
  r = await p.$$eval('.card .stu .sn', a => a.map(x => x.textContent));
  ok('개인 — 그 학생 수업이 펼쳐진 채로', r.length === 1 && r[0] === '한지우', JSON.stringify(r));
  await p.click('[data-view="all"]');

  // ⑤ 기록 없는 수업 숨기기
  await p.uncheck('#showNone');
  r = await p.$$eval('.card .nm', a => a.map(x => x.textContent));
  ok('"기록 없는 수업도 보기"를 끄면 수업 기록 있는 카드만', r.length === 2, JSON.stringify(r));
  await p.check('#showNone');

  // ⑥ 칭찬 · 요주의
  await p.click('[data-tab="pc"]');
  r = await p.textContent('#pcView');
  ok('관리가 필요해요 — 박보검 태도 노력 필요·베낌 의심·평균 0%', /박보검서정고 고2.*태도 노력 필요 1회.*베낌 의심 1건 · 비공개.*과제 검사 평균 0%/.test(r), r.slice(0, 400));
  ok('결석 1회만인 학생은 요주의 아님(결석+지각 2회 기준)', !/최민준/.test(r));
  await p.click('.pc[data-person="박보검"]');
  r = await p.evaluate(() => ({ v: document.querySelector('#subIn') && document.querySelector('#subIn').value, n: document.querySelectorAll('.card').length, tab: !!document.querySelector('[data-tab="rec"].on') }));
  ok('이름을 누르면 수업 기록 탭 · 개인 보기로 이동', r.v === '박보검' && r.n === 1 && r.tab, JSON.stringify(r));

  // ⑦ 기간 바꾸기 → 다시 조회
  urls.length = 0;
  await p.click('[data-per="last"]');
  await p.waitForFunction(() => /9\/23/.test(document.getElementById('status').textContent), null, { timeout: 5000 });
  ok('지난주 = 9/23 ~ 9/29 로 다시 조회', urls.some(u => /ymd=gte\.2026-09-23&ymd=lte\.2026-09-29/.test(u)));

  // ⑧ 휴대폰
  await p.setViewportSize({ width: 390, height: 1400 });
  r = await p.evaluate(() => document.documentElement.scrollWidth <= 390);
  ok('휴대폰 폭에서 가로 스크롤 없음', r);

  ok('페이지 오류 없음', perr === 0);
  await br.close(); srv.close();
  console.log('\n' + pass + ' 통과, ' + fail + ' 실패');
  process.exit(fail ? 1 : 0);
})();
