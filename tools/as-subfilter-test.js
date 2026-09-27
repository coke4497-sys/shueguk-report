#!/usr/bin/env node
/* 출석 현황 학교+학년 조합 필터 검증 (timetable.html asSub2Pills/asPool/asSet/asScope).
 *   node tools/as-subfilter-test.js
 * 2026-09-27 수정 요청함 김상우 "화수중2 친구들만 보고 싶어요" — 학년/학교를 고르면
 * 반대쪽 두 번째 필터 알약이 열려 조합 명단을 본다.
 * timetable.html 의 함수를 이름으로 떼어 실행하므로 로직이 두 벌이 되지 않는다. */
const fs = require('fs'), path = require('path'), vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'timetable.html'), 'utf8');
function grab(name){
  const at = html.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error(name + ' 함수를 찾지 못했습니다');
  let i = html.indexOf('{', at), depth = 0, j = i;
  for (; j < html.length; j++){
    const ch = html[j];
    if (ch === '{') depth++;
    else if (ch === '}'){ depth--; if (!depth) break; }
  }
  return html.slice(at, j + 1);
}
const NAMES = ['asPool','asSet','asScope','asSub2Pills','asPills','esc'];
const src = [
  "var asS = { weeks:4, view:'all', sort:'issue', q:'', sub:'', sub2:'', limit:40, open:{}, gclosed:{}, person:'' };",
  "var asData = null, rendered = 0, loaded = 0;",
  "function asRender(){ rendered++; }",
  "function asLoad(){ loaded++; }"
].concat(NAMES.map(grab)).join('\n');

const ctx = { console }; vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.__api = {' +
  ' setData: function(d){ asData = d; },' +
  ' S: function(){ return asS; },' +
  ' set: function(k, v){ asSet(k, v); },' +
  ' pool: function(){ return asPool(); },' +
  ' scope: function(){ return asScope(); },' +
  ' pills: function(){ return asSub2Pills(); } };', ctx);
const API = ctx.__api;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); } };

function st(n, s, g, known){ return { n:n, s:s, g:g, known:(known !== false), left:false,
  t:{ att:0, late:0, abs:0, move:0, done:0, issue:0, rate:null }, w:[], i:[], ex:0 }; }
API.setData({ weeks: [], list: [
  st('김민수', '화수중', '중2'), st('이서연', '화수중', '중2'), st('박준호', '화수중', '중3'),
  st('최지아', '화정고', '고1'), st('한도윤', '화정고', '고1'), st('정하은', '화정고', '고2'),
  st('서지우', '백양고', '고1'),                       // 학년이 하나뿐인 학교
  st('노연호', '', '', false)                          // 미등록생 — 두 번째 필터 후보에서 제외
]});

/* 1) 학교별 → 학교를 고르면 학년 알약이 열린다 */
API.set('view', 'school'); API.set('sub', '화수중');
let p = API.pills();
ok('학교 고르면 학년 알약', p.indexOf('학년') > 0 && p.indexOf('중2 2') > 0 && p.indexOf('중3 1') > 0, p);
ok('학년 순서(중2 먼저)', p.indexOf('중2 2') < p.indexOf('중3 1'), p);
ok('알약 키는 sub2', p.indexOf("'sub2'") > 0, p);
ok('학교만 고르면 전체 학년', API.pool().length === 3);

/* 2) 화수중 + 중2 조합 */
API.set('sub2', '중2');
let names = API.pool().map(x => x.n).join(',');
ok('화수중+중2만', names === '김민수,이서연', names);
ok('범위 표기 = 화수중 중2', API.scope() === '화수중 중2', API.scope());

/* 3) 학교를 바꾸면 두 번째 필터가 풀린다 */
API.set('sub', '화정고');
ok('학교 바꾸면 sub2 초기화', API.S().sub2 === '' && API.pool().length === 3, API.S().sub2);
ok('범위 표기 = 화정고', API.scope() === '화정고', API.scope());

/* 4) 학년이 하나뿐인 학교는 알약을 안 연다 */
API.set('sub', '백양고');
ok('한 갈래뿐이면 알약 없음', API.pills() === '', API.pills());

/* 5) 학년별 → 학년을 고르면 학교 알약(많은 순) */
API.set('view', 'grade');
ok('보기 바꾸면 sub·sub2 초기화', API.S().sub === '' && API.S().sub2 === '');
ok('학년 미선택이면 알약 없음', API.pills() === '');
API.set('sub', '고1');
p = API.pills();
ok('학년 고르면 학교 알약(많은 순)', p.indexOf('학교') > 0 && p.indexOf('화정고 2') < p.indexOf('백양고 1'), p);
API.set('sub2', '화정고');
names = API.pool().map(x => x.n).join(',');
ok('고1+화정고만', names === '최지아,한도윤', names);
ok('범위 표기 = 화정고 고1', API.scope() === '화정고 고1', API.scope());

/* 6) 미등록생은 조합 후보·명단에 섞이지 않는다 */
ok('미등록생 제외', API.pool().every(x => x.known));

console.log((fail ? '✗ ' : '✓ ') + pass + '/' + (pass + fail) + ' 통과');
process.exit(fail ? 1 : 0);
