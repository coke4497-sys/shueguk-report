/* 복기 제출(r.html) — 한 번 제출하면 원본에 **한 줄만** 들어가는지 확인한다.
 *
 * 2026-09-30에 이 검사를 만든 이유: mirror_submission 함수는 `returns void`라
 * HTTP 204 + 빈 본문으로 답하는데, 어댑터의 sbRpc가 r.json()을 그대로 불러
 * **저장이 성공했는데도** 예외가 났다. 그러면 폴백으로 빠져 mirror_submission을
 * 두 번 더 불러 같은 제출이 2~3줄로 들어갔다(9/23~9/29 학생 6명, 조교 화면에
 * 같은 학생이 여러 번 보였다). 응답 모양을 바꾸는 코드를 손대면 이 검사를 돌릴 것.
 *
 *   NODE_PATH=$(npm root -g) node tools/r-submit-e2e.js
 */
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

function serve(){
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, '') || 'r.html');
      fs.readFile(f, (e, b) => e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'Content-Type': 'text/html' }), r.end(b)));
    }).listen(0, () => res(s));
  });
}

const EXAM = { found: true, title: '26-2-중간-테스트고1-공통국어2', scope: '1~3단원', review: '총평',
  questions: [{ no: 1, area: '문학', qtype: '내용 일치', lv: '중', txt: '문항 1', detail: '현대시', grp: '', multi: false },
              { no: 2, area: '독서', qtype: '추론', lv: '상', txt: '문항 2', detail: '과학', grp: '', multi: false }] };

(async () => {
  const srv = await serve(), port = srv.address().port;
  const br = await chromium.launch();
  const pg = await br.newContext().then(c => c.newPage());
  const calls = { mirror: 0, sheet: 0 };

  // 수파베이스 — exam_bundle 은 JSON, mirror_submission 은 실제 배포처럼 204 + 빈 본문
  await pg.route('**/bangdbhqpphqqdwcledg.supabase.co/**', route => {
    const u = route.request().url();
    if (u.includes('/rpc/exam_bundle')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EXAM) });
    if (u.includes('/rpc/mirror_submission')){ calls.mirror++; return route.fulfill({ status: 204, body: '' }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  // 시트 사본(앱스스크립트) — 성공 응답
  await pg.route('**/script.google.com/**', route => {
    if (route.request().method() === 'POST') calls.sheet++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'success' }) });
  });

  await pg.goto(`http://127.0.0.1:${port}/r.html?id=26-2-중간-테스트고1-공통국어2`, { waitUntil: 'networkidle' });

  console.log('① 제출 한 번 = 원본 한 줄');
  await pg.fill('#f_name', '테스트학생');
  await pg.fill('#f_school', '테스트고');
  await pg.fill('#f_parent', '12345678');
  await pg.fill('#f_score', '88');
  await pg.click('#f_vow');
  await pg.fill('#f_vow', '다음엔 더 꼼꼼히');
  await pg.click('text=입력 완료 · 확인하기');
  await pg.click('#submitBtn');
  await pg.waitForFunction(() => document.getElementById('submitBtn').textContent === '제출됨', { timeout: 8000 });

  ok(calls.mirror === 1, `원본 저장 호출 1번 (실제 ${calls.mirror}번)`);
  ok(calls.sheet === 1, `시트 사본 전송 1번 (실제 ${calls.sheet}번)`);
  ok(await pg.textContent('#submitBtn') === '제출됨', '버튼이 제출됨으로 바뀜');
  ok(await pg.$eval('#doneMark', e => e.classList.contains('show')), '제출 완료 표시');

  // 3초 재시도 타이머가 걸려 있었다면 여기서 드러난다
  await pg.waitForTimeout(4000);
  ok(calls.mirror === 1, `4초 뒤에도 저장 호출은 그대로 1번 (실제 ${calls.mirror}번)`);

  console.log('② 원본이 정말 실패하면 시트 사본으로 폴백한다');
  const p2 = await br.newContext().then(c => c.newPage());
  const c2 = { mirror: 0, sheet: 0 };
  await p2.route('**/bangdbhqpphqqdwcledg.supabase.co/**', route => {
    const u = route.request().url();
    if (u.includes('/rpc/exam_bundle')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EXAM) });
    if (u.includes('/rpc/mirror_submission')){ c2.mirror++; return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await p2.route('**/script.google.com/**', route => {
    if (route.request().method() === 'POST') c2.sheet++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'success' }) });
  });
  await p2.goto(`http://127.0.0.1:${port}/r.html?id=26-2-중간-테스트고1-공통국어2`, { waitUntil: 'networkidle' });
  await p2.fill('#f_name', '테스트학생2');
  await p2.fill('#f_school', '테스트고');
  await p2.fill('#f_parent', '87654321');
  await p2.fill('#f_score', '70');
  await p2.click('text=입력 완료 · 확인하기');
  await p2.click('#submitBtn');
  await p2.waitForFunction(() => document.getElementById('submitBtn').textContent === '제출됨', { timeout: 8000 });
  ok(c2.sheet >= 1, `원본 실패 시 시트 사본으로 저장됨 (${c2.sheet}번)`);
  ok(await p2.textContent('#submitBtn') === '제출됨', '학생에게는 제출 완료로 보임');

  await br.close(); srv.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
