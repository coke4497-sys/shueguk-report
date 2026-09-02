#!/usr/bin/env node
/* 주차별 시간표의 학생 검색 검증 (timetable.html).
 *   node tools/tt-search-test.js
 * 검색 결과가 '그 주에 실제로 어느 반·언제' 수업하는지를 보여 주는지 확인한다 —
 * 1회 이동·이 주만 추가/빼기·반 전체 이동(다른 주 포함)·휴강.
 * timetable.html 의 함수를 이름으로 떼어 실행하므로 로직이 두 벌이 되지 않는다. */
const fs = require('fs'), path = require('path'), vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'timetable.html'), 'utf8');
/* 함수 선언 한 개를 이름으로 떼어 온다 (중괄호 짝 맞추기) */
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
const NAMES = ['weekSearchHits','classSearchHits','sortHits','searchHitBtn','weekViewRange',
               'plainName','isStudentLog','wkMovedAway','wkOffAt','wkDayLabel','mdOf','ymdOf',
               'weekDates','weekDatesOf','mins','esc'];
const src = [
  "var WEEK_VIEW_ORDER = ['월','화','수','목','금','토','일'];",
  "var DAY_IDX = { '월':0, '화':1, '수':2, '목':3, '금':4, '토':5, '일':6 };",
  "var STUDENT_KINDS = { '1회':1, '주간추가':1, '주간빼기':1 };",
  "var mode = 'week', classes = [], weekOnce = [], weekStart = null, onceMoves = [];",
  "function todayStr(){ return '2026-09-02'; }"
].concat(NAMES.map(grab)).join('\n');

const ctx = { console }; vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.__api = { set: function(o){ classes = o.classes; weekOnce = o.weekOnce; weekStart = o.weekStart; },' +
                ' hits: function(q){ return weekSearchHits(q); }, btn: searchHitBtn, all: function(q){ mode = "all"; var r = classSearchHits(q); mode = "week"; return r; } };', ctx);
const API = ctx.__api;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); } };

/* 그 주: 2026-09-02(수) 주차 → 월 8/31 ~ 일 9/6 */
const WED = new Date(2026, 8, 2);
function cls(o){ return Object.assign({ id:'r001', day:'금', start:'5:30', end:'7:00', loc:'본원',
  teacher:'지원', cls:'고1 가', wk:'', students:[] }, o); }
function log(o){ return Object.assign({ row:1, kind:'1회', date:'', student:'', fromId:'', toId:'', reason:'' }, o); }

const A = cls({ id:'r001', day:'금', start:'5:30', cls:'고1 가', students:['김민수','이서연(9/4부터)'] });
const B = cls({ id:'r002', day:'토', start:'2:00', teacher:'승연', cls:'고1 가', students:['박준호'] });
const W = cls({ id:'w260905a', day:'토', start:'오전9:30', end:'11:00', teacher:'선주', cls:'고1 백양B', wk:'2026-09-05', students:[] });
const WNEXT = cls({ id:'w260912a', day:'토', start:'오전9:30', end:'11:00', teacher:'선주', cls:'고1 가', wk:'2026-09-12', students:[] });

function set(classes, weekOnce){ API.set({ classes: classes, weekOnce: weekOnce, weekStart: WED }); }
const one = (q) => { const h = API.hits(q); return h.length === 1 ? h[0] : null; };

/* 1) 기록이 없으면 원래 반·그 주 날짜 */
set([A, B], []);
let h = one('김민수');
ok('기본 — 원래 반', h && h.c.id === 'r001' && !h.flag, h && JSON.stringify(h.flag));
ok('기본 — 그 주 금요일 날짜', h && h.ymd === '2026-09-04', h && h.ymd);
ok('기본 — 표기에 날짜·시간', h && API.btn(h).indexOf('9/4 (금) 5:30') > 0, h && API.btn(h));

/* 2) 1회 이동 — 옮겨 간 반의 요일·시간이 나온다 */
set([A, B], [log({ row:11, kind:'1회', student:'김민수', fromId:'r001', toId:'r002', date:'2026-09-05', reason:'가족모임' })]);
h = one('김민수');
ok('1회 이동 — 옮겨 간 반', h && h.c.id === 'r002', h && h.c.id);
ok('1회 이동 — 옮겨 간 날짜', h && h.ymd === '2026-09-05', h && h.ymd);
ok('1회 이동 — 표기', h && /1회 이동/.test(API.btn(h)) && API.btn(h).indexOf('9/5 (토) 2:00') > 0, h && API.btn(h));
ok('1회 이동 — 원래 반은 안내(title)', h && API.btn(h).indexOf('원래 고1 가 금5:30') > 0, h && API.btn(h));
ok('1회 이동 — 줄이 하나만', API.hits('김민수').length === 1, String(API.hits('김민수').length));

/* 3) 이동해 온 학생은 명단에 없어도 잡힌다 */
h = one('김민수');
set([A, B], [log({ row:12, kind:'1회', student:'최유진', fromId:'r009', toId:'r002', date:'2026-09-05' })]);
h = one('최유진');
ok('이동해 온 학생 — 그 반·날짜', h && h.c.id === 'r002' && h.ymd === '2026-09-05', h && h.c.id + '/' + h.ymd);

/* 4) 이 주만 추가 / 이 주만 빼기 */
set([A, B], [log({ row:13, kind:'주간추가', student:'한지민', toId:'r001', date:'2026-09-04' })]);
h = one('한지민');
ok('주간추가 — 표기', h && h.flag === '이 주 추가' && h.ymd === '2026-09-04', h && h.flag);
set([A, B], [log({ row:14, kind:'주간빼기', student:'김민수', fromId:'r001', date:'2026-09-04', reason:'병결' })]);
h = one('김민수');
ok('주간빼기 — 빠짐 표기', h && h.flag === '이 주 빠짐' && h.off === true, h && h.flag);
ok('주간빼기 — 원래 반 시간 유지', h && h.c.id === 'r001' && h.ymd === '2026-09-04', h && h.ymd);

/* 5) 반 전체를 그 주만 다른 시간으로 — 복사본의 날짜·시간 */
set([A, B, W], [log({ row:15, kind:'주간반이동', fromId:'r002', toId:'w260905a', date:'2026-09-05', reason:'시험' })]);
h = one('박준호');
ok('반 이동 — 복사본 반', h && h.c.id === 'w260905a', h && h.c.id);
ok('반 이동 — 복사본 시간', h && API.btn(h).indexOf('9/5 (토) 오전9:30') > 0, h && API.btn(h));

/* 6) 반 전체를 다른 주로 당김 — 다음 주 날짜가 나온다 */
set([A, B, WNEXT], [log({ row:16, kind:'주간반이동', fromId:'r002', toId:'w260912a', date:'2026-09-05' })]);
h = one('박준호');
ok('다른 주로 이동 — 그 주 날짜', h && h.ymd === '2026-09-12', h && h.ymd);

/* 7) 이 주만 휴강 */
set([A, B], [log({ row:17, kind:'주간반휴강', fromId:'r002', date:'2026-09-05', reason:'추석' })]);
h = one('박준호');
ok('휴강 — 표기', h && h.flag === '이 주 휴강' && h.off === true, h && h.flag);

/* 8) 반 단위 기록을 학생 칩으로 오해하지 않는다 (student 빈 기록) */
set([A, B, W], [log({ row:18, kind:'주간반보강', fromId:'r002', toId:'w260905a', date:'2026-09-05' })]);
ok('반 단위 기록 — 이름 없는 결과 없음', API.hits('').every(function(x){ return String(x.nm).trim(); }));

/* 9) 다른 주의 '이 주만' 반은 그 주 검색에 안 나온다 */
set([A, B, WNEXT], []);
WNEXT.students = ['박준호'];
ok('다른 주 임시반 제외', API.hits('박준호').every(function(x){ return x.c.id !== 'w260912a'; }));
WNEXT.students = [];

/* 10) 이름 뒤 괄호(특이사항)는 떼고 찾고, 표기도 이름만 */
set([A, B], []);
h = one('이서연');
ok('괄호 표기 — 검색됨', !!h);
ok('괄호 표기 — 이름만 표시', h && API.btn(h).indexOf('<b>이서연</b>') > 0, h && API.btn(h));

/* 11) 정렬 — 이름 → 날짜 */
set([A, B], [log({ row:19, kind:'주간추가', student:'김민수', toId:'r002', date:'2026-09-05' })]);
const two = API.hits('김민수');
ok('한 학생 여러 수업 — 날짜순', two.length === 2 && two[0].ymd < two[1].ymd, JSON.stringify(two.map(x => x.ymd)));

/* 12) 전체 시간표 검색은 '이 주만' 반을 빼고 명단 그대로 */
set([A, B, W], []);
W.students = ['박준호'];
const allHits = API.all('박준호');
ok('전체 시간표 — 임시반 제외', allHits.length === 1 && allHits[0].c.id === 'r002', JSON.stringify(allHits.map(x => x.c.id)));
W.students = [];

console.log((fail ? '✗' : '✓') + ' ' + pass + '건 통과' + (fail ? ' / ' + fail + '건 실패' : ''));
process.exit(fail ? 1 : 0);
