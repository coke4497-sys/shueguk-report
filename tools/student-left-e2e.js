/* 퇴원생 페이지 — 학생 기기에는 닫히고(088 left 응답·옛 경로 퇴원 정보) 로그인 선생님은 본다 (2026-11-20).
 * 실행: NODE_PATH=$(npm root -g) LC_ALL=C.UTF-8 node tools/student-left-e2e.js */
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const root = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m){ if (c){ pass++; console.log('✓', m); } else { fail++; console.log('✗', m); } }
const srv = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript' });
  r.end(fs.readFileSync(f));
});
(async () => {
  await new Promise(res => srv.listen(0, res));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const br = await chromium.launch();
  async function run(opts){
    const ctx = await br.newContext(); const pg = await ctx.newPage();
    const seen = [];
    await pg.route(/supabase\.co\/rest\/v1\/rpc\/student_bundle/, (rt) => {
      seen.push(rt.request().headers()['authorization'] || '');
      if (opts.bundleFail) return rt.fulfill({ status: 500, body: 'x' });
      rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.bundle) });
    });
    await pg.route(/supabase\.co\/rest\/v1\/rpc\/(?!student_bundle)/, rt => rt.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await pg.route(/script\.google\.com/, rt => rt.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(opts.legacy || { result: 'error', message: 'x' }) }));
    await pg.route(/fonts\.|coke4497-sys\.github\.io/, rt => rt.fulfill({ status: 200, body: '' }));
    if (opts.session) await pg.addInitScript(s => localStorage.setItem('shueguk_teacher_session_v2', s),
      JSON.stringify({ access_token: 'TEACHERJWT', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600, user: { id: 'u' } }));
    await pg.goto(base + '/s.html?key=ABC');
    await pg.waitForTimeout(1500);
    const err = await pg.evaluate(() => getComputedStyle(document.getElementById('errBox')).display !== 'none' ? document.getElementById('errTitle').textContent : '');
    const badge = await pg.evaluate(() => { const b = document.getElementById('s_badge'); return b && getComputedStyle(b).display !== 'none' ? b.textContent : ''; });
    await ctx.close();
    return { err, badge, seen };
  }
  // ① 학생 기기 — 서버가 left 응답
  let r = await run({ bundle: { found: true, left: true, me: { name: '강구현', enrolled: '퇴원' } } });
  ok(r.err === '열람할 수 없는 페이지입니다', '학생 기기 + left 응답이면 닫힘 (' + r.err + ')');
  ok(r.seen[0] && r.seen[0].indexOf('sb_publishable') >= 0, '로그인이 없으면 공개 키로 부름');
  // ② 수파베이스 실패 → 옛 경로가 퇴원 정보를 주면 학생 기기에서는 닫힘
  r = await run({ bundleFail: true, legacy: { result: 'success', info: { name: '강구현', enrolled: '퇴원' }, notices: [] } });
  ok(r.err === '열람할 수 없는 페이지입니다', '옛 경로로 온 퇴원생도 학생 기기에서는 닫힘');
  // ③ 선생님 기기 — 로그인 신분으로 부르고, 옛 경로 퇴원생도 열림 + 배지
  r = await run({ session: true, bundleFail: true, legacy: { result: 'success', info: { name: '강구현', enrolled: '퇴원' }, notices: [] } });
  ok(r.seen[0] === 'Bearer TEACHERJWT', '허브 로그인이 있으면 그 신분으로 student_bundle 을 부름');
  ok(!r.err, '선생님 기기에서는 퇴원생 페이지가 열림');
  ok(/퇴원 · 선생님만 보는 화면/.test(r.badge), '배지 "퇴원 · 선생님만 보는 화면" (' + r.badge + ')');
  await br.close(); srv.close();
  console.log(pass + ' 통과, ' + fail + ' 실패'); process.exit(fail ? 1 : 0);
})();
