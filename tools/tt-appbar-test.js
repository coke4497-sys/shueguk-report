#!/usr/bin/env node
/* 앱 바 검증 (timetable.html, 2026-09-21 사용자 요청 "화면 위아래의 너저분한 것 없이 앱처럼").
 *   NODE_PATH=$(npm root -g) node tools/tt-appbar-test.js
 * 확인 대상 — ① 백링크 줄·설명 문단·푸터·팁이 사라졌고 ② 앱 바가 화면 위에 붙어 스크롤해도 남으며
 * ③ 기간은 작은 칩(자세한 문장은 title) ④ 보기 탭 6개가 한 줄 ⑤ 창으로 여는 기능 세 개는 상시 버튼(⋯ 안에 숨기지 않음)
 * ⑥ 상태 문구는 화면 아래 알림(비면 안 보임) ⑦ 안내문은 한 줄 + ⓘ로 펼침(세션 기억)
 * ⑧ 휴대폰: 탭 한 줄 가로 스크롤 · 오늘 보충 패널 기본 접힘 · 칩에서 날짜 숨김 ⑨ 옆 패널은 바 아래에서 시작. */
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
const mk = (id, day, st, en, loc, t, cls, stu) => ({ id, day, start: st, end: en, loc, teacher: t, cls, students: stu });
const CLASSES = [];
for (var i = 0; i < 10; i++) CLASSES.push(mk('r0' + i, TODAY, '2:00', '3:30', '본원', '은지', '고1 가' + i, ['가나' + i, '다라' + i]));
CLASSES.push(mk('r90', TODAY, '9:00', '10:30', '본원', '지원', '고2 나', ['마바']));

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const b = await chromium.launch();
  async function open(ctx, mode){
    const page = await ctx.newPage();
    await page.addInitScript(({ cls, mode }) => {
      sessionStorage.setItem('tt_mode', mode); sessionStorage.setItem('tt_book', '정규');
      localStorage.setItem('ttc:list:정규', JSON.stringify({ t: Date.now(), d: { classes: cls, onceMoves: [] } }));
    }, { cls: CLASSES, mode });
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    await page.waitForSelector('#bar .viewtabs button', { timeout: 15000 });
    await page.waitForTimeout(500);
    return page;
  }
  const wide = await b.newContext({ viewport: { width: 1300, height: 860 }, timezoneId: 'Asia/Seoul' });
  await wide.route(/script\.google\.com|supabase\.co|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' }));
  await wide.route(/fonts\.g/, r => r.abort());
  let page = await open(wide, 'today');

  /* ① 없어진 것들 */
  ok('백링크 글줄 없음', !(await page.$('.backlink')));
  ok('설명 문단(.sub) 없음', !(await page.$('.sub')));
  ok('푸터 없음', !(await page.$('footer')));
  ok('Ctrl+Shift+R 팁 줄 없음', !(await page.$('p.tip')));
  ok('⋯ 메뉴 없음(기능을 숨기지 않는다)', !(await page.$('#ab-more')));
  ok('Ctrl+Shift+R 안내는 안내문 줄에', (await page.textContent('.hintline .ab-note')).includes('Ctrl+Shift+R'));

  /* ② 앱 바 — 화면 위에 붙어 스크롤해도 남는다 */
  const barCss = await page.$eval('#bar', el => [getComputedStyle(el).position, el.getBoundingClientRect().top]);
  ok('앱 바 sticky top:0', barCss[0] === 'sticky' && Math.round(barCss[1]) === 0, JSON.stringify(barCss));
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(150);
  const afterScroll = await page.$eval('#bar', el => el.getBoundingClientRect().top);
  ok('스크롤해도 앱 바가 화면 위에 남음', Math.round(afterScroll) === 0, String(afterScroll));
  await page.evaluate(() => window.scrollTo(0, 0));
  const barH = await page.$eval('#bar', el => el.offsetHeight);
  ok('앱 바는 낮다(150px 이하)', barH <= 150, String(barH));

  /* ③ 기간 = 작은 칩, 자세한 문장은 title */
  const pb = await page.$eval('#period-badge', el => [el.textContent, el.title, el.offsetHeight, getComputedStyle(el).borderRadius]);
  ok('칩 글자 = ○○ 주간 · 날짜', /주간 · \d+\/\d+~\d+\/\d+/.test(pb[0]), pb[0]);
  ok('칩 title = 원래 안내 문장', pb[1].includes('시간표로 운영합니다'), pb[1]);
  ok('칩은 낮다(30px 이하)·둥근 알약', pb[2] <= 30 && pb[3].indexOf('999') === 0, JSON.stringify([pb[2], pb[3]]));

  /* ④ 보기 탭 6개 한 줄 */
  const tabs = await page.$$eval('#bar .viewtabs button', bs => bs.map(x => [x.id, x.textContent.trim(), x.offsetTop]));
  ok('탭 6개 · 순서', JSON.stringify(tabs.map(t => t[0])) === JSON.stringify(['v-today','v-week','v-all','v-att','v-cal','v-exs']), JSON.stringify(tabs));
  ok('짧은 이름', JSON.stringify(tabs.map(t => t[1])) === JSON.stringify(['오늘','주차별','전체','출석 현황','캘린더','지필고사']), JSON.stringify(tabs.map(t => t[1])));
  ok('한 줄(줄바꿈 없음)', tabs.every(t => t[2] === tabs[0][2]), JSON.stringify(tabs.map(t => t[2])));
  ok('지금 보기 표시', await page.$eval('#v-today', e => e.classList.contains('on')));
  await page.click('#v-att');
  await page.waitForTimeout(200);
  ok('출석 현황도 탭으로 전환', await page.evaluate(() => mode === 'att' && document.getElementById('v-att').classList.contains('on')));
  await page.click('#v-today'); await page.waitForTimeout(300);

  /* ⑤ 창으로 여는 기능 — 예전처럼 상시 버튼 (2026-09-21 "수정 요청 메뉴가 사라졌어요") */
  const tools = await page.$$eval('.ab-tools button', bs => bs.map(x => [x.id, x.textContent.trim(), x.offsetTop, x.offsetWidth > 0]));
  ok('도구 버튼 3개 · 순서', JSON.stringify(tools.map(t => t[0])) === JSON.stringify(['ab-makeup','ab-alim','ab-req']), JSON.stringify(tools));
  ok('이름 그대로', JSON.stringify(tools.map(t => t[1])) === JSON.stringify(['결석자 관리','알림톡','수정 요청']), JSON.stringify(tools.map(t => t[1])));
  ok('세 개 모두 처음부터 보인다(한 줄)', tools.every(t => t[3] && t[2] === tools[0][2]), JSON.stringify(tools));
  ok('출석 관리 묶음 라벨', (await page.textContent('.ab-tools .cluster .clabel')).trim() === '출석 관리');
  await page.evaluate(() => { window.__hit = ''; window.openEditReq = function(){ window.__hit = 'req'; };
                              window.openMakeup = function(){ window.__hit += 'mk'; }; });
  await page.click('#ab-req');
  ok('[수정 요청]을 누르면 요청함이 열린다', await page.evaluate(() => window.__hit === 'req'));
  await page.click('#ab-makeup');
  ok('[결석자 관리]도 그대로', await page.evaluate(() => window.__hit === 'reqmk'));

  /* ⑥ 상태 문구 = 화면 아래 알림 */
  await page.evaluate(() => setStatus(''));
  const st0 = await page.$eval('#status', e => [getComputedStyle(e).position, getComputedStyle(e).opacity, e.getBoundingClientRect().height]);
  ok('비었을 땐 보이지 않음(자리도 안 차지)', st0[0] === 'fixed' && st0[1] === '0', JSON.stringify(st0));
  await page.evaluate(() => setStatus('저장했어요', 'ok'));
  await page.waitForTimeout(250);
  const st1 = await page.$eval('#status', e => { const r = e.getBoundingClientRect();
    return [getComputedStyle(e).opacity, r.bottom <= innerHeight, r.top > innerHeight / 2, e.textContent]; });
  ok('문구가 있으면 화면 아래에 뜬다', st1[0] === '1' && st1[1] && st1[2] && st1[3] === '저장했어요', JSON.stringify(st1));
  await page.evaluate(() => setStatus(''));

  /* ⑦ 안내문 한 줄 + ⓘ */
  const h0 = await page.$eval('.hint', e => [getComputedStyle(e).whiteSpace, e.offsetHeight]);
  ok('안내문은 기본 한 줄', h0[0] === 'nowrap' && h0[1] < 34, JSON.stringify(h0));
  ok('뒷문장은 접혀 있음', await page.$eval('.hint .hint-x', e => getComputedStyle(e).display === 'none'));
  ok('새로고침 안내도 접혀 있음', await page.$eval('.hintline .ab-note', e => getComputedStyle(e).display === 'none'));
  await page.click('#hint-i');
  ok('ⓘ 누르면 펼쳐짐', await page.$eval('.hint .hint-x', e => getComputedStyle(e).display !== 'none'));
  ok('펼치면 새로고침 안내도 보임', await page.$eval('.hintline .ab-note', e => getComputedStyle(e).display !== 'none'));
  ok('펼침을 세션에 기억', await page.evaluate(() => sessionStorage.getItem('tt_hintopen') === '1'));
  await page.reload(); await page.waitForSelector('#hint-i'); await page.waitForTimeout(400);
  ok('새로고침해도 펼친 상태', await page.$eval('#hintline', e => e.classList.contains('open')));
  await page.click('#hint-i');
  ok('다시 누르면 접힘', await page.$eval('#hintline', e => !e.classList.contains('open')));

  /* ⑨ 옆 패널은 앱 바 아래에서 시작 */
  const panel = await page.evaluate(() => {
    const v = document.getElementById('vmpanel').getBoundingClientRect();
    return [v.top, document.getElementById('bar').offsetHeight,
            getComputedStyle(document.documentElement).getPropertyValue('--abh').trim()];
  });
  ok('--abh = 앱 바 높이', parseInt(panel[2], 10) === panel[1], JSON.stringify(panel));
  ok('패널이 바 아래에서 시작', panel[0] >= panel[1], JSON.stringify(panel));
  await page.close();

  /* ⑧ 휴대폰 */
  const small = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul' });
  await small.route(/script\.google\.com|supabase\.co|googleusercontent/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' }));
  await small.route(/fonts\.g/, r => r.abort());
  const m = await open(small, 'today');
  const mt = await m.$$eval('#bar .viewtabs button', bs => bs.map(x => x.offsetTop));
  ok('휴대폰에서도 탭 한 줄', mt.every(t => t === mt[0]), JSON.stringify(mt));
  ok('탭 줄은 가로로 민다', await m.$eval('#bar .viewtabs', e => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'auto'));
  ok('기간 칩은 날짜를 숨겨 안 잘린다', await m.$eval('#period-badge .pb-range', e => getComputedStyle(e).display === 'none'));
  ok('오늘 보충 패널은 기본 접힘(화면을 덮지 않게)', await m.$eval('#vmpanel', e => e.classList.contains('closed')));
  ok('색 범례는 감춤', await m.$eval('.legend', e => getComputedStyle(e).display === 'none'));
  ok('출석 도구줄 한 줄', await m.$$eval('.attbar button', bs => bs.every(x => x.offsetTop === bs[0].offsetTop)));
  const mbar = await m.$eval('#bar', e => e.offsetHeight);
  ok('휴대폰 앱 바도 낮다(150px 이하)', mbar <= 150, String(mbar));
  const mtools = await m.$$eval('.ab-tools button', bs => bs.map(x => [x.offsetTop, x.offsetWidth > 0]));
  ok('휴대폰에서도 도구 버튼 세 개가 한 줄로 보인다', mtools.length === 3 && mtools.every(t => t[1] && t[0] === mtools[0][0]), JSON.stringify(mtools));
  ok('[수정 요청]이 화면 안에 들어온다', await m.$eval('#ab-req', e => { const r = e.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1; }));
  await b.close(); srv.close();
  console.log(fail ? ('통과 ' + pass + ' / 실패 ' + fail) : ('✓ ' + pass + '건 통과'));
  process.exit(fail ? 1 : 0);
})();
