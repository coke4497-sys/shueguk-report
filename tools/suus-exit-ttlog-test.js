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
function grabVar(name){
  const m = new RegExp('\\n\\s*var ' + name + ' = [^\\n]*').exec(html);
  if (!m) throw new Error(name + ' 값을 찾지 못했습니다');
  return m[0];
}
const src = [
  grabVar('TTLOG_PAGE'),
  "var CALLS = [];", "var ROWS = [];", "var DELFAIL = false;",
  "var GETFAIL = false;",
  "function sbx(method, p, body, extra){",
  "  CALLS.push({ method: method, path: p, body: body });",
  "  if (method === 'GET'){ if (GETFAIL) return Promise.reject(new Error('503'));",
  "    var base = decodeURIComponent(/student=like\\.([^&]*)/.exec(p)[1]).replace(/\\*/g,'');",
  "    var lim = +/limit=(\\d+)/.exec(p)[1], off = +/offset=(\\d+)/.exec(p)[1];",
  "    var hit = ROWS.filter(function(r){ return r.kind === '주간추가' && String(r.student).indexOf(base) >= 0; });",
  "    return Promise.resolve(hit.slice(off, off + lim)); }",
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
  ok(/kind=eq\./.test(q) && /apply_date=gte\.\d{4}-\d{2}-\d{2}/.test(q) && /limit=1000&offset=0/.test(q), '조회는 주간추가 + 오늘 이후 적용분, 1000줄씩');
  ok(/student=like\./.test(q) && decodeURIComponent(q).indexOf('*김건우*') >= 0, '서버에서 끝의 A를 뗀 이름으로 먼저 거른다');
  ok(items.length === 2, '김건우A 검색 → 주간추가 2건 (1회 이동 김건우·심지후 제외): ' + items.length);
  ok(items.every(it => it.src === 'ttlog' && it.label === '시간표 주간 기록'), 'src ttlog · 라벨 시간표 주간 기록');
  const d = items.map(it => it.desc);
  ok(/내신 · 이 주만 추가 · 10\/11 · 정리정독 중2 \(w261011c\)/.test(d[0]), '설명 줄: ' + d[0]);
  ok(!items.some(it => it.kind === '1회'), "'1회' 기록은 목록에 넣지 않는다(보충 완료·시트 사본과 맞물림)");
  const hit2 = await ctx.scanTTLog('심지후');
  ok(hit2.length === 1 && hit2[0].dbid === 1701, '앞 괄호 학교 표기도 이름으로 대조');

  // 삭제
  ctx.CALLS = [];
  const r = await ctx.removeTTLogs(items.slice(0, 2));
  ok(r.ok === 2 && r.fail === 0, '체크한 2건 삭제 → ok 2 · fail 0: ' + JSON.stringify(r));
  const dp = ctx.CALLS[0].path;
  ok(ctx.CALLS[0].method === 'DELETE' && /id=in\.\(1612,1679\)/.test(dp) && /kind=eq\./.test(dp), 'DELETE는 id 묶음 + 종류 조건');
  ok(ctx.ROWS.length === 2 && !ctx.ROWS.some(x => x.id === 1612 || x.id === 1679), '다른 기록은 그대로');
  const r0 = await ctx.removeTTLogs([]);
  ok(r0.ok === 0 && r0.fail === 0 && ctx.CALLS.length === 1, '빈 선택은 호출 없음');
  ctx.DELFAIL = true;
  const rf = await ctx.removeTTLogs([{ dbid: 1700 }]);
  ok(rf.ok === 0 && rf.fail === 1, '삭제 실패는 fail로 보고');

  // 1000줄 넘는 기록도 끝까지 — 두 쪽
  ctx.ROWS = []; for (let i = 0; i < 1203; i++) ctx.ROWS.push({ id: 5000+i, kind:'주간추가', student: (i === 1202 ? '김건우A' : '남학생'+i), book:'내신', to_class_id:'w1', to_class:'정리정독 중2', apply_date:'2026-11-01' });
  ctx.CALLS = [];
  const far = await ctx.scanTTLog('김건우A');
  ok(far.length === 1 && far[0].dbid === 6202, '서버 이름 필터로 한 쪽에 들어와 잡힌다: ' + far.length);
  ctx.ROWS = []; for (let i = 0; i < 1203; i++) ctx.ROWS.push({ id: 7000+i, kind:'주간추가', student:'김건우A', book:'내신', to_class_id:'w1', to_class:'정리정독 중2', apply_date:'2026-11-01' });
  ctx.CALLS = [];
  const many = await ctx.scanTTLog('김건우A');
  ok(many.length === 1203 && ctx.CALLS.length === 2 && /offset=1000/.test(ctx.CALLS[1].path), '1203건이면 두 쪽으로 끝까지 넘겨 전부 잡는다');
  // 조회 실패는 숨기지 않고 ttlog 표시가 붙은 오류로 올린다
  ctx.GETFAIL = true;
  let thrown = null; try { await ctx.scanTTLog('김건우A'); } catch(e){ thrown = e; }
  ok(thrown && thrown.ttlog === true, '조회 실패 → 빈 결과가 아니라 ttlog 오류로 거절');
  ctx.GETFAIL = false;
  const sc = grab('scan');
  ok(/e && e\.ttlog/.test(sc) && /다시 검색해 주세요/.test(sc), 'scan(): 주간 기록 조회 실패면 검색을 멈추고 다시 검색 안내');

  // removeChecked 가 새 src 를 묶는지 — 소스 검사
  const rc = grab('removeChecked');
  ok(/it\.src==='ttlog'/.test(rc) && /removeTTLogs\(tlSel\)/.test(rc) && /시간표 주간 기록 '\+tl\.ok/.test(rc), 'removeChecked: ttlog 선택 → removeTTLogs → 결과 문구');
  ok(/scanTTLog\(nm\)/.test(grab('scan')), 'scan()이 scanTTLog를 함께 부른다');

  console.log(bad ? `\n실패 ${bad}/${n}` : `\n전체 통과 ${n}건`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
