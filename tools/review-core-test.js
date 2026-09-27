// 복습 영상 시청 계산(s.html REVIEW-CORE 블록) 검증 — node tools/review-core-test.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 's.html'), 'utf8');
const m = src.match(/\/\* ==REVIEW-CORE== \*\/([\s\S]*?)\/\* ==\/REVIEW-CORE== \*\//);
if (!m) { console.error('REVIEW-CORE 블록 없음'); process.exit(1); }
const RVC = new Function(m[1] + '; return RVC;')();
let n = 0, bad = 0;
function ok(c, msg){ n++; if (!c){ bad++; console.log('✗', msg); } }

// bits / pct
let b = RVC.bitsFrom('1100', 10);
ok(b.length === 10 && b[0] === 1 && b[2] === 0 && b[9] === 0, 'bitsFrom 길이·값');
ok(RVC.pct(b) === 20, 'pct 20');
ok(RVC.pct(RVC.bitsFrom('', 0)) === 0, 'pct 빈 영상');
ok(RVC.pct(RVC.bitsFrom('1'.repeat(89) + '0'.repeat(11), 100)) === 89, 'pct 89 내림');

// merge
ok(JSON.stringify(RVC.merge([[5, 8], [0, 3], [2, 6], [10, 12], [12, 13], [4, 4]])) === '[[0,8],[10,13]]', 'merge');

// step: 1배속 10초 재생
let st = { lastT: null, bits: RVC.bitsFrom('', 100), pending: [], addSec: 0 };
for (let t = 0; t <= 10; t++) RVC.step(st, t, true);
ok(st.addSec === 10, '10초 재생 addSec 10: ' + st.addSec);
ok(RVC.pct(st.bits) === 11, '0~10초 11칸: ' + RVC.pct(st.bits));
// 화면 벗어남(counting=false) 5초 — 세지 않음, 위치 초기화
for (let t = 11; t <= 15; t++) RVC.step(st, t, false);
ok(st.addSec === 10 && st.lastT === null, '화면 벗어나면 세지 않음');
ok(st.bits[13] === 0, '벗어난 동안의 구간은 빈 칸');
// 다시 보임: 첫 틱은 기준만 잡음
RVC.step(st, 16, true); ok(st.addSec === 10, '다시 보인 첫 틱은 기준만');
RVC.step(st, 17, true); ok(st.addSec === 11 && st.bits[16] === 1 && st.bits[17] === 1, '이어서 셈');
// 건너뛰기(17 → 60) — 빈 칸 그대로
RVC.step(st, 60, true); ok(st.addSec === 11 && st.bits[40] === 0, '건너뛰기는 세지 않음');
RVC.step(st, 61, true); ok(st.bits[60] === 1 && st.bits[61] === 1, '건너뛴 뒤 이어 봄');
// 2배속
RVC.step(st, 63, true); ok(st.bits[62] === 1 && st.bits[63] === 1 && st.addSec === 13, '2배속');
// 되감기 — 뒤로 가면 기준만 다시 잡음
RVC.step(st, 30, true); ok(st.addSec === 13 && st.lastT === 30, '되감기');
// 다시 본 구간은 새로 적지 않음(marked 0), 시청 시간은 늘어남
st.lastT = 0; const mk = RVC.step(st, 1, true); ok(mk === 0 && st.addSec === 14, '다시 본 구간: 시간만 늘어남');
// 끝에서 넘치지 않음
st.lastT = 99; RVC.step(st, 99.9, true); ok(st.bits.length === 100 && st.bits[99] === 1, '끝 칸');
// NaN
ok(RVC.step(st, NaN, true) === 0 && st.lastT === null, 'NaN');

// fmt
ok(RVC.fmt(0) === '0초' && RVC.fmt(59) === '59초' && RVC.fmt(60) === '1분' && RVC.fmt(125) === '2분 5초' && RVC.fmt(3725) === '1시간 2분', 'fmt');
// ytId
const id = 'dQw4w9WgXcQ';
['https://www.youtube.com/watch?v=' + id, 'https://youtu.be/' + id + '?si=abc', 'https://www.youtube.com/embed/' + id,
 'https://youtube.com/shorts/' + id, 'https://m.youtube.com/watch?feature=share&v=' + id, 'https://www.youtube.com/live/' + id, id]
  .forEach(u => ok(RVC.ytId(u) === id, 'ytId ' + u));
ok(RVC.ytId('https://example.com') === '' && RVC.ytId('') === '', 'ytId 아님');

console.log((bad ? '실패 ' + bad + ' / ' : '통과 ') + n + '건');
process.exit(bad ? 1 : 0);
