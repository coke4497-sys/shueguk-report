/* 복기 점수 자동 계산(046, 2026-10-08 원장님 "틀린 문항을 체크하면 점수가 자동으로 기록되도록") — r.html.
 *   · 배점이 있는 시험: 100 − 틀린 문항 배점 합, 문항 카드에 'n점' 배지, 제출 본문 score 에 그 값
 *   · 배점이 없는 옛 시험: 문항당 100÷문항 수, 안내 문구
 *   · 예상 점수 입력칸(#f_score)은 없다
 *   NODE_PATH=$(npm root -g) node tools/r-score-e2e.js
 */
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m, extra) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (extra ? ' — ' + extra : ''))); };
function serve(){
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, '') || 'r.html');
      fs.readFile(f, (e, b) => e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'Content-Type': 'text/html' }), r.end(b)));
    }).listen(0, () => res(s));
  });
}
const Q = (no, pts, grp) => ({ no, area: '문학', qtype: '객관식', lv: '중', txt: '문항 ' + no, detail: '현대시', grp: grp || '', multi: false, pts });
const EXAM_PTS = { found: true, title: 'T1', scope: '', review: '총평',
  questions: [Q(1, 3), Q(2, 3.5, '(가) 현대시'), Q(3, 4.5, '(가) 현대시'), Q(4, 89)] };   // 합 100
const EXAM_OLD = { found: true, title: 'T2', scope: '', review: '총평',
  questions: [Q(1, 0), Q(2, 0), Q(3, null), Q(4, undefined), Q(5, 0), Q(6, 0), Q(7, 0), Q(8, 0)] };   // 배점 없음 → 12.5점씩

/* 틀린 문항 누르기 — 반성 칸이 .26s 로 펼쳐지므로 잠깐 기다린다 */
async function tap(pg, no){ await pg.click('.q[data-no="' + no + '"] .q-head'); await pg.waitForTimeout(350); }
async function open(br, port, exam, sent){
  const pg = await br.newContext().then(c => c.newPage());
  await pg.route('**/bangdbhqpphqqdwcledg.supabase.co/**', route => {
    const u = route.request().url();
    if (u.includes('/rpc/exam_bundle')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(exam) });
    if (u.includes('/rpc/mirror_submission')){ sent.push(JSON.parse(route.request().postData()).p); return route.fulfill({ status: 204, body: '' }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await pg.route('**/script.google.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"success"}' }));
  await pg.goto(`http://127.0.0.1:${port}/r.html?id=${encodeURIComponent(exam.title)}`, { waitUntil: 'networkidle' });
  return pg;
}

(async () => {
  const srv = await serve(), port = srv.address().port;
  const br = await chromium.launch();

  console.log('① 배점이 있는 시험');
  let sent = [];
  let pg = await open(br, port, EXAM_PTS, sent);
  ok(!(await pg.$('#f_score')), '예상 점수 입력칸이 없다');
  ok(/^점수/.test(await pg.textContent('label:has-text("점수")')), '칸 이름이 점수');
  ok(await pg.textContent('#scoreView') === '100점', '처음엔 100점');
  const tags = await pg.$$eval('.q .q-tag.pts', es => es.map(e => e.textContent));
  ok(JSON.stringify(tags) === JSON.stringify(['3점', '3.5점', '4.5점', '89점']), '문항마다 배점 배지', JSON.stringify(tags));
  await tap(pg, 2);
  await tap(pg, 3);
  ok(await pg.textContent('#scoreView') === '92점', '2·3번 틀림 → 92점', await pg.textContent('#scoreView'));
  ok(/배점 8점을 뺐어요/.test(await pg.textContent('#scoreNote')), '안내: 배점 8점을 뺐어요', await pg.textContent('#scoreNote'));
  await tap(pg, 2);   // 다시 누르면 풀림
  ok(await pg.textContent('#scoreView') === '95.5점', '2번 풀면 95.5점', await pg.textContent('#scoreView'));
  await tap(pg, 4);
  ok(await pg.textContent('#scoreView') === '6.5점', '4번(89점)까지 틀리면 6.5점', await pg.textContent('#scoreView'));
  await tap(pg, 1);
  ok(await pg.textContent('#scoreView') === '3.5점', '1·3·4 틀림 = 3.5점', await pg.textContent('#scoreView'));
  await tap(pg, 1); await tap(pg, 4);   // 3번만 남김 → 95.5
  await pg.fill('#f_name', '테스트학생'); await pg.fill('#f_school', '테스트고'); await pg.fill('#f_parent', '12345678');
  await pg.click('text=입력 완료 · 확인하기');
  ok(await pg.textContent('#r_score') === '95.5점', '확인 화면 점수 95.5점', await pg.textContent('#r_score'));
  ok(/^점수$/.test(await pg.textContent('#r_score').then(() => pg.$eval('#r_score', e => e.previousElementSibling.textContent))), '확인 화면 라벨 점수');
  await pg.click('#submitBtn');
  await pg.waitForFunction(() => document.getElementById('submitBtn').textContent === '제출됨', { timeout: 8000 });
  ok(sent.length === 1 && sent[0].score === '95.5' && sent[0].wrong_count === '1', '제출 본문 score 95.5 · 틀린 1', JSON.stringify(sent[0] && { score: sent[0].score, wc: sent[0].wrong_count }));

  console.log('② 배점이 없는 옛 시험 — 문항당 균등');
  sent = [];
  pg = await open(br, port, EXAM_OLD, sent);
  ok(await pg.textContent('#scoreView') === '100점', '처음 100점');
  ok(/문항당 12.5점으로 계산/.test(await pg.textContent('#scoreNote')), '균등 배점 안내', await pg.textContent('#scoreNote'));
  ok((await pg.$$eval('.q .q-tag.pts', es => es.map(e => e.textContent))).every(t => t === '12.5점'), '배지 12.5점');
  await tap(pg, 1); await tap(pg, 5); await tap(pg, 8);
  ok(await pg.textContent('#scoreView') === '62.5점', '3개 틀림 → 62.5점', await pg.textContent('#scoreView'));
  await pg.fill('#f_name', '학생2'); await pg.fill('#f_school', '테스트고'); await pg.fill('#f_parent', '12345678');
  await pg.click('text=입력 완료 · 확인하기'); await pg.click('#submitBtn');
  await pg.waitForFunction(() => document.getElementById('submitBtn').textContent === '제출됨', { timeout: 8000 });
  ok(sent.length === 1 && sent[0].score === '62.5', '제출 본문 score 62.5', JSON.stringify(sent[0] && sent[0].score));

  await br.close(); srv.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
