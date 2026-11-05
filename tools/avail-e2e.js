#!/usr/bin/env node
/* 학생 페이지 '시간표 조사'(062, 2026-11-05) 검증.
 *   LC_ALL=C.UTF-8 NODE_PATH=$(npm root -g) node tools/avail-e2e.js
 * 가짜 수파베이스(avail_mine/avail_submit)로 허브 카드(조사 있을 때만·점)·바로 열리는 입력 창·칸 누르기(가능↔안 돼요)·
 * 누가 적는지 필수·저장 본문·별 +1·고치기(학부모님)·마감 지난 조사 읽기 전용·오류 안내를 확인한다. */
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const SHOT = process.env.SHOT || '';
const shot = (pg, n, sel) => SHOT ? (sel ? pg.locator(sel).screenshot({ path: path.join(SHOT, n + '.png') }) : pg.screenshot({ path: path.join(SHOT, n + '.png'), fullPage: true })) : Promise.resolve();
const ok = (m, c, x) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (x ? ' ' + x : ''))); };

const SLOTS = [
  { id: '수-5:30', day: '수', start: '5:30', end: '7:30' }, { id: '수-8:00', day: '수', start: '8:00', end: '10:00' },
  { id: '토-11:00', day: '토', start: '11:00', end: '1:00' }, { id: '토-1:30', day: '토', start: '1:30', end: '3:30' }
];
let ITEMS = [], CALLS = [];
function reset(){
  ITEMS = [{ id: 7, title: '화정고1 새 시간표 조사', memo: '12/16부터 바뀌는 시간표입니다.', slots: SLOTS, due: '2099-12-31', closed: false, response: null }];
  CALLS = [];
}
function submit(p){
  const x = ITEMS.find(i => i.id === p.survey);
  if (!x) return { ok: false, error: 'no_survey' };
  if (!p.who) return { ok: false, error: 'no_who' };
  const first = !x.response;
  x.response = { no: p.no, memo: p.memo, last_by: p.who, at: '2026-11-05T10:00:00Z', updated_at: '2026-11-05T10:00:00Z' };
  return { ok: true, first, survey: x.id, no: p.no };
}
(async () => {
  const srv = await new Promise(res => { const s = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, ''));
    fs.readFile(f, (e, b) => e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8' }), r.end(b)));
  }).listen(0, () => res(s)); });
  const port = srv.address().port;
  const br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  let perr = 0; pg.on('pageerror', e => { perr++; console.log('  ✗ pageerror', e.message); });
  let failNext = '';
  await pg.route('**/*', rt => {
    const u = rt.request().url();
    if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u);
    const json = o => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (m && m[1] === 'avail_mine') return json({ ok: true, today: '2026-11-05', items: JSON.parse(JSON.stringify(ITEMS)) });
    if (m && m[1] === 'avail_submit'){
      const p = JSON.parse(rt.request().postData() || '{}').p || {};
      CALLS.push(p);
      if (failNext){ const e = failNext; failNext = ''; return json({ ok: false, error: e }); }
      return json(submit(p));
    }
    if (m) return json({ ok: false });
    return rt.fulfill({ status: 204, body: '' });
  });
  await pg.goto('http://127.0.0.1:' + port + '/s.html', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(300);
  const hub = () => pg.evaluate(() => {
    KEY = 'tok-kim'; IS_ID = false;
    STATE.info = { name: '김철수', school: '화정고', grade: '2026 고등 1학년', id: '12345678' };
    STATE.notices = []; STATE.analyses = []; STATE.homework = []; STATE.lhist = []; STATE.ahist = []; STATE.review = []; STATE.plan = null;
    STATE.smock = { grade: '고1', open: [], entries: [] };
    STATE.stars = { total: 3, breakdown: { voca: 3 } };
    delete STATE.avail;
    renderHub();
  });
  const card = () => pg.evaluate(() => {
    const c = [...document.querySelectorAll('#menu .card')].find(x => /시간표 조사/.test(x.textContent));
    return c ? { text: c.textContent.replace(/\s+/g, ' '), dot: (c.querySelector('.new-dot') || {}).textContent || '' } : null;
  });

  // ① 조사가 없으면 카드 없음
  ITEMS = []; await hub(); await pg.waitForTimeout(300);
  ok('조사 없으면 카드 없음', (await card()) === null);

  // ② 조사 있음 — 카드·점
  reset(); await hub(); await pg.waitForTimeout(300);
  let c = await card();
  ok('카드: 제목·안내·별 +1', c && /화정고1 새 시간표 조사 · 안 되는 시간을 골라 주세요 · 별 \+1/.test(c.text), c && c.text);
  ok('제출 안 한 조사 수 점', c && c.dot === '1');
  await shot(pg, 'avail-1-card', '#menu');

  // ③ 하나뿐이면 바로 입력 창
  await pg.evaluate(() => openAvail()); await pg.waitForTimeout(300);
  let t = await pg.textContent('#avBody');
  ok('바로 입력 창(안내·메모)', /수업이 안 되는 시간을 모두/.test(t) && /12\/16부터 바뀌는 시간표/.test(t), t.slice(0, 120));
  ok('요일별 칸 4개 · 처음엔 모두 가능', (await pg.$$eval('.av-s', a => a.length)) === 4 && (await pg.$$eval('.av-s.no', a => a.length)) === 0);
  ok('시간표 틀: 줄 = 요일(수·토)', JSON.stringify(await pg.$$eval('.av-grid .av-dy', a => a.map(e => e.textContent))) === JSON.stringify(['수', '토']));
  const tks = await pg.$$eval('.av-grid .av-tk', a => a.map(e => e.textContent));
  ok('가로축 = 30분 눈금 고정(오전 11:00 ~ 밤 10:00)', tks.length === 23 && tks[0] === '오전11:00' && tks[2] === '오후12:00' && tks[22] === '밤10:00', tks.join('|'));
  const g = await pg.evaluate(() => { const c = s => { const b = document.querySelector(s).getBoundingClientRect(); return b.left + b.width / 2; }; const t = [...document.querySelectorAll('.av-tk')].map(e => { const b = e.getBoundingClientRect(); return b.left + b.width / 2; }); const r = document.querySelector('[data-av-s="수-5:30"]').getBoundingClientRect(); return { l: r.left, r: r.right, t13: t[13], t17: t[17] }; });
  ok('칸이 눈금 선과 맞음(수 5:30~7:30)', Math.abs(g.l - g.t13) < 4 && Math.abs(g.r - g.t17) < 4, JSON.stringify(g));
  ok('빈 자리는 옅은 회색 바탕(요일 2줄 × 30분 22칸)', (await pg.$$eval('.av-bg', a => a.length)) === 44);
  ok('칸 안에 글자 없음 · 시간은 마우스를 올리면', (await pg.textContent('[data-av-s="수-5:30"]')) === '' && /수 오후 5:30~오후 7:30 · 가능/.test(await pg.getAttribute('[data-av-s="수-5:30"]', 'title')));
  const BOX = e => [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight].join(',');
  const box0 = await pg.$eval('[data-av-s="토-11:00"]', BOX);
  ok('모두 가능 안내', /모든 시간이 가능해요/.test(await pg.textContent('#avCnt')));

  // ④ 칸 누르기
  await pg.click('[data-av-s="토-11:00"]'); await pg.click('[data-av-s="수-8:00"]');
  ok('누른 칸 불가', (await pg.$$eval('.av-s.no', a => a.map(e => e.dataset.avS))).sort().join(',') === '수-8:00,토-11:00' && (await pg.textContent('[data-av-s="토-11:00"]')) === '불가');
  ok('눌러도 칸이 움직이지 않음', (await pg.$eval('[data-av-s="토-11:00"]', BOX)) === box0);
  ok('개수 안내', /안 되는 시간 2칸 · 가능한 시간 2칸/.test(await pg.textContent('#avCnt')));
  await pg.click('[data-av-s="수-8:00"]');
  ok('다시 누르면 가능', (await pg.$$eval('.av-s.no', a => a.length)) === 1);
  await pg.fill('#avMemo', '토요일 오전 다른 학원');

  // ⑤ 누가 적는지 필수
  await pg.click('#avSave'); await pg.waitForTimeout(150);
  ok('누가 적는지 안 고르면 막음', /누가 적고 있는지/.test(await pg.textContent('#avBody')) && CALLS.length === 0);
  ok('메모 유지', (await pg.inputValue('#avMemo')) === '토요일 오전 다른 학원');
  ok('안 고른 사이 칸 선택 유지', (await pg.$$eval('.av-s.no', a => a.length)) === 1);
  await shot(pg, 'avail-2-form');

  // ⑥ 학생으로 제출
  await pg.click('[data-av-who="학생"]'); await pg.click('#avSave'); await pg.waitForTimeout(400);
  const p1 = CALLS[0] || {};
  ok('저장 본문(조사·칸·메모·누가·키)', p1.survey === 7 && JSON.stringify(p1.no) === '["토-11:00"]' && p1.memo === '토요일 오전 다른 학원' && p1.who === '학생' && p1.key === 'tok-kim', JSON.stringify(p1));
  ok('제출 안내·별 +1', /별 \+1을 받았어요/.test(await pg.textContent('#avBody')));
  ok('별 합계 +1', (await pg.evaluate(() => STATE.stars.total)) === 4 && (await pg.evaluate(() => STATE.stars.breakdown.avail)) === 1);
  ok('마지막 저장 표시', /마지막 저장 · 학생/.test(await pg.textContent('#avBody')));

  // ⑦ 학부모님이 고침 — 별 다시 안 줌
  await pg.click('[data-av-s="토-1:30"]'); await pg.click('[data-av-who="학부모님"]'); await pg.click('#avSave'); await pg.waitForTimeout(400);
  const p2 = CALLS[1] || {};
  ok('고친 본문(학부모님·칸 둘)', p2.who === '학부모님' && JSON.stringify(p2.no) === '["토-11:00","토-1:30"]', JSON.stringify(p2));
  ok('고친 안내·별 그대로', /고친 내용을 저장했습니다/.test(await pg.textContent('#avBody')) && (await pg.evaluate(() => STATE.stars.total)) === 4);

  // ⑧ 서버 오류 안내
  failNext = 'past_due'; await pg.click('[data-av-who="학생"]'); await pg.click('#avSave'); await pg.waitForTimeout(300);
  ok('마감 오류 안내', /마감이 지나/.test(await pg.textContent('#avBody')));

  // ⑨ 메뉴로 → 카드는 제출함
  await pg.evaluate(() => avBack()); await pg.waitForTimeout(400);
  c = await card();
  ok('제출 뒤 카드: 제출함·점 없음', c && /제출함/.test(c.text) && !c.dot, c && c.text);

  // ⑩ 조사 둘 — 목록 · 마감 지난 조사는 읽기 전용
  reset();
  ITEMS.push({ id: 8, title: '지난 조사', memo: '', slots: SLOTS.slice(0, 2), due: '2026-11-01', closed: true,
               response: { no: ['수-5:30'], memo: '수요일 학교 보충', last_by: '학부모님', at: '2026-10-30T10:00:00Z', updated_at: '2026-10-31T10:00:00Z' } });
  await hub(); await pg.waitForTimeout(300);
  await pg.evaluate(() => openAvail()); await pg.waitForTimeout(300);
  t = await pg.textContent('#avBody');
  ok('두 조사 목록', /화정고1 새 시간표 조사/.test(t) && /지난 조사/.test(t) && /마감/.test(t), t.slice(0, 200));
  await pg.click('[data-av-open="8"]'); await pg.waitForTimeout(200);
  t = await pg.textContent('#avBody');
  ok('마감 조사 읽기 전용', /마감된 조사입니다/.test(t) && !(await pg.$('#avSave')) && (await pg.$$eval('.av-s:disabled', a => a.length)) === 2);
  ok('제출한 칸·메모 표시', (await pg.$$eval('.av-s.no', a => a.length)) === 1 && /수요일 학교 보충/.test(t));
  await pg.click('[data-av-s="수-8:00"]', { force: true });
  ok('마감 조사 칸 눌러도 그대로', (await pg.$$eval('.av-s.no', a => a.length)) === 1);
  await pg.evaluate(() => avBack()); await pg.waitForTimeout(200);
  ok('목록으로 돌아감', /지난 조사/.test(await pg.textContent('#avBody')));

  // ⑪ 별 내역 줄
  const html = fs.readFileSync(path.join(ROOT, 's.html'), 'utf8');
  ok('별 규칙·내역 줄(avail)', /avail: 1 \}/.test(html) && /'시간표 조사 제출', bd\.avail/.test(html) && /availN \* STAR_RULES\.avail/.test(html));
  ok('페이지 오류 없음', perr === 0);
  await br.close(); srv.close();
  console.log('\n' + pass + '건 통과, ' + fail + '건 실패');
  process.exit(fail ? 1 : 0);
})();
