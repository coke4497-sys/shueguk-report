#!/usr/bin/env node
/* 백엔드 시트 사본 — 슈국 캘린더 학년별 예외(D열 '학년예외' JSON) 저장·조회 (2026-10-11, 047)
 *   node tools/period-ov-stub-test.js */
const S = require('./tt-twin-stub.js');
const F = S.fns;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
const PW = F.TEACHER_PW;
S.mkSheet(F.TAB_TT_PERIOD, [['주차수요일', '구분', '기록일시']]);   // 옛 시트(3열)
let r = S.J(F.ttPeriodSet({ pw: PW, week: '2026-10-14', book: '내신', ov: { '중2': '정규' } }));
ok('예외와 함께 저장', r.result === 'success', JSON.stringify(r));
ok('옛 시트에 D열 머리글 보충', S.SHEETS[F.TAB_TT_PERIOD][0][3] === '학년예외');
let d = F.ttPeriodData_();
ok('조회에 ov가 실린다', d.length === 1 && d[0].week === '2026-10-14' && d[0].book === '내신' && JSON.stringify(d[0].ov) === '{"중2":"정규"}', JSON.stringify(d));
r = S.J(F.ttPeriodSet({ pw: PW, week: '2026-10-14', book: '정규' }));   // ov 없이 구분만 바꿈
d = F.ttPeriodData_();
ok('ov를 안 보내면 D열 그대로', r.result === 'success' && d[0].book === '정규' && JSON.stringify(d[0].ov) === '{"중2":"정규"}', JSON.stringify(d));
r = S.J(F.ttPeriodSet({ pw: PW, week: '2026-10-14', book: '정규', ov: {} }));
d = F.ttPeriodData_();
ok('빈 ov = 예외 지움', JSON.stringify(d[0].ov) === '{}', JSON.stringify(d));
r = S.J(F.ttPeriodSet({ pw: PW, week: '2026-10-21', book: '내신', ov: { '중2': '정규' } }));
ok('새 줄도 D열까지', S.SHEETS[F.TAB_TT_PERIOD].length === 3 && S.SHEETS[F.TAB_TT_PERIOD][2][3] === '{"중2":"정규"}', JSON.stringify(S.SHEETS[F.TAB_TT_PERIOD]));
r = S.J(F.ttPeriodSet({ pw: PW, week: '2026-10-21', book: '내신', ov: { '중9': '정규' } }));
ok('잘못된 학년은 거절', r.result === 'error' && /모양/.test(r.message), JSON.stringify(r));
r = S.J(F.ttPeriodSet({ pw: PW, week: '2026-10-21', book: '내신', ov: { '고1': '방학' } }));
ok('잘못된 구분은 거절', r.result === 'error', JSON.stringify(r));
r = S.J(F.ttPeriodSet({ pw: PW, week: '2026-10-21', book: '' }));
ok('구분 빈 값 = 줄 삭제(예외도 함께)', r.result === 'success' && F.ttPeriodData_().length === 1);
r = S.J(F.ttPeriodSet({ pw: 'x', week: '2026-10-21', book: '내신', ov: {} }));
ok('비밀번호 없으면 거절', r.result === 'error');
console.log(fail ? ('통과 ' + pass + ' / 실패 ' + fail) : ('✓ ' + pass + '건 통과'));
process.exit(fail ? 1 : 0);
