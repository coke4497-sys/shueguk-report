#!/usr/bin/env node
/* 예비 고3 인서울 15개 대학(pre3.html, 095 — 2026-11-28) 검증.
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
let MODE = 'ok', CALLS = [];

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
    if (m) return rt.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false}' });
    return rt.fulfill({ status: 204, body: '' });
  });
  const real = !!process.env.PRE3_JSON;
  const nUniv = ITEMS.filter(x => x.kind === 'univ').length;

  console.log('① 전체 요약');
  await pg.goto(base + '/pre3.html?key=ABC', { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('.ci');
  ok('처음 열면 [나의 점검표] — 탭 맨 앞', (await pg.locator('#seg button').first().textContent()) === '나의 점검표' && (await pg.locator('#seg button.on').textContent()) === '나의 점검표');
  await pg.locator('#seg button[data-v="summary"]').click();
  await pg.waitForSelector('.urow');
  ok('접근코드로 pre3_list 를 부름', CALLS[0] && CALLS[0].key === 'ABC');
  ok('[전체 요약] 탭이 켜짐', await pg.locator('#seg button.on').textContent() === '전체 요약');
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
  ok('[대학별 전형] 탭이 켜짐', await pg.locator('#seg button.on').textContent() === '대학별 전형');
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
    ok('전체 요약으로', await pg.locator('#seg button.on').textContent() === '전체 요약');
  }

  console.log('③ 나의 점검표');
  await pg.goto(base + '/pre3.html?key=ABC#check');
  await pg.waitForSelector('.ci');
  ok('30개 항목', await pg.locator('.ci').count() === 30);
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
  ok('저장 시각 줄', (await pg.locator('#ckSaved').textContent()).includes('이 기기에 저장됨'));
  ok('pre1 점검표와 따로 저장(pre3_check_)', await pg.evaluate(() => !!localStorage.getItem('pre3_check_ABC') && !localStorage.getItem('pre1_check_ABC')));
  if (SHOT) await pg.screenshot({ path: path.join(SHOT, 'pre3-check.png'), fullPage: true });
  pg.once('dialog', d => d.accept());
  await pg.click('[data-rst]');
  ok('모두 지우기', (await pg.locator('#ckProg').textContent()).includes('0 / 30') && (await pg.inputValue('#f3w')) === '');

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

  console.log('⑥ s.html 카드');
  const src = fs.readFileSync(path.join(ROOT, 's.html'), 'utf8');
  ok('허브에 [인서울 15개 대학 2028 입시 미리보기] 카드', src.includes("href=\"pre3.html?'+(IS_ID ? 'id=' : 'key=')") && src.includes('<h3>인서울 15개 대학 2028 입시 미리보기</h3>'));

  ok('페이지 오류 없음', perr === 0);
  await br.close(); srv.close();
  console.log(`\n${pass} 통과, ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
