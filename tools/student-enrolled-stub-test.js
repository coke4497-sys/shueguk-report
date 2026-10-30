/* 재원여부(K열)만 고치는 studentEnrolledSet (2026-10-29) — 가짜 시트 왕복
 *   node tools/student-enrolled-stub-test.js */
const stub = require('./tt-twin-stub.js');
const { SHEETS, mkSheet, J } = stub;
const F = stub.fns;
let pass = 0, fail = 0;
const ok = (m, c, x) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (x ? ' ' + x : ''))); };
const HDR = ['학생ID', '이름', '학교', '학년', '담당교사', '메모', '정규가', '정규나', '내신진도', '내신확인', '재원여부', '접근코드'];
mkSheet(F.TAB_STUDENTS, [HDR,
  ['12345678', '심은빈', '도래울중', '2026 중등 3학년', '배선주', '메모1', '토4:30', '', '토4:30', '', '', 'k-sim'],
  ['22345678', '정지후', '백양고', '2026 고등 1학년', '김현지', '', '토11:00', '일11:00', '토11:00', '일11:00', '재원', 'k-jung'],
  ['32345678', '김퇴원', '화정고', '2026 고등 2학년', '', '', '', '', '', '', '퇴원', 'k-out']]);
const call = (o) => J(F.studentEnrolledSet(Object.assign({ pw: F.TEACHER_PW }, o)));
let r = J(F.studentEnrolledSet({ pw: 'x', items: [{ code: 'k-sim', enrolled: '재원' }] }));
ok('비밀번호 틀리면 거절', r.result === 'error' && SHEETS[F.TAB_STUDENTS][1][10] === '');
r = call({ items: [] });
ok('고칠 학생이 없으면 거절', r.result === 'error');
r = call({ items: [{ code: 'k-sim', enrolled: '재원' }, { code: 'k-none', enrolled: '재원' }] });
const rows = SHEETS[F.TAB_STUDENTS];
ok('빈 재원 칸 → 재원 · 없는 접근코드는 missing', r.result === 'success' && r.done.length === 1 && r.done[0].name === '심은빈' && r.missing.join() === 'k-none' && rows[1][10] === '재원', JSON.stringify(r));
ok('다른 열(이름·학교·시간표·접근코드)은 그대로', rows[1][1] === '심은빈' && rows[1][2] === '도래울중' && rows[1][6] === '토4:30' && rows[1][11] === 'k-sim' && rows[2][10] === '재원' && rows[3][10] === '퇴원', JSON.stringify(rows[1]));
r = call({ items: [{ code: 'k-out', enrolled: '' }] });
ok('빈 값으로도 쓸 수 있다(퇴원 → 빈)', r.result === 'success' && SHEETS[F.TAB_STUDENTS][3][10] === '', JSON.stringify(SHEETS[F.TAB_STUDENTS][3]));   // getDataRange 가 표를 새 배열로 바꾸므로 다시 읽는다
// 제출결과 빈 줄 지우기(submissionBlankDelete)
mkSheet(F.TAB_RESULT, [['제출일시','시험','학교','학년','이름','틀린문항수','틀린문항 · 반성','다음 시험 다짐','선생님의 한 마디','예상 점수','부모님 연락처'],
  ['2026-10-25 11:04:48','26-2-중간-화정중3-국어','화정중','3학년','허담',0,'','','','0','12345678'],
  ['2026-10-29 22:38:36','','','','',0,'','','','0',''],
  ['2026-10-29 23:00:00','','','','나이름',0,'','','','0','']]);
r = J(F.submissionBlankDelete({ pw: 'x' }));
ok('빈 줄 지우기 — 비밀번호 틀리면 거절', r.result === 'error' && SHEETS[F.TAB_RESULT].length === 4);
r = J(F.submissionBlankDelete({ pw: F.TEACHER_PW }));
ok('시험·이름이 모두 빈 줄만 지운다(1줄) — 이름만 있는 줄·정상 제출은 그대로', r.result === 'success' && r.deleted.length === 1 && r.deleted[0].ts === '2026-10-29 22:38:36' && SHEETS[F.TAB_RESULT].length === 3 && SHEETS[F.TAB_RESULT][1][4] === '허담' && SHEETS[F.TAB_RESULT][2][4] === '나이름', JSON.stringify(r));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
