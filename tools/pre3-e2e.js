#!/usr/bin/env node
/* 예비 고3 인서울 15개 대학(pre3.html, 095·096 — 2026-11-28) 검증.
 *   LC_ALL=C.UTF-8 NODE_PATH=$(npm root -g) node tools/pre3-e2e.js
 * 가짜 pre3_list 로 전체 요약(맨 위 카드·모집 구조·정렬·비교표·대학 카드·전국 흐름·일정)·대학 상세(바뀐 점·전형 거르기·
 * 정시 반영 표·국어 요점·앞뒤 대학)·점검표(30항목 표시·개수·저장·되살리기·지우기)·오류 안내·휴대폰·s.html 카드를 본다.
 * 옮긴 자료는 저장소에 두지 않으므로 이 검사의 대학 자료는 가짜다. 실제 자료로 화면을 보려면
 * PRE3_JSON=<JSON 폴더(common.json 포함)> SHOT=<캡처 폴더> 로 돌린다(검사는 가짜 자료로만 판정). */
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const SHOT = process.env.SHOT || '';
const ok = (m, c, x) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (x ? ' ' + x : ''))); };

function fakeU(name, short, totals, kor, extra){
  return Object.assign({
    name, short, src: { title: '2028학년도 ' + name + ' 대학입학전형 시행계획', date: '2026.4', note: '' },
    changes: [short + ' 바뀐 점 하나', short + ' 바뀐 점 둘'],
    tracks: [
      { period: '수시', type: '학생부교과', name: short + '추천', n: totals.s_gyo, n_note: '', apply: '졸업예정자 · 학교장 추천', method: '교과 100%', min: '국·수·영·탐 중 3개 합 7', essay: '', note: '' },
      { period: '수시', type: '학생부종합', name: short + '인재', n: totals.s_jong, n_note: '', apply: '', method: '서류 100%(3배수) → 1단계 70% + 면접 30%', min: '없음', essay: '', note: '' },
      { period: '수시', type: '논술', name: short + '논술', n: totals.s_non, n_note: '', apply: '', method: '논술 100%', min: '없음', essay: '인문 90분', note: '' },
      { period: '정시', type: '수능', name: '일반전형(수능)', n: totals.j_su, n_note: '', apply: '', method: '수능 100%', min: '없음', essay: '', note: '가군' }
    ],
    jeongsi: { groups: '전 모집단위 가군', ratio: [{ track: '인문', kor: kor[0], math: 30, eng: null, inq: 30, hist: '가산', note: '영어 등급별 감점' }, { track: '자연', kor: kor[1], math: 40, eng: null, inq: 30, hist: '가산', note: '' }], score: '표준점수', extra: '', note: '' },
    korean: [short + ' 국어 요점 하나', short + ' 국어 요점 둘'], notes: [], totals
  }, extra || {});
}
let ITEMS = [
  { key: 'common', kind: 'common', name: '공통', year: '2028', data: { src: '대교협 주요사항', schedule: [{ k: '수시 원서접수', v: '2027. 9. 20.(월) ~ 23.(목)' }, { k: '정시 원서접수', v: '2028. 1. 3.(월) ~ 6.(목)' }],
      national: { total: 348789, total_prev: 345717, susi: 281895, susi_pct: 80.8, jeongsi: 66894, jeongsi_pct: 19.2, types: [['학생부교과', 157991, 45.3], ['학생부종합', 84704, 24.3], ['논술', 12727, 3.6], ['수능(정시)', 61779, 17.7]], note: '수도권은 학종이 가장 많습니다.' } } },
  { key: 'bb', kind: 'univ', name: '나대학교', year: '2028', data: fakeU('나대학교', '나대', { s_gyo: 200, s_jong: 500, s_non: 300, s_sil: 0, s_etc: 0, j_su: 1000, total: 2000, jg: [200, 180, 20], nonsul: [300, null, 300] }, [40, 30]) },
  { key: 'aa', kind: 'univ', name: '가대학교', year: '2028', data: fakeU('가대학교', '가대', { s_gyo: 300, s_jong: 1200, s_non: 0, s_sil: 0, s_etc: 0, j_su: 500, total: 2000, jg: [300, 300, 0] }, [30, 20],
      { tracks: [{ period: '수시', type: '학생부교과', name: '가대추천', n: 300, n_note: '', apply: '', method: '교과 100%', min: '없음', essay: '', note: '' },
                 { period: '수시', type: '학생부종합', name: '가대인재', n: 1200, n_note: '', apply: '', method: '서류 100%', min: '없음', essay: '', note: '' },
                 { period: '정시', type: '수능', name: '일반전형(수능)', n: 500, n_note: '', apply: '', method: '수능 100%', min: '없음', essay: '', note: '' }],
        jeongsi: { groups: '나군', ratio: [{ track: '전 모집단위 유형 A', kor: null, math: null, eng: 10, inq: 20, hist: '감점', note: '국어·수학 중 점수가 좋은 영역 순으로 40%, 30%' }], score: '표준점수', extra: '', note: '' } }) }
];
if (process.env.PRE3_JSON){
  const dir = process.env.PRE3_JSON;
  ITEMS = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map((f, i) => { const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); const k = f.replace('.json', '');
    return k === 'common' ? { key: 'common', kind: 'common', name: '공통', year: '2028', data: d } : { key: k, kind: 'univ', name: d.name, year: '2028', data: d }; });
  const common = ITEMS.find(x => x.kind === 'common'); const kc = common && common.data.kcue15 || {}; const AL = { '한국외대': '한국외국어대' };
  ITEMS.forEach(x => { if (x.kind === 'univ' && !x.data.totals){ const t = kc[AL[x.data.short] || x.data.short]; if (t) x.data.totals = t; } });
  ITEMS.sort((a, b) => (a.kind === 'common' ? -1 : b.kind === 'common' ? 1 : 0));
}
let MODE = 'ok', CALLS = [], SAVES = [], MINE = { ok: true, data: null };
// 096 — 학생들이 저장한 체크리스트(선생님 보기 목록용 가짜 두 줄)
const CHK = [
  { student_id: 11, code: 'ABC', name: '김철수', school: '화정고', grade: '2026 고등 2학년', marks: 3, updated_at: '2026-11-28T10:00:00+09:00', data: { m: { 1: 'o', 7: 't', 22: 'x' }, f: { f3n: '7', f3w: '야자 전', w1u: '연세대학교', w1d: '국어국문학과', h11k: '2' }, at: 1764295200000 } },
  { student_id: 12, code: 'DEF', name: '이영희', school: '능곡고', grade: '2026 고등 2학년', marks: 1, updated_at: '2026-11-27T09:00:00+09:00', data: { m: { 3: 'n' }, f: {}, at: 1764200000000 } }
];

(async () => {
  const srv = await new Promise(res => { const s = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, ''));
    fs.readFile(f, (e, b) => e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'application/javascript' : f.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8' }), r.end(b)));
  }).listen(0, () => res(s)); });
  const port = srv.address().port, base = 'http://127.0.0.1:' + port;
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1000, height: 900 } });
  const pg = await ctx.newPage();
  let perr = 0; pg.on('pageerror', e => { perr++; console.log('  ✗ pageerror', e.message); });
  await ctx.route('**/*', rt => {
    const u = rt.request().url();
    if (u.startsWith(base)) return rt.continue();
    if (SHOT && /fonts\.(googleapis|gstatic)\.com/.test(u)) return rt.continue();
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u);
    if (m && m[1] === 'pre3_list'){
      CALLS.push(JSON.parse(rt.request().postData() || '{}').p || {});
      if (MODE === 'missing') return rt.fulfill({ status: 404, body: '{}' });
      if (MODE === 'nostudent') return rt.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"no_student"}' });
      return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: ITEMS }) });
    }
    if (m && m[1] === 'pre3_check_save'){ SAVES.push(JSON.parse(rt.request().postData() || '{}').p || {}); return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, at: new Date().toISOString() }) }); }
    if (m && m[1] === 'pre3_check_mine'){ return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MINE) }); }
    if (m) return rt.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false}' });
    if (/\/rest\/v1\/pre3_checks\?/.test(u)){
      TCALLS.push({ url: u, auth: rt.request().headers()['authorization'] || '' });
      if (!/Bearer T-OK/.test(rt.request().headers()['authorization'] || '')) return rt.fulfill({ status: 401, body: '{}' });
      return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CHK) });
    }
    if (/\/rest\/v1\/pre3_univs\?/.test(u)){
      TCALLS.push({ url: u, auth: rt.request().headers()['authorization'] || '' });
      if (!/Bearer T-OK/.test(rt.request().headers()['authorization'] || '')) return rt.fulfill({ status: 401, body: '{}' });
      return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ITEMS) });
    }
    return rt.fulfill({ status: 204, body: '' });
  });
  const TCALLS = [];
  const real = !!process.env.PRE3_JSON;
  const nUniv = ITEMS.filter(x => x.kind === 'univ').length;

  console.log('① 전체 요약');
  await pg.goto(base + '/pre3.html?key=ABC', { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('.ci');
  ok('처음 열면 [팀09 셀프 체크리스트] — 탭 맨 앞', (await pg.locator('#seg button').first().textContent()) === '팀09 셀프 체크리스트' && (await pg.locator('#seg button.on').textContent()) === '팀09 셀프 체크리스트');
  ok('탭 셋 — 체크리스트 · 개편안 · 15개 대학', (await pg.locator('#seg button').allTextContents()).join('|') === '팀09 셀프 체크리스트|대입 개편안 · 전형 요약|15개 주요 대학');
  await pg.locator('#seg button[data-v="univ15"]').click();
  await pg.waitForSelector('.urow');
  ok('15개 대학 탭 = 전체 요약 하위 탭부터', (await pg.locator('.sub2 button.on').textContent()) === '전체 요약');
  ok('접근코드로 pre3_list 를 부름', CALLS[0] && CALLS[0].key === 'ABC');
  ok('[15개 주요 대학] 탭이 켜짐', await pg.locator('#seg button.on').textContent() === '15개 주요 대학');
  ok('대학 줄 수 = 대학 수(공통 줄 제외)', await pg.locator('.urow').count() === nUniv);
  ok('전국 흐름·일정 카드(공통 줄)', (await pg.locator('.sec-t').allTextContents()).join('|').includes('큰 흐름') && await pg.locator('.sched').count() === 1);
  if (SHOT) await pg.screenshot({ path: path.join(SHOT, 'pre3-summary.png'), fullPage: true });
  if (!real){
    const rn = await pg.locator('.urow .un').allTextContents();
    ok('수시 비율 높은 순(가 75% → 나 50%)', rn[0].startsWith('가대') && rn[1].startsWith('나대'), rn.join('|'));
    ok('수시·정시 비율 글', rn[0].includes('수시 75%') && rn[0].includes('정시 25%'));
    ok('쌓인 막대(가대 = 교과·종합·정시 세 칸)', await pg.locator('.urow').first().locator('.stk i').count() === 3);
    ok('정시 국어 비율 칸(나대 40%)', (await pg.locator('.urow').nth(1).locator('.kv').nth(2).textContent()).includes('40') && (await pg.locator('.urow').nth(1).locator('.kv').nth(2).textContent()).includes('자연 30%'));
    ok('고정 비율이 없는 대학은 유형별 글', (await pg.locator('.urow').first().locator('.kv').nth(2).textContent()).includes('유형별') && (await pg.locator('.urow').first().locator('.kv').nth(2).textContent()).includes('점수가 좋은 영역'));
    ok('맨 위 카드 — 수시 비율·정시 국어·논술', (await pg.locator('.tops').textContent()).includes('가대') && (await pg.locator('.tops .es0').textContent()).includes('나대') && (await pg.locator('.tops .es0').textContent()).includes('국어 40%') && (await pg.locator('.tops').textContent()).includes('1개 대학'));
    ok('특징 칩 — 논술 최저 없음·지역균형', (await pg.locator('.urow').nth(1).locator('.ft').allTextContents()).includes('논술 최저 없음') && (await pg.locator('.urow').nth(1).locator('.ft').allTextContents()).includes('지역균형 200명'));
    await pg.click('[data-sort="kor"]');
    ok('정시 국어 비율 높은 순(나 40 → 가 유형별)', (await pg.locator('.urow .un').allTextContents())[0].startsWith('나대'));
    await pg.click('[data-sort="name"]');
    const rows = await pg.locator('.cmr').allTextContents();
    ok('비교표 대학 이름순(가 → 나)', rows.length === 2 && rows[0].startsWith('가대') && rows[1].startsWith('나대'), JSON.stringify(rows));
    ok('비교표 최저 칩(나대 교과 최저 있음·논술 최저 없음)', (await pg.locator('.cmr').nth(1).locator('.ok').allTextContents()).join('|') === ' 최저 있음| 최저 없음| 최저 없음');
    ok('비교표 논술 없음은 붉게', await pg.locator('.cmr').first().locator('.v.e').count() === 1);
    ok('비교표 유형별 국어', (await pg.locator('.cmr').first().locator('.cq').textContent()).includes('유형별로 다름'));
    ok('대학 카드 두 장 + 바뀐 점', await pg.locator('.sbox').count() === 2 && (await pg.locator('.sbox').first().textContent()).includes('외 1건'));
    ok('전국 총계·증감', (await pg.locator('.nat').textContent()).includes('348,789명') && (await pg.locator('.nat').textContent()).includes('+3,072명'));
  }

  console.log('② 대학 상세');
  await pg.click('.sbox');
  await pg.waitForSelector('.shead');
  ok('주소가 #univ=… 로', /#univ=/.test(pg.url()));
  ok('[대학별 전형] 하위 탭이 켜짐', await pg.locator('.sub2 button.on').textContent() === '대학별 전형' && await pg.locator('#seg button.on').textContent() === '15개 주요 대학');
  if (SHOT) await pg.screenshot({ path: path.join(SHOT, 'pre3-univ.png'), fullPage: true });
  if (!real){
    ok('첫 카드 = 가대학교(정렬 유지)', (await pg.locator('.shead .nm').textContent()) === '가대학교');
    ok('머리 타일 전체·수시·정시', (await pg.locator('.shead .tiles').textContent()).includes('2,000명') && (await pg.locator('.shead .tiles').textContent()).includes('75%'));
    ok('섹션 1~4', (await pg.locator('.sec-t .n').allTextContents()).join() === '1,2,3,4');
    ok('바뀐 점 2건', await pg.locator('.chg li').count() === 2);
    ok('전형 카드 3개', await pg.locator('.tk').count() === 3);
    await pg.click('[data-tf="정시"]');
    ok('정시만 → 1개', await pg.locator('.tk').count() === 1 && (await pg.locator('.tk .tg.p.j').count()) === 1);
    await pg.click('[data-tf="학생부종합"]');
    ok('학생부종합만 → 1개(가대인재)', await pg.locator('.tk').count() === 1 && (await pg.locator('.tk .tn').textContent()) === '가대인재');
    ok('최저 없음은 흐린 글', await pg.locator('.tk .mn.none').count() === 1);
    ok('정시 반영 표 — 국어 칸 비면 – + 유형 설명', (await pg.locator('.rt').nth(1).textContent()).includes('––10%') && (await pg.locator('.rt .nt').textContent()).includes('점수가 좋은 영역'));
    ok('통합형 안내 한 줄', (await pg.locator('.card').nth(3).textContent()).includes('선택과목이 없는 통합형'));
    ok('국어 요점 상자', await pg.locator('.kobox li').count() === 2);
    ok('출처 줄', (await pg.locator('.srcline').textContent()).includes('어디가'));
    await pg.click('.nav2 [data-go]');
    await pg.waitForFunction(() => document.querySelector('.shead .nm') && document.querySelector('.shead .nm').textContent === '나대학교');
    ok('다음 대학 나대 + 거르기 풀림', await pg.locator('.tk').count() === 4);
    ok('나대 정시 표 국어 40%·자연 30%·영어 가감점', (await pg.locator('.rt').nth(1).textContent()).includes('40') && (await pg.locator('.rt').nth(2).textContent()).includes('30') && (await pg.locator('.rt').nth(1).textContent()).includes('가감점'));
    ok('논술고사 줄', (await pg.locator('.tk').nth(2).textContent()).includes('인문 90분'));
    await pg.click('[data-sum]'); await pg.waitForSelector('.urow');
    ok('전체 요약으로', await pg.locator('.sub2 button.on').textContent() === '전체 요약');
    await pg.click('.sub2 [data-sub="univ"]'); await pg.waitForSelector('.shead');
    ok('하위 탭 [대학별 전형]으로', /#univ/.test(pg.url()));
  }

  console.log('②-2 대입 개편안 · 전형 요약');
  await pg.click('#seg button[data-v="reform"]'); await pg.waitForSelector('.rf');
  ok('주소 #reform · 탭 켜짐', /#reform$/.test(pg.url()) && await pg.locator('#seg button.on').textContent() === '대입 개편안 · 전형 요약');
  ok('개편안 특징 카드 4 — 수능 선택과목 폐지 · 내신 5등급', await pg.locator('.rf .it').count() === 4 && (await pg.locator('.rf').textContent()).includes('통합사회와 통합과학') && (await pg.locator('.rf').textContent()).includes('5등급'));
  ok('5등급 누적 비율 띠', (await pg.locator('.g5').textContent()).includes('누적 ~34%'));
  ok('전형 요약 넷 — 교과·종합·논술·정시', (await pg.locator('.rtk h4').allTextContents()).map(t => t.split(/\s/)[0]).join('|').replace(/내신.*?\|/,'|') .length > 0 && await pg.locator('.rtk').count() === 4);
  if (!real){
    ok('전국 숫자(대교협) + 15개 대학 중 몇 곳', (await pg.locator('.rtk').nth(2).textContent()).includes('전국 12,727명') && (await pg.locator('.rtk').nth(2).textContent()).includes('중 1곳'));
  }
  ok('개편안 탭에 하위 탭 없음', await pg.locator('.sub2').count() === 0);
  await pg.goto(base + '/pre3.html#reform'); await pg.waitForSelector('.rf');
  ok('키 없어도 개편안 탭은 열림(전국 숫자만 없음)', await pg.locator('.rf .it').count() === 4 && await pg.locator('.rtk').count() === 4);

  console.log('③ 팀09 셀프 체크리스트');
  await pg.goto(base + '/pre3.html?key=ABC#check');
  await pg.waitForSelector('.ci');
  ok('30개 항목', await pg.locator('.ci').count() === 30);
  ok('내신 히스토리 — 학기 5줄 × 등급(1~5)·성취도(A~E)·평균·메모', await pg.locator('.hist select').count() === 10 && await pg.locator('.hist input').count() === 10 && (await pg.locator('#h11k option').allTextContents()).join('') === '등급12345' && (await pg.locator('#h11a option').allTextContents()).join('') === '성취도ABCDE');
  ok('수능 목표 등급 — 국·수·영·통합사회·통합과학·한국사(1~9)', await pg.locator('#gk, #gm, #ge, #gs, #gc, #gh').count() === 6 && await pg.locator('#gk option').count() === 10);
  ok('지원 희망 대학·학과 세 줄 + 15개 대학 자동완성', await pg.locator('.wish input[list="univlist"]').count() === 3 && await pg.locator('#univlist option').count() === 15 && (await pg.locator('#w1t option').allTextContents()).includes('정시(수능)'));
  await pg.selectOption('#h11k', '2'); await pg.selectOption('#h11a', 'B'); await pg.fill('#h11g', '2.3');
  await pg.selectOption('#gk', '1'); await pg.fill('#w1u', '연세대학교'); await pg.fill('#w1d', '국어국문학과'); await pg.selectOption('#w1t', '학생부종합');
  await pg.reload(); await pg.waitForSelector('.hist');
  ok('새 칸도 이 기기에 저장·되살림', await pg.inputValue('#h11k') === '2' && await pg.inputValue('#h11a') === 'B' && await pg.inputValue('#h11g') === '2.3' && await pg.inputValue('#gk') === '1' && await pg.inputValue('#w1u') === '연세대학교' && await pg.inputValue('#w1d') === '국어국문학과' && await pg.inputValue('#w1t') === '학생부종합');
  ok('새 칸은 ○△× 개수에 들지 않음', (await pg.locator('#ckProg').textContent()).includes('0</b>') || (await pg.locator('#ckProg .lb b').textContent()) === '0');
  ok('4층', await pg.locator('.flh').count() === 4);
  await pg.click('[data-mk="1|o"]'); await pg.click('[data-mk="7|t"]'); await pg.click('[data-mk="22|x"]');
  ok('개수 3/30', (await pg.locator('#ckProg').textContent()).includes('3 / 30') && (await pg.locator('#ckCount b').allTextContents()).join() === '1,1,1,0');
  ok('진행 막대', (await pg.locator('#ckProg .tr i').getAttribute('style')).includes('10%'));
  await pg.click('[data-mk="22|x"]');
  ok('같은 표시 다시 누르면 풀림', (await pg.locator('#ckProg').textContent()).includes('2 / 30'));
  ok('1번 고르기 목록에 ○ 항목이 먼저', (await pg.locator('#f1n optgroup').first().getAttribute('label')) === '표시한 항목' && (await pg.locator('#f1n optgroup').first().locator('option').count()) === 1);
  await pg.selectOption('#f1n', '1');
  await pg.fill('#f3w', '자습 시작 전 10분');
  await pg.click('[data-re="t"]');
  await pg.reload(); await pg.waitForSelector('.ci');
  ok('새로고침 뒤 표시·글 남음', await pg.locator('[data-mk="1|o"].on').count() === 1 && (await pg.inputValue('#f3w')) === '자습 시작 전 10분' && await pg.locator('[data-re="t"].on').count() === 1);
  await pg.waitForFunction(() => /선생님도 함께/.test(document.getElementById('ckSaved').textContent), null, { timeout: 4000 });
  ok('저장 시각 줄 — 서버에 저장됨 · 선생님도 함께 봅니다', (await pg.locator('#ckSaved').textContent()).includes('저장됨 ·'));
  const last = SAVES[SAVES.length - 1];
  ok('서버 저장 본문(pre3_check_save) = 접근코드 + m·f·at', last && last.key === 'ABC' && last.data && last.data.m['1'] === 'o' && last.data.f.f3w === '자습 시작 전 10분' && last.data.f.f1n === '1' && last.data.f.f4m === 't' && typeof last.data.at === 'number');
  ok('1.2초 모아서 보냄(표시 셋 + 글 셋을 다섯 번 아래로)', SAVES.length >= 1 && SAVES.length <= 5, String(SAVES.length));
  ok('pre1 점검표와 따로 저장(pre3_check_)', await pg.evaluate(() => !!localStorage.getItem('pre3_check_ABC') && !localStorage.getItem('pre1_check_ABC')));
  if (SHOT) await pg.screenshot({ path: path.join(SHOT, 'pre3-check.png'), fullPage: true });
  pg.once('dialog', d => d.accept());
  const nS = SAVES.length;
  await pg.click('[data-rst]');
  ok('모두 지우기', (await pg.locator('#ckProg').textContent()).includes('0 / 30') && (await pg.inputValue('#f3w')) === '');
  await pg.waitForTimeout(1500);
  ok('지운 것도 서버에 저장(빈 m·f)', SAVES.length === nS + 1 && Object.keys(SAVES[nS].data.m).length === 0 && Object.keys(SAVES[nS].data.f).length === 0);

  console.log('③-2 서버에 더 새로 저장한 것이 있으면 그것을 쓴다(다른 기기에서 적은 것)');
  MINE = { ok: true, data: { m: { 5: 'o', 9: 'x' }, f: { f3w: '서버에 적은 글', gk: '2' }, at: Date.now() + 100000 }, at: new Date(Date.now() + 100000).toISOString() };
  await pg.goto(base + '/pre3.html?key=ABC&r=3'); await pg.waitForSelector('.ci');
  await pg.waitForFunction(() => document.querySelector('[data-mk="5|o"].on'), null, { timeout: 4000 });
  ok('서버 것으로 표시·글이 바뀜', await pg.locator('[data-mk="5|o"].on').count() === 1 && await pg.locator('[data-mk="9|x"].on').count() === 1 && (await pg.inputValue('#f3w')) === '서버에 적은 글' && (await pg.inputValue('#gk')) === '2');
  ok('이 기기에도 내려받아 둠', await pg.evaluate(() => JSON.parse(localStorage.getItem('pre3_check_ABC')).f.f3w === '서버에 적은 글'));
  ok('받은 뒤 상태 줄 = 저장됨', (await pg.locator('#ckSaved').textContent()).includes('저장됨 ·'));
  const nS2 = SAVES.length;
  MINE = { ok: true, data: { m: { 5: 'o' }, f: {}, at: 1000 }, at: '2026-01-01T00:00:00Z' };
  await pg.goto(base + '/pre3.html?key=ABC&r=4'); await pg.waitForSelector('.ci');
  await pg.waitForTimeout(600);
  ok('이 기기 것이 더 새로우면 그대로 두고 서버로 올림', await pg.locator('[data-mk="9|x"].on').count() === 1 && SAVES.length === nS2 + 1 && SAVES[nS2].data.m['9'] === 'x');
  MINE = { ok: true, data: null };

  console.log('④ 오류 안내');
  await pg.goto(base + '/pre3.html#summary'); await pg.waitForSelector('.msg');
  ok('주소에 키 없음', (await pg.locator('.msg').textContent()).includes('학생 페이지에서 열어'));
  await pg.click('[data-v="check"]'); await pg.waitForSelector('.ci');
  ok('키 없어도 점검표는 열림', await pg.locator('.ci').count() === 30);
  MODE = 'missing'; await pg.goto(base + '/pre3.html?key=A#summary'); await pg.waitForSelector('.msg');
  ok('함수 없음(095 전) = 준비 중', (await pg.locator('.msg').textContent()).includes('준비 중'));
  MODE = 'nostudent'; await pg.goto(base + '/pre3.html?id=12345678#summary'); await pg.waitForSelector('.msg');
  ok('학생ID로 부름 + 못 찾음 안내', CALLS[CALLS.length - 1].student === '12345678' && (await pg.locator('.msg').textContent()).includes('찾지 못했'));
  MODE = 'ok';

  console.log('⑤ 휴대폰');
  const mp = await (await br.newContext({ viewport: { width: 390, height: 840 } })).newPage();
  await mp.route('**/*', rt => { const u = rt.request().url(); if (u.startsWith(base)) return rt.continue(); if (SHOT && /fonts\.(googleapis|gstatic)\.com/.test(u)) return rt.continue();
    if (/rpc\/pre3_list/.test(u)) return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: ITEMS }) }); return rt.fulfill({ status: 204, body: '' }); });
  await mp.goto(base + '/pre3.html?key=ABC#summary'); await mp.waitForSelector('.cmr');
  ok('가로 스크롤 없음(요약)', await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  if (SHOT) await mp.screenshot({ path: path.join(SHOT, 'pre3-mobile-summary.png'), fullPage: true });
  const firstU = ITEMS.find(x => x.kind === 'univ').key;
  await mp.goto(base + '/pre3.html?key=ABC#univ=' + firstU); await mp.waitForSelector('.shead');
  ok('가로 스크롤 없음(상세)', await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  if (SHOT) await mp.screenshot({ path: path.join(SHOT, 'pre3-mobile-univ.png'), fullPage: true });
  await mp.goto(base + '/pre3.html?key=ABC#check'); await mp.waitForSelector('.ci');
  ok('가로 스크롤 없음(점검표)', await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

  console.log('⑤-2 선생님 보기(?teacher=1 — 허브 슈국 운영 카드)');
  await pg.goto(base + '/pre3.html?teacher=1#summary'); await pg.waitForSelector('.msg');
  ok('로그인 없음 = 허브 로그인 안내 + login.html 링크', (await pg.locator('.msg').textContent()).includes('허브에 로그인') && /shueguk-hub\/login\.html\?next=/.test(await pg.locator('.msg a').getAttribute('href')));
  ok('표 조회를 보내지 않음', TCALLS.length === 0);
  await pg.evaluate(() => localStorage.setItem('shueguk_teacher_session_v2', JSON.stringify({ access_token: 'T-OK', refresh_token: 'R', expires_at: Math.floor(Date.now() / 1000) + 3600 })));
  await pg.goto(base + '/pre3.html?teacher=1&r=2#summary'); await pg.waitForSelector('.urow');   // 해시만 다른 주소는 다시 불러오지 않아 r=2
  const TU = TCALLS.filter(c => /pre3_univs/.test(c.url));
  ok('개인 로그인 신분으로 pre3_univs 를 직접 읽음(visible·ord)', TU.length === 1 && /Bearer T-OK/.test(TU[0].auth) && /visible=is\.true/.test(TU[0].url) && /order=ord/.test(TU[0].url));
  ok('대학 줄 수 = 대학 수(공통 줄은 전국 흐름으로)', await pg.locator('.urow').count() === nUniv && await pg.locator('.sched').count() === 1);
  ok('선생님 보기 띠 + 슈국 운영 링크', await pg.locator('#tband').isVisible() && /shueguk-hub\/ops\.html/.test(await pg.locator('#tband a').getAttribute('href')) && await pg.evaluate(() => document.body.classList.contains('teacher')));
  await pg.click('[data-v="check"]'); await pg.waitForSelector('.tsub');
  ok('체크리스트 탭 = 학생 화면과 같은 체크리스트(표시 가능, 이 기기에만) + 위 하위 탭 [체크리스트][학생 저장 목록 2]', await pg.locator('.ci[data-no]').count() === 30 && !(await pg.locator('[data-mk="1|o"]').isDisabled()) && (await pg.locator('.tsub').textContent()).replace(/\s+/g, ' ').includes('학생 저장 목록 2') && await pg.locator('.tsub button.on[data-tsub="check"]').count() === 1 && (await pg.locator('.tnote').textContent()).includes('이 기기에만'));
  const sv0 = SAVES.length; await pg.click('[data-mk="3|t"]'); await pg.waitForTimeout(1500);
  ok('선생님이 표시한 것은 이 기기에만 · 서버로 보내지 않음', await pg.locator('[data-mk="3|t"].on').count() === 1 && (await pg.evaluate(() => JSON.parse(localStorage.getItem('pre3_check_teacher') || '{}').m['3'])) === 't' && SAVES.length === sv0 && (await pg.locator('#ckSaved').textContent()).includes('이 기기에 저장됨'));
  await pg.click('[data-tsub="stulist"]'); await pg.waitForSelector('.trow[data-stu]');
  ok('[학생 저장 목록] = 학생들이 저장한 목록(pre3_checks 를 개인 로그인으로 읽음)', /#stulist/.test(pg.url()) && TCALLS.filter(c => /pre3_checks/.test(c.url) && /Bearer T-OK/.test(c.auth)).length === 1 && await pg.locator('.trow[data-stu]').count() === 2);
  ok('요약 줄 — 2명 저장 · 고2 2', (await pg.locator('.tsum').textContent()).replace(/\s+/g, ' ').includes('2명 저장 · 고2 2'));
  const r0 = await pg.locator('.trow[data-stu]').first().textContent();
  ok('최근 저장한 학생이 위 · 표시 3/30 · ○△× 수 · 이번 주 행동 · 희망 1순위', r0.startsWith('김철수') && r0.includes('3 / 30') && r0.includes('모의고사 국어 기출') && r0.includes('연세대학교 · 국어국문학과') && (await pg.locator('.trow[data-stu]').first().locator('.cs em').allTextContents()).join() === '1,1,1,0');
  await pg.fill('#tq', '영희'); await pg.waitForTimeout(100);
  ok('이름 찾기 — 1명', await pg.locator('.trow[data-stu]').count() === 1 && (await pg.locator('.trow[data-stu]').textContent()).startsWith('이영희'));
  await pg.fill('#tq', '');
  await pg.click('.trow[data-stu="11"]'); await pg.waitForSelector('.rohead');
  ok('학생을 누르면 #stu= 로 그 학생 체크리스트(읽기 전용)', /#stu=11/.test(pg.url()) && (await pg.locator('.rohead .who').textContent()).includes('김철수') && await pg.locator('#view.ro').count() === 1);
  ok('학생이 표시한 그대로 보임', await pg.locator('[data-mk="1|o"].on').count() === 1 && await pg.locator('[data-mk="7|t"].on').count() === 1 && (await pg.inputValue('#f3w')) === '야자 전' && (await pg.inputValue('#w1u')) === '연세대학교' && (await pg.inputValue('#h11k')) === '2');
  ok('선생님은 바꿀 수 없음(버튼·칸 잠김, 지우기 없음)', await pg.locator('[data-mk="1|o"]').isDisabled() && await pg.locator('#f3w').isDisabled() && await pg.locator('.rst').count() === 0 && (await pg.locator('#ckSaved').textContent()).includes('학생이 마지막으로 저장한 때'));
  await pg.locator('[data-mk="2|o"]').click({ force: true }).catch(() => {});
  ok('눌러도 표시가 안 바뀜 · 선생님 기기의 체크리스트에도 섞이지 않음', await pg.locator('[data-mk="2|o"].on').count() === 0 && !(await pg.evaluate(() => JSON.parse(localStorage.getItem('pre3_check_teacher') || '{}').m['2'])));
  await pg.click('[data-tback]'); await pg.waitForSelector('.trow[data-stu]');
  ok('[← 학생 목록]으로 돌아옴(#stulist)', /#stulist/.test(pg.url()) && await pg.locator('.trow[data-stu]').count() === 2);
  await pg.click('[data-tsub="check"]'); await pg.waitForSelector('.ci[data-no]');
  ok('[체크리스트]로 돌아오면 선생님 기기의 표시가 그대로', await pg.locator('[data-mk="3|t"].on').count() === 1 && await pg.locator('.tsub button.on[data-tsub="check"]').count() === 1);
  await pg.evaluate(() => { localStorage.removeItem('shueguk_teacher_session_v2'); localStorage.removeItem('pre3_check_teacher'); });
  await pg.goto(base + '/pre3.html?teacher=1&key=ABC#summary'); await pg.waitForSelector('.urow');
  ok('키가 있으면 학생 보기(pre3_list) 그대로', TCALLS.filter(c => /pre3_univs/.test(c.url)).length === 1 && !(await pg.locator('#tband').isVisible()));

  console.log('⑥ s.html 카드');
  const src = fs.readFileSync(path.join(ROOT, 's.html'), 'utf8');
  ok('허브에 [2028 대입 미리보기] 카드', src.includes("href=\"pre3.html?'+(IS_ID ? 'id=' : 'key=')") && src.includes('<h3>2028 대입 미리보기</h3>'));

  ok('페이지 오류 없음', perr === 0);
  await br.close(); srv.close();
  console.log(`\n${pass} 통과, ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
