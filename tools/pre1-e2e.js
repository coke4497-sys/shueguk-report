#!/usr/bin/env node
/* 예비 고1 학교 분석(pre1.html, 061 — 2026-11-03) 검증.
 *   LC_ALL=C.UTF-8 NODE_PATH=$(npm root -g) node tools/pre1-e2e.js
 * 가짜 pre1_list 로 전체 요약(비교 표·정렬·학교 카드)·학교 상세(구성·범위·분포·문항 거르기·총평·고난도·
 * 학습 포인트·앞뒤 학교)·점검표(표시·개수·저장·되살리기·고르기 목록·지우기)·오류 안내·s.html 카드를 본다.
 * 분석 글은 공개 저장소에 두지 않으므로 이 검사의 학교 자료는 가짜다. 실제 자료로 화면을 보려면
 * PRE1_JSON=<JSON 폴더> SHOT=<캡처 폴더> 로 돌린다(검사는 가짜 자료로만 판정). */
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const SHOT = process.env.SHOT || '';
const ok = (m, c, x) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (x ? ' ' + x : ''))); };

function fake(school, short, n, lv, extra){
  const qs = [];
  for (let i = 1; i <= n; i++) qs.push({ no: i, scope: '교과서 1(1) 〈가짜 작품〉', area: i <= n / 2 ? '문학' : '독서', lv: lv[i - 1], type: '객관식', text: short + ' ' + i + '번 내용' });
  const cnt = k => qs.filter(q => q.lv === k).length;
  return Object.assign({
    school, short, exam: '2026학년도 1학기 중간고사', subject: '공통국어1',
    cover: { items: '객관식 ' + n, areas: '문학 · 독서', hard: (cnt('상') + cnt('최상')) + '문항' },
    composition: { mc: n + '문항 · 100점', essay: '없음', book: short + '출판' },
    scope: { main: short + '출판 공통국어1 교과서 + 학교 프린트', rows: [{ label: '교과서', lines: ['1단원 〈가짜 작품〉', '2단원 〈둘째 작품〉'] }] },
    areaDist: [{ name: '문학', n: qs.filter(q => q.area === '문학').length }, { name: '독서', n: qs.filter(q => q.area === '독서').length }],
    levelDist: ['중', '중상', '상', '최상'].map(k => ({ name: k, n: cnt(k) })),
    distNote: ['〈보기〉 활용 3문항'], questions: qs, questionsNote: '전 문항 객관식입니다.',
    review: [short + ' 총평 첫 문단', '둘째 문단'], trends: [{ title: '문학 · 1~' + (n / 2) + '번', body: ['문학 경향'] }],
    hardTitle: '최상 ' + cnt('최상') + '문항',
    hard: qs.filter(q => q.lv === '최상').map(q => ({ no: q.no, lv: '최상', area: q.area, answer: '④', pts: '4.4점', title: q.no + '번 제목', key: '핵심 글', trap: '함정 글' })),
    pointsTitle: '다음 시험(기말) 대비 학습 포인트',
    points: [{ title: '포인트 하나', body: '설명', steps: [{ label: 'STEP 1', star: false, text: '첫 단계' }, { label: 'STEP 2', star: true, text: '둘째 단계' }] }],
    extra: [], notes: []
  }, extra || {});
}
let ITEMS = [
  { key: 'b-26-1m', school: '나고', exam: '2026학년도 1학기 중간고사', data: fake('나고', '나', 4, ['중', '상', '상', '최상'], { hard: [{ no: '3·4', lv: '', title: '묶은 칸', key: 'k', structure: '구조 글' }] }) },
  { key: 'a-26-1m', school: '가고', exam: '2026학년도 1학기 중간고사', data: fake('가고', '가', 6, ['중', '중상', '중상', '상', '최상', '최상']) }
];
if (process.env.PRE1_JSON){
  const dir = process.env.PRE1_JSON;
  ITEMS = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => { const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return { key: f.replace('.json', ''), school: d.school, exam: d.exam, data: d }; });
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
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u);
    if (m && m[1] === 'pre1_list'){
      CALLS.push(JSON.parse(rt.request().postData() || '{}').p || {});
      if (MODE === 'missing') return rt.fulfill({ status: 404, body: '{}' });
      if (MODE === 'nostudent') return rt.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"no_student"}' });
      return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: ITEMS }) });
    }
    if (m) return rt.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false}' });
    return rt.fulfill({ status: 204, body: '' });
  });
  const real = !!process.env.PRE1_JSON;

  console.log('① 전체 요약');
  await pg.goto(base + '/pre1.html?key=ABC', { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('table.cmp');
  ok('접근코드로 pre1_list 를 부름', CALLS[0] && CALLS[0].key === 'ABC');
  ok('[전체 요약] 탭이 켜짐', await pg.locator('#seg button.on').textContent() === '전체 요약');
  if (!real){
    const rows = await pg.locator('table.cmp tbody tr').allTextContents();
    ok('학교 이름순(가 → 나)', rows.length === 2 && rows[0].startsWith('가') && rows[1].startsWith('나'), JSON.stringify(rows));
    ok('문항 수·상·최상 비율', /6/.test(rows[0]) && /3/.test(rows[0]) && /50%/.test(rows[0]), rows[0]);
    await pg.click('[data-sort="hard"]');
    const r2 = await pg.locator('table.cmp tbody tr .sc').allTextContents();
    ok('상·최상 비율 높은 순(나 75% → 가 50%)', r2.join() === '나,가', r2.join());
    ok('난도 막대 칸 수', await pg.locator('table.cmp tbody tr:first-child .lvbar i').count() === 3);
    ok('학교 카드 두 장', await pg.locator('.sbox').count() === 2);
  }
  if (SHOT) await pg.screenshot({ path: path.join(SHOT, 'pre1-summary.png'), fullPage: true });

  console.log('② 학교 상세');
  await pg.locator('.sbox').first().click();
  await pg.waitForSelector('.shead');
  ok('주소가 #school=… 로', /#school=/.test(pg.url()));
  ok('[학교별 분석] 탭이 켜짐', await pg.locator('#seg button.on').textContent() === '학교별 분석');
  if (!real){
    ok('첫 카드 = 나고(정렬 유지)', (await pg.locator('.shead .nm').textContent()) === '나고');
    ok('섹션 1~8', (await pg.locator('.sec-t .n').allTextContents()).join() === '1,2,3,4,5,6,7,8');
    ok('범위 줄', (await pg.locator('.srow').textContent()).includes('〈둘째 작품〉'));
    ok('문항 4개', await pg.locator('.q').count() === 4);
    await pg.click('[data-qf="hard"]');
    ok('상·최상만 → 3개', await pg.locator('.q').count() === 3);
    await pg.click('[data-qf="독서"]');
    ok('독서만 → 2개', await pg.locator('.q').count() === 2);
    ok('묶은 고난도 칸·문항 구조', (await pg.locator('.hard').textContent()).includes('3·4번') && (await pg.locator('.hard').textContent()).includes('문항 구조'));
    ok('★ 단계 표시', await pg.locator('.step .sl.star').count() === 1);
    ok('학습 포인트 제목', (await pg.locator('.sec-t').nth(7).textContent()).includes('학습 포인트'));
    await pg.click('.nav2 [data-go]');
    await pg.waitForFunction(() => document.querySelector('.shead .nm').textContent === '가고').catch(() => {});
    ok('다음 학교 가고 + 거르기 풀림', (await pg.locator('.shead .nm').textContent()) === '가고' && await pg.locator('.q').count() === 6);
    ok('고난도 정답·배점', (await pg.locator('.hard').first().textContent()).includes('정답 ④'));
    await pg.goBack();
    await pg.waitForFunction(() => document.querySelector('.shead .nm') && document.querySelector('.shead .nm').textContent === '나고');
    ok('뒤로 가기 = 앞 학교', true);
  }
  if (SHOT){
    const keys = ITEMS.map(x => x.key);
    for (const k of keys){ await pg.goto(base + '/pre1.html?key=ABC#school=' + encodeURIComponent(k)); await pg.waitForSelector('.shead'); await pg.screenshot({ path: path.join(SHOT, 'pre1-' + k + '.png'), fullPage: true }); }
  }

  console.log('③ 나의 점검표');
  await pg.goto(base + '/pre1.html?key=ABC#check');
  await pg.waitForSelector('.ci');
  ok('29개 항목', await pg.locator('.ci').count() === 29);
  await pg.click('[data-mk="1|o"]'); await pg.click('[data-mk="2|t"]'); await pg.click('[data-mk="3|x"]');
  ok('개수 3/29', (await pg.locator('#ckCount').textContent()).includes('3/ 29'));
  await pg.click('[data-mk="3|x"]');
  ok('같은 표시 다시 누르면 풀림', (await pg.locator('#ckCount').textContent()).includes('2/ 29'));
  ok('1번 고르기 목록에 ○ 항목이 먼저', (await pg.locator('#f1n optgroup').first().getAttribute('label')) === '표시한 항목' && (await pg.locator('#f1n optgroup').first().locator('option').count()) === 1);
  await pg.selectOption('#f1n', '1');
  await pg.fill('#f3w', '학원 가기 전 10분');
  await pg.reload(); await pg.waitForSelector('.ci');
  ok('새로고침 뒤 표시 남음', await pg.locator('[data-mk="1|o"].on').count() === 1 && await pg.locator('[data-mk="2|t"].on').count() === 1);
  ok('새로고침 뒤 글·번호 남음', (await pg.inputValue('#f3w')) === '학원 가기 전 10분' && (await pg.inputValue('#f1n')) === '1');
  if (SHOT) await pg.screenshot({ path: path.join(SHOT, 'pre1-check.png'), fullPage: true });
  pg.once('dialog', d => d.accept());
  await pg.click('[data-rst]');
  ok('모두 지우기', (await pg.locator('#ckCount').textContent()).includes('0/ 29') && (await pg.inputValue('#f3w')) === '');
  const other = await ctx.newPage();
  await other.goto(base + '/pre1.html?key=XYZ#check'); await other.waitForSelector('.ci');
  ok('다른 학생 키는 따로 저장', (await other.locator('#ckCount').textContent()).includes('0/ 29'));
  await other.close();

  console.log('④ 오류 안내');
  await pg.goto(base + '/pre1.html'); await pg.waitForSelector('.msg');
  ok('주소에 키 없음', (await pg.locator('.msg').textContent()).includes('학생 페이지에서 열어'));
  await pg.click('[data-v="check"]'); await pg.waitForSelector('.ci');
  ok('키 없어도 점검표는 열림', await pg.locator('.ci').count() === 29);
  MODE = 'missing'; await pg.goto(base + '/pre1.html?key=A'); await pg.waitForSelector('.msg');
  ok('함수 없음(061 전) = 준비 중', (await pg.locator('.msg').textContent()).includes('준비 중'));
  MODE = 'nostudent'; await pg.goto(base + '/pre1.html?id=12345678'); await pg.waitForSelector('.msg');
  ok('학생ID로 부름', CALLS[CALLS.length - 1].student === '12345678');
  ok('학생 못 찾음 안내', (await pg.locator('.msg').textContent()).includes('찾지 못했'));
  MODE = 'ok';

  console.log('⑤ 휴대폰');
  const mp = await (await br.newContext({ viewport: { width: 390, height: 840 } })).newPage();
  await mp.route('**/rpc/pre1_list', rt => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: ITEMS }) }));
  await mp.goto(base + '/pre1.html?key=ABC'); await mp.waitForSelector('table.cmp');
  ok('가로 스크롤 없음(요약)', await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await mp.goto(base + '/pre1.html?key=ABC#school=' + ITEMS[0].key); await mp.waitForSelector('.shead');
  ok('가로 스크롤 없음(상세)', await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  if (SHOT) await mp.screenshot({ path: path.join(SHOT, 'pre1-mobile.png'), fullPage: true });
  await mp.goto(base + '/pre1.html?key=ABC#check'); await mp.waitForSelector('.ci');
  ok('가로 스크롤 없음(점검표)', await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

  console.log('⑥ s.html 카드');
  const src = fs.readFileSync(path.join(ROOT, 's.html'), 'utf8');
  ok('허브에 [예비 고1 학교 분석] 카드', src.includes("href=\"pre1.html?'+(IS_ID ? 'id=' : 'key=')") && src.includes('<h3>예비 고1 학교 분석</h3>'));

  ok('페이지 오류 없음', perr === 0);
  await br.close(); srv.close();
  console.log(`\n${pass} 통과, ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
