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
eq('기록 내용', rows[1].slice(1), ['absent', '김하나', '학부모1', '01012345678', '고1 가', '2026-09-11', '성공', '', 'G1', '', '']);
eq('머리글에 보낸사람 열', rows[0][10], '보낸사람');

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

console.log('5b) 받는 분마다 따로 — 학생·학부모 함께 보내기(2026-09-29)');
const itw = (nm, to, d, who) => Object.assign(item(nm, to, d), { who: who });
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [itw('김일곱', '01000000071', '2026-09-20', '학부모1'), itw('김일곱', '01000000072', '2026-09-20', '학생')] }));
eq('한 학생 두 사람 모두 발송', [r.okCount, r.sent.map(x => x.who)], [2, ['학부모1', '학생']]);
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [itw('김일곱', '01000000071', '2026-09-20', '학부모1'), itw('김일곱', '01000000073', '2026-09-20', '학부모2')] }));
eq('학부모1은 dup, 학부모2는 새로 감', r.sent.map(x => [x.who, !!x.dup]), [['학부모1', true], ['학부모2', false]]);

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

console.log('6b) 잠금 — 중복 확인→발송→기록을 한 잠금 안에서(2026-10-03)');
reset();
fns.alimConfigSet({ pw: 'sh', apiKey: 'K', apiSecret: 'S', pfId: 'P', tpl: { absent: 'T' } });
const LOCK = { wait: 0, release: 0, fail: false };
const prevLock = global.LockService;
global.LockService = { getScriptLock: () => ({ waitLock(){ LOCK.wait++; if (LOCK.fail) throw new Error('busy'); }, releaseLock(){ LOCK.release++; } }) };
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김잠금', '01000000011', '2026-09-11')] }));
eq('발송 때 잠금을 잡고 푼다', [r.okCount, LOCK.wait, LOCK.release], [1, 1, 1]);
NEXT = { throw: 'DNS' };
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김잠금', '01000000012', '2026-09-12')] }));
eq('연결 예외여도 잠금을 푼다', [r.failCount, LOCK.release], [1, 2]);
NEXT = { code: 200, body: { groupInfo: { _id: 'G1' }, failedMessageList: [] } };
LOCK.fail = true;
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김잠금', '01000000013', '2026-09-13')] }));
eq('잠금을 못 잡으면 보내지 않고 안내', [r.result, /진행 중/.test(r.message), CALLS.length], ['error', true, 2]);
LOCK.fail = false;
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [] }));
eq('검증 거절(빈 목록)은 잠금 전에 돌아간다', [r.result, LOCK.wait], ['error', 3]);
global.LockService = prevLock;

console.log('8) 솔라피에서 채널·템플릿 가져오기(alimDiscover)');
reset();
const TXT = fns.ALIM_TPL_.absent.text;
let ROUTES = {};
global.UrlFetchApp = { fetch: (url, opt) => { CALLS.push({ url, opt }); const k = Object.keys(ROUTES).find(p => url.indexOf(p) >= 0);
  const n = k ? ROUTES[k] : { code: 404, body: {} };
  return { getResponseCode: () => n.code, getContentText: () => JSON.stringify(n.body) }; } };
eq('키 없으면 거절', J(fns.alimDiscover({ pw: 'sh' })).result, 'error');
fns.alimConfigSet({ pw: 'sh', apiKey: 'K', apiSecret: 'S' });
ROUTES = { '/kakao/v1/plus-friends': { code: 200, body: { list: [{ pfId: 'KA01PF260912155016737BPjigUV32pr', name: '이수경국어', searchId: '@이수경국어', status: 'ACTIVE' }] } },
           '/kakao/v1/templates': { code: 200, body: { templateList: [
             { templateId: 'KA01TP111', name: '결석 안내', content: TXT.replace(/\n/g, '\r\n'), status: 'APPROVED' },
             { templateId: 'KA01TP222', name: '다른 것', content: '다른 문구', status: 'APPROVED' } ] } } };
r = J(fns.alimDiscover({ pw: 'sh' }));
eq('채널 1개 → pfId 저장', [r.savedPfId, PROPS.KAKAO_PFID], ['KA01PF260912155016737BPjigUV32pr', 'KA01PF260912155016737BPjigUV32pr']);
eq('채널 정보', [r.channels[0].name, r.channels[0].searchId], ['이수경국어', '@이수경국어']);
eq('문구 같고 승인된 템플릿 저장(줄바꿈 차이 무시)', [r.templates.absent.saved, PROPS.ALIM_TPL_ABSENT], ['KA01TP111', 'KA01TP111']);
eq('템플릿 조회에 pfId 붙임', CALLS[CALLS.length - 1].url.indexOf('pfId=KA01PF260912155016737BPjigUV32pr') > 0, true);
eq('GET 인증 헤더', /^HMAC-SHA256 apiKey=K, /.test(CALLS[CALLS.length - 1].opt.headers.Authorization), true);
// 승인 전
delete PROPS.ALIM_TPL_ABSENT;
ROUTES['/kakao/v1/templates'] = { code: 200, body: [{ templateId: 'KA01TP333', content: TXT, status: 'PENDING' }] };
r = J(fns.alimDiscover({ pw: 'sh' }));
eq('승인 전이면 저장 안 함 + 안내', [r.templates.absent.saved, r.templates.absent.pending, PROPS.ALIM_TPL_ABSENT, r.notes.some(n => n.indexOf('승인 전') >= 0)], ['', true, undefined, true]);
// 상태 항목이 없으면(모양이 달라 못 읽음) 저장하지 않는다 — 2026-09-12 심사 중 템플릿이 저장된 사고
delete PROPS.ALIM_TPL_ABSENT;
ROUTES['/kakao/v1/templates'] = { code: 200, body: [{ templateId: 'KA01TP555', content: TXT }] };
r = J(fns.alimDiscover({ pw: 'sh' }));
eq('상태 못 읽으면 저장 안 함', [r.templates.absent.saved, PROPS.ALIM_TPL_ABSENT, r.notes.some(n => n.indexOf('상태를 읽지 못함') >= 0)], ['', undefined, true]);
ROUTES['/kakao/v1/templates'] = { code: 200, body: [{ templateId: 'KA01TP666', content: TXT, inspectionStatus: 'INSPECTING', status: 'ACTIVE' }] };
r = J(fns.alimDiscover({ pw: 'sh' }));
eq('다른 이름의 상태 항목이 심사 중이면 저장 안 함', [r.templates.absent.saved, PROPS.ALIM_TPL_ABSENT], ['', undefined]);
ROUTES['/kakao/v1/templates'] = { code: 200, body: [{ templateId: 'KA01TP777', content: TXT, inspectionStatus: 'APPROVED', status: 'ACTIVE' }] };
r = J(fns.alimDiscover({ pw: 'sh' }));
eq('다른 이름의 상태 항목이 승인이면 저장', [r.templates.absent.saved, PROPS.ALIM_TPL_ABSENT], ['KA01TP777', 'KA01TP777']);
// 실제 솔라피 응답 모양(2026-09-12 debug로 확인): friends 배열 + startKey/nextKey 에 pfId, 템플릿 상태는 codes[].status
delete PROPS.ALIM_TPL_ABSENT; delete PROPS.KAKAO_PFID;
ROUTES['/kakao/v1/plus-friends'] = { code: 200, body: { friends: [{ pfId: 'KA01PFreal', name: '이수경국어', searchId: '@이수경국어', status: 'ACTIVE' }], limit: 20, startKey: 'KA01PFreal', nextKey: null } };
ROUTES['/kakao/v1/templates'] = { code: 200, body: { templateList: [{ templateId: 'KA01TP888', name: '결석 안내', content: TXT, codes: [{ status: 'INSPECTING', comments: [{ status: 'x' }] }], status: 'ACTIVE' }] } };
r = J(fns.alimDiscover({ pw: 'sh' }));
eq('페이지 키의 pfId는 무시하고 채널 이름까지 읽음', [r.savedPfId, r.channels.length, r.channels[0].name], ['KA01PFreal', 1, '이수경국어']);
eq('codes[].status 심사 중 → 저장 안 함', [r.templates.absent.saved, r.templates.absent.status.indexOf('codes[0].status=INSPECTING') >= 0], ['', true]);
ROUTES['/kakao/v1/templates'].body.templateList[0].codes[0].status = 'APPROVED';
r = J(fns.alimDiscover({ pw: 'sh' }));
eq('codes[].status 승인 → 저장', PROPS.ALIM_TPL_ABSENT, 'KA01TP888');
// 문구 다름
ROUTES['/kakao/v1/templates'] = { code: 200, body: [{ templateId: 'KA01TP444', content: TXT + ' 감사합니다.', status: 'APPROVED' }] };
r = J(fns.alimDiscover({ pw: 'sh' }));
eq('문구 다르면 저장 안 함 + 안내', [r.templates.absent.saved, r.notes.some(n => n.indexOf('똑같은 템플릿이 없어요') >= 0)], ['', true]);
// 수업 일정 안내 두 벌(2026-10-29 — 마지막 줄 있음/없음)은 문구 대조로 각각 제 자리에만 저장된다
ROUTES['/kakao/v1/templates'] = { code: 200, body: [
  { templateId: 'KA01TPS1', name: '수업 일정 안내', content: fns.ALIM_TPL_.notice_sched.text, status: 'APPROVED' },
  { templateId: 'KA01TPS2', name: '수업 일정 안내(학생페이지 안내 없음)', content: fns.ALIM_TPL_.notice_sched2.text + '\n', status: 'APPROVED' } ] };
r = J(fns.alimDiscover({ pw: 'sh' }));
eq('수업 일정 안내 두 종류가 각각 제 ID로 저장(끝 줄바꿈 무시)', [PROPS.ALIM_TPL_NOTICE_SCHED, PROPS.ALIM_TPL_NOTICE_SCHED2, r.templates.notice_sched.found, r.templates.notice_sched2.found], ['KA01TPS1', 'KA01TPS2', 1, 1]);
delete PROPS.ALIM_TPL_NOTICE_SCHED; delete PROPS.ALIM_TPL_NOTICE_SCHED2;
// 채널 여럿 → 저장 안 하고 목록
delete PROPS.KAKAO_PFID;
ROUTES['/kakao/v1/plus-friends'] = { code: 200, body: [{ pfId: 'KA01PFaaa', name: 'A' }, { pfId: 'KA01PFbbb', name: 'B' }] };
r = J(fns.alimDiscover({ pw: 'sh' }));
eq('채널 여럿 → 목록만', [r.channels.length, r.savedPfId, PROPS.KAKAO_PFID], [2, '', undefined]);
fns.alimConfigSet({ pw: 'sh', pfId: 'KA01PFbbb' });
r = J(fns.alimDiscover({ pw: 'sh' }));
eq('여럿 중 이미 고른 것은 유지', [r.savedPfId, PROPS.KAKAO_PFID], ['KA01PFbbb', 'KA01PFbbb']);
ROUTES['/kakao/v1/plus-friends'] = { code: 401, body: { errorCode: 'InvalidApiKey' } };
eq('키 거절 → 오류', J(fns.alimDiscover({ pw: 'sh' })).result, 'error');
ROUTES['/kakao/v1/plus-friends'] = { code: 200, body: [] };
r = J(fns.alimDiscover({ pw: 'sh' }));
eq('채널 없음 → 안내', r.notes.some(n => n.indexOf('찾지 못했어요') >= 0), true);

console.log('9) 공지 알림(종류 여덟 notice_* — 2026-09-17, 카카오 반려로 용도별 분리)');
reset();
global.UrlFetchApp = { fetch: (url, opt) => { CALLS.push({ url, opt }); const n = NEXT;
  if (n.throw) throw new Error(n.throw);
  return { getResponseCode: () => n.code, getContentText: () => JSON.stringify(n.body) }; } };
fns.alimConfigSet({ pw: 'sh', apiKey: 'KEY1', apiSecret: 'SEC1', pfId: 'PF1', tpl: { absent: 'KA01TP1' } });
r = J(fns.alimConfigGet());
const NK = Object.keys(r.templates).filter(k => r.templates[k].notice && k !== 'notice_mockrep');   // notice_mockrep 는 문구 모양이 달라 12-2에서 따로 본다
eq('공지 종류 여덟(notice 표시) + 결석 안내·결석 예고 — 옛 단일 notice 없음', [NK, 'notice' in r.templates, r.templates.absent.notice, Object.keys(r.templates).length],
   [['notice_sched', 'notice_sched2', 'notice_mock', 'notice_hwork', 'notice_report', 'notice_reportup', 'notice_voca', 'notice_gramma'], false, false, 13]);
eq('종류 이름', NK.map(k => r.templates[k].label), ['수업 일정 안내', '수업 일정 안내 (학생 페이지 안내 없음)', '주말 실전 모의고사 신청 안내', 'H WORK 과제 안내', '지필고사 리포트 제작 안내', '지필고사 리포트 업데이트 안내', '어휘 테스트 참여 안내', '문법 테스트 참여 안내']);
eq('설정 목록에 공지 템플릿(아직 ID 없음)', [typeof r.templates.notice_mock.text, r.templates.notice_mock.ready, r.templates.notice_mock.vars, r.templates.notice_voca.vars], ['string', false, ['학생명', '제목', '장소', '신청일', '정원', '접근코드'], ['학생명', '제목', '접근코드']]);
const MOCK_BODY = '1. #{장소}에서 실시합니다.\n2. 8:30까지 등원하여 8:40-10:00까지, 모의수능시험에 응시합니다. 8:35분이 지나면 출입을 통제하고 이후 입실이 <불가>합니다.\n3. #{신청일} 중 택1하여 신청합니다. 마감되면 설문을 종료합니다.\n4. 장소가 협소하므로 각 요일 #{정원}명 선착순으로 마감합니다. 임의로 요일을 이동할 수 없습니다.\n\n';
const TAILS = { notice_sched: '학생 페이지에서 내용을 확인해 주세요.', notice_mock: '학생 페이지의 주말 실전 모의고사 메뉴에서 신청할 수 있습니다.',
  notice_hwork: '학생 페이지의 H-work 메뉴에서 과제를 확인하고 제출해 주세요.', notice_report: '학생 페이지의 지필고사 데이터 메뉴에서 시험 복기를 입력해 주세요.',
  notice_reportup: '학생 페이지의 지필고사 데이터 메뉴에서 새로 올라온 리포트를 확인해 주세요.', notice_voca: '학생 페이지의 어휘 테스트 메뉴에서 이번 주 테스트에 참여해 주세요.',
  notice_gramma: '학생 페이지의 문법 테스트 메뉴에서 배정된 테스트에 참여해 주세요.' };
eq('문구 = 제목 줄·둘째 줄에 종류 이름 + ▶ 제목 + 종류별 마지막 줄 + 학생 페이지 주소(#{접근코드})',
   NK.filter(k => k !== 'notice_sched2').map(k => r.templates[k].text === '[이수경국어학원] ' + r.templates[k].label + '\n#{학생명} 학생에게 ' + r.templates[k].label + '가 도착했어요.\n\n▶ #{제목}\n\n' + (k === 'notice_mock' ? MOCK_BODY : '') + TAILS[k]),
   NK.filter(k => k !== 'notice_sched2').map(() => true));
// 2026-10-29 원장님 — 마지막 줄 없는 '수업 일정 안내' 종류(솔라피에 따로 등록, 제목 줄·둘째 줄은 같고 ▶ 제목 줄로 끝남)
eq('수업 일정 안내(학생 페이지 안내 없음) = 같은 문구에서 마지막 줄만 없음, 뒤에 빈 줄도 없음',
   [r.templates.notice_sched2.text, r.templates.notice_sched2.vars, r.templates.notice_sched2.buttons[0].name, r.templates.notice_sched2.text !== r.templates.notice_sched.text],
   ['[이수경국어학원] 수업 일정 안내\n#{학생명} 학생에게 수업 일정 안내가 도착했어요.\n\n▶ #{제목}', ['학생명', '제목', '접근코드'], '학생 페이지 링크', true]);
eq('공지 템플릿 버튼 = 학생 페이지 열기(웹링크, 접근코드 변수) — 결석은 버튼 없음',
   [NK.map(k => r.templates[k].buttons.map(b => [b.name, b.type, b.linkMo === b.linkPc, /s\.html\?key=#\{접근코드\}$/.test(b.linkMo)])), r.templates.absent.buttons],
   [NK.map(() => [['학생 페이지 링크', 'WL', true, true]]), []]);
const nitem = (student, to, title) => ({ student, to, who: '학생', cls: '공지', date: 'N:2026-09-15|' + title, vars: { 학생명: student, 제목: title, 장소: '대감빌딩 5층 이수경 국어 본원', 신청일: '3/14(토), 3/15(일)', 정원: '35', 접근코드: 'k-' + student } });
r = J(fns.alimSend({ pw: 'sh', kind: 'notice_mock', items: [nitem('김하나', '01012345678', '추석 휴강 안내')] }));
eq('템플릿 ID 없으면 거절', [r.result, /모의고사 신청 안내/.test(r.message)], ['error', true]);
r = J(fns.alimSend({ pw: 'sh', kind: 'notice', items: [nitem('김하나', '01012345678', '추석 휴강 안내')] }));
eq('옛 종류 notice는 없는 종류로 거절', r.result, 'error');
fns.alimConfigSet({ pw: 'sh', tpl: { notice_mock: 'KA01TPS', notice_voca: 'KA01TPE' } });
r = J(fns.alimConfigGet());
eq('종류별 ID 저장 → 그 종류만 준비됨', NK.map(k => r.templates[k].ready), [false, false, true, false, false, false, true, false]);
r = J(fns.alimSend({ pw: 'sh', kind: 'notice_mock', items: [nitem('김하나', '01012345678', '추석 휴강 안내'), nitem('김둘', '01000000002', '추석 휴강 안내')] }));
eq('공지 2건 발송', [r.okCount, r.failCount], [2, 0]);
let nb = JSON.parse(CALLS[CALLS.length - 1].opt.payload);
eq('공지 템플릿 ID·변수(접근코드 포함, 버튼은 따로 싣지 않음)', [nb.messages[0].kakaoOptions.templateId, nb.messages[0].kakaoOptions.variables, nb.messages[0].kakaoOptions.buttons], ['KA01TPS', { '#{학생명}': '김하나', '#{제목}': '추석 휴강 안내', '#{장소}': '대감빌딩 5층 이수경 국어 본원', '#{신청일}': '3/14(토), 3/15(일)', '#{정원}': '35', '#{접근코드}': 'k-김하나' }, undefined]);
eq('기록: 종류 notice_mock·받는분 학생·반 공지·중복 키', SHEETS['알림톡기록'][1].slice(1, 7), ['notice_mock', '김하나', '학생', '01012345678', '공지', 'N:2026-09-15|추석 휴강 안내']);
r = J(fns.alimSend({ pw: 'sh', kind: 'notice_mock', items: [nitem('김하나', '01012345678', '추석 휴강 안내')] }));
eq('같은 공지는 중복 건너뜀(키 전체로 대조)', [r.okCount, r.sent[0].dup], [0, true]);
r = J(fns.alimSend({ pw: 'sh', kind: 'notice_mock', items: [nitem('김하나', '01012345678', '모의고사 안내')] }));
eq('같은 날 다른 공지는 따로 감', [r.okCount, r.sent[0].dup], [1, undefined]);
{ const nc = CALLS.length, it = nitem('김셋', '01000000003', '신청일 없음'); it.vars.신청일 = ' ';
  r = J(fns.alimSend({ pw: 'sh', kind: 'notice_mock', items: [it] }));
  eq('모의고사 신청일이 비면 보내지 않음', [r.okCount, r.sent[0].ok, /신청일/.test(r.sent[0].message), CALLS.length === nc], [0, false, true, true]); }
r = J(fns.alimSend({ pw: 'sh', kind: 'notice_voca', items: [nitem('김하나', '01012345678', '추석 휴강 안내')] }));
nb = JSON.parse(CALLS[CALLS.length - 1].opt.payload);
eq('다른 종류는 그 종류 템플릿 ID로 따로 감', [r.okCount, nb.messages[0].kakaoOptions.templateId], [1, 'KA01TPE']);
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김하나', '01012345678', '2026-09-15')] }));
eq('결석 중복 판정은 종류가 달라 영향 없음', r.okCount, 1);

console.log('10) 보낸 사람 (2026-10-03)');
reset();
fns.alimConfigSet({ pw: 'sh', apiKey: 'KEY1', apiSecret: 'SEC1', pfId: 'PF1', tpl: { absent: 'KA01TP1' } });
fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김보낸', '01000000009', '2026-09-11')], by: '김현지' });
eq('K열에 보낸 사람', SHEETS['알림톡기록'][1][10], '김현지');
eq('조회에 보낸 사람', J(fns.alimLogGet('2026-09-11', '2026-09-11')).rows[0].by, '김현지');
fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김없음', '01000000008', '2026-09-11')] });
eq('안 보내면 빈 값', [SHEETS['알림톡기록'][2][10], J(fns.alimLogGet('2026-09-11', '2026-09-11')).rows[0].by], ['', '']);
{ const sh = SHEETS['알림톡기록']; sh[0] = sh[0].slice(0, 10);   // 옛 시트(A~J)
  fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김옛', '01000000007', '2026-09-11')], by: '이은지' });
  eq('옛 시트에 머리글 보충', [sh[0][10], sh[3][10]], ['보낸사람', '이은지']); }

console.log('11) 결석 예고 (2026-10-16)');
reset();
fns.alimConfigSet({ pw: 'sh', apiKey: 'KEY1', apiSecret: 'SEC1', pfId: 'PF1', tpl: { absent: 'KA01TP1' } });
r = J(fns.alimConfigGet());
eq('결석 예고 템플릿 — 이름·변수·보충 안내 선택지·준비 전', [r.templates.preabsent.label, r.templates.preabsent.vars, r.templates.preabsent.options['보충안내'].length, r.templates.preabsent.options['알린분'], r.templates.preabsent.ready, !!r.templates.preabsent.notice],
   ['결석 예고 안내', ['학생명', '수업일', '반이름', '알린분', '사유', '보충안내'], 2, ['학부모님께', '학생에게'], false, false]);
eq('문구 — 알린 분 자리', /결석한다는 연락을 #\{알린분\} 받았습니다/.test(r.templates.preabsent.text), true);
eq('문구 첫 줄', r.templates.preabsent.text.split('\n')[0], '[이수경국어학원] 결석 예고 안내');
const pitem = (nm, to, d, why, mk) => ({ student: nm, to, who: '학부모1', cls: '고1 가', date: d, vars: { 학생명: nm, 수업일: '10/17(토) 2:00', 반이름: '고1 가', 알린분: '학부모님께', 사유: why, 보충안내: mk } });
r = J(fns.alimSend({ pw: 'sh', kind: 'preabsent', items: [pitem('김예고', '01012345678', '2026-10-17', '학교 행사', '보충 일정은 별도 안내드립니다.')] }));
eq('템플릿 ID 없으면 거절', [r.result, /결석 예고/.test(r.message)], ['error', true]);
fns.alimConfigSet({ pw: 'sh', tpl: { preabsent: 'KA01TPP' } });
r = J(fns.alimSend({ pw: 'sh', kind: 'preabsent', items: [pitem('김예고', '01012345678', '2026-10-17', '학교 행사', '보충 일정은 별도 안내드립니다.')] }));
let pb = JSON.parse(CALLS[CALLS.length - 1].opt.payload).messages[0].kakaoOptions;
eq('발송 — 템플릿 ID·알린 분·사유·보충 안내 변수', [r.okCount, pb.templateId, pb.variables['#{알린분}'], pb.variables['#{사유}'], pb.variables['#{보충안내}']], [1, 'KA01TPP', '학부모님께', '학교 행사', '보충 일정은 별도 안내드립니다.']);
eq('기록 — 종류 preabsent·수업일', [SHEETS['알림톡기록'][1][1], SHEETS['알림톡기록'][1][6]], ['preabsent', '2026-10-17']);
{ const nc = CALLS.length;
  r = J(fns.alimSend({ pw: 'sh', kind: 'preabsent', items: [pitem('김사유', '01000000002', '2026-10-17', ' ', '보충 일정은 별도 안내드립니다.')] }));
  eq('사유가 비면 보내지 않음', [r.okCount, /사유/.test(r.sent[0].message), CALLS.length === nc], [0, true, true]); }
{ const nc = CALLS.length, it = pitem('김알림', '01000000003', '2026-10-17', '학교 행사', '보충 일정은 별도 안내드립니다.'); it.vars.알린분 = '';
  r = J(fns.alimSend({ pw: 'sh', kind: 'preabsent', items: [it] }));
  eq('알린 분이 비면 보내지 않음', [r.okCount, /알린분/.test(r.sent[0].message), CALLS.length === nc], [0, true, true]); }
r = J(fns.alimSend({ pw: 'sh', kind: 'preabsent', items: [pitem('김예고', '01012345678', '2026-10-17', '학교 행사', '보충 일정은 별도 안내드립니다.')] }));
eq('같은 결석 예고는 중복 건너뜀', r.sent[0].dup, true);
r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김예고', '01012345678', '2026-10-17')] }));
eq('결석 안내는 종류가 달라 막히지 않음(화면이 체크를 풀어 둔다)', r.okCount, 1);

console.log('12) 예약 발송 (2026-10-18)');
reset();
fns.alimConfigSet({ pw: 'sh', apiKey: 'KEY1', apiSecret: 'SEC1', pfId: 'PF1', tpl: { absent: 'KA01TP1', notice_sched: 'KA01TPS' } });
{
  const p = n => String(n).padStart(2, '0');
  const kst = t => { const d = new Date(t + 9 * 3600000); return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()); };
  const slot = t => { const x = Math.ceil(t / 1800000) * 1800000; return x; };   // 30분 단위로 올림
  const at = slot(Date.now() + 2 * 3600000), when = kst(at);
  const nitem = (st, to) => ({ student: st, to, who: '학생', cls: '', date: 'N:2026-10-18|일정', vars: { 학생명: st, 제목: '일정', 접근코드: 'c1' } });
  let r = J(fns.alimSend({ pw: 'sh', kind: 'notice_sched', schedule: kst(at + 15 * 60000), items: [nitem('김예약', '01011112222')] }));
  eq('30분 단위가 아니면 거절', [r.result, /30분 단위/.test(r.message), CALLS.length], ['error', true, 0]);
  r = J(fns.alimSend({ pw: 'sh', kind: 'notice_sched', schedule: kst(Math.floor(Date.now() / 1800000) * 1800000), items: [nitem('김예약', '01011112222')] }));
  eq('10분 안·지난 시각은 거절', [r.result, /10분 뒤/.test(r.message)], ['error', true]);
  r = J(fns.alimSend({ pw: 'sh', kind: 'notice_sched', schedule: kst(slot(Date.now() + 40 * 86400000)), items: [nitem('김예약', '01011112222')] }));
  eq('30일 넘으면 거절', [r.result, /30일/.test(r.message)], ['error', true]);
  r = J(fns.alimSend({ pw: 'sh', kind: 'absent', schedule: when, items: [item('김결석', '01011113333', '2026-10-18')] }));
  eq('결석 안내는 예약 거절', [r.result, /바로 보냅니다/.test(r.message), CALLS.length], ['error', true, 0]);
  NEXT = { code: 200, body: { groupInfo: { _id: 'GS1' }, failedMessageList: [] } };
  r = J(fns.alimSend({ pw: 'sh', kind: 'notice_sched', schedule: when, by: '김현지 선생님', items: [nitem('김예약', '01011112222'), nitem('이예약', '01011114444')] }));
  const pl = JSON.parse(CALLS[0].opt.payload);
  eq('예약 성공 응답', [r.result, r.okCount, r.scheduled, r.sent[0].message], ['success', 2, when, '예약했어요']);
  eq('솔라피 scheduledDate = ISO +09:00', pl.scheduledDate, when.replace(' ', 'T') + ':00+09:00');
  const R = SHEETS['알림톡기록'];
  eq('머리글 L열 예약시각', R[0][11], '예약시각');
  eq('기록 결과 예약 · 예약시각 · 그룹ID', [R[1][7], R[1][11], R[1][9], R[2][7]], ['예약', when, 'GS1', '예약']);
  r = J(fns.alimSend({ pw: 'sh', kind: 'notice_sched', items: [nitem('김예약', '01011112222')] }));
  eq('예약해 둔 알림은 바로 보내기에서 중복으로 건너뜀', [r.sent[0].dup, CALLS.length], [true, 1]);
  const lg = J(fns.alimLogGet('', '', 10)).rows;
  eq('기록 조회에 res·sched·groupId', [lg[0].res, lg[0].sched, lg[0].groupId, lg[0].ok], ['예약', when, 'GS1', false]);
  // 취소
  eq('묶음 번호 없으면 거절', J(fns.alimCancel({ pw: 'sh', groupId: '' })).result, 'error');
  NEXT = { code: 400, body: { errorMessage: 'nope' } };
  r = J(fns.alimCancel({ pw: 'sh', groupId: 'GS1' }));
  eq('솔라피가 거절하면 기록은 그대로', [r.result, R[1][7]], ['error', '예약']);
  NEXT = { code: 200, body: {} };
  r = J(fns.alimCancel({ pw: 'sh', groupId: 'GS1', by: '김현지 선생님' }));
  const cc = CALLS[CALLS.length - 1];
  eq('취소 = DELETE groups/{id}/schedule', [cc.url, cc.opt.method], ['https://api.solapi.com/messages/v4/groups/GS1/schedule', 'delete']);
  eq('두 줄 예약 취소로', [r.result, r.canceled, R[1][7], R[2][7], R[1][8]], ['success', 2, '예약 취소', '예약 취소', '취소함 · 김현지 선생님']);
  eq('다시 취소하면 거절', J(fns.alimCancel({ pw: 'sh', groupId: 'GS1' })).result, 'error');
  NEXT = { code: 200, body: { groupInfo: { _id: 'G2' }, failedMessageList: [] } };
  r = J(fns.alimSend({ pw: 'sh', kind: 'notice_sched', items: [nitem('김예약', '01011112222')] }));
  eq('취소한 뒤에는 다시 보낼 수 있다', [r.okCount, R[R.length - 1][7]], [1, '성공']);
  // 시각 지난 예약은 취소 거절
  R.push([new Date(), 'notice_sched', '박지남', '학생', '01011115555', '', 'N:x', '예약', '', 'GOLD', '', kst(Date.now() + 30000)]);
  r = J(fns.alimCancel({ pw: 'sh', groupId: 'GOLD' }));
  eq('보낼 시각이 지난 예약은 취소 거절', [r.result, /지나/.test(r.message)], ['error', true]);
}

console.log('12-2) 교육청·평가원 모의고사 리포트 제출 안내 (2026-10-21)');
reset();
fns.alimConfigSet({ pw: 'sh', apiKey: 'KEY1', apiSecret: 'SEC1', pfId: 'PF1' });
{
  let r = J(fns.alimConfigGet()), t = r.templates.notice_mockrep;
  eq('공지 종류로 표시·변수 넷·아직 준비 전', [t.notice, t.vars, t.ready, t.label], [true, ['학생명', '제목', '마감일', '접근코드'], false, '교육청·평가원 모의고사 리포트 제출 안내']);
  eq('문구 = 원장님 확정본 그대로', t.text, '[이수경국어학원] 교육청·평가원 모의고사 리포트 제출 안내\n#{학생명} 학생, #{제목}를 성실하게 치러 내느라 정말 고생 많았습니다.\n\n학생 페이지의 교육청·평가원 모의고사 리포트 메뉴에서 틀린 문제를 선택 입력해 주세요. 채점한 시험지를 준비했다면 1분이면 끝나요!\n\n▶ 제출 기한: #{마감일}\n\n애타게 기다리고 있을 선생님들의 마음을 헤아려 얼른 제출해 주세요.');
  eq('버튼 = 학생 개인 페이지(승인본)', t.buttons.map(b => [b.name, b.type, /s\.html\?key=#\{접근코드\}$/.test(b.linkMo), b.linkMo === b.linkPc]), [['학생 개인 페이지', 'WL', true, true]]);
  fns.alimConfigSet({ pw: 'sh', tpl: { notice_mockrep: 'KA01TPMR' } });
  const it = (st, due) => ({ student: st, to: '01012340000', who: '학생', cls: '공지', date: 'N:2026-10-21|26년 10월 학력평가', vars: { 학생명: st, 제목: '26년 10월 학력평가', 마감일: due, 접근코드: 'k1' } });
  const nc = CALLS.length;
  r = J(fns.alimSend({ pw: 'sh', kind: 'notice_mockrep', items: [it('김마감', ' ')] }));
  eq('마감일이 비면 보내지 않음', [r.okCount, /마감일/.test(r.sent[0].message), CALLS.length === nc], [0, true, true]);
  r = J(fns.alimSend({ pw: 'sh', kind: 'notice_mockrep', items: [it('김하나', '10/25(일)')] }));
  const v = JSON.parse(CALLS[CALLS.length - 1].opt.payload).messages[0].kakaoOptions;
  eq('발송 — 템플릿 ID·변수', [r.okCount, v.templateId, v.variables], [1, 'KA01TPMR', { '#{학생명}': '김하나', '#{제목}': '26년 10월 학력평가', '#{마감일}': '10/25(일)', '#{접근코드}': 'k1' }]);
}

console.log('13) 미등원 안내 · 등원 안내 (2026-10-29)');
reset();
fns.alimConfigSet({ pw: 'sh', apiKey: 'KEY1', apiSecret: 'SEC1', pfId: 'PF1', tpl: { absent: 'KA01TP1' } });
{
  let r = J(fns.alimConfigGet()), ns = r.templates.noshow, ar = r.templates.arrived;
  eq('미등원 안내 — 이름·변수·공지 아님·준비 전', [ns.label, ns.vars, !!ns.notice, ns.ready, ns.buttons], ['미등원 안내', ['학생명', '수업일', '반이름', '학원번호'], false, false, []]);
  eq('미등원 문구 = 원장님 승인 그대로', ns.text, '[이수경국어학원] 미등원 안내\n#{학생명} 학생이 #{수업일} #{반이름} 수업 시간에 아직 등원하지 않았습니다.\n학생과 학부모님께 연락을 드렸으나 연결되지 않았습니다.\n확인 후 학원(#{학원번호})으로 연락 부탁드립니다.');
  eq('등원 안내 — 이름·변수(등원시각)·준비 전', [ar.label, ar.vars, !!ar.notice, ar.ready], ['지각 등원 안내', ['학생명', '수업일', '반이름', '등원시각'], false, false]);
  eq('등원 문구', ar.text, '[이수경국어학원] 지각 등원 안내\n#{학생명} 학생이 #{수업일} #{반이름} 수업에 지금 등원했습니다. (#{등원시각} 도착)\n앞서 보내 드린 미등원 안내는 확인하지 않으셔도 됩니다.');
  const ni = (nm, to, who) => ({ student: nm, to, who, cls: '고1 가', date: '2026-10-29', vars: { 학생명: nm, 수업일: '10/29(목) 5:30', 반이름: '고1 가', 학원번호: '031-979-4497' } });
  r = J(fns.alimSend({ pw: 'sh', kind: 'noshow', items: [ni('김미등', '01012345678', '학부모1')] }));
  eq('템플릿 ID 없으면 거절', [r.result, /미등원 안내/.test(r.message)], ['error', true]);
  fns.alimConfigSet({ pw: 'sh', tpl: { noshow: 'KA01TPNS', arrived: 'KA01TPAR' } });
  r = J(fns.alimSend({ pw: 'sh', kind: 'noshow', items: [ni('김미등', '01012345678', '학부모1'), ni('김미등', '01012345679', '학생')] }));
  let pb = JSON.parse(CALLS[CALLS.length - 1].opt.payload).messages[0].kakaoOptions;
  eq('미등원 발송 — 두 분·템플릿 ID·변수', [r.okCount, pb.templateId, pb.variables['#{수업일}'], Object.keys(pb.variables).length], [2, 'KA01TPNS', '10/29(목) 5:30', 4]);
  eq('학원번호 변수가 비면 그 건은 보내지 않음', J(fns.alimSend({ pw: 'sh', kind: 'noshow', items: [Object.assign(ni('김번호', '01012345671', '학부모1'), { vars: { 학생명: '김번호', 수업일: '10/29(목) 5:30', 반이름: '고1 가' } })] })).okCount || 0, 0);
  eq('기록 — 종류 noshow·수업일', [SHEETS['알림톡기록'][1][1], SHEETS['알림톡기록'][1][6]], ['noshow', '2026-10-29']);
  r = J(fns.alimSend({ pw: 'sh', kind: 'noshow', items: [ni('김미등', '01012345678', '학부모1')] }));
  eq('같은 날 같은 학생 미등원 안내는 중복 건너뜀', r.sent[0].dup, true);
  r = J(fns.alimSend({ pw: 'sh', kind: 'absent', items: [item('김미등', '01012345678', '2026-10-29')] }));
  eq('뒤에 결석 안내는 종류가 달라 막히지 않음', r.okCount, 1);
  const ai = Object.assign(ni('김미등', '01012345678', '학부모1'), { vars: { 학생명: '김미등', 수업일: '10/29(목) 5:30', 반이름: '고1 가', 등원시각: '오후 5:52' } });
  r = J(fns.alimSend({ pw: 'sh', kind: 'arrived', items: [ai] }));
  pb = JSON.parse(CALLS[CALLS.length - 1].opt.payload).messages[0].kakaoOptions;
  eq('등원 발송 — 등원시각 변수', [r.okCount, pb.templateId, pb.variables['#{등원시각}']], [1, 'KA01TPAR', '오후 5:52']);
  { const nc = CALLS.length, it = Object.assign(ni('김시각', '01000000009', '학부모1'), { vars: { 학생명: '김시각', 수업일: '10/29(목) 5:30', 반이름: '고1 가', 등원시각: '' } });
    r = J(fns.alimSend({ pw: 'sh', kind: 'arrived', items: [it] }));
    eq('등원시각이 비면 보내지 않음', [r.okCount, /등원시각/.test(r.sent[0].message), CALLS.length === nc], [0, true, true]); }
  r = J(fns.alimSend({ pw: 'sh', kind: 'noshow', schedule: (function(){ var d = new Date(Date.now() + 9 * 3600000 + 2 * 86400000); return d.toISOString().slice(0, 10) + ' 10:00'; })(), items: [ni('김예약', '01012345670', '학부모1')] }));
  eq('미등원 안내는 예약 거절', [r.result, /예약하지 않고/.test(r.message)], ['error', true]);
}

console.log(fail ? ('\n' + fail + '건 실패') : '\n전부 통과');
process.exit(fail ? 1 : 0);
