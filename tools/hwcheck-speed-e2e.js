/* 숙제 검사(hwcheck.html) 속도 개선 브라우저 E2E (2026-09-12)
 * 가짜 수파베이스(재원생 485명·그 주 검사 기록·정규 시간표·출석·1회 이동)로 실제 페이지를 띄워
 *   ① 나눠 그리기 — 첫 덩어리가 먼저 보이고 결국 485명 전부, 접힌 메모·대책 칸은 비어 있음
 *   ② 캐시 방문 — 최신 데이터가 같으면 다시 그리지 않음 / 다르면 한 번 다시 그림
 *   ③ 보기 전용(2026-09-28, 035) — 학생마다 수업(가·나)별 기록 한 줄씩, 입력 칸·별 버튼 없음,
 *      미제출 대책 목록의 수업 표시와 [확인]이 그 수업 기록만 고치는지
 *   ④ 필터·학생 추가·?slot= 등 기존 동작 회귀
 * 를 검사한다. 원격에는 아무것도 보내지 않는다.
 *   실행: NODE_PATH=$(npm root -g) node tools/hwcheck-speed-e2e.js */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const PORT = 8991, SB = 'https://bangdbhqpphqqdwcledg.supabase.co';
let n = 0, bad = 0;
const ok = (c, l) => { n++; if (!c) { bad++; console.error('  ✗', l); } else console.log('  ✓', l); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── 가짜 데이터 ── */
function weekStartOf(d){ const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 4) % 7)); return x; }
const ymd = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const WED = weekStartOf(new Date()), WEEK = ymd(WED);
const dayOf = i => ymd(new Date(WED.getFullYear(), WED.getMonth(), WED.getDate() + i));
const GRADES = ['2026 고등 1학년', '2026 고등 2학년', '2026 고등 3학년', '2026 중등 2학년', '2026 중등 3학년'];
const SLOTS = ['수 5:30', '수 7:00', '목 5:30', '금 5:30', '토 2:00', '토 6:00', '일 11:00', '일 2:00'];
const NSLOTS = ['수 8:30', '목 7:00', '금 8:30', '토 9:00'];   // 내신 진도/확인 시간대(정규와 다르게)
const STUDENTS = [], CLASSES = [];
for (let i = 0; i < 485; i++){
  const name = '학생' + String(i + 1).padStart(3, '0');
  STUDENTS.push({ seq: i, id: i + 1, student_id: String(10000000 + i), name, school: ['화정고', '능곡고', '서정중', '무원고'][i % 4], grade: GRADES[i % 5],
    teacher: ['이수경', '김지원', '이은지'][i % 3], memo: '', class_a: SLOTS[i % 8], class_b: i % 5 < 3 ? SLOTS[(i + 3) % 8] : '', naeshin_a: NSLOTS[i % 4], naeshin_b: i % 2 ? NSLOTS[(i + 2) % 4] : '', enrolled: '재원', code: 'tok' + String(i).padStart(4, '0'), reg_date: '' });
}
/* 반: 시간대마다 3개(학생 번호 %3로 배정) — 가/나 시간대 둘 다 그 반 명단에 들어간다 */
const CMAP = {};
STUDENTS.forEach((s, i) => { [s.class_a, s.class_b].filter(Boolean).forEach(slot => { const k = slot + '|' + (i % 3); (CMAP[k] = CMAP[k] || []).push(s.name); }); });
Object.keys(CMAP).sort().forEach((k, ci) => { const slot = k.split('|')[0]; CLASSES.push({ class_id: 'r' + String(ci + 1).padStart(3, '0'), day: slot.charAt(0), start_time: slot.slice(2), end_time: '', location: '본원', teacher: '슈', name: '반' + ci, roster: CMAP[k].join(' ') }); });
function classOf(s, slot){ return CLASSES.find(c => c.day + ' ' + c.start_time === slot && c.roster.split(' ').includes(s.name)); }
/* 내신 시간표(n###)·내신 출석 — 내신 주 검사용 */
const NCLASSES = [], NMAP = {};
STUDENTS.forEach((s, i) => { [s.naeshin_a, s.naeshin_b].filter(Boolean).forEach(slot => { const k = slot + '|' + (i % 2); (NMAP[k] = NMAP[k] || []).push(s.name); }); });
Object.keys(NMAP).sort().forEach((k, ci) => { const slot = k.split('|')[0]; NCLASSES.push({ class_id: 'n' + String(ci + 1).padStart(3, '0'), day: slot.charAt(0), start_time: slot.slice(2), end_time: '', location: '본원', teacher: '슈', name: '내신반' + ci, roster: NMAP[k].join(' ') }); });
const NATT = [];
STUDENTS.forEach((s, i) => { const c = NCLASSES.find(x => x.day + ' ' + x.start_time === s.naeshin_a && x.roster.split(' ').includes(s.name)); if (!c) return;
  NATT.push({ id: 5000 + i, date: dayOf('수목금토일'.indexOf(s.naeshin_a.charAt(0))), class_id: c.class_id, student: s.name, status: i === 4 ? '결석' : '출석', memo: '', book: '내신' }); });
let PERIOD = '정규';
const ATT = []; let aid = 1;
STUDENTS.forEach((s, i) => {
  const c = classOf(s, s.class_a); if (!c) return;
  const status = i === 7 ? '결석' : (i % 9 === 0 ? '지각' : '출석');
  ATT.push({ id: aid++, date: dayOf('수목금토일'.indexOf(s.class_a.charAt(0))), class_id: c.class_id, student: s.name, status, memo: status === '지각' ? '10분' : '', book: '정규' });
});
const S3 = STUDENTS[2], C3 = classOf(S3, S3.class_a), C3b = CLASSES.find(c => c.class_id !== C3.class_id && c.day === C3.day);
const LOGS = [{ id: 1, kind: '1회', book: '정규', student: S3.name, from_class_id: C3.class_id, to_class_id: C3b.class_id, reason: '학교 행사', at: WEEK + 'T10:00:00+09:00', apply_date: dayOf(1) }];
let RECORDS = [
  { week: WEEK, token: 'tok0000', class_id: 'r001', part: '가', class_name: '고1 가', scores: { '숙제 수행': 6, '오답 처리': 6 }, pct: 100, pub: '공개 메모 원본', priv: '비공개 메모 원본', missing: false, plan: '' },
  { week: WEEK, token: 'tok0000', class_id: 'r002', part: '나', class_name: '고1 나', scores: { '숙제 수행': 3, '오답 처리': 3 }, pct: 50, pub: '', priv: '', missing: false, plan: '' },
  { week: WEEK, token: 'tok0001', class_id: 'r003', part: '나', class_name: '고1 나', scores: { '숙제 수행': 0, '오답 처리': 0 }, pct: 0, pub: '', priv: '', missing: true, plan: '9/20 토 5:30에 재검사 약속' },
  { week: WEEK, token: 'tok0002', class_id: '', part: '', class_name: '', scores: { '숙제 수행': 3, '오답 처리': 3 }, pct: 50, pub: '', priv: '', missing: false, plan: '' },
];
const PLANS = [{ week: WEEK, token: 'tok0001', name: '학생002', school: '능곡고', grade: '2026 고등 2학년', plan: '9/20 토 5:30에 재검사 약속', missing: true, plan_done: false, class_id: 'r003', part: '나', class_name: '고1 나' }];
const saves = [], legacy = [], patches = [];

const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, ''));
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(p));
});
async function route(page){
  await page.route('**/*', r => {
    const u = r.request().url(), m = r.request().method();
    if (u.startsWith('http://127.0.0.1:' + PORT)) return r.continue();
    if (u.startsWith(SB + '/auth/')) return r.fulfill({ contentType: 'application/json', body: '{"access_token":"T","expires_in":3600}' });
    if (u.startsWith(SB + '/rest/v1/')){
      if (m === 'POST' && u.includes('/hwcheck_records')){ saves.push(JSON.parse(r.request().postData())[0]); return r.fulfill({ status: 201, body: '' }); }
      const j = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
      if (m === 'PATCH' && u.includes('/hwcheck_records')){ patches.push({ url: decodeURIComponent(u), body: JSON.parse(r.request().postData()) }); return j([{ id: 1 }]); }
      if (u.includes('/hwcheck_records?week')) return j(RECORDS);
      if (u.includes('/hwcheck_records?or')) return j(PLANS);
      const nae = u.includes(encodeURIComponent('내신'));
      if (u.includes('/tt_period')) return j(PERIOD === '내신' ? [{ book: '내신' }] : []);
      if (u.includes('/tt_classes')) return j(nae ? NCLASSES : CLASSES);
      if (u.includes('/attendance')) return j(nae ? NATT : ATT);
      if (u.includes('/tt_log')) return j(LOGS);
      if (u.includes('/students')) return j(STUDENTS);
      if (u.includes('/report_config')) return j([{ value: '숙제 수행,오답 처리' }]);
      return j([]);
    }
    if (/script\.google/.test(u)){ if (m === 'POST') legacy.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ contentType: 'application/json', body: '{"result":"success"}' }); }
    return r.fulfill({ status: 204, body: '' });
  });
}
const INIT = () => {
  window.__ev = []; window.__replaced = 0;
  const mark = n => window.__ev.push([n, Math.round(performance.now())]);
  document.addEventListener('DOMContentLoaded', () => {
    mark('DCL'); const L = document.getElementById('list'); if (!L) return;
    if (L.querySelector('.stu')) mark('cards@DCL');
    new MutationObserver(ms => { ms.forEach(m => { if (m.removedNodes.length && m.addedNodes.length) window.__replaced++; }); if (L.querySelector('.stu') && !window.__first) { window.__first = 1; window.__firstCount = L.querySelectorAll('.stu').length; mark('first-cards'); } }).observe(L, { childList: true });
  });
};
const cards = pg => pg.evaluate(() => document.querySelectorAll('#list .stu').length);

(async () => {
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => { bad++; console.error('  ✗ pageerror', e.message); });
  await route(page);
  await page.addInitScript(INIT);
  const URL = 'http://127.0.0.1:' + PORT + '/hwcheck.html';

  console.log('① 첫 방문 — 나눠 그리기');
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#list .stu');
  await page.waitForFunction(() => document.querySelectorAll('#list .stu').length === 485, { timeout: 15000 });
  const early = await page.evaluate(() => window.__firstCount);
  ok(early === 60, '첫 덩어리(' + early + '명)가 먼저 보이고 뒤이어 485명까지 채워진다');
  ok(await page.evaluate(() => document.querySelectorAll('#list textarea, #list input, #list .stars button').length) === 0, '보기 전용 — 입력 칸·별 버튼 없음');
  ok(await page.$eval('#count-note', e => e.textContent).then(t => /전체 485명/.test(t) && /결석 1명/.test(t)), '인원 표시: ' + await page.$eval('#count-note', e => e.textContent));
  ok(await page.evaluate(() => { const L = document.querySelectorAll('#list .stu'); return L[L.length - 1].id === 'stu-tok0007' && L[L.length - 1].classList.contains('away'); }), '이번 주 결석 학생은 맨 아래 + 흐림');
  ok(await page.evaluate(() => document.querySelector('#stu-tok0002 .tt-chip.once') && /1회 이동/.test(document.querySelector('#stu-tok0002 .tt-chip.once').textContent)), '1회 이동 칩 표시');
  ok(await page.evaluate(() => /지각/.test(document.querySelector('#stu-tok0009 .ttinfo').textContent)), '출석 칩(지각) 표시');
  const stat1 = await page.evaluate(() => document.getElementById('status').textContent);
  ok(stat1 === '', '상태 문구가 비워짐');

  console.log('② 캐시 방문 — 같은 데이터면 다시 그리지 않음');
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#list .stu').length === 485, { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('status').textContent === '', { timeout: 15000 });
  await sleep(600);
  let ev = await page.evaluate(() => ({ ev: window.__ev, replaced: window.__replaced }));
  ok(ev.replaced === 0, '캐시로 그린 화면을 다시 그리지 않았다(교체 0회)');
  const dcl = ev.ev.find(x => x[0] === 'DCL')[1], first = (ev.ev.find(x => x[0] === 'cards@DCL') || ev.ev.find(x => x[0] === 'first-cards'))[1];
  ok(first - dcl < 400, '캐시 첫 카드가 페이지 뜬 직후(' + (first - dcl) + 'ms 뒤)에 보인다');
  RECORDS = RECORDS.concat([{ week: WEEK, token: 'tok0010', class_id: 'r005', part: '가', class_name: '고1 가', scores: { '숙제 수행': 6, '오답 처리': 6 }, pct: 100, pub: '', priv: '', missing: false, plan: '' }]);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('status').textContent === '' && document.querySelectorAll('#list .stu').length === 485, { timeout: 15000 });
  await sleep(600);
  ev = await page.evaluate(() => ({ replaced: window.__replaced, pct: document.querySelector('#stu-tok0010 .rec-pct').textContent }));
  ok(ev.replaced === 1 && /100%/.test(ev.pct), '기록이 바뀌었으면 한 번 다시 그린다(교체 1회, 새 기록 반영)');

  console.log('③ 보기 전용 — 수업별 기록');
  const recs = await page.evaluate(() => Array.from(document.querySelectorAll('#stu-tok0000 .rec')).map(e => e.textContent));
  ok(recs.length === 2 && /가 수업/.test(recs[0]) && /고1 가/.test(recs[0]) && /100%/.test(recs[0]) && /나 수업/.test(recs[1]) && /50%/.test(recs[1]), '가·나 수업 기록이 한 줄씩: ' + recs.join(' | '));
  ok(await page.evaluate(() => document.querySelectorAll('#stu-tok0000 .rec')[0].querySelectorAll('.stars span.on').length) === 12, '별은 보기용 표시(가 수업 6+6)');
  ok(/기록 2개/.test(await page.$eval('#stu-tok0000 .pct', e => e.textContent)) && /만점 1/.test(await page.$eval('#stu-tok0000 .pct', e => e.textContent)), '카드 머리에 기록 수·만점 수');
  ok(/코멘트공개 메모 원본/.test(recs[0]) && /비공개 메모비공개 메모 원본/.test(recs[0]), '코멘트·비공개 메모가 글로 보인다');
  ok(/미제출/.test(await page.$eval('#stu-tok0001 .rec', e => e.textContent)) && /재검사 약속/.test(await page.$eval('#stu-tok0001 .rec', e => e.textContent)), '미제출 기록은 대책 글과 함께');
  ok(/반 구분 전 기록/.test(await page.$eval('#stu-tok0002 .rec', e => e.textContent)), '035 이전 기록은 "반 구분 전 기록"');
  ok(/미검사/.test(await page.$eval('#stu-tok0005 .pct', e => e.textContent)) && /아직 없어요/.test(await page.$eval('#stu-tok0005', e => e.textContent)), '기록 없는 학생은 미검사');
  ok(/기록 보기 전용/.test(await page.$eval('.view-note', e => e.textContent)) && /수업 기록/.test(await page.$eval('.view-note', e => e.textContent)), '보기 전용 안내가 보인다');
  await page.click('#plans-btn');
  await page.waitForSelector('.plan-card');
  ok(/나 수업 · 고1 나/.test(await page.$eval('.plan-card', e => e.textContent)), '미제출 목록에 수업 표시');
  await page.click('.plan-card .okbtn');
  await sleep(500);
  ok(patches.length === 1 && /class_id=eq\.r003/.test(patches[0].url) && /token=eq\.tok0001/.test(patches[0].url) && patches[0].body.plan_done === true, '[확인]은 그 수업 기록만 고친다: ' + (patches[0] || {}).url);
  ok(legacy.some(b => b.action === 'hwcheckPlanDone' && b.cls === 'r003'), '시트 사본에도 반ID를 함께 보냄');
  await page.click('#plans-btn');

  console.log('④ 필터·추가·주소 필터 회귀');
  await page.selectOption('#f-grade', '2026 고등 1학년');
  await page.waitForFunction(() => document.querySelectorAll('#list .stu').length === 97, { timeout: 5000 });
  ok(await page.evaluate(() => Array.from(document.querySelectorAll('#list .stu .nm small')).every(e => /고등 1학년/.test(e.textContent))), '학년 필터 → 97명, 전부 고1');
  await page.fill('#stu-search', '학생002');
  await page.click('#stu-results button');
  ok(await page.evaluate(() => document.querySelector('#list .stu').id === 'stu-tok0001' && !!document.querySelector('#list .stu .extra-badge')), '검색으로 추가한 학생이 맨 위에 "추가됨"');
  await page.goto(URL + '?slot=' + encodeURIComponent('토 6:00'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('status').textContent === '' && document.querySelectorAll('#list .stu').length > 0, { timeout: 15000 });
  await sleep(500);
  const slotN = await cards(page);
  ok(slotN > 0 && slotN < 485 && await page.$eval('#f-slot', e => e.value) === '토6:00', '?slot= 주소 필터 → ' + slotN + '명');

  console.log('⑤ 내신 주 — 내신 시간표·출석으로 읽는다');
  ok(!(await page.$eval('#wk-range', e => e.textContent)).includes('내신'), '정규 주에는 기간 표시 없음');
  PERIOD = '내신';
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('status').textContent === '' && /내신 기간/.test(document.getElementById('wk-range').textContent), { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#list .stu').length === 485, { timeout: 15000 });
  ok(true, '주차 표시에 “내신 기간”');
  ok(await page.evaluate(() => document.querySelectorAll('#list .ttinfo .tt-chip.ok').length) > 300, '내신 출석 칩이 보인다(' + await page.evaluate(() => document.querySelectorAll('#list .ttinfo .tt-chip').length) + '개)');
  ok(await page.evaluate(() => /수 8:30|수8:30/.test(document.querySelector('#stu-tok0000 .ttinfo').textContent)), '칩의 시간대가 학생의 내신 진도 시간대');
  ok(await page.evaluate(() => { const L = document.querySelectorAll('#list .stu'); return L[L.length - 1].id === 'stu-tok0004' && L[L.length - 1].classList.contains('away'); }), '내신 결석 학생이 맨 아래로');
  const slotOpts = await page.$$eval('#f-slot option', os => os.map(o => o.value).filter(Boolean));
  ok(slotOpts.length === 4 && slotOpts.every(v => /^(수8:30|목7:00|금8:30|토9:00)$/.test(v)), '시간대 필터가 내신 시간대: ' + slotOpts.join(','));
  await page.selectOption('#f-slot', '수8:30');
  await page.waitForTimeout(400);
  const expN = STUDENTS.filter(s => [s.naeshin_a, s.naeshin_b].map(v => v.replace(/\s+/g, '')).includes('수8:30')).length;
  ok(await page.evaluate(() => document.querySelectorAll('#list .stu').length) === expN, '내신 시간대 필터 → 그 시간대 학생만(' + expN + '명)');
  await page.goto(URL + '?cid=n001', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('status').textContent === '' && document.querySelector('#cid-note') && document.querySelector('#cid-note').style.display === 'flex', { timeout: 15000 });
  await page.waitForTimeout(400);
  const cidN = await page.evaluate(() => document.querySelectorAll('#list .stu').length);
  ok(cidN > 0 && cidN < 200 && /내신반0/.test(await page.$eval('#cid-note', e => e.textContent)), '시간표에서 내신 반(n001)으로 넘어오면 그 반 명단만: ' + cidN + '명');
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('status').textContent === '' && document.querySelectorAll('#list .stu').length === 485, { timeout: 15000 });
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => window.__replaced) === 0, '내신 주 캐시 방문도 다시 그리지 않음');
  PERIOD = '정규';
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('status').textContent === '' && !/내신/.test(document.getElementById('wk-range').textContent), { timeout: 15000 });
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => /지각/.test((document.querySelector('#stu-tok0009 .ttinfo') || {}).textContent || '') && window.__replaced === 1), '정규로 돌아오면 정규 출석으로 다시 그림(교체 1회)');

  await browser.close(); srv.close();
  console.log('\n' + (bad ? '✗ ' + bad + ' / ' + n + ' 실패' : '✓ ' + n + '건 모두 통과'));
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
