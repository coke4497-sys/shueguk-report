#!/usr/bin/env node
/* 학생 페이지 H WORK — 개인 리테스트 목록(2026-11-17, 070) 검증.
 *   LC_ALL=C.UTF-8 NODE_PATH=$(npm root -g) node tools/hwork-retest-list-e2e.js
 * 가짜 hwork_student_extra · hwork_qa_mine 으로 허브 카드 설명·점과 H WORK 목록의 [리테스트 풀기]/결과 줄·주소(k / st)를 본다. */
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (m, c, x) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (x ? ' ' + x : ''))); };
const RT = [{ id: 5, teacher: '이현지', code: '[테스트] 문장 1회', n: 2, created_at: '2026-11-17 15:00', submitted_at: null },
            { id: 4, teacher: '이현지', code: '[테스트] 음운 1회', n: 3, created_at: '2026-11-16 15:00', submitted_at: '2026-11-16 20:00', got: 2, total: 3 }];
(async () => {
  const srv = await new Promise(res => { const s = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, ''));
    fs.readFile(f, (e, b) => e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8' }), r.end(b)));
  }).listen(0, () => res(s)); });
  const port = srv.address().port;
  const br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  let perr = 0; pg.on('pageerror', e => { perr++; console.log('  ✗ pageerror', e.message); });
  const calls = [];
  await pg.route('**/*', rt => {
    const u = rt.request().url();
    if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u);
    const json = o => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (m) calls.push({ fn: m[1], p: (JSON.parse(rt.request().postData() || '{}').p) || {} });
    if (m && m[1] === 'hwork_student_extra') return json({ ok: true, replies: [], retests: RT });
    if (m && m[1] === 'hwork_qa_mine') return json({ ok: true, list: [] });
    if (m) return json({ ok: false });
    return rt.fulfill({ status: 204, body: '' });
  });
  await pg.goto('http://127.0.0.1:' + port + '/s.html', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(300);
  const hub = (byId) => pg.evaluate(id => {
    KEY = id ? '12345678' : 'tok-kim'; IS_ID = !!id;
    STATE.info = { name: '김철수', school: '화정고', grade: '2026 고등 1학년', id: '12345678' };
    STATE.notices = []; STATE.analyses = []; STATE.homework = []; STATE.lhist = []; STATE.ahist = []; STATE.review = []; STATE.plan = null;
    STATE.smock = { grade: '고1', open: [], entries: [] }; STATE.stars = { total: 0, breakdown: {} };
    delete STATE.hwqa; delete STATE.hwrt;
    renderHub();
  }, byId);
  await hub(false); await pg.waitForTimeout(500);
  const card = await pg.evaluate(() => { const c = [...document.querySelectorAll('#menu .card')].find(x => /H-work/.test(x.textContent));
    return c ? { text: c.textContent.replace(/\s+/g, ' '), dot: (c.querySelector('.new-dot') || {}).textContent || '' } : null; });
  ok('허브 H WORK 카드 — 안 푼 리테스트 1개', card && /리테스트 1개/.test(card.text), card && card.text);
  ok('점에 리테스트 수', card && card.dot === '1', card && card.dot);
  ok('hwork_student_extra 를 접근코드로', calls.some(c => c.fn === 'hwork_student_extra' && c.p.key === 'tok-kim'));
  await pg.evaluate(() => openHomework()); await pg.waitForTimeout(400);
  const rows = await pg.evaluate(() => [...document.querySelectorAll('#homeworkView .hwqa-row')].map(a => ({ t: a.textContent.replace(/\s+/g, ' '), h: a.getAttribute('href') })));
  ok('목록 — 리테스트 두 줄', rows.length === 2, JSON.stringify(rows));
  ok('안 푼 것 — [리테스트 풀기 · 2문항] · rt=5&k=', rows[0] && /리테스트 풀기 · 2문항/.test(rows[0].t) && /hwork\.html\?rt=5&k=tok-kim$/.test(rows[0].h), rows[0] && rows[0].h);
  ok('푼 것 — 점수 · 결과 보기', rows[1] && /2 \/ 3 · 결과 보기/.test(rows[1].t));
  await hub(true); await pg.waitForTimeout(500);
  await pg.evaluate(() => openHomework()); await pg.waitForTimeout(400);
  const h2 = await pg.evaluate(() => (document.querySelector('#homeworkView .hwqa-row') || {}).getAttribute && document.querySelector('#homeworkView .hwqa-row').getAttribute('href'));
  ok('학생ID로 연 페이지 — st= 로 연다', /\?rt=5&st=12345678$/.test(h2 || ''), h2);
  ok('페이지 오류 없음', perr === 0);
  await br.close(); srv.close();
  console.log(`통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
