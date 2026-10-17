#!/usr/bin/env node
/* 학생 페이지 '예비 고1 반 신청'(053, 2026-10-17) 검증.
 *   NODE_PATH=$(npm root -g) node tools/plan-signup-e2e.js
 * plan_view 응답으로 내 가·나 반·신청 상태를 그리고, 나 반 고르기·바꾸기·취소, 가 반 옮기기(접이식),
 * 가·나 같은 요일 잠김·꽉 찬 반 잠금, 서버 거절 안내, 닫힌 상태, 허브 카드(대상·신청 중·이미 고름)를 확인한다. */
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (m, c, x) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (x ? ' ' + x : ''))); };
const C = (id, day, start, end, m, t, tname, part) => ({ id, day, start, end, m, teacher: t, tname, part });
const CLASSES = [
  C('토11:00-승연','토','11:00','1:00',660,'승연','이승연T','가'), C('토1:30-지원','토','1:30','3:30',810,'지원','김지원T','가'),
  C('토11:00-지원','토','11:00','1:00',660,'지원','김지원T','나'), C('토1:30-승연','토','1:30','3:30',810,'승연','이승연T','나'),
  C('일11:00-승연','일','11:00','1:00',660,'승연','이승연T','나'), C('수5:30-지원','수','5:30','7:30',1050,'지원','김지원T','나'),
  C('일1:30-승연','일','1:30','3:30',810,'승연','이승연T','나'), C('일4:30-지원','일','4:30','6:30',990,'지원','김지원T','가')];
const view = (o) => Object.assign({ ok: true, eligible: true, open: true, cap: 9, name: '박보검', ga: '토11:00-승연', na: '',
  classes: CLASSES.map(c => Object.assign({ cnt: c.id === '일11:00-승연' ? 9 : (c.id === '수5:30-지원' ? 7 : 3) }, c)) }, o || {});
(async () => {
  const srv = await new Promise(res => { const s = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, ''));
    fs.readFile(f, (e, b) => e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8' }), r.end(b)));
  }).listen(0, () => res(s)); });
  const port = srv.address().port;
  const br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  let perr = 0; pg.on('pageerror', e => { perr++; console.log('  ✗ pageerror', e.message); });
  let cur = view(), picks = [], next = null;
  await pg.route('**/*', rt => {
    const u = rt.request().url();
    if (u.startsWith('http://127.0.0.1:' + port)) return rt.continue();
    if (/\/rpc\/plan_view/.test(u)) return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cur) });
    if (/\/rpc\/plan_pick/.test(u)){
      const b = JSON.parse(rt.request().postData()); picks.push(b.p);
      const r = next ? next(b.p) : cur; next = null;
      if (r.ok) cur = r;
      return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
    }
    return rt.fulfill({ status: 204, body: '' });
  });
  await pg.goto('http://127.0.0.1:' + port + '/s.html', { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => { KEY = 'tok-park'; IS_ID = false; STATE.info = { name: '박보검', school: '화정중', grade: '중3' }; });
  pg.on('dialog', d => d.accept());

  // 화면 열기
  await pg.evaluate(() => openPlan());
  await pg.waitForSelector('.pl-mine');
  const mine = await pg.$eval('.pl-mine', e => e.textContent);
  ok('내 가 반 표시', /토 11:00~1:00/.test(mine) && /이승연T/.test(mine), mine);
  ok('나 반 아직', /아직 고르지 않았어요/.test(mine), mine);
  const stt = await pg.$eval('.pl-state', e => e.textContent);
  ok('신청 받는 중 안내(선착순·정원 9명·같은 요일 안 됨)', /선착순/.test(stt) && /9명까지/.test(stt) && /서로 다른 요일/.test(stt), stt);
  ok('나 고르기 안내에 같은 요일 금지', /같은 요일의 반은 고를 수 없습니다/.test(await pg.$eval('.pl-box .pl-sub', e => e.textContent)));
  const st = id => pg.$eval('.pl-box [data-pl="' + id + '"][data-plp="나"]', e => ({ dis: e.disabled, t: e.textContent }));
  let s1 = await st('토11:00-지원');
  ok('가와 같은 요일·같은 시간 나 반은 잠김', s1.dis && /가 수업과 같은 요일이에요/.test(s1.t), JSON.stringify(s1));
  s1 = await st('토1:30-승연');
  ok('가와 같은 요일이면 시간이 달라도 잠김', s1.dis && /가 수업과 같은 요일이에요/.test(s1.t), JSON.stringify(s1));
  s1 = await st('일11:00-승연');
  ok('꽉 찬 반은 잠김', s1.dis && /자리가 없어요/.test(s1.t), JSON.stringify(s1));
  s1 = await st('수5:30-지원');
  ok('남은 자리 2 — 적다고 표시', !s1.dis && /남은 자리 2/.test(s1.t) && await pg.$eval('[data-pl="수5:30-지원"][data-plp="나"] .left', e => e.classList.contains('few')), JSON.stringify(s1));
  ok('가 옮기기는 접혀 있음', !(await pg.$eval('details.pl-move', e => e.open)));
  ok('요일 순서(수 → 토 → 일)', (await pg.$$eval('.pl-box:not(.pl-move) .pl-day', e => e.map(x => x.textContent))).join() === '수요일,토요일,일요일');

  // 나 고르기
  next = p => view({ na: p.cls });
  await pg.click('[data-pl="일1:30-승연"][data-plp="나"]'); await pg.waitForTimeout(300);
  ok('plan_pick 본문', picks.length === 1 && picks[0].key === 'tok-park' && picks[0].part === '나' && picks[0].cls === '일1:30-승연', JSON.stringify(picks));
  ok('신청 안내', /나 수업을 일 1:30~3:30 이승연T 반으로 신청했어요/.test(await pg.$eval('#plMsg', e => e.textContent)));
  ok('내 반으로 표시', await pg.$eval('[data-pl="일1:30-승연"][data-plp="나"]', e => e.classList.contains('mine') && e.disabled && /지금 내 반/.test(e.textContent)));
  ok('취소 버튼 생김', !!(await pg.$('#plCancel')));
  // 꽉 찬 반 거절(서버)
  next = () => ({ ok: false, error: 'full' });
  await pg.click('[data-pl="수5:30-지원"][data-plp="나"]'); await pg.waitForTimeout(300);
  ok('서버가 꽉 찼다고 하면 안내 + 다시 불러옴', /방금 자리가 다 찼어요/.test(await pg.$eval('#plMsg', e => e.textContent)) && await pg.$eval('#plMsg', e => e.classList.contains('err')));
  ok('거절 뒤에도 내 나 반 그대로', /일 1:30~3:30/.test(await pg.$eval('.pl-slot.na', e => e.textContent)));
  // 가 옮기기
  await pg.click('details.pl-move > summary');
  let g = await pg.$eval('details.pl-move [data-pl="일4:30-지원"]', e => ({ dis: e.disabled, t: e.textContent }));
  ok('가를 나와 같은 요일로는 못 옮김(시간이 달라도)', g.dis && /나 수업과 같은 요일이에요/.test(g.t), JSON.stringify(g));
  next = p => view({ ga: p.cls, na: '일11:00-승연' });
  cur = view({ na: '일11:00-승연' }); await pg.evaluate(() => plRefresh()); await pg.waitForTimeout(200);
  await pg.click('details.pl-move [data-pl="토1:30-지원"]'); await pg.waitForTimeout(300);
  ok('가 옮기기 본문', picks[picks.length - 1].part === '가' && picks[picks.length - 1].cls === '토1:30-지원');
  ok('가 옮김 안내', /가 수업을 토 1:30~3:30 김지원T 반으로 옮겼어요/.test(await pg.$eval('#plMsg', e => e.textContent)));
  ok('펼친 접이식 유지', await pg.$eval('details.pl-move', e => e.open));
  // 취소
  next = () => view({ ga: '토1:30-지원', na: '' });
  await pg.click('#plCancel'); await pg.waitForTimeout(300);
  ok('나 취소 본문(빈 반)', picks[picks.length - 1].part === '나' && picks[picks.length - 1].cls === '');
  ok('취소 안내', /나 수업 신청을 취소했어요/.test(await pg.$eval('#plMsg', e => e.textContent)));
  // 닫힘
  cur = view({ open: false, na: '토1:30-승연' }); await pg.evaluate(() => plRefresh()); await pg.waitForTimeout(200);
  ok('닫히면 고르기 없음', !(await pg.$('[data-pl]')) && /신청 기간이 아닙니다/.test(await pg.$eval('.pl-state', e => e.textContent)));
  // 대상 아님
  cur = { ok: true, eligible: false, open: true }; await pg.evaluate(() => plRefresh()); await pg.waitForTimeout(200);
  ok('대상 아니면 안내', /대상이 아니에요/.test(await pg.$eval('#plBody', e => e.textContent)));
  ok('휴대폰 가로 넘침 없음', await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  // 허브 카드
  const card = async (v) => { cur = v; return pg.evaluate(async () => {
    await plRefresh();
    STATE.notices = []; STATE.homework = []; STATE.analyses = []; STATE.review = []; STATE.lhist = []; STATE.ahist = []; STATE.qq = [];
    try { renderHub(); } catch (e) { return 'ERR ' + e.message; }
    const c = [...document.querySelectorAll('#menu .card')].find(x => /2027 고1 반 신청/.test(x.textContent));
    return c ? c.textContent + (c.querySelector('.new-dot') ? ' [DOT]' : '') : null;
  }); };
  let t = await card(view());
  ok('허브 카드: 신청 중·안 고름 → 고르라는 안내 + 점', t && /나 수업을 골라 주세요/.test(t) && /\[DOT\]/.test(t), t);
  t = await card(view({ na: '토1:30-승연' }));
  ok('허브 카드: 이미 고름', t && /신청 완료/.test(t) && !/\[DOT\]/.test(t), t);
  t = await card(view({ open: false }));
  ok('허브 카드: 닫혀 있으면 없음(계획 비공개)', t === null, t);
  t = await card({ ok: true, eligible: false, open: true });
  ok('허브 카드: 대상 아니면 없음', t === null, t);
  ok('페이지 오류 없음', perr === 0);
  await br.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
