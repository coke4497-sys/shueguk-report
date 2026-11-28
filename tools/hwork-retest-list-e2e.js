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
  // 질문 목록 문구 (2026-11-17 원장님) — '새 답장 n'·'질문 n'·'오답하기 남음' 대신 문장
  const qaT = await pg.evaluate(() => { STATE.hwqa = [{ id: 1, code: 'A', teacher: 'T', ts: '2026-11-15 15:25', unread: 2, msgs: 4, done: true },
      { id: 2, code: 'B', teacher: 'T', ts: '2026-11-14 03:01', unread: 0, msgs: 0, done: false },
      { id: 3, code: 'C', teacher: 'T', ts: '2026-11-13 03:01', unread: 0, msgs: 2, done: true }];
    STATE.hwrt = []; return hwQaHtml().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); });
  ok('답장 — 질문에 답장이 왔습니다 · 숫자 알약 없음', /A .*질문에 답장이 왔습니다/.test(qaT) && !/새 답장|질문 4/.test(qaT), qaT);
  ok('오답 — 남은 오답이 있습니다', /B .*남은 오답이 있습니다/.test(qaT) && !/오답하기 남음/.test(qaT));
  ok('다 끝난 질문 — 지난 질문 보기', /C .*지난 질문 보기/.test(qaT));
  ok('페이지 오류 없음', perr === 0);
  // 같은 단원으로 나뉜 H WORK — 단원 카드 하나 → 누르면 세부 문제지 (2026-11-21 원장님)
  const g = await pg.evaluate(() => {
    STATE.hwqa = []; STATE.hwrt = [];
    STATE.homework = [
      { teacher: '이수경', code: 'Shuefit 독서: 문화를 담은 건축물 · 01 OX 쉬움 (17)', done: true },
      { teacher: '이수경', code: 'Shuefit 독서: 문화를 담은 건축물 · 02 모의고사형 (8)', done: false },
      { teacher: '이수경', code: 'Shuefit 독서: 문화를 담은 건축물 · 03 보기형 (6)', done: false },
      { teacher: '이수경', code: '[테스트] 어휘 1회', done: false },
      { teacher: '이수경', code: '[지필 워크북] 로봇 · 01 지문 학습 빈칸', done: true } ];
    renderHomework();
    const grp = [...document.querySelectorAll('#homeworkList .hw-grp')];
    const box = grp[0];
    const before = box && getComputedStyle(box.querySelector('.hw-parts')).display;
    box && box.querySelector('.hw-gh').click();
    const parts = box ? [...box.querySelectorAll('.hw-part')].map(p => ({ t: p.querySelector('.pt').textContent, d: p.classList.contains('done'), h: (p.tagName === 'A' ? p : (p.querySelector('a') || {})).getAttribute('href'), whole: p.tagName === 'A' })) : [];
    return { n: grp.length, head: box && box.querySelector('.hw-gh').textContent.replace(/\s+/g, ' '), before, after: box && getComputedStyle(box.querySelector('.hw-parts')).display, parts,
      singles: [...document.querySelectorAll('#homeworkList > .notice-item:not(.hw-grp) .ntitle')].map(e => e.textContent),
      cards: [...document.querySelectorAll('#homeworkList > .notice-item:not(.hw-grp)')].map(c => ({ whole: c.tagName === 'A', h: c.getAttribute('href'), done: c.classList.contains('done'), t: c.textContent, inner: !!c.querySelector('a') })) };
  });
  ok('단원 카드는 두 개 이상 나뉜 단원만 (하나뿐인 단원은 그대로)', g.n === 1 && g.singles.length === 2, JSON.stringify(g.singles));
  ok('단원 카드 — 이름 · 문제지 수 · 남은 수', /문화를 담은 건축물/.test(g.head) && /문제지 3개/.test(g.head) && /남은 2개/.test(g.head), g.head);
  ok('처음엔 접혀 있고 누르면 세부 문제지', g.before === 'none' && g.after === 'block', g.before + '→' + g.after);
  ok('세부 문제지 — 구간 이름·제출 여부·바로 열기', g.parts.length === 3 && g.parts[0].t.startsWith('01 OX 쉬움') && g.parts[0].d && /&done=1&(k|st)=/.test(g.parts[0].h) && /hwork\.html\?c=/.test(g.parts[1].h), JSON.stringify(g.parts));
  ok('세부 문제지 줄 전체가 링크 (2026-11-22)', g.parts.every(p => p.whole), JSON.stringify(g.parts.map(p => p.whole)));
  ok('낱개 카드 전체가 링크 — 안 낸 과제는 풀러 가기, 낸 과제는 오답하기', g.cards.length === 2 && g.cards.every(c => c.whole && /hwork\.html\?c=/.test(c.h)) && g.cards.some(c => !c.done && !/&done=1/.test(c.h) && /풀러 가기/.test(c.t)) && g.cards.some(c => c.done && /&done=1/.test(c.h)) && !g.cards.some(c => c.inner), JSON.stringify(g.cards));
  // 안 낸 과제는 배정이 오래된 것부터 (2026-11-25 원장님)
  const ord = await pg.evaluate(() => {
    STATE.hwqa = []; STATE.hwrt = [];
    STATE.homework = [   // 들어오는 차례는 최근 배정 먼저
      { teacher: '이수경', code: '새 과제 C', date: '2026-11-25', done: false },
      { teacher: '이수경', code: '같은 날 과제 B2', date: '2026-11-20', done: false },
      { teacher: '이수경', code: '같은 날 과제 B1', date: '2026-11-20', done: false },
      { teacher: '이수경', code: '낸 과제 Y', date: '2026-11-12', done: true },
      { teacher: '이수경', code: '낸 과제 Z', date: '2026-11-01', done: true },
      { teacher: '이수경', code: '오래된 과제 A', date: '2026-11-10', done: false } ];
    renderHomework();
    return [...document.querySelectorAll('#homeworkList > .notice-item .ntitle')].map(e => e.textContent.replace(/^\d+주차/, '').replace(/^이수경 · /, ''));
  });
  // 주차 표시 (2026-11-26 원장님 — 4주차 11/24~, 7일마다)
  const wk = await pg.evaluate(() => [...document.querySelectorAll('#homeworkList > .notice-item')].map(e => { const w = e.querySelector('.hwwk'); return w ? w.textContent : ''; }));
  ok('주차 표시 — 11/10·11/20·11/25 (11/1은 1주차 전이라 없음)', JSON.stringify(wk) === JSON.stringify(['2주차', '3주차', '3주차', '4주차', '', '2주차']), JSON.stringify(wk));
  ok('안 낸 과제는 오래된 배정부터 · 같은 날은 먼저 배정한 것 · 낸 과제도 아래에 오래된 배정부터', JSON.stringify(ord) === JSON.stringify(['오래된 과제 A', '같은 날 과제 B1', '같은 날 과제 B2', '새 과제 C', '낸 과제 Z', '낸 과제 Y']), JSON.stringify(ord));
  await br.close(); srv.close();
  console.log(`통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
