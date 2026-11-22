// H WORK 별 +1 중지(2026-11-22) — 학생 페이지 별 집계가 11/21까지 낸 H WORK 만 세는지(091 ts 기준, ts 없으면 옛 제출로 셈). LC_ALL=C.UTF-8 NODE_PATH=$(npm root -g) node tools/hwork-star-stop-e2e.js
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const root = require('path').resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m){ if (c){ pass++; console.log('✓', m); } else { fail++; console.log('✗', m); } }
const srv = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript' });
  r.end(fs.readFileSync(f));
});
const me = { student_id:'12345678', name:'박보검', school:'화정고', grade:'2026 고등 2학년', enrolled:'재원', class_a:'수5:30', class_b:'', naeshin_a:'수5:30', naeshin_b:'목5:30', code:'tok-park', teacher:'이현지' };
function bundle(hw){
  return { found:true, me, share_count:1, name_dup_count:1, notices:[], notice_reads:[], star_bonus:[], hwcheck:[], submissions:[], exams:[], exam_questions:[],
    clinic_settings:[], gramma_results:[], gramma_sets:[], review_done:[], smock_entries:[], avail_responses:[], signup_settings:[], mock_signups:[], voca_results:[], hwork_submissions:hw, hwork_homeworks:[], assignments:[], config:[] };
}
(async () => {
  await new Promise(res => srv.listen(0, res));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const br = await chromium.launch();
  async function run(hw){
    const ctx = await br.newContext(); const pg = await ctx.newPage();
    await pg.route(/supabase\.co\/rest\/v1\//, rt => rt.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await pg.route(/supabase\.co\/rest\/v1\/rpc\/student_bundle/, rt => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bundle(hw)) }));
    await pg.route(/script\.google/, rt => { const m = rt.request().url().match(/callback=([^&]+)/); const payload = { result:'error', message:'x' };
      if (m) return rt.fulfill({ status:200, contentType:'text/javascript', body: m[1] + '(' + JSON.stringify(payload) + ')' }); rt.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(payload) }); });
    await pg.route(/fonts\.|coke4497-sys\.github\.io/, rt => rt.fulfill({ status: 200, body: '' }));
    await pg.goto(base + '/s.html?key=tok-park'); await pg.waitForTimeout(1500);
    const r = await pg.evaluate(() => ({ total: STATE.stars && STATE.stars.total, hwork: STATE.stars && STATE.stars.breakdown && STATE.stars.breakdown.hwork, label: (document.body.innerText.match(/H-work 과제[^\n]*/) || [''])[0] }));
    await ctx.close(); return r;
  }
  const S = (ts, code) => ({ teacher:'이수경', code, name:'박보검', school:'화정고', grade:'고2', ts });
  let r = await run([S('2026-11-21 20:10','A'), S('2026-11-22 15:11','B'), S('2026-11-23 09:00','C')]);
  ok(r.hwork === 1 && r.total === 1, '11/21 제출만 별 1 — 11/22·23 제출은 세지 않음: ' + JSON.stringify(r));
  r = await run([S(undefined,'A'), S(undefined,'B')]);
  ok(r.hwork === 2 && r.total === 2, '091 전(ts 없음)은 옛 제출로 보고 센다: ' + JSON.stringify(r));
  r = await run([S('2026-11-21 23:59','A'), S('2026-11-21 23:59','A')]);
  ok(r.hwork === 1, '같은 과제 두 번 제출은 1개 그대로: ' + JSON.stringify(r));
  r = await run([S('2026-11-22 00:01','A')]);
  ok(r.hwork === 0 && r.total === 0, '11/22 0시 1분 제출은 별 없음: ' + JSON.stringify(r));
  r = await run([S('2026-11-20 10:00','A')]);
  ok(/H-work 과제 \(11\/21까지\)/.test(r.label), '별 내역 라벨 (11/21까지): ' + r.label);
  await br.close(); srv.close();
  console.log('통과', pass, '· 실패', fail); process.exit(fail ? 1 : 0);
})();
