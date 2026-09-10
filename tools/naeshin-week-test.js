#!/usr/bin/env node
/* 내신대비 피드백 — 반을 열 때 기본 주차 규칙 검증 (naeshin.html, 2026-09-10 조교 건의).
 *   node tools/naeshin-week-test.js
 * naeshin.html 의 defaultWeek 를 이름으로 떼어 실행한다. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'naeshin.html'), 'utf8');
function grab(name){
  const at = html.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error(name + ' 없음');
  let i = html.indexOf('{', at), depth = 0, j = i;
  for (; j < html.length; j++){ const ch = html[j]; if (ch === '{') depth++; else if (ch === '}'){ depth--; if (!depth) break; } }
  return html.slice(at, j + 1);
}
const ctx = {}; vm.createContext(ctx);
vm.runInContext(grab('defaultWeek') + ';globalThis.dw = defaultWeek;', ctx);
const dw = ctx.dw;
const W = ['2026-08-26', '2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23'];
let pass = 0, fail = 0;
const ok = (n, a, b) => { if (a === b) pass++; else { fail++; console.log('  ✗ ' + n + ' — ' + a + ' ≠ ' + b); } };
ok('9/9 주(수)에는 9/2 주차', dw(W, '2026-09-09'), '2026-09-02');
ok('9/16 주에는 9/9 주차', dw(W, '2026-09-16'), '2026-09-09');
ok('첫 내신 주(8/26)에는 그 주', dw(W, '2026-08-26'), '2026-08-26');
ok('내신 시작 전(8/19)에는 첫 주차', dw(W, '2026-08-19'), '2026-08-26');
ok('내신 사이에 정규 주가 껴도(9/30 정규) 직전 내신 주차', dw(W, '2026-09-30'), '2026-09-23');
ok('옛 숫자 주차(1·2)는 기본값 후보에서 제외', dw(['1', '2'].concat(W), '2026-09-09'), '2026-09-02');
ok('캘린더 주차가 없으면 첫 항목', dw(['1', '2'], '2026-09-09'), '1');
console.log(fail ? '실패 ' + fail : '✓ ' + pass + '건 통과');
process.exit(fail ? 1 : 0);
