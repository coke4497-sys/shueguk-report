#!/usr/bin/env node
/* 백엔드 addStarBonus 의 dedupe('시험 별 한꺼번에 주기', 2026-10-06) 검증 — 가짜 시트로 backend-createReport.gs 를 그대로 실행.
 *   node tools/star-bonus-stub-test.js
 * 같은 학생(이름·학교)·같은 사유는 한 번만, 이름 표기(끝 A·괄호)가 달라도 같은 사람, dedupe 없는 옛 호출은 그대로. */
const stub = require('./tt-twin-stub.js');
const { SHEETS, mkSheet, J } = stub;
const F = stub.fns;
function SpreadsheetAppSS(){ return global.SpreadsheetApp ? global.SpreadsheetApp.getActiveSpreadsheet() : null; }
let pass = 0, fail = 0;
const ok = (m, c, x) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (x ? ' ' + x : ''))); };
mkSheet(F.TAB_STARS, [['일시', '학생ID', '이름', '학교', '별', '사유', '학년']]);
const rows = () => SHEETS[F.TAB_STARS].length - 1;
const call = (o) => J(F.addStarBonus(Object.assign({ pw: F.TEACHER_PW }, o)));

let r = call({ name: '박보검', school: '화정고', grade: '2026 고등 1학년', stars: 2, reason: '26년 2학기 중간고사 1등급', dedupe: '1' });
ok('처음 — 저장(dup 없음)', r.result === 'success' && !r.dup && rows() === 1, JSON.stringify(r));
r = call({ name: '박보검', school: '화정고', grade: '2026 고등 1학년', stars: 2, reason: '26년 2학기 중간고사 1등급', dedupe: '1' });
ok('같은 학생·사유 다시 — dup:true, 줄 안 늘어남', r.result === 'success' && r.dup === true && rows() === 1, JSON.stringify(r));
r = call({ name: '박보검A', school: '화정고', stars: 2, reason: '26년 2학기 중간고사 1등급', dedupe: '1' });
ok('이름 뒤 A 가 붙어도 같은 사람 — dup', r.dup === true && rows() === 1);
r = call({ name: '박보검(8/30부터)', school: '화정고', stars: 2, reason: '26년 2학기 중간고사 1등급', dedupe: '1' });
ok('뒤 괄호 표기가 붙어도 같은 사람 — dup', r.dup === true && rows() === 1);
r = call({ name: '박보검B', school: '화정고', stars: 2, reason: '26년 2학기 중간고사 1등급', dedupe: '1' });
ok('B 는 다른 사람 — 저장', !r.dup && rows() === 2);
r = call({ name: '박보검', school: '화정고', stars: 3, reason: '26년 2학기 중간고사 전교권 슈퍼스타', dedupe: '1' });
ok('같은 학생 다른 사유 — 저장', !r.dup && rows() === 3);
r = call({ name: '박보검', school: '서정고', stars: 2, reason: '26년 2학기 중간고사 1등급', dedupe: '1' });
ok('같은 이름 다른 학교 — 저장', !r.dup && rows() === 4);
r = call({ name: '박보검', school: '화정고', stars: 2, reason: '26년 2학기 중간고사 1등급' });
ok('dedupe 없는 옛 호출(깜짝 보너스)은 그대로 저장', r.result === 'success' && !r.dup && rows() === 5);
r = call({ name: '박보검', school: '화정고', stars: 1, reason: '', dedupe: '1' });
ok('사유가 비면 dedupe 를 안 건다(그대로 저장)', r.result === 'success' && !r.dup && rows() === 6);
ok('starKey_ — 앞뒤 괄호·끝 A 제거, B 유지', F.starKey_('(화정)김하늘A') === '김하늘' && F.starKey_('김하늘B') === '김하늘B' && F.starKey_('A') === 'A');

// 별을 준 선생님(050, 2026-10-14) — H열 '보낸사람'
r = call({ name: '김하늘', school: '화정고', grade: '2026 고등 2학년', stars: 3, reason: '수업 태도', by: '김현지' });
const last = SHEETS[F.TAB_STARS][SHEETS[F.TAB_STARS].length - 1];
ok('by → H열 보낸사람', r.result === 'success' && last[7] === '김현지', JSON.stringify(last));
ok('머리글 H열 보낸사람 보충', SHEETS[F.TAB_STARS][0][7] === '보낸사람', JSON.stringify(SHEETS[F.TAB_STARS][0]));
r = call({ name: '이소율', school: '화정고', stars: 1, reason: '' });
ok('by 없는 옛 호출 — H열 빈 값', SHEETS[F.TAB_STARS][SHEETS[F.TAB_STARS].length - 1][7] === '');
if (F.starLogData_) {
  const lg = F.starLogData_();
  ok('starLog 에 giver', lg.some(g => g.name === '김하늘' && g.giver === '김현지'), JSON.stringify(lg.slice(0, 3)));
}
if (F.sumBonus_) {
  const sb = F.sumBonus_(SpreadsheetAppSS(), '', '김하늘', '화정고', '2026 고등 2학년', true);
  ok('학생 최근 보너스 giver', sb.latest && sb.latest.giver === '김현지', JSON.stringify(sb));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
