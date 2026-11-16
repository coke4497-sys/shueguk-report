#!/usr/bin/env node
/* 학생 페이지 H WORK — 선생님 답장·개인 리테스트(067, 2026-11-16) 검증.
 *   LC_ALL=C.UTF-8 NODE_PATH=$(npm root -g) node tools/hwork-extra-e2e.js
 * 가짜 hwork_student_extra 로 허브 카드 문구·점, 목록의 리테스트(풀기·결과)·선생님 답장(문항·내 답·도움 요청·새 답장 표시),
 * 본 뒤 '새 답장'이 꺼지는지, 오답하기 이어 하기 링크에 접근코드가 붙는지 본다. */
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const SHOT = process.env.SHOT || '';
const ok = (m, c, x) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (x ? ' ' + x : ''))); };
let EXTRA = { ok: true, replies: [], retests: [] }, CALLS = [], FCALLS = [], SCALLS = [];
(async () => {
  const srv = await new Promise(res => { const s = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, ''));
    fs.readFile(f, (e, b) => e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8' }), r.end(b)));
  }).listen(0, () => res(s)); });
  const port = srv.address().port;
  const br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  let perr = 0; pg.on('pageerror', e => { perr++; console.log('  ✗ pageerror', e.message); });
  await pg.route('**/*', rt => {
    const u = rt.request().url();
    if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u);
    const json = o => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (m && m[1] === 'hwork_student_extra'){ CALLS.push(JSON.parse(rt.request().postData() || '{}').p); return json(EXTRA); }
    if (m && m[1] === 'hwork_reply_file_url'){ const p = JSON.parse(rt.request().postData() || '{}').p; FCALLS.push(p);
      const f = { 11: ['r/41/a.png', '풀이.png', 'image/png'], 12: ['r/41/b.mp4', '설명.mp4', 'video/mp4'], 13: ['r/41/c.pdf', '정리.pdf', 'application/pdf'] }[p.file];
      return json(f ? { ok: true, bucket: 'hwork-reply-files', path: f[0], name: f[1], mime: f[2] } : { ok: false, error: 'not_mine' }); }
    if (u.includes('/storage/v1/object/authenticated/hwork-reply-files/')){ SCALLS.push({ u, auth: rt.request().headers()['authorization'] });
      return rt.fulfill({ status: 200, contentType: u.endsWith('.png') ? 'image/png' : 'application/octet-stream',
        body: u.endsWith('.png') ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') : Buffer.from('x') }); }
    if (m) return json({ ok: false });
    return rt.fulfill({ status: 204, body: '' });
  });
  await pg.goto('http://127.0.0.1:' + port + '/s.html', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(300);
  await pg.evaluate(() => localStorage.removeItem('hw_rp_seen'));
  const hub = () => pg.evaluate(() => {
    KEY = 'tok-kim'; IS_ID = false;
    STATE.info = { name: '김철수', school: '화정고', grade: '2026 고등 1학년', id: '12345678' };
    STATE.notices = []; STATE.analyses = []; STATE.lhist = []; STATE.ahist = []; STATE.review = []; STATE.plan = null;
    STATE.smock = { grade: '고1', open: [], entries: [] }; STATE.avail = [];
    STATE.homework = [{ teacher: '이수경', code: 'REAL 1권 03 파생어', done: true, date: '2026-11-10' }];
    STATE.stars = { total: 3, breakdown: { voca: 3 } };
    delete STATE.hwExtra;
    renderHub();
  });
  const card = () => pg.evaluate(() => {
    const c = [...document.querySelectorAll('#menu .card')].find(x => /H-work/.test(x.textContent));
    return c ? { text: c.textContent.replace(/\s+/g, ' '), dot: (c.querySelector('.new-dot') || {}).textContent || '' } : null;
  });

  // ① 아무것도 없으면 종전 그대로
  await hub(); await pg.waitForTimeout(300);
  let c = await card();
  ok('없으면 종전 문구·점 없음', c && /과제 모두 제출 완료/.test(c.text) && !c.dot, c && c.text);
  ok('접근코드로 조회', CALLS.length === 1 && CALLS[0].key === 'tok-kim', JSON.stringify(CALLS));

  // ② 리테스트 1(안 풂)·1(푼 것) + 답장 2
  EXTRA = { ok: true,
    retests: [{ id: 9, teacher: '이수경', code: 'REAL 1권 03 파생어', n: 3, created_at: '2026-11-16 15:00', submitted_at: null },
              { id: 8, teacher: '이수경', code: 'REAL 1권 02 형태소', n: 2, created_at: '2026-11-15 15:00', submitted_at: '2026-11-15 20:00', got: 1, total: 2 }],
    replies: [{ id: 41, teacher: '이수경', code: 'REAL 1권 03 파생어', q: '7', type: 'choice5', mine: '2', help: '접사 구분이 헷갈려요', cleared: false, text: '둘째 문단의 예시를 다시 보세요.\n접두사는 품사를 바꾸지 않아요.', by: '김현지', at: '2026-11-16 15:10' },
              { id: 41, teacher: '이수경', code: 'REAL 1권 03 파생어', q: '9', type: 'ox', mine: 'X', help: '', cleared: true, text: '맞아요!', by: '', at: '2026-11-16 15:00' }] };
  await hub(); await pg.waitForTimeout(400);
  c = await card();
  ok('허브: 리테스트 1개 · 새 답장 2개 · 점 3', c && /리테스트 1개/.test(c.text) && /새 선생님 답장 2개/.test(c.text) && c.dot === '3', c && JSON.stringify(c));

  await pg.evaluate(() => openHomework()); await pg.waitForTimeout(400);
  const t = await pg.textContent('#homeworkList');
  const secs = await pg.$$eval('#homeworkList .hw-sec', a => a.map(e => e.textContent));
  ok('구역 순서: 리테스트 → 선생님 답장 → 배정된 과제', JSON.stringify(secs) === JSON.stringify(['리테스트', '선생님 답장', '배정된 과제']), JSON.stringify(secs));
  const links = await pg.$$eval('#homeworkList a.hw-go', a => a.map(e => e.textContent.trim() + '|' + e.getAttribute('href')));
  ok('리테스트 풀기 링크 = rt·k', links.some(l => /^리테스트 풀기\|.*hwork\.html\?rt=9&k=tok-kim$/.test(l)), links.join('\n'));
  ok('푼 리테스트 = 점수 + 결과 보기', /리테스트 1 \/ 2/.test(t) && links.some(l => /^결과 보기\|.*rt=8&k=tok-kim$/.test(l)));
  ok('답장 카드: 문항·처음 답(②)·도움 요청 글·선생님 이름', /7번/.test(t) && /처음에 고른 답 ②/.test(t) && /접사 구분이 헷갈려요/.test(t) && /김현지 선생님의 답장/.test(t));
  ok('답장 줄바꿈 그대로', await pg.$eval('#homeworkList .hw-rp', e => getComputedStyle(e).whiteSpace === 'pre-wrap'));
  ok('도움 글이 비면 기본 문구 · 클리어 표시', /왜 틀렸는지 모르겠어요/.test(t) && /오답하기 클리어/.test(t));
  ok('새 답장 표시 2개', (await pg.$$eval('.hw-new', a => a.length)) === 2);
  ok('오답하기 이어 하기에 접근코드', links.some(l => /^오답하기 이어 하기\|.*done=1&k=tok-kim$/.test(l)), links.join('\n'));
  if (SHOT) await pg.screenshot({ path: path.join(SHOT, 'hw-extra-list.png'), fullPage: true });

  // ③ 닫고 돌아오면 새 답장 점이 꺼진다
  await pg.evaluate(() => closeHomework()); await pg.waitForTimeout(300);
  c = await card();
  ok('본 뒤 허브 점 = 리테스트 1만', c && c.dot === '1' && !/새 선생님 답장/.test(c.text), c && JSON.stringify(c));
  await pg.evaluate(() => openHomework()); await pg.waitForTimeout(300);
  ok('다시 열면 새 답장 표시 없음', (await pg.$$eval('.hw-new', a => a.length)) === 0);

  // ④ 배정 과제가 없어도 리테스트·답장은 보인다
  await pg.evaluate(() => { STATE.homework = []; renderHomework(); }); await pg.waitForTimeout(200);
  const secs2 = await pg.$$eval('#homeworkList .hw-sec', a => a.map(e => e.textContent));
  ok('배정 과제 없음 + 리테스트·답장', JSON.stringify(secs2) === JSON.stringify(['리테스트', '선생님 답장']) && !(await pg.$('#homeworkList .empty-state')), JSON.stringify(secs2));
  // ⑤ 답장 첨부 — 사진은 바로 작게, 영상은 눌러서 재생, 파일은 내려받기 (글 없이 파일만 있는 답장도 보임)
  EXTRA.replies[0].files = [{ id: 11, name: '풀이.png', size: 2048, mime: 'image/png' }, { id: 12, name: '설명.mp4', size: 3145728, mime: 'video/mp4' }, { id: 13, name: '정리.pdf', size: 51200, mime: 'application/pdf' }];
  EXTRA.replies[1] = Object.assign({}, EXTRA.replies[1], { text: '', files: [] });
  await pg.evaluate(() => { STATE.hwExtra = null; hwExtraRefresh(false); }); await pg.waitForTimeout(600);
  ok('사진 첨부가 바로 그림으로', await pg.$('#homeworkList .hw-rfimg img') !== null);
  ok('접근코드로 파일 창 열기', FCALLS.some(p => p.key === 'tok-kim' && p.file === 11), JSON.stringify(FCALLS));
  ok('공개 키로 받기', SCALLS.length >= 1 && /sb_publishable/.test(SCALLS[0].auth || ''), JSON.stringify(SCALLS[0]));
  ok('영상·파일 단추 이름·크기', /영상 보기 · 설명\.mp4 3\.0MB/.test(await pg.textContent('#homeworkList')) && /내려받기 · 정리\.pdf 50KB/.test(await pg.textContent('#homeworkList')));
  await pg.click('[data-hwrf="12"]'); await pg.waitForTimeout(400);
  ok('영상 보기 → 그 자리에서 재생 칸', await pg.$('#hwrfv12 video') !== null);
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 3000 }).catch(() => null), pg.click('[data-hwrf="13"]')]);
  ok('파일은 원래 이름으로 내려받기', dl && dl.suggestedFilename() === '정리.pdf', dl && dl.suggestedFilename());
  if (SHOT) await pg.screenshot({ path: path.join(SHOT, 'hw-reply-files.png'), fullPage: true });
  ok('페이지 오류 없음', perr === 0);
  console.log('\n통과 ' + pass + ' · 실패 ' + fail);
  await br.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
