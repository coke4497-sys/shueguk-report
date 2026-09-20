#!/usr/bin/env node
/* '이 주만 추가' 학생을 다른 반으로 옮기기 검증 (timetable.html, 2026-09-20 수정 요청함 김상우).
 *   NODE_PATH=$(npm root -g) node tools/tt-tempmove-test.js
 * 배경: 주간추가 학생 칩을 누르면 출석 체크·되돌리기만 있고 다른 반으로 옮길 메뉴가 없었다.
 * 확인 대상 —
 * ① 주차별 '이 주' 칩 클릭 → 창에 [다른 반으로 옮기기] 버튼(주간빼기 학생 창에는 없음)
 * ② 버튼 → 옮길 주·반 선택 창, 같은 반 재선택은 오류로 막힘
 * ③ 옮기기 = timetableWeekAdd(새 반·그 요일 날짜) → timetableWeekCancel(원래 주간추가 row)
 * ④ 오늘의 시간표(mode today)에서는 옮기기 버튼이 없다(주차별 전용 — 되돌리기와 같은 규칙) */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
const TODAY = new Intl.DateTimeFormat('ko-KR', { weekday: 'narrow', timeZone: 'Asia/Seoul' }).format(new Date());
const TODAYSTR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const mk = (id, day, st, en, loc, t, cls, stu) => ({ id, day, start: st, end: en, loc, teacher: t, cls, students: stu });
const CLASSES = [
  mk('rA', TODAY, '3:30', '5:00', '화정센터', '지원', '고1 확인', ['가나다', '라마바']),
  mk('rB', TODAY, '7:00', '8:30', '화정센터', '지원', '고1 확인B', ['사아자']),
];
// 철수 = rA에 '이 주만 추가'(row 77) / 라마바 = rA에서 '이 주만 빼기'(row 78)
const RECS = [
  { row: 77, kind: '주간추가', date: TODAYSTR, student: '철수', fromId: '', toId: 'rA', reason: '테스트 추가' },
  { row: 78, kind: '주간빼기', date: TODAYSTR, student: '라마바', fromId: 'rA', toId: '', reason: '' },
];
(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
  await ctx.route(/script\.google\.com|supabase\.co|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' }));
  await ctx.route(/fonts\.g/, r => r.abort());
  async function open(mode){
    const page = await ctx.newPage();
    await page.addInitScript(({ cls, mode }) => {
      sessionStorage.setItem('tt_mode', mode); sessionStorage.setItem('tt_book', '정규');
      localStorage.setItem('ttc:list:정규', JSON.stringify({ t: Date.now(), d: { classes: cls, onceMoves: [] } }));
    }, { cls: CLASSES, mode });
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    return page;
  }

  // ── 주차별: 칩 → 창 → 옮기기 흐름
  let page = await open('week');
  await page.waitForSelector('.wk-mini', { timeout: 15000 });
  await page.evaluate(({ recs, day }) => {
    weekOnce = recs; keepScroll = false; weekZoomDay = day; render();
    window.__calls = []; window.post = function(b2, msg, cb){ __calls.push(b2); cb({ result: 'success' }); };
    window.loadWeek = function(){};
  }, { recs: RECS, day: TODAY });
  await page.waitForSelector('.blk .stus button', { timeout: 15000 });

  // ① '이 주' 칩 → [다른 반으로 옮기기] 있음
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll('.blk .stus button')].find(x => /철수/.test(x.textContent) && /이 주/.test(x.textContent));
    chip.click();
  });
  let r = await page.evaluate(() => {
    const m = document.getElementById('modal');
    const btns = [...m.querySelectorAll('button')].map(x => x.textContent.trim());
    return { on: m.classList.contains('on'), txt: m.textContent, btns };
  });
  ok('칩 클릭 = 이 주만 추가 창', r.on && /이 주만 추가된 학생/.test(r.txt), (r.txt || '').slice(0, 60));
  ok('창에 [다른 반으로 옮기기]', r.btns.includes('다른 반으로 옮기기'), JSON.stringify(r.btns));
  ok('창에 [되돌리기]도 그대로', r.btns.includes('되돌리기'), JSON.stringify(r.btns));

  // ② 옮기기 창 — 반 선택·같은 반 차단
  await page.evaluate(() => {
    [...document.querySelectorAll('#modal button')].find(x => x.textContent.trim() === '다른 반으로 옮기기').click();
  });
  r = await page.evaluate(() => {
    const m = document.getElementById('modal');
    return { txt: m.textContent, hasSel: !!m.querySelector('#sm-cls'), hasWeek: !!m.querySelector('#sm-week') };
  });
  ok('옮기기 창 열림(반·주 선택)', /다른 반으로 옮기기/.test(r.txt) && r.hasSel && r.hasWeek, (r.txt || '').slice(0, 60));
  r = await page.evaluate(() => {
    document.getElementById('sm-cls').value = 'rA';   // 같은 반 = 오류
    [...document.querySelectorAll('#modal button')].find(x => x.textContent.trim() === '옮기기').click();
    return { err: document.getElementById('sm-err').textContent, calls: __calls.length };
  });
  ok('같은 반 재선택은 오류로 막힘', /같은 주·같은 반/.test(r.err) && r.calls === 0, r.err);

  // ③ rB로 옮기기 = 주간추가(rB) + 주간반추가 기록(row 77) 삭제
  r = await page.evaluate(() => {
    document.getElementById('sm-cls').value = 'rB';
    document.getElementById('sm-reason').value = '시간이 안 맞아서';
    [...document.querySelectorAll('#modal button')].find(x => x.textContent.trim() === '옮기기').click();
    return { calls: __calls };
  });
  ok('저장 2회(추가 → 기록 정리)', r.calls.length === 2, JSON.stringify(r.calls));
  const c1 = r.calls[0] || {}, c2 = r.calls[1] || {};
  ok('① timetableWeekAdd → rB·오늘 날짜·사유', c1.action === 'timetableWeekAdd' && c1.toId === 'rB' && c1.student === '철수' && c1.date === TODAYSTR && c1.reason === '시간이 안 맞아서', JSON.stringify(c1));
  ok('② timetableWeekCancel → 원래 기록 row 77', c2.action === 'timetableWeekCancel' && c2.row === 77, JSON.stringify(c2));
  ok('완료 문구에 옮긴 반 이름', await page.evaluate(() => document.getElementById('status').textContent).then(t => /고1 확인B/.test(t) && /옮겼어요/.test(t)), await page.evaluate(() => document.getElementById('status').textContent));

  // '이 주만 빼기' 학생 창에는 옮기기 버튼이 없다 (빠진 학생은 명단이 원본 — 옮길 대상이 아님)
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll('.blk .stus button')].find(x => /라마바/.test(x.textContent));
    chip.click();
  });
  r = await page.evaluate(() => {
    const m = document.getElementById('modal');
    return { txt: m.textContent, btns: [...m.querySelectorAll('button')].map(x => x.textContent.trim()) };
  });
  ok('빼기 학생 창 = 옮기기 버튼 없음', /이 주만 빠진 학생/.test(r.txt) && !r.btns.includes('다른 반으로 옮기기') && r.btns.includes('되돌리기'), JSON.stringify(r.btns));
  await page.close();

  // ── ④ 오늘의 시간표: 창은 열리되 옮기기·되돌리기 버튼 없음(주차별 전용)
  page = await open('today');
  await page.waitForSelector('.grid.fitgrid .blk', { timeout: 15000 });
  await page.evaluate((recs) => {
    onceMoves = recs.map(o => Object.assign({}, o, { ymd: o.date })); keepScroll = false; render();
  }, RECS);
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll('.blk .stus button')].find(x => /철수/.test(x.textContent));
    chip.click();
  });
  r = await page.evaluate(() => {
    const m = document.getElementById('modal');
    return { on: m.classList.contains('on'), btns: [...m.querySelectorAll('button')].map(x => x.textContent.trim()) };
  });
  ok('오늘: 창 열림 + 옮기기·되돌리기 없음', r.on && !r.btns.includes('다른 반으로 옮기기') && !r.btns.includes('되돌리기'), JSON.stringify(r.btns));
  await page.close();

  await b.close(); srv.close();
  console.log((fail ? '✗ ' : '✓ ') + pass + '/' + (pass + fail) + ' 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
