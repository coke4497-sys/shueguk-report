#!/usr/bin/env node
/* 아웃 슈스 — 시간표 주간 기록(주간추가·1회)까지 찾아 지우는지 검증 (superstar.html).
 *   node tools/suus-exit-ttlog-test.js
 * superstar.html 의 함수를 이름으로 떼어 실행한다(로직 두 벌 금지).
 * 배경: 2026-10-11 김건우A — 10/4 아웃 뒤에도 9/18에 미리 넣어 둔 주간추가 기록(10/11·11/1)이 남아
 * 그 날짜 시간표에 '이 주' 칩으로 되살아났다. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'superstar.html'), 'utf8');
function grab(name){
  const at = html.indexOf('\n  function ' + name + '(');
  if (at < 0) throw new Error(name + ' 함수를 찾지 못했습니다');
  let i = html.indexOf('{', at), depth = 0, j = i;
  for (; j < html.length; j++){ const ch = html[j]; if (ch === '{') depth++; else if (ch === '}'){ depth--; if (!depth) break; } }
  return html.slice(at, j + 1);
}
const src = [
  "var CALLS = [];", "var ROWS = [];", "var DELFAIL = false;",
  "function sbx(method, p, body, extra){",
  "  CALLS.push({ method: method, path: p, body: body });",
  "  if (method === 'GET') return Promise.resolve(ROWS);",
  "  if (method === 'DELETE'){ if (DELFAIL) return Promise.reject(new Error('x'));",
  "    var ids = /id=in\\.\\(([^)]*)\\)/.exec(p)[1].split(',').map(Number);",
  "    var gone = ROWS.filter(function(r){ return ids.indexOf(r.id) >= 0 && /주간추가|1회/.test(r.kind); });",
  "    ROWS = ROWS.filter(function(r){ return gone.indexOf(r) < 0; }); return Promise.resolve(gone); }",
  "  return Promise.resolve([]);",
  "}",
  ...['ttNameHit','todayYmdKST','scanTTLog','removeTTLogs'].map(grab),
].join('\n');
const ctx = { console, Promise, Date, encodeURIComponent, decodeURIComponent, String, Number, RegExp };
vm.createContext(ctx); vm.runInContext(src, ctx);

let n = 0, bad = 0;
function ok(cond, msg){ n++; if (!cond){ bad++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); }
(async function(){
  const today = ctx.todayYmdKST();
  ok(/^\d{4}-\d{2}-\d{2}$/.test(today), '오늘 날짜(KST) 형식 ' + today);

  ctx.ROWS = [
    { id: 1612, kind:'주간추가', student:'김건우A', book:'내신', to_class_id:'w261011c', to_class:'정리정독 중2', apply_date:'2026-10-11' },
    { id: 1679, kind:'주간추가', student:'김건우A', book:'내신', to_class_id:'w261101b', to_class:'정리정독 중2', apply_date:'2026-11-01' },
    { id: 1700, kind:'1회',     student:'김건우',  book:'정규', to_class_id:'r042',     to_class:'고2 가',      apply_date:'2026-10-24' },
    { id: 1701, kind:'주간추가', student:'(화정)심지후', book:'내신', to_class_id:'n110', to_class:'중2 확인', apply_date:'2026-10-25' },
  ];
  const items = await ctx.scanTTLog('김건우A');
  const q = ctx.CALLS[0].path;
  ok(/kind=in\.\(/.test(q) && /apply_date=gte\.\d{4}-\d{2}-\d{2}/.test(q), '조회는 주간추가·1회 + 오늘 이후 적용분만');
  ok(items.length === 3, '김건우A 검색 → 김건우A 2건 + 끝 A만 다른 김건우 1건 = 3건 (심지후 제외): ' + items.length);
  ok(items.every(it => it.src === 'ttlog' && it.label === '시간표 주간 기록'), 'src ttlog · 라벨 시간표 주간 기록');
  const d = items.map(it => it.desc);
  ok(/내신 · 이 주만 추가 · 10\/11 · 정리정독 중2 \(w261011c\)/.test(d[0]), '설명 줄: ' + d[0]);
  ok(/정규 · 1회 이동 · 10\/24 · 고2 가 \(r042\)/.test(d[2]), '1회 이동 설명 줄: ' + d[2]);
  const hit2 = await ctx.scanTTLog('심지후');
  ok(hit2.length === 1 && hit2[0].dbid === 1701, '앞 괄호 학교 표기도 이름으로 대조');

  // 삭제
  ctx.CALLS = [];
  const r = await ctx.removeTTLogs(items.slice(0, 2));
  ok(r.ok === 2 && r.fail === 0, '체크한 2건 삭제 → ok 2 · fail 0: ' + JSON.stringify(r));
  const dp = ctx.CALLS[0].path;
  ok(ctx.CALLS[0].method === 'DELETE' && /id=in\.\(1612,1679\)/.test(dp) && /kind=in\.\(/.test(dp), 'DELETE는 id 묶음 + 종류 조건');
  ok(ctx.ROWS.length === 2 && !ctx.ROWS.some(x => x.id === 1612 || x.id === 1679), '다른 기록은 그대로');
  const r0 = await ctx.removeTTLogs([]);
  ok(r0.ok === 0 && r0.fail === 0 && ctx.CALLS.length === 1, '빈 선택은 호출 없음');
  ctx.DELFAIL = true;
  const rf = await ctx.removeTTLogs([{ dbid: 1700 }]);
  ok(rf.ok === 0 && rf.fail === 1, '삭제 실패는 fail로 보고');

  // removeChecked 가 새 src 를 묶는지 — 소스 검사
  const rc = grab('removeChecked');
  ok(/it\.src==='ttlog'/.test(rc) && /removeTTLogs\(tlSel\)/.test(rc) && /시간표 주간 기록 '\+tl\.ok/.test(rc), 'removeChecked: ttlog 선택 → removeTTLogs → 결과 문구');
  ok(/scanTTLog\(nm\)/.test(grab('scan')), 'scan()이 scanTTLog를 함께 부른다');

  console.log(bad ? `\n실패 ${bad}/${n}` : `\n전체 통과 ${n}건`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
