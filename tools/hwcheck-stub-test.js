/* 숙제 검사 시트 사본 — 수업마다 따로(2026-09-28, 035) 왕복 검증. 가짜 시트(tt-twin-stub)로 backend-createReport.gs를 그대로 실행.
 * 실행: node tools/hwcheck-stub-test.js */
const stub = require('./tt-twin-stub');
let n = 0, bad = 0;
function ok(c, label) { n++; if (!c) { bad++; console.error('  ✗', label); } else console.log('  ✓', label); }
const F = stub.fns, PW = F.TEACHER_PW, T = F.TAB_HWCHECK;
// 035 이전 모양의 시트(14열) + 옛 기록 한 줄
stub.mkSheet(T, [['일시', '주차', '접근코드', '이름', '학교', '학년', '항목점수(JSON)', '만점', '점수%', '공개메모', '비공개메모', '상태', '대책', '대책완료'],
  [new Date(), '2026-09-16', 'tok-a', '박보검', '화정고', '고2', '{"숙제 수행":6,"오답 처리":6}', 12, 100, '옛 메모', '', '', '', '']]);
const base = { pw: PW, week: '2026-09-23', token: 'tok-a', name: '박보검', school: '화정고', grade: '고2' };
let r = stub.J(F.hwcheckSave(Object.assign({}, base, { cls: 'r010', part: '가', clsName: '고2 가', scores: { '숙제 수행': 6, '오답 처리': 6 } })));
ok(r.result === 'success' && r.pct === 100, '가 수업 저장');
ok(stub.SHEETS[T][0][14] === '반ID' && stub.SHEETS[T][0][16] === '반이름', '옛 시트에 O반ID·P수업·Q반이름 머리글 보충');
stub.J(F.hwcheckSave(Object.assign({}, base, { cls: 'r011', part: '나', clsName: '고2 나', scores: { '숙제 수행': 3, '오답 처리': 3 }, missing: '1', plan: '토 재검사' })));
ok(stub.SHEETS[T].length === 4, '나 수업은 새 줄(같은 주·같은 학생이어도)');
stub.J(F.hwcheckSave(Object.assign({}, base, { cls: 'r010', part: '가', clsName: '고2 가', scores: { '숙제 수행': 6, '오답 처리': 6 }, pub: '잘했어요' })));
ok(stub.SHEETS[T].length === 4 && stub.SHEETS[T][2][9] === '잘했어요', '같은 수업은 그 줄을 덮어씀');
const row = stub.SHEETS[T].find(x => x[14] === 'r011');
ok(row && row[15] === '나' && row[16] === '고2 나' && row[11] === '미제출' && row[8] === 0, '나 수업 줄: 반ID·수업·반이름·미제출 0%');
// 교사 화면용 조회 — 학생마다 수업별 목록
let d = F.hwcheckData_('2026-09-23');
ok(Array.isArray(d.records['tok-a']) && d.records['tok-a'].length === 2 && d.records['tok-a'].some(x => x.cls === 'r010' && x.part === '가' && x.pct === 100), '주차 조회 = 수업별 목록 2개');
// 학생 페이지·별
const list = F.collectHwchecks_(SpreadsheetApp.getActiveSpreadsheet(), 'tok-a');
ok(list.length === 3 && list.some(x => x.week === '2026-09-16' && x.cls === ''), '학생 기록 3줄(옛 기록은 반 구분 전)');
ok(F.countHwcheckPerfect_(SpreadsheetApp.getActiveSpreadsheet(), 'tok-a') === 2, '만점 별 = 옛 주 1 + 가 수업 1 (나 수업 미제출 제외)');
stub.J(F.hwcheckSave(Object.assign({}, base, { cls: 'r011', part: '나', clsName: '고2 나', scores: { '숙제 수행': 6, '오답 처리': 6 } })));
ok(F.countHwcheckPerfect_(SpreadsheetApp.getActiveSpreadsheet(), 'tok-a') === 3, '같은 주 가·나 모두 만점이면 별 2개(합계 3)');
// 대책 목록·완료 표시
stub.J(F.hwcheckSave(Object.assign({}, base, { cls: 'r011', part: '나', clsName: '고2 나', scores: { '숙제 수행': 0, '오답 처리': 0 }, missing: '1', plan: '토 재검사' })));
const plans = stub.J(F.getHwcheckPlans()).plans;
ok(plans.length === 1 && plans[0].cls === 'r011' && plans[0].part === '나', '대책 목록에 반ID·수업');
r = stub.J(F.hwcheckPlanDone({ pw: PW, week: '2026-09-23', token: 'tok-a', cls: 'r011', done: '1' }));
ok(r.result === 'success' && stub.SHEETS[T].find(x => x[14] === 'r011')[13] === '완료' && stub.SHEETS[T].find(x => x[14] === 'r010')[13] === '', '완료 표시는 그 수업 줄만');
r = stub.J(F.hwcheckPlanDone({ pw: PW, week: '2026-09-23', token: 'tok-a', cls: 'r999', done: '1' }));
ok(r.result === 'error', '없는 수업이면 오류');
// cls 없이 저장(옛 페이지·폴백) = 반 구분 전 줄 하나
stub.J(F.hwcheckSave(Object.assign({}, base, { scores: { '숙제 수행': 2 } })));
ok(stub.SHEETS[T].filter(x => x[1] === '2026-09-23').length === 3 && stub.SHEETS[T].some(x => x[2] === 'tok-a' && x[14] === '' && String(x[1]).includes('09-23')), 'cls 없이 저장하면 반 구분 전 줄');
// 항목마다 만점이 다름(2026-10-01 — 학습량 5 · 채점 등 2): maxes 를 보내면 그대로 만점 합
r = stub.J(F.hwcheckSave(Object.assign({}, base, { cls: 'r020', part: '가', clsName: '고1 가', itemMax: 5,
  scores: { 'A (학습량)': 5, 'A (채점)': 2, 'A (학습 분석)': 2, 'A (오답 분석)': 2 },
  maxes: { 'A (학습량)': 5, 'A (채점)': 2, 'A (학습 분석)': 2, 'A (오답 분석)': 2 } })));
ok(r.result === 'success' && r.pct === 100 && stub.SHEETS[T].find(x => x[14] === 'r020')[7] === 11, '항목별 만점 — 5·완벽 셋 = 100%, 만점 합 11');
r = stub.J(F.hwcheckSave(Object.assign({}, base, { cls: 'r020', part: '가', clsName: '고1 가', itemMax: 5,
  scores: { 'A (학습량)': 4, 'A (채점)': 9 }, maxes: { 'A (학습량)': 5, 'A (채점)': 2 } })));
ok(r.pct === 86, '3단계 점수는 2로 자름 — (4+2)/7 = 86%');
console.log(bad ? `실패 ${bad} / ${n}` : `전부 통과 (${n}건)`); process.exit(bad ? 1 : 0);
