#!/usr/bin/env node
/* 슈스 링크 [수정]의 이름 뒤 알파벳 변경 검증 (superstar.html).
 *   node tools/suus-rename-test.js
 * superstar.html 의 함수를 이름으로 떼어 실행하므로 로직이 두 벌이 되지 않는다.
 * 확인하는 것 — 기본 이름/알파벳 가르기, 명단 토큰의 괄호 표기 보존,
 * 시간표 명단 CAS 반영(정규·내신·짝 반 포함)과 tt_log·출석·시트 사본 호출,
 * 저장 흐름(이름 → 나머지 정보 → 시간표 명단)과 실패 시 안내 문구. */
const fs = require('fs'), path = require('path'), vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'superstar.html'), 'utf8');
/* 함수 선언 한 개를 이름으로 떼어 온다 (중괄호 짝 맞추기) */
function grab(name){
  const at = html.indexOf('\n  function ' + name + '(');
  if (at < 0) throw new Error(name + ' 함수를 찾지 못했습니다');
  let i = html.indexOf('{', at), depth = 0, j = i;
  for (; j < html.length; j++){
    const ch = html[j];
    if (ch === '{') depth++;
    else if (ch === '}'){ depth--; if (!depth) break; }
  }
  return html.slice(at, j + 1);
}
function grabVar(name){
  const m = new RegExp('\\n\\s*var ' + name + ' = [^\\n]*').exec(html);
  if (!m) throw new Error(name + ' 값을 찾지 못했습니다');
  return m[0];
}

const NAMES = ['nmBase','nmSfx','ttTokRename','ttRenameOne','renameTT','saveEdit'];
const src = [
  grabVar('TT_SEP'),
  "var ENDPOINT = 'https://endpoint.test/exec';",
  "var SERVER_PW = 'sh';",
  "var CALLS = { sb: [], post: [] };",
  "var DB = null;",                       // { '정규|r001': '양지우 김철수', … }
  "var FAIL = {};",                       // { cas: true } 등 실패 흉내
  /* sbx 흉내 — 실제 페이지의 수파베이스 호출 규칙(조회·CAS PATCH)만 재현 */
  "function sbx(method, p, body){",
  "  CALLS.sb.push({ method: method, path: p, body: body });",
  "  var q = function(re){ var m = re.exec(p); return m ? decodeURIComponent(m[1]) : null; };",
  "  if (method === 'GET' && /^\\/tt_classes\\?select=book/.test(p)){",
  "    return Promise.resolve(Object.keys(DB).map(function(k){",
  "      return { book: k.split('|')[0], class_id: k.split('|')[1], roster: DB[k] }; }));",
  "  }",
  "  if (method === 'GET' && /^\\/tt_classes\\?book=/.test(p)){",
  "    var k = q(/book=eq\\.([^&]*)/) + '|' + q(/class_id=eq\\.([^&]*)/);",
  "    return Promise.resolve(DB[k] === undefined ? [] : [{ roster: DB[k] }]);",
  "  }",
  "  if (method === 'PATCH' && /^\\/tt_classes\\?book=/.test(p)){",
  "    var k2 = q(/book=eq\\.([^&]*)/) + '|' + q(/class_id=eq\\.([^&]*)/), old = q(/roster=eq\\.([^&]*)/);",
  "    if (FAIL.casOnce){ FAIL.casOnce = false; return Promise.resolve([]); }",
  "    if (FAIL.cas || DB[k2] !== old) return Promise.resolve([]);",   // 값이 달라졌으면 0행 = CAS 실패
  "    DB[k2] = body.roster; return Promise.resolve([{ roster: body.roster }]);",
  "  }",
  "  if (FAIL.log && /tt_log/.test(p)) return Promise.reject(new Error('log'));",
  "  if (FAIL.att && /attendance/.test(p)) return Promise.reject(new Error('att'));",
  "  return Promise.resolve([]);",
  "}",
  "function fetch(url, opts){ CALLS.post.push(JSON.parse(opts.body)); return Promise.resolve({ json: function(){ return Promise.resolve(POSTRES.shift() || { result:'success' }); } }); }",
  "var POSTRES = [];",
  "function renderLinks(){ RENDERED++; }",
  "var RENDERED = 0;",
  "function setE(wrap, m, k){ wrap.__msg = m || ''; wrap.__kind = k || ''; }"
].concat(NAMES.map(grab)).join('\n');

const ctx = { console, setTimeout, Promise, Date, JSON, encodeURIComponent, decodeURIComponent, String, Object, RegExp, Error, Number };
vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.__t = { nmBase:nmBase, nmSfx:nmSfx, tok:ttTokRename, renameTT:renameTT, saveEdit:saveEdit,' +
                ' set:function(db){ DB = db; CALLS.sb = []; CALLS.post = []; FAIL = {}; }, calls:function(){ return CALLS; },' +
                ' db:function(){ return DB; }, fail:function(f){ FAIL = f; }, res:function(r){ POSTRES = r; },' +
                ' rendered:function(){ return RENDERED; } };', ctx);
const T = ctx.__t;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); } };

/* ── ① 이름 가르기 ─────────────────────────────────────────── */
ok('알파벳 없는 이름', T.nmBase('양지우') === '양지우' && T.nmSfx('양지우') === '');
ok('알파벳 있는 이름', T.nmBase('양지우B') === '양지우' && T.nmSfx('양지우B') === 'B');
ok('소문자도 알파벳', T.nmBase('김민재a') === '김민재' && T.nmSfx('김민재a') === 'a');
ok('한 글자 이름은 그대로', T.nmBase('A') === 'A' && T.nmSfx('A') === '');
ok('앞뒤 공백 정리', T.nmBase(' 이수빈A ') === '이수빈' && T.nmSfx(' 이수빈A ') === 'A');

/* ── ② 명단 토큰 — 괄호 표기는 그대로 두고 이름만 ─────────── */
ok('그냥 이름',        T.tok('양지우', '양지우', '양지우B') === '양지우B');
ok('뒤 특이사항 보존', T.tok('양지우(8/23부터)', '양지우', '양지우B') === '양지우B(8/23부터)');
ok('앞 학교 구분 보존', T.tok('(화정)심지후', '심지후', '심지후A') === '(화정)심지후A');
ok('앞뒤 모두 보존',   T.tok('(화정)심지후(8/21부터)', '심지후', '심지후A') === '(화정)심지후A(8/21부터)');
ok('알파벳 지우기',    T.tok('이수빈A', '이수빈A', '이수빈') === '이수빈');
ok('다른 사람은 안 건드림', T.tok('양지우A', '양지우', '양지우B') === null);
ok('부분 일치는 아님',  T.tok('김양지우', '양지우', '양지우B') === null);

/* ── ③ 시간표 명단 반영 ────────────────────────────────────── */
function run(fn){ return fn().then(function(r){ return r; }); }
const tests = [];

tests.push(function(){
  T.set({ '정규|r001': '김철수 양지우 박영희', '정규|r044': '양지우(8/23부터) 최민수',
          '내신|n015': '(화정)양지우', '정규|r099': '양지우A 홍길동' });
  return T.renameTT('양지우', '양지우B').then(function(r){
    const db = T.db(), c = T.calls();
    ok('세 곳 반영', r.ok === 3 && r.fail === 0, JSON.stringify(r));
    ok('정규 명단', db['정규|r001'] === '김철수 양지우B 박영희', db['정규|r001']);
    ok('특이사항 보존', db['정규|r044'] === '양지우B(8/23부터) 최민수', db['정규|r044']);
    ok('내신 짝 반도', db['내신|n015'] === '(화정)양지우B', db['내신|n015']);
    ok('동명이인(양지우A)은 그대로', db['정규|r099'] === '양지우A 홍길동', db['정규|r099']);
    const logs = c.sb.filter(function(x){ return /tt_log/.test(x.path); });
    ok('표기수정 기록 3건(토큰별)', logs.length === 3, JSON.stringify(logs.map(function(l){ return l.body.reason; })));
    ok('기록에 반 구분', logs.some(function(l){ return l.body.book === '내신'; }));
    const att = c.sb.filter(function(x){ return /attendance/.test(x.path); });
    ok('출석 기록도 3건', att.length === 3, String(att.length));
    ok('출석은 60일 창', att.every(function(a){ return /date=gte\.\d{4}-\d{2}-\d{2}/.test(a.path); }));
    ok('출석 대조는 괄호 뗀 이름', att.some(function(a){ return /student_plain=eq\.%EC%96%91%EC%A7%80%EC%9A%B0(&|$)/.test(a.path); }));
    ok('시트 사본 3건', c.post.length === 3 && c.post.every(function(b){ return b.action === 'timetableRenameStudent'; }));
    ok('시트 사본 from/to', c.post.some(function(b){ return b.from === '양지우(8/23부터)' && b.to === '양지우B(8/23부터)'; }));
  });
});

tests.push(function(){
  // 앞뒤 괄호가 다 있으면 시트·DB의 '괄호 뗀 이름'이 빈 값이 된다 — 출석은 건드리지 않는다
  T.set({ '내신|n015': '(화정)심지후(8/21부터) 김철수' });
  return T.renameTT('심지후', '심지후A').then(function(r){
    ok('앞뒤 괄호 토큰도 명단은 반영', r.ok === 1 && T.db()['내신|n015'] === '(화정)심지후A(8/21부터) 김철수', T.db()['내신|n015']);
    ok('그 경우 출석은 건드리지 않음', T.calls().sb.filter(function(x){ return /attendance/.test(x.path); }).length === 0);
  });
});

tests.push(function(){
  T.set({ '정규|r001': '김철수 박영희' });
  return T.renameTT('양지우', '양지우B').then(function(r){
    ok('명단에 없으면 0곳', r.ok === 0 && r.fail === 0);
    ok('없으면 기록·사본도 없음', T.calls().post.length === 0 &&
       T.calls().sb.filter(function(x){ return /tt_log/.test(x.path); }).length === 0);
  });
});

tests.push(function(){
  T.set({ '정규|r001': '양지우 김철수' });
  T.fail({ cas: true });
  return T.renameTT('양지우', '양지우B').then(function(r){
    ok('저장 겹치면 실패로 센다', r.ok === 0 && r.fail === 1, JSON.stringify(r));
    ok('실패하면 사본도 안 보냄', T.calls().post.length === 0);
  });
});

tests.push(function(){
  // 다른 조교와 겹치면 다시 읽어 재시도한다 (timetable.html rosterCas와 같은 규칙)
  T.set({ '정규|r001': '양지우 김철수' });
  T.fail({ casOnce: true });
  return T.renameTT('양지우', '양지우B').then(function(r){
    ok('한 번 겹쳐도 다시 시도해 반영', r.ok === 1 && r.fail === 0 && T.db()['정규|r001'] === '양지우B 김철수', T.db()['정규|r001']);
  });
});

tests.push(function(){
  // 같은 반에 이름이 두 번 적혀 있어도 반 하나로 센다
  T.set({ '정규|r001': '양지우 김철수 양지우' });
  return T.renameTT('양지우', '양지우B').then(function(r){
    ok('중복 이름도 반 하나', r.ok === 1 && T.db()['정규|r001'] === '양지우B 김철수 양지우B', T.db()['정규|r001']);
  });
});

tests.push(function(){
  T.set({ '정규|r001': '양지우 김철수' });
  T.fail({ log: true, att: true });
  return T.renameTT('양지우', '양지우B').then(function(r){
    ok('기록·출석이 실패해도 명단은 성공', r.ok === 1 && r.fail === 0 && T.db()['정규|r001'] === '양지우B 김철수');
  });
});

/* ── ④ 저장 흐름 ───────────────────────────────────────────── */
function fakeWrap(vals){
  const w = { __msg:'', __kind:'', __btn:{ disabled:false } };
  w.querySelector = function(sel){
    const cls = sel.slice(1);
    if (cls === 'esave') return w.__btn;
    return { value: vals[cls] === undefined ? '' : vals[cls] };
  };
  return w;
}
const FORM = { 'e-sfx':'', 'e-school':'화정고', 'e-grade':'고1', 'e-teacher':'지원',
               'e-memo':'', 'e-classA':'', 'e-classB':'', 'e-progress':'', 'e-checkup':'',
               'e-regdate':'', 'e-pstu':'01011112222', 'e-pp1':'01033334444', 'e-pp2':'' };
function form(over){ const o = {}; for (const k in FORM) o[k] = FORM[k]; for (const k in (over||{})) o[k] = over[k]; return o; }
function later(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }

tests.push(function(){
  const s = { name:'양지우', code:'abc123', school:'화정고', grade:'고1' };
  const w = fakeWrap(form({ 'e-sfx':'B' }));
  T.set({ '정규|r001': '양지우 김철수' });
  T.res([{ result:'success' }, { result:'success' }]);   // studentRename → updateStudent
  T.saveEdit(w, s);
  return later(30).then(function(){
    const c = T.calls();
    ok('이름부터 바꾼다', c.post[0] && c.post[0].action === 'studentRename' && c.post[0].to === '양지우B', JSON.stringify(c.post[0]));
    ok('그 다음 나머지 정보', c.post[1] && c.post[1].action === 'updateStudent' && c.post[1].school === '화정고');
    ok('시간표 명단도 반영', T.db()['정규|r001'] === '양지우B 김철수');
    ok('학생 값도 갱신', s.name === '양지우B' && s.teacher === '지원');
    ok('안내에 옛 이름→새 이름', /양지우 → 양지우B/.test(w.__msg) && /1곳/.test(w.__msg), w.__msg);
    ok('성공 표시', w.__kind === 'ok' && w.__btn.disabled === false);
  });
});

tests.push(function(){
  const s = { name:'양지우B', code:'abc123' };
  const w = fakeWrap(form({ 'e-sfx':'' }));
  T.set({ '정규|r001': '양지우B 김철수' });
  T.res([{ result:'success' }, { result:'success' }]);
  T.saveEdit(w, s);
  return later(30).then(function(){
    ok('알파벳 지우기도 됨', T.calls().post[0].to === '양지우' && T.db()['정규|r001'] === '양지우 김철수');
  });
});

tests.push(function(){
  const s = { name:'양지우', code:'abc123' };
  const w = fakeWrap(form());   // 알파벳 그대로
  T.set({ '정규|r001': '양지우 김철수' });
  T.res([{ result:'success' }]);
  T.saveEdit(w, s);
  return later(30).then(function(){
    const c = T.calls();
    ok('이름 그대로면 이름 저장 안 함', c.post.length === 1 && c.post[0].action === 'updateStudent');
    ok('이름 그대로면 명단도 안 건드림', c.sb.length === 0 && w.__msg === '✓ 저장되었어요', w.__msg);
  });
});

tests.push(function(){
  const s = { name:'양지우', code:'abc123' };
  const w = fakeWrap(form({ 'e-sfx':'BB' }));
  T.set({});
  T.saveEdit(w, s);
  return later(10).then(function(){
    ok('알파벳 두 글자는 거절', /A~Z 한 글자/.test(w.__msg) && w.__kind === 'err', w.__msg);
    ok('거절이면 저장 시도 없음', T.calls().post.length === 0);
  });
});

tests.push(function(){
  const s = { name:'양지우', code:'abc123' };
  const w = fakeWrap(form({ 'e-sfx':'가' }));
  T.set({});
  T.saveEdit(w, s);
  return later(10).then(function(){
    ok('한글 접미사도 거절', /A~Z 한 글자/.test(w.__msg));
  });
});

tests.push(function(){
  const s = { name:'양지우', code:'abc123' };
  const w = fakeWrap(form({ 'e-sfx':'B' }));
  T.set({ '정규|r001': '양지우 김철수' });
  T.res([{ result:'error', message:"'양지우B' 이름이 이미 있어요. 다른 표기를 써주세요." }]);
  T.saveEdit(w, s);
  return later(30).then(function(){
    ok('같은 이름이 있으면 멈춘다', /이미 있어요/.test(w.__msg) && w.__kind === 'err', w.__msg);
    ok('멈추면 나머지도 저장 안 함', T.calls().post.length === 1);
    ok('멈추면 명단도 그대로', T.db()['정규|r001'] === '양지우 김철수');
    ok('버튼 다시 눌림', w.__btn.disabled === false);
  });
});

tests.push(function(){
  const s = { name:'양지우', code:'abc123' };
  const w = fakeWrap(form({ 'e-sfx':'B' }));
  T.set({ '정규|r001': '양지우 김철수' });
  T.res([{ result:'success' }, { result:'error', message:'학교와 학년은 비울 수 없어요.' }]);
  T.saveEdit(w, s);
  return later(30).then(function(){
    ok('이름만 바뀐 경우 그렇게 알린다', /이름은 바뀌었지만/.test(w.__msg), w.__msg);
  });
});

tests.push(function(){
  const s = { name:'양지우', code:'abc123' };
  const w = fakeWrap(form({ 'e-sfx':'B' }));
  T.set({ '정규|r001': '박영희 김철수' });   // 시간표에는 없는 학생
  T.res([{ result:'success' }, { result:'success' }]);
  T.saveEdit(w, s);
  return later(30).then(function(){
    ok('명단에 없으면 그렇게 알린다', /시간표 명단에는 이 이름이 없었어요/.test(w.__msg), w.__msg);
    ok('그래도 저장은 성공', w.__kind === 'ok');
  });
});

tests.reduce(function(p, t){ return p.then(t); }, Promise.resolve()).then(function(){
  console.log((fail ? '✗' : '✓') + ' ' + pass + '건 통과' + (fail ? ' · ' + fail + '건 실패' : ''));
  process.exit(fail ? 1 : 0);
}, function(e){ console.log('테스트 실행 오류', e); process.exit(1); });
