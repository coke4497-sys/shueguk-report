#!/usr/bin/env node
/* 확인 수업은 학교별로 묶어 보여 준다 — 2026-11-04 원장님 "확인 수업에서는 학교마다 그룹으로 학생들을 볼 수 있었으면"
 *   NODE_PATH=$(npm root -g) node tools/tt-checkgroup-test.js
 * ① 확인 수업 카드: 학교 묶음 머리(많은 순) + 그 아래 칩, 학교 표기가 없는 학생은 재원 명단 학교로, 모르면 '학교 확인 필요' 맨 끝
 * ② 확인이 아닌 수업은 종전대로(묶음 머리 없음) ③ 학교가 하나뿐이면 머리 없음 ④ 칩 이름·출석 키는 그대로 */
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
const mk = (id, cls, stu, t) => ({ id, day: TODAY, start: '5:30', end: '7:00', loc: '본원', teacher: t, cls, students: stu, wk: '' });
const CLASSES = [
  mk('n01', '고1 확인', ['김영윤(백양)', '양지우A(백양)', '김하언(능곡)', '이지홍(화정)', '서윤우(화정)', '민서영(화수)', '임지훈', '모름이'], '현지'),
  mk('n02', '고1 화정A(천재수 공통국어2)', ['가나', '다라'], '지원'),
  mk('n03', '고2 확인', ['(서정)송도균', '김서빈(서정)'], '연주'),
];
const STUDENTS = [
  { name: '임지훈', school: '능곡고', phone_student: '', phone_parent1: '', phone_parent2: '', code: 'x1' },
  { name: '모름이', school: '화정고', phone_student: '', phone_parent1: '', phone_parent2: '', code: 'x2' },
  { name: '모름이', school: '백양고', phone_student: '', phone_parent1: '', phone_parent2: '', code: 'x3' },   // 동명이인 — 가리지 못함
];
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
  await ctx.route(/script\.google\.com|supabase\.co|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' }));
  await ctx.route(/supabase\.co\/rest\/v1\/students/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STUDENTS) }));
  await ctx.route(/fonts\.g/, r => r.abort());
  for (const mode of ['today', 'all']){
    const page = await ctx.newPage();
    await page.addInitScript(({ cls, mode }) => {
      sessionStorage.setItem('tt_mode', mode); sessionStorage.setItem('tt_book', '정규');
      sessionStorage.setItem('tt_vmopen', '0'); sessionStorage.setItem('tt_chopen', '0'); sessionStorage.setItem('tt_allview', 'grid');
      localStorage.setItem('ttc:list:정규', JSON.stringify({ t: Date.now(), d: { classes: cls, onceMoves: [] } }));
    }, { cls: CLASSES, mode });
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    await page.waitForSelector('.blk', { timeout: 15000 });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const card = id => document.querySelector('.blk[data-cid="' + id + '"] .stus');
      const seq = el => el ? Array.from(el.children).map(x => x.classList.contains('sgrp') ? '#' + x.textContent : (x.getAttribute('data-nm') || '')) : null;
      return { n01: seq(card('n01')), n02: seq(card('n02')), n03: seq(card('n03')) };
    });
    const g = (r.n01 || []).filter(x => x[0] === '#');
    ok(mode + ' ① 확인 수업 묶음 머리', JSON.stringify(g) === JSON.stringify(['#능곡 2', '#백양 2', '#화정 2', '#화수 1', '#학교 확인 필요 1']), JSON.stringify(g));
    ok(mode + ' ① 임지훈 = 재원 명단 학교(능곡)', (r.n01 || []).join('|').indexOf('#능곡 2|김하언(능곡)|임지훈') >= 0, (r.n01 || []).join('|'));
    ok(mode + ' ① 동명이인은 학교 확인 필요', (r.n01 || []).slice(-2).join('|') === '#학교 확인 필요 1|모름이', (r.n01 || []).join('|'));
    ok(mode + ' ② 진도 수업은 머리 없음', r.n02 && !r.n02.some(x => x[0] === '#'), JSON.stringify(r.n02));
    ok(mode + ' ③ 학교 하나뿐(앞 괄호 포함)이면 머리 없음', r.n03 && !r.n03.some(x => x[0] === '#'), JSON.stringify(r.n03));
    await page.close();
  }
  await b.close(); srv.close();
  console.log((fail ? '✗ ' + fail + '건 실패, ' : '✓ ') + pass + '건 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
