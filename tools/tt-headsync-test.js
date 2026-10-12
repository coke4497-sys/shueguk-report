#!/usr/bin/env node
/* 오늘·주차별 그리드 머리글(강사 열) 폭이 본문을 따라가는지 — 2026-10-12 원장님 "시간표 라인이 안맞아"
 *   머리글 폭을 그릴 때 한 번만 재서, 그 뒤 옆 패널이 열리며 본문 폭이 줄면 머리글만 넓은 채 남아
 *   강사 열과 카드가 한 칸씩 어긋났다. syncHeadWidth가 ResizeObserver로 본문 폭을 따라간다.
 *   NODE_PATH=$(npm root -g) node tools/tt-headsync-test.js
 * ① 처음 그린 뒤 머리글 폭 = 본문 폭, 카드가 자기 선생님 열 안에 있다
 * ② 본문 폭을 바꾸면(ch-on 토글 = 옆 패널 여닫기) 머리글이 따라오고 카드도 선생님 열 안에 있다
 * ③ 폭이 그대로면 다시 그리지 않는다(요청 수 그대로) */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
const DAYK = ['일','월','화','수','목','금','토'];
const today = new Intl.DateTimeFormat('ko-KR', { weekday: 'narrow', timeZone: 'Asia/Seoul' }).format(new Date());
const T = ['슈','선주','승연','주혜','현정','연주','현지','지원','덕기'];
// 오늘 요일에 강사 9명의 반 — 열이 많아야 어긋남이 눈에 띈다
const CLASSES = T.map((t, i) => ({ class_id: 'r0' + (i + 1), book: '정규', day: today, start_time: (i % 2 ? '5:30' : '1:00'), end_time: (i % 2 ? '7:00' : '4:00'),
  location: i < 3 ? '본원' : '화정센터', teacher: t, name: '고1 ' + t + '반', roster: '가나 다라 마바', kind: '' }));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
  let gets = 0;
  await ctx.route(/fonts\.g/, r => r.abort());
  await ctx.route(/script\.google\.com|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"success"}' }));
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (r.request().method() !== 'GET') return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    gets++;
    const json = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (/\/tt_classes/.test(u)) return json(CLASSES);
    return json([]);
  });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:' + port + '/timetable.html');
  await p.waitForSelector('.scrollwrap .fitgrid .blk', { timeout: 30000 });
  await p.waitForTimeout(1200);
  const measure = () => p.evaluate(() => {
    const gs = document.querySelector('.scrollwrap').querySelectorAll('.fitgrid');
    const hg = gs[0], g = gs[1];
    const heads = [...hg.querySelectorAll('.thead')].slice(1).filter(h => h.querySelector('b')).map(h => ({ t: h.querySelector('b').textContent, l: h.getBoundingClientRect().left, r: h.getBoundingClientRect().right }));
    const cards = [...g.querySelectorAll('.blk')].map(c => ({ t: (c.querySelector('b')||c).textContent.replace(/^고1 |반.*$/g, ''), l: c.getBoundingClientRect().left + 2 }));
    const wrong = cards.filter(c => { const h = heads.find(h => h.t === c.t); return !h || c.l < h.l || c.l > h.r; }).map(c => c.t);
    return { hw: Math.round(hg.getBoundingClientRect().width), gw: Math.round(g.getBoundingClientRect().width), n: cards.length, wrong };
  });
  let m = await measure();
  ok('① 처음: 머리글 폭 = 본문 폭', Math.abs(m.hw - m.gw) <= 1, m.hw + ' vs ' + m.gw);
  ok('① 처음: 카드 9개가 자기 선생님 열 안', m.n === 9 && !m.wrong.length, JSON.stringify(m));
  // ② 옆 패널 여닫기와 같은 본문 폭 변화(전환 없이 즉시) — 머리글이 따라와야 한다
  await p.evaluate(() => { document.body.style.transition = 'none'; document.body.classList.toggle('ch-on'); });
  await p.waitForTimeout(700);
  m = await measure();
  ok('② 폭이 바뀐 뒤: 머리글 폭 = 본문 폭', Math.abs(m.hw - m.gw) <= 1, m.hw + ' vs ' + m.gw);
  ok('② 폭이 바뀐 뒤: 카드가 자기 선생님 열 안', m.n === 9 && !m.wrong.length, JSON.stringify(m));
  await p.evaluate(() => { document.body.classList.toggle('ch-on'); });
  await p.waitForTimeout(700);
  m = await measure();
  ok('② 다시 바뀐 뒤에도 맞음', Math.abs(m.hw - m.gw) <= 1 && !m.wrong.length, JSON.stringify(m));
  // ③ 폭이 그대로면 다시 그리지 않는다
  const g0 = gets;
  await p.waitForTimeout(900);
  ok('③ 폭이 그대로면 다시 불러오지 않음', gets === g0, gets + ' vs ' + g0);
  await b.close(); srv.close();
  console.log((fail ? '✗ ' : '✓ ') + pass + '건 통과' + (fail ? ' · ' + fail + '건 실패' : ''));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
