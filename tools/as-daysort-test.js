#!/usr/bin/env node
/* 출석 현황 '요일순' 정렬 검증 (timetable.html asDayKey/asSort).
 *   node tools/as-daysort-test.js
 * 2026-10-01 사용자 요청 "출석 현황을 학년별로 고른 후 요일별 소트".
 * 기준 = 가장 최근 주의 진도(가) 칸 수업, 없으면 확인(나) 칸 — 요일(월~일) → 시작 시간 → 이름. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'timetable.html'), 'utf8');
function grab(name){
  const at = html.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error(name + ' 함수를 찾지 못했습니다');
  let i = html.indexOf('{', at), depth = 0, j = i;
  for (; j < html.length; j++){ const ch = html[j];
    if (ch === '{') depth++; else if (ch === '}'){ depth--; if (!depth) break; } }
  return html.slice(at, j + 1);
}
const src = ["var DAYS = ['월','화','수','목','금','토','일'];",
  "var asS = { sort:'day' };"].concat(['mins','asSlotTime','asDayKey','asSort'].map(grab)).join('\n');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.__api = { sort: asSort, key: asDayKey, S: function(){ return asS; } };', ctx);
const API = ctx.__api;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

const C = (day, start) => ({ day, start });
const wk = (a, b) => ({ slots: [(a || []).map(c => ({ c })), (b || []).map(c => ({ c }))] });
const st = (n, wks) => ({ n, wk: wks });
const list = [
  st('하늘', [wk([C('토','2:00')], [C('수','5:30')])]),          // 진도 칸이 기준 → 토
  st('가람', [wk([C('수','8:00')])]),
  st('나래', [wk([C('수','5:30')])]),
  st('다온', [wk([C('일','오전10:00')])]),
  st('라온', [wk([], [C('금','5:30')])]),                       // 진도 칸 없음 → 확인 칸
  st('마루', [wk([C('월','2:00')]), wk([])]),                   // 최근 주 비면 앞 주
  st('바다', [wk([C('수','8:00')])]),                           // 같은 시간 → 이름순
  st('사랑', [wk([], [])]),                                     // 수업 없음 → 맨 뒤
  st('아라', [wk([C('목','5:30'), C('수','7:00')])])            // 한 칸 여럿 → 가장 이른 것
];
const out = API.sort(list).map(x => x.n);
ok('요일·시간·이름 순서', out.join(',') === '마루,나래,아라,가람,바다,라온,하늘,다온,사랑', out.join(','));
ok('진도 칸 우선', API.key(list[0]).day === '토');
ok('확인 칸 대체', API.key(list[4]).day === '금');
ok('수업 없음 = null', API.key(list[7]) === null);
ok('시간 표기', API.key(list[1]).time === '수8:00');
API.S().sort = 'name';
ok('다른 정렬은 그대로', API.sort(list).map(x => x.n)[0] === '가람');
console.log((fail ? '실패 ' + fail + '건, ' : '') + '통과 ' + pass + '건');
process.exit(fail ? 1 : 0);
