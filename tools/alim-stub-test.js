#!/usr/bin/env node
/* 카카오 알림톡(솔라피) 백엔드 검증 — 실행: node tools/alim-stub-test.js
 * 가짜 시트·속성·UrlFetchApp으로 backend-createReport.gs의 alimSend/alimConfigGet/alimConfigSet/alimLogGet을 그대로 돌린다.
 * 확인: 설정 전 거절 · 쓰기 전용 설정 · HMAC 서명(노드 crypto와 대조) · 페이로드 모양 · 문자 대체 발송 여부 ·
 *       기록 줄 · 부분 실패 · HTTP 오류 · 중복 차단(force) · 번호 형식 · 기록 조회 범위. */
const crypto = require('crypto');
const S = require('./tt-twin-stub.js');
const { SHEETS, mkSheet, J, fns } = S;

/* 속성 저장소·UUID·HMAC·UrlFetch 흉내 */
const PROPS = {};
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: (k) => (k in PROPS ? PROPS[k] : null),
  setProperty(k, v){ PROPS[k] = String(v); }, deleteProperty(k){ delete PROPS[k]; } }) };
global.Utilities.getUuid = () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
global.Utilities.computeHmacSha256Signature = (msg, key) => Array.from(crypto.createHmac('sha256', key).update(msg).digest()).map(b => (b > 127 ? b - 256 : b));
global.Utilities.formatDate = (d, tz, f) => {
  const p = n => String(n).padStart(2, '0');
  const ymd = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  if (f === 'yyyy-MM-dd') return ymd;
  if (f === 'yyyy-MM-dd HH:mm') return ymd + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  return d.getHours() + ':' + p(d.getMinutes());
};
let CALLS = [], NEXT = { code: 200, body: { groupInfo: { _id: 'G1' }, failedMessageList: [] } };
global.UrlFetchApp = { fetch: (url, opt) => { CALLS.push({ url, opt }); const n = NEXT;
  if (n.throw) throw new Error(n.throw);
  return { getResponseCode: () => n.code, getContentText: () => JSON.stringify(n.body) }; } };

let fail = 0;
function eq(label, got, want){ const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++;
  console.log((ok ? '  ok  ' : '  FAIL') + '  ' + label + (ok ? '' : '  → ' + JSON.stringify(got) + ' (기대: ' + JSON.stringify(want) + ')')); }
function reset(){ for (const k of Object.keys(SHEETS)) delete SHEETS[k]; for (const k of Object.keys(PROPS)) delete PROPS[k]; CALLS = [];
  NEXT = { code: 200, body: { groupInfo: { _id: 'G1' }, failedMessageList: [] } }; }
const item = (student, to, date, extra) => Object.assign({ student, to, who: '학부모1', cls: '고1 가', date,
  vars: { 학생명: student, 수업일: '9/11(금) 5:30', 반이름: '고1 가' } }, extra || {});

console.log('1) 설정 전');
reset();
let r = J(fns.alimConfigGet());
eq('ready=false', r.ready, false); eq('템플릿 문구 포함', typeof r.templates.absent.text, 'string'); eq('템플릿 ready=false', r.templates.absent.ready, false);
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김하나', '01012345678', '2026-09-11')] }));
eq('발송 거절(설정 없음)', r.result, 'error'); eq('시트 안 만듦', SHEETS['알림톡기록'], undefined); eq('UrlFetch 안 부름', CALLS.length, 0);
eq('비번 없으면 거절', J(fns.alimConfigSet({ apiKey: 'x' })).result, 'error');

console.log('2) 설정 저장(쓰기 전용)');
r = J(fns.alimConfigSet({ pw: 'sh', apiKey: 'KEY1', apiSecret: 'SEC1', pfId: 'PF1', from: '031-123-4567', tpl: { absent: 'KA01TP1' } }));
eq('saved 목록', r.saved, ['apiKey', 'apiSecret', 'from', 'pfId', 'tpl.absent']);
eq('발신번호 숫자만', PROPS.SOLAPI_FROM, '0311234567');
r = J(fns.alimConfigGet());
eq('ready=true', r.ready, true); eq('smsFallback=true', r.smsFallback, true); eq('템플릿 ready', r.templates.absent.ready, true);
eq('응답에 키 값 없음', JSON.stringify(r).indexOf('KEY1') < 0 && JSON.stringify(r).indexOf('SEC1') < 0, true);
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김하나', '01012345678', '2026-09-11')] }));
eq('템플릿 있음 → 성공', r.result, 'success');

console.log('3) 서명·페이로드');
reset();
fns.alimConfigSet({ pw: 'sh', apiKey: 'KEY1', apiSecret: 'SEC1', pfId: 'PF1', tpl: { absent: 'KA01TP1' } });
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김하나', '010-1234-5678', '2026-09-11')] }));
eq('성공 1건', [r.okCount, r.failCount], [1, 0]);
const c = CALLS[0];
eq('솔라피 주소', c.url, 'https://api.solapi.com/messages/v4/send-many/detail');
const auth = c.opt.headers.Authorization;
const m = auth.match(/^HMAC-SHA256 apiKey=(\S+), date=(\S+), salt=(\S+), signature=([0-9a-f]{64})$/);
eq('인증 헤더 형식', !!m, true);
if (m){ const want = crypto.createHmac('sha256', 'SEC1').update(m[2] + m[3]).digest('hex');
  eq('서명 = HMAC(date+salt, secret) hex', m[4], want); eq('apiKey', m[1], 'KEY1'); eq('salt = uuid에서 - 제거', m[3], 'aaaaaaaabbbbccccddddeeeeeeeeeeee'); }
const body = JSON.parse(c.opt.payload);
eq('메시지 1개', body.messages.length, 1);
eq('to 숫자만', body.messages[0].to, '01012345678');
eq('type ATA', body.messages[0].type, 'ATA');
eq('from 없으면 문자 대체 끔', [body.messages[0].from, body.messages[0].kakaoOptions.disableSms], [undefined, true]);
eq('kakaoOptions', [body.messages[0].kakaoOptions.pfId, body.messages[0].kakaoOptions.templateId], ['PF1', 'KA01TP1']);
eq('변수 #{} 형식·순서', body.messages[0].kakaoOptions.variables, { '#{학생명}': '김하나', '#{수업일}': '9/11(금) 5:30', '#{반이름}': '고1 가' });
const rows = SHEETS['알림톡기록'];
eq('기록 1줄', rows.length, 2);
eq('기록 내용', rows[1].slice(1), ['absent', '김하나', '학부모1', '01012345678', '고1 가', '2026-09-11', '성공', '', 'G1']);

console.log('4) 발신번호 있으면 문자 대체');
fns.alimConfigSet({ pw: 'sh', from: '01099998888' });
fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김둘', '01000000002', '2026-09-11')] });
const b4 = JSON.parse(CALLS[1].opt.payload).messages[0];
eq('from·disableSms=false', [b4.from, b4.kakaoOptions.disableSms], ['01099998888', false]);

console.log('5) 중복 차단');
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김하나', '01012345678', '2026-09-11'), item('김셋', '01000000003', '2026-09-11')] }));
eq('김하나는 dup, 김셋만 발송', r.sent.map(x => [x.student, x.ok, !!x.dup]), [['김하나', true, true], ['김셋', true, false]]);
eq('페이로드에 김셋만', JSON.parse(CALLS[2].opt.payload).messages.map(x => x.kakaoOptions.variables['#{학생명}']), ['김셋']);
eq('기록은 김셋만 추가', SHEETS['알림톡기록'].length, 4);
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', force: '1', items: [item('김하나', '01012345678', '2026-09-11')] }));
eq('force → 다시 보냄', [r.okCount, r.sent[0].dup], [1, undefined]);
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김하나', '01012345678', '2026-09-12')] }));
eq('다른 수업일은 새로 보냄', r.okCount, 1);
eq('모두 dup면 UrlFetch 안 부름', (() => { const n = CALLS.length; fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김하나', '01012345678', '2026-09-12')] }); return CALLS.length - n; })(), 0);

console.log('6) 실패 처리');
reset();
fns.alimConfigSet({ pw: 'sh', apiKey: 'K', apiSecret: 'S', pfId: 'P', tpl: { absent: 'T' } });
NEXT = { code: 200, body: { groupInfo: { _id: 'G2' }, failedMessageList: [{ to: '01000000002', statusMessage: '수신 불가 번호' }] } };
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김하나', '01000000001', '2026-09-11'), item('김둘', '01000000002', '2026-09-11')] }));
eq('부분 실패', r.sent.map(x => [x.student, x.ok, x.message]), [['김하나', true, '보냈어요'], ['김둘', false, '수신 불가 번호']]);
eq('기록 결과', SHEETS['알림톡기록'].slice(1).map(x => [x[2], x[7], x[8]]), [['김하나', '성공', ''], ['김둘', '실패', '수신 불가 번호']]);
NEXT = { code: 401, body: { errorCode: 'InvalidApiKey', errorMessage: 'API 키가 틀렸어요' } };
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김셋', '01000000003', '2026-09-11')] }));
eq('HTTP 오류 → 전부 실패', [r.okCount, r.failCount, r.sent[0].message], [0, 1, '솔라피 오류 401 API 키가 틀렸어요']);
NEXT = { throw: 'DNS' };
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김넷', '01000000004', '2026-09-11')] }));
eq('연결 예외 → 실패 기록', [r.failCount, SHEETS['알림톡기록'][SHEETS['알림톡기록'].length - 1][7]], [1, '실패']);
NEXT = { code: 200, body: { groupInfo: { _id: 'G3' } } };
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김다섯', '0212345678', '2026-09-11'), item('김여섯', '01000000006', '2026-09-11')] }));
eq('휴대폰 아닌 번호는 보내지 않음', r.sent.map(x => [x.student, x.ok]), [['김다섯', false], ['김여섯', true]]);
eq('실패한 김둘은 다시 보낼 수 있음(dup 아님)', J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김둘', '01000000002', '2026-09-11')] })).okCount, 1);
eq('모르는 종류', J(fns.alimSend({ pw: 'sh', kind: 'late', items: [item('a', '01000000000', '2026-09-11')] })).result, 'error');
eq('빈 목록', J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [] })).result, 'error');

console.log('7) 기록 조회');
r = J(fns.alimLogGet('2026-09-11', '2026-09-11'));
eq('최신순·수업일 범위(번호 형식 오류 김다섯은 기록 없음)', r.rows.map(x => x.student), ['김둘', '김여섯', '김넷', '김셋', '김둘', '김하나']);
eq('행 내용', [r.rows[0].ok, r.rows[0].who, r.rows[0].kind, r.rows[0].date], [true, '학부모1', 'absent', '2026-09-11']);
eq('범위 밖은 없음', J(fns.alimLogGet('2026-09-12', '2026-09-12')).rows.length, 0);
eq('limit', J(fns.alimLogGet('2026-09-11', '2026-09-11', '2')).rows.length, 2);
eq('시트 없으면 빈 목록', (() => { delete SHEETS['알림톡기록']; return J(fns.alimLogGet()).rows; })(), []);

console.log(fail ? ('\n' + fail + '건 실패') : '\n전부 통과');
process.exit(fail ? 1 : 0);
