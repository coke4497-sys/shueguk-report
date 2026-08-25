/* timetable.html 의 '수파베이스 연결부'(어댑터)를 그대로 떼어 내 실제 수파베이스·시트에
 * 붙여 왕복 시험한다. 실행: node tools/tt-roster-live-test.js
 *
 * 실제 데이터에 쓴다 — 테스트 학생('짝반테스트')을 정리정독 중3 금8:00(정규 r023)에 넣고,
 * 표기를 바꿨다가, 도로 빼서 처음 상태로 되돌린다. 중간에 죽으면 그 학생이 남으므로
 * 시간표에서 직접 빼면 된다. */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'timetable.html'), 'utf8');
const blocks = [...HTML.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const adapter = blocks.find(b => b.includes('__sbAdapter'));
if (!adapter) throw new Error('어댑터 스크립트를 찾지 못했습니다.');

global.ENDPOINT = /var ENDPOINT = "([^"]+)"/.exec(HTML)[1];
global.pw = 'sh';
global.classes = [];                       // 페이지 상태 — 어댑터는 typeof 로 막아 뒀다
global.window = { fetch: (...a) => fetch(...a) };
eval(adapter);
const wfetch = global.window.fetch;

const SB = 'https://bangdbhqpphqqdwcledg.supabase.co/rest/v1';
const KEY = /var SB_KEY = '([^']+)'/.exec(adapter)[1];
const q = encodeURIComponent;

async function roster(book, id, from) {   // from: 'db' | 'sheet'
  if (from === 'sheet') {
    const u = `${ENDPOINT}?action=timetableList&pw=sh&book=${q(book)}&t=${Date.now()}`;
    const d = await (await fetch(u)).json();
    const c = (d.classes || []).find(x => x.id === id);
    return c ? c.students.join(' ') : '(없음)';
  }
  const r = await fetch(`${SB}/tt_classes?book=eq.${q(book)}&class_id=eq.${id}&select=roster`,
                        { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  const rows = await r.json();
  return rows.length ? String(rows[0].roster || '') : '(없음)';
}
function post(body) {
  return wfetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify(Object.assign({ pw: 'sh' }, body)) }).then(r => r.json());
}
const wait = ms => new Promise(r => setTimeout(r, ms));

let fail = 0;
function eq(label, got, want) {
  const ok = got === want;
  if (!ok) fail++;
  console.log((ok ? '  ok  ' : '  FAIL') + '  ' + label + '  → ' + JSON.stringify(got) +
              (ok ? '' : '  (기대: ' + JSON.stringify(want) + ')'));
}
const has = (s, n) => s.split(/\s+/).filter(Boolean).includes(n);

(async () => {
  const NM = '짝반테스트', NM2 = '짝반테스트(확인)';
  const before = { r: await roster('정규', 'r023'), n: await roster('내신', 'n035') };
  console.log('시작 상태  정규 r023:', before.r, '\n          내신 n035:', before.n, '\n');

  console.log('1) 학생 추가 — 수파베이스에 곧바로, 짝 반(내신)까지');
  let t = Date.now();
  let res = await post({ action: 'timetableAdd', book: '정규', student: NM, toId: 'r023' });
  const addMs = Date.now() - t;
  eq('결과', res.result, 'success');
  eq('짝 반 안내', res.twinMsg, '내신 시간표에도 함께 반영했어요.');
  eq('수파베이스 정규', has(await roster('정규', 'r023'), NM), true);
  eq('수파베이스 내신', has(await roster('내신', 'n035'), NM), true);
  console.log('    저장 응답 시간:', addMs, 'ms (예전엔 시트 왕복 2~4초)');

  console.log('2) 표기 수정 — 양쪽 시간표가 같이 바뀐다');
  res = await post({ action: 'timetableRenameStudent', book: '정규', from: NM, to: NM2 });
  eq('결과', res.result, 'success');
  eq('수파베이스 정규', has(await roster('정규', 'r023'), NM2), true);
  eq('수파베이스 내신', has(await roster('내신', 'n035'), NM2), true);

  console.log('3) 같은 이름을 또 넣으면 막는다');
  res = await post({ action: 'timetableAdd', book: '정규', student: NM, toId: 'r023' });
  eq('결과', res.result, 'error');
  eq('안내', res.message, '이미 그 반에 있는 학생이에요.');

  console.log('4) 시트에도 뒤에서 같은 내용이 기록됐는지 (백그라운드 이중 기록)');
  await wait(12000);
  eq('시트 정규', has(await roster('정규', 'r023', 'sheet'), NM2), true);
  eq('시트 내신', has(await roster('내신', 'n035', 'sheet'), NM2), true);

  console.log('5) 되돌리기 — 빼면 양쪽에서 같이 빠진다');
  res = await post({ action: 'timetableRemove', book: '내신', student: NM2, fromId: 'n035' });
  eq('결과', res.result, 'success');
  eq('수파베이스 내신', has(await roster('내신', 'n035'), NM2), false);
  eq('수파베이스 정규', has(await roster('정규', 'r023'), NM2), false);
  await wait(12000);
  eq('시트 정규', has(await roster('정규', 'r023', 'sheet'), NM2), false);
  eq('시트 내신', has(await roster('내신', 'n035', 'sheet'), NM2), false);

  console.log('\n6) 처음 상태 그대로인가');
  eq('정규 r023', await roster('정규', 'r023'), before.r);
  eq('내신 n035', await roster('내신', 'n035'), before.n);
  eq('시트 정규 r023', await roster('정규', 'r023', 'sheet'), before.r);
  eq('시트 내신 n035', await roster('내신', 'n035', 'sheet'), before.n);

  console.log(fail ? '\n실패 ' + fail + '건' : '\n전부 통과');
  process.exit(fail ? 1 : 0);
})();
