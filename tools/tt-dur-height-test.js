#!/usr/bin/env node
/* 개요 카드·옆 요일 막대 높이가 수업 길이에 비례하는지 (timetable.html, 2026-09-10).
 *   NODE_PATH=$(npm root -g) node tools/tt-dur-height-test.js
 * 90·120·180분 반을 가짜 캐시로 넣고 전체 개요·주차별 개요·요일 확대의 옆 막대 높이를 잰다. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
const mk = (id, day, st, en, loc, t, cls, stu) => ({ id, day, start: st, end: en, loc, teacher: t, cls, students: stu });
const CLASSES = [
  mk('r090','토','11:00','12:30','화정센터','지원','고1 가',['가','나','다','라','마','바','사','아','자']),   // 90분
  mk('r120','토','1:30','3:30','본원','승연','정리정독 중3',['가','나']),                           // 120분
  mk('r180','토','6:00','9:00','본원','슈','고3파이널D',['가']),                                    // 180분
  mk('r091','일','2:00','3:30','화정센터','지원','고1 가',['가']),                                  // 90분(옆 막대용)
];
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.route(/script\.google\.com|supabase\.co|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' }));
  await ctx.route(/fonts\.g/, r => r.abort());
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
  const near = (a, b, tol) => Math.abs(a - b) <= (tol || 1.5);
  async function open(mode){
    const page = await ctx.newPage();
    await page.addInitScript(({ cls, mode }) => {
      sessionStorage.setItem('tt_mode', mode); sessionStorage.setItem('tt_book', '정규'); sessionStorage.removeItem('tt_allteacher');
      localStorage.setItem('ttc:list:정규', JSON.stringify({ t: Date.now(), d: { classes: cls, onceMoves: [] } }));
    }, { cls: CLASSES, mode });
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    await page.waitForSelector('.wk-mini', { timeout: 15000 });
    return page;
  }
  const hs = async (page) => page.$$eval('.wk-mini', els => Object.fromEntries(els.map(e => [e.getAttribute('data-cid'), e.getBoundingClientRect().height])));
  // 전체 개요
  let page = await open('all'); let h = await hs(page);
  ok('전체 개요: 120분 = 90분 × 4/3', near(h.r120, h.r090 * 4 / 3, 2), JSON.stringify(h));
  ok('전체 개요: 180분 = 90분 × 2', near(h.r180, h.r090 * 2, 2), JSON.stringify(h));
  ok('전체 개요: 90분 카드(좁은 열에서 세 줄)가 내용에 밀리지 않음', near(h.r090, 90 * 0.72, 2), String(h.r090));
  await page.evaluate(() => { allZoomDay = '일'; keepScroll = false; render(); });
  await page.waitForSelector('.wk-slim .wk-bar');
  const bars = (await page.$$eval('.wk-slim .wk-bar', els => els.map(e => e.getBoundingClientRect().height))).sort((a, b) => a - b);
  ok('전체 확대 옆 막대: 90·120·180 = 23·30·45', bars.length === 3 && near(bars[0], 23) && near(bars[1], 30) && near(bars[2], 45), JSON.stringify(bars));
  await page.close();
  // 주차별 개요 (출석 요약 줄이 있어 카드가 한 줄 더)
  page = await open('week'); h = await hs(page);
  ok('주차별 개요: 120분 = 90분 × 4/3', near(h.r120, h.r090 * 4 / 3, 2), JSON.stringify(h));
  ok('주차별 개요: 180분 = 90분 × 2', near(h.r180, h.r090 * 2, 2), JSON.stringify(h));
  ok('주차별 개요: 90분 카드가 내용(세 줄)에 밀리지 않음', near(h.r090, 90 * 0.74, 2), String(h.r090));
  await page.evaluate(() => { weekZoomDay = '일'; keepScroll = false; render(); });
  await page.waitForSelector('.wk-slim .wk-bar');
  const wb = (await page.$$eval('.wk-slim .wk-bar', els => els.map(e => e.getBoundingClientRect().height))).sort((a, b) => a - b);
  ok('주차별 확대 옆 막대도 비례', wb.length === 3 && near(wb[0], 23) && near(wb[1], 30) && near(wb[2], 45), JSON.stringify(wb));
  console.log('통과 ' + pass + ' / 실패 ' + fail);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
