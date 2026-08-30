#!/usr/bin/env node
/* 학생 페이지 '모의고사 성적 추이'(s.html)의 계산 검증.
 *   node tools/mock-trend-test.js             → 가짜 성적표로 규칙 검증
 *   SB_TOKEN=<교사 토큰> node tools/... --live → 배포된 omr_exam_stats(평균 함수) 확인
 * s.html 의 TREND-CORE 블록만 떼어 실행하므로 로직이 두 벌이 되지 않는다. */
const fs = require('fs'), path = require('path'), vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 's.html'), 'utf8');
const m = /\/\* ==TREND-CORE==[\s\S]*?\n([\s\S]*?)\/\* ==\/TREND-CORE== \*\//.exec(html);
if (!m) { console.error('TREND-CORE 블록을 찾지 못했습니다'); process.exit(1); }
const ctx = { console }; vm.createContext(ctx);
vm.runInContext(m[1] + '\n;globalThis.__t = TREND;', ctx);
const TREND = ctx.__t;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); } };
const near = (a, b, e = 0.05) => Math.abs(a - b) <= e;

/* 성적표 한 건 (omr_student_reports 응답 모양) */
function rep(o) {
  return Object.assign({
    examName: 'R', examDate: '8월 29일', subject: '화법과작문', school: 'A고', grade: '3',
    got: 80, level: '2', total: 100, cuts: [88, 80, 71, 61],
    submittedAt: '2026-08-29 10:00:00',
    areas: [
      { cat: '독서', name: '독서론', full: 10, score: 8, rate: 80 },
      { cat: '독서', name: '과학기술', full: 10, score: 4, rate: 40 },
      { cat: '문학', name: '현대시', full: 20, score: 15, rate: 75 },
      { cat: '선택과목', name: '화법과작문', full: 20, score: 18, rate: 90 }
    ]
  }, o);
}
// 서버(omr_student_reports)는 최근순으로 준다
const REPS = [
  rep({ examName: '3회', examDate: '8월 29일', got: 84, level: '2', submittedAt: '2026-08-29 10:00:00' }),
  rep({ examName: '2회', examDate: '8월 22일', got: 71, level: '3', submittedAt: '2026-08-22 10:00:00' }),
  rep({ examName: '1회', examDate: '8월 15일', got: 64, level: '4', submittedAt: '2026-08-15 10:00:00' })
];
const STATS = [
  { exam: '1회', subject: '화법과작문', n: 20, avg: 70 }, { exam: '1회', subject: '전체', n: 30, avg: 69 },
  { exam: '2회', subject: '화법과작문', n: 3, avg: null }, { exam: '2회', subject: '전체', n: 12, avg: 74.5 },
  { exam: '3회', subject: '화법과작문', n: 25, avg: 78.2 }, { exam: '3회', subject: '전체', n: 40, avg: 77 }
];

console.log('1. 회차 정렬과 표기');
{
  const o = TREND.order(REPS);
  ok('시간순(옛→최근)으로 뒤집는다', o.map(x => x.rep.examName).join(',') === '1회,2회,3회');
  ok('원래 자리(idx)를 들고 간다', o[0].idx === 2 && o[2].idx === 0);
  const noTime = REPS.map(r => Object.assign({}, r, { submittedAt: '' }));
  ok('제출시각이 없으면 받은 순서를 뒤집는다',
    TREND.order(noTime).map(x => x.rep.examName).join(',') === '1회,2회,3회');
  ok("'8월 29일' → '8/29'", TREND.label(REPS[0]) === '8/29');
  ok('응시일이 없으면 회차 이름', TREND.label({ examName: '상상3-5회차' }) === '상상3-5회차');
}

console.log('2. 영역 분류별 성취도');
{
  const c = TREND.catRates(REPS[0]);
  ok('같은 분류를 합쳐 %로', near(c['독서'], 60) && near(c['문학'], 75) && near(c['선택과목'], 90),
    JSON.stringify(c));
  ok('배점이 0이면 null', TREND.catRates({ areas: [{ cat: '독서', full: 0, score: 0 }] })['독서'] === null);
}

console.log('3. 슈국 평균 고르기');
{
  ok('같은 선택과목 평균이 먼저', TREND.avgOf(STATS, '1회', '화법과작문').avg === 70);
  const a2 = TREND.avgOf(STATS, '2회', '화법과작문');
  ok('과목 인원이 적으면 전체 평균으로', a2.avg === 74.5 && a2.basis === '전체', JSON.stringify(a2));
  ok('둘 다 없으면 null', TREND.avgOf(STATS, '없는회차', '화법과작문') === null);
  ok('평균 없이도 동작(stats 미도착)', TREND.avgOf(null, '1회', '화법과작문') === null);
}

console.log('4. 추이 만들기');
{
  const T = TREND.build(REPS, STATS);
  const P = T.points;
  ok('점이 시간순', P.map(p => p.label).join(',') === '8/15,8/22,8/29');
  ok('점수·등급이 담긴다', P[2].got === 84 && P[2].level === '2');
  ok('평균이 붙는다', P[0].avg === 70 && P[1].avg === 74.5 && P[2].avg === 78.2);
  ok('전체 응시 횟수', T.total === 3 && T.summary.n === 3);
  ok('최근 3회 평균', near(T.summary.recentAvg, 73), String(T.summary.recentAvg));
  ok('지난 회차 대비', T.summary.delta === 13, String(T.summary.delta));
  ok('평균 대비', near(T.summary.vsAvg, 5.8), String(T.summary.vsAvg));
  ok('등급이 올랐다(+1)', T.summary.levelDelta === 1, String(T.summary.levelDelta));
  ok('가장 낮은 영역', T.summary.worst.cat === '독서' && near(T.summary.worst.rate, 60),
    JSON.stringify(T.summary.worst));
  ok('영역 줄 순서(독서·문학·선택과목)',
    T.catRows.map(r => r.cat).join(',') === '독서,문학,선택과목', T.catRows.map(r => r.cat).join(','));
  ok('영역 줄 값이 회차 수만큼', T.catRows[0].values.length === 3);
}
{
  // 회차가 많으면 최근 것만 그린다
  const many = [];
  for (let i = 12; i >= 1; i--) many.push(rep({ examName: i + '회', examDate: '8월 ' + i + '일', got: 60 + i,
    submittedAt: '2026-08-' + String(i).padStart(2, '0') + ' 10:00:00' }));
  const T = TREND.build(many, null, 8);
  ok('최근 8회만', T.points.length === 8 && T.points[7].label === '8/12', T.points.map(p => p.label).join(','));
  ok('안 그린 회차 수를 알려 준다', T.hidden === 4 && T.total === 12);
  ok('평균이 없어도 점은 그대로', T.points.every(p => p.avg === null));
}
{
  // 회차가 하나뿐
  const T = TREND.build([REPS[0]], STATS);
  ok('한 회차면 비교값이 없다', T.summary.delta === null && T.summary.levelDelta === null);
  ok('한 회차도 평균 대비는 나온다', near(T.summary.vsAvg, 5.8));
}
{
  // 등급외·선택과목이 바뀐 경우
  const mixed = [
    rep({ examName: '2회', subject: '언어와매체', got: 55, level: '등급외', submittedAt: '2026-08-22 10:00:00' }),
    rep({ examName: '1회', subject: '화법과작문', got: 64, level: '4', submittedAt: '2026-08-15 10:00:00' })
  ];
  const T = TREND.build(mixed, STATS);
  ok('등급외는 등급 비교를 하지 않는다', T.summary.levelDelta === null);
  ok('점수 비교는 그대로', T.summary.delta === -9);
  ok('과목이 바뀌면 그 회차 과목 평균으로', T.points[1].avg === 74.5, String(T.points[1].avg));
}

console.log('5. 그리기용 좌표');
{
  const P = TREND.build(REPS, STATS).points;
  const sc = TREND.scale(P, 340, 152, { l: 22, r: 14, t: 20, b: 32 });
  ok('세로 범위가 데이터를 감싼다', sc.yMin <= 64 && sc.yMax >= 84 && sc.yMin >= 0 && sc.yMax <= 100,
    sc.yMin + '~' + sc.yMax);
  ok('10점 단위', sc.yMin % 10 === 0 && sc.yMax % 10 === 0);
  ok('가로가 여백 안에', near(sc.x(0), 22, 0.01) && near(sc.x(2), 326, 0.01), sc.x(0) + '~' + sc.x(2));
  ok('점이 하나면 가운데', near(TREND.scale([P[0]], 340, 152, { l: 22, r: 14, t: 20, b: 32 }).x(0), 174, 0.01));
  ok('높은 점수가 위(y가 작다)', sc.y(84) < sc.y(64));
  const segs = TREND.segments(P, 'got');
  ok('내 점수는 한 줄로 이어진다', segs.length === 1 && segs[0].length === 3);
  const gap = TREND.build(REPS, STATS.filter(s => !(s.exam === '2회'))).points;
  const asegs = TREND.segments(gap, 'avg');
  ok('평균이 빈 회차에서 선이 끊긴다', asegs.length === 2 && asegs[0].length === 1 && asegs[1].length === 1,
    JSON.stringify(asegs.map(s => s.length)));
}

/* ── (선택) 배포된 평균 함수 확인 ── */
async function live() {
  const SB = 'https://bangdbhqpphqqdwcledg.supabase.co/rest/v1';
  const KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT';
  const th = { apikey: KEY, Authorization: 'Bearer ' + process.env.SB_TOKEN, 'Content-Type': 'application/json' };
  const anon = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
  console.log('6. 배포된 omr_exam_stats 확인');
  const exams = await (await fetch(SB + '/omr_exams?select=name', { headers: th })).json();
  const names = exams.map(e => e.name);
  const r = await fetch(SB + '/rpc/omr_exam_stats', { method: 'POST', headers: anon, body: JSON.stringify({ p: { exams: names } }) });
  if (!r.ok) { ok('공개 키로 평균 함수 호출', false, 'HTTP ' + r.status + ' — 023 마이그레이션이 아직 안 올라갔을 수 있어요'); return; }
  const d = await r.json();
  ok('공개 키로 평균 함수 호출', d && d.result === 'success');
  const stats = (d && d.stats) || [];
  ok('회차마다 결과가 온다', new Set(stats.map(s => s.exam)).size > 0, stats.length + '줄');
  ok('5명 미만이면 평균을 숨긴다', stats.every(s => (s.n >= 5) === (s.avg != null)),
    JSON.stringify(stats.filter(s => (s.n >= 5) !== (s.avg != null))));
  ok('평균이 0~100 안', stats.every(s => s.avg == null || (s.avg >= 0 && s.avg <= 100)));
  // '전체' 인원 = 과목별 인원 합
  const byExam = {};
  stats.forEach(s => { byExam[s.exam] = byExam[s.exam] || {}; byExam[s.exam][s.subject] = s; });
  ok('전체 인원 = 과목별 인원 합', Object.keys(byExam).every(e => {
    const g = byExam[e], sum = Object.keys(g).filter(k => k !== '전체').reduce((t, k) => t + g[k].n, 0);
    return !g['전체'] || g['전체'].n === sum;
  }));
  // 이름·점수 같은 개인 정보가 섞여 나오지 않는지
  ok('개인 정보가 나가지 않는다', !/name|school|student|got|answers/i.test(JSON.stringify(stats)));
  // 회차 분석 화면(교사용)과 같은 숫자인지 — hub 저장소가 옆에 있으면 대조
  const hub = path.join(__dirname, '..', '..', 'shueguk-hub', 'omr_analysis.html');
  if (fs.existsSync(hub)) {
    const cm = /\/\* ==ANALYSIS-CORE==[\s\S]*?\n([\s\S]*?)\/\* ==\/ANALYSIS-CORE== \*\//.exec(fs.readFileSync(hub, 'utf8'));
    const c2 = { console }; vm.createContext(c2); vm.runInContext(cm[1] + '\n;globalThis.__c = CORE;', c2);
    const CORE = c2.__c;
    for (const name of names) {
      const pk = await (await fetch(SB + '/omr_exams?select=data&name=eq.' + encodeURIComponent(name), { headers: th })).json();
      let pack = null; try { pack = JSON.parse(pk[0].data); } catch (e) { }
      if (!pack) continue;
      const rows = await (await fetch(SB + '/omr_responses?select=id,submitted_at,name,school,grade,subject,answers&exam=eq.'
        + encodeURIComponent(name) + '&limit=5000', { headers: th })).json();
      if (!rows.length) continue;
      const A = CORE.analyze(pack, rows, { dedupe: true, dropTest: true });
      const g = byExam[name] || {};
      let bad = [];
      A.bySubject.forEach(sub => {
        const st = g[sub.subject];
        if (!st) { bad.push(sub.subject + ' 없음'); return; }
        if (st.n !== sub.n) bad.push(sub.subject + ' 인원 ' + st.n + '≠' + sub.n);
        if (st.avg != null && !near(st.avg, sub.avg, 0.11)) bad.push(sub.subject + ' 평균 ' + st.avg + '≠' + sub.avg);
      });
      if (g['전체'] && g['전체'].avg != null && !near(g['전체'].avg, A.avg, 0.11)) bad.push('전체 평균 ' + g['전체'].avg + '≠' + A.avg);
      ok('[' + name + '] 회차 분석 화면과 같은 평균', bad.length === 0, bad.join(', '));
    }
  } else {
    console.log('    (shueguk-hub 저장소가 없어 교사 화면 대조는 건너뜀)');
  }
}

(async () => {
  if (process.argv.includes('--live')) {
    if (!process.env.SB_TOKEN) console.log('6. 배포 확인 건너뜀 (SB_TOKEN 없음)');
    else await live();
  }
  console.log('\n통과 ' + pass + ' · 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})();
