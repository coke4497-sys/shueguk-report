/* 수정 요청함 + 문법 오류 제보(grammaReport) 왕복 검증 — 가짜 시트(tt-twin-stub)로 backend-createReport.gs를 그대로 실행.
 * 실행: node tools/editreq-stub-test.js */
const stub = require('./tt-twin-stub');
let n = 0, bad = 0;
function ok(c, label) { n++; if (!c) { bad++; console.error('  ✗', label); } else console.log('  ✓', label); }
const notes = [];
global.UrlFetchApp = { fetch: (url, opt) => { notes.push({ url, body: JSON.parse(opt.payload) }); return { getResponseCode: () => 201, getContentText: () => '' }; } };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => k === 'GH_TOKEN' ? 'tok' : null, setProperty() {} }) };
const F = stub.fns;
// 시트 없음 → grammaReport가 탭을 만들고 한 줄
let r = stub.J(F.grammaReport({ name: '박검증', school: '화정고', grade: '고1', cat: '형태소', level: '레벨1', round: '3', qno: '12', start: '단어와 형태소의 수를…', kind: '정답이 틀린 것 같아요', text: "단어는 형태소보다 적거나 같아야 해요", mine: '적거나 같다', answer: '많거나 같다' }));
ok(r.result === 'success', '학생 제보 등록(비밀번호 없음)');
let list = stub.J(F.getEditReqList()).reqs;
ok(list.length === 1 && list[0].screen === '문법 테스트' && list[0].status === '접수됨', "화면 '문법 테스트' · 접수됨");
ok(list[0].writer === '박검증 (화정고 고1)', '작성자 = 이름 (학교 학년)');
ok(list[0].text.startsWith('[형태소 레벨1 · 스테이지 3 · 12번 단어와 형태소의 수를…]\n종류: 정답이 틀린 것 같아요\n내용: 단어는 형태소보다') && list[0].text.includes('내 답: 적거나 같다 / 정답: 많거나 같다'), '내용 = 위치·종류·내용·내 답/정답');
ok(notes.length === 1 && notes[0].url.includes('/issues/329/comments') && notes[0].body.body.startsWith('[문법 오류 제보 접수]') && notes[0].body.body.includes('박검증'), '즉시 알림: PR #329 댓글, 문법 제보 머리글');
// 미리보기(선생님)
r = stub.J(F.grammaReport({ preview: true, name: 'x', cat: '음운', round: '1', qno: '2', kind: '오타', text: '해설 오타' }));
list = stub.J(F.getEditReqList()).reqs;
ok(r.result === 'success' && list[0].writer === '선생님(미리보기)' && list[0].text === '[음운 · 스테이지 1 · 2번]\n종류: 오타\n내용: 해설 오타', '미리보기 제보 = 선생님(미리보기), 내 답 줄 없음');
// 빈 내용 거절·길이 제한·줄바꿈 제거
r = stub.J(F.grammaReport({ name: '박검증', text: '   ' }));
ok(r.result === 'error' && stub.J(F.getEditReqList()).reqs.length === 2, '내용이 비면 거절');
r = stub.J(F.grammaReport({ name: 'a'.repeat(80), school: 'b'.repeat(80), cat: 'c\nd', round: '1', qno: '1', kind: 'k', text: 't'.repeat(900) }));
list = stub.J(F.getEditReqList()).reqs;
ok(list[0].writer.length <= 20 + 3 + 20 + 10 + 1 && !list[0].text.includes('c\nd') && list[0].text.length < 600, '길이 제한·위치 줄바꿈 제거');
// 교사 편에서 상태 변경(editReqSet) — 보류 + 메모
r = stub.J(F.editReqSet({ pw: F.TEACHER_PW, row: list[2].row, ts: list[2].ts, status: '보류', note: '클로슈 확인: 제보가 맞아요' }));
list = stub.J(F.getEditReqList()).reqs;
ok(r.result === 'success' && list[2].status === '보류' && list[2].note === '클로슈 확인: 제보가 맞아요', '보류 + 처리메모');
// 기존 editReqAdd는 비밀번호 필요 그대로
r = stub.J(F.editReqAdd({ writer: '조교', screen: '전체 시간표', text: '테스트' }));
ok(r.result === 'error', 'editReqAdd는 비밀번호 없으면 거절(종전 그대로)');
r = stub.J(F.editReqAdd({ pw: F.TEACHER_PW, writer: '조교', screen: '전체 시간표', text: '테스트' }));
ok(r.result === 'success' && notes[notes.length - 1].body.body.startsWith('[수정 요청 접수]'), 'editReqAdd 등록 + 옛 머리글 알림');
console.log(bad ? `실패 ${bad} / ${n}` : `전부 통과 (${n}건)`); process.exit(bad ? 1 : 0);
