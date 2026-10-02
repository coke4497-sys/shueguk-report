#!/usr/bin/env node
/* 주차별 시간표의 교사 임시 휴무 검증.
 *   NODE_PATH=$(npm root -g) node tools/tt-teacher-off-test.js
 * 임시 휴무는 별도 표시이며 수업 카드·출석·회차를 바꾸지 않는다. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
const now = new Date();
const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate());
mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
const ymd = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const MON = ymd(mon);
const CLS = [{ id:'r001', day:'월', start:'4:00', end:'5:30', loc:'본원', teacher:'지원', cls:'고1 가', students:['김하나'] }];
const OFF = [{ date:MON, teacher:'지원', reason:'월 직보' }];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{ width:1300, height:900 }, timezoneId:'Asia/Seoul' });
  let writes = [], pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
  await ctx.route(/fonts\.g/, r => r.abort());
  await ctx.route(/supabase\.co/, async r => {
    const req = r.request();
    if (/tt_teacher_days_off/.test(req.url()) && req.method() !== 'GET'){
      writes.push({ method:req.method(), url:req.url(), body:req.postData() || '' });
      return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
    }
    if (req.method() === 'GET') return r.fulfill({ status:500, contentType:'application/json', body:'{}' });
    await r.fulfill({ status:200, contentType:'application/json', body:'{}' });
  });
  await ctx.route(/script\.google\.com|googleusercontent/, r => r.fulfill({ status:200, contentType:'application/json', body:'{"result":"error"}' }));
  const page = await ctx.newPage();
  await page.addInitScript(({ cls, off, mon }) => {
    sessionStorage.setItem('tt_mode', 'week'); sessionStorage.setItem('tt_book', '정규');
    localStorage.setItem('ttc:list:정규', JSON.stringify({ t:Date.now(), d:{ classes:cls, onceMoves:[] } }));
    localStorage.setItem('ttc:week:정규:' + mon, JSON.stringify({ t:Date.now(), d:{ attend:[], onceMoves:[], teacherOffs:off } }));
  }, { cls:CLS, off:OFF, mon:MON });
  await page.goto('http://127.0.0.1:' + port + '/timetable.html');
  await page.waitForSelector('.toff-ctr', { timeout:15000 });

  let r = await page.evaluate(() => ({
    strip: document.querySelector('.toff-strip') ? document.querySelector('.toff-strip').textContent : '',
    monHead: [...document.querySelectorAll('.wk-dayh')].find(x => /^월/.test(x.textContent)).textContent,
    ctrNote: (() => { const c = [...document.querySelectorAll('.wk-ov-col')].find(x => /^월/.test(x.querySelector('.wk-dayh').textContent)); const n = c && c.querySelector('.wk-ctr + .toff-ctr'); return n ? n.previousElementSibling.textContent + '|' + n.textContent + '|' + getComputedStyle(n).color : ''; })(),
    cards: [...document.querySelectorAll('.wk-mini')].map(x => x.textContent)
  }));
  ok('주차별: 위쪽 휴무 요약 줄 없음(요일 칸에만 표시)', r.strip === '', r.strip);
  ok('요일 머리글에는 휴무 글자 없음', !/OFF/.test(r.monHead), r.monHead);
  ok('센터 라벨 아래 빨간 글씨: 본원|지원T OFF (월 직보)', /^본원\|지원T OFF \(월 직보\)\|rgb\(200, 70, 63\)$/.test(r.ctrNote), r.ctrNote);
  ok('독립 정보: 원래 수업 카드 유지', r.cards.some(x => /고1 가/.test(x)), JSON.stringify(r.cards));
  ok('개요 카드: 반이름 앞에 담당 선생님', r.cards.some(x => /^지원T\s*고1 가/.test(x)), JSON.stringify(r.cards));

  // 요일 확대: 휴무 강사 열 머리글에 표시
  await page.evaluate(() => { weekZoomDay = '월'; render(); });
  await page.waitForTimeout(200);
  r = await page.evaluate(() => [...document.querySelectorAll('.wk-th')].map(x => x.textContent));
  ok('확대: 강사 열 머리글에 휴무·사유', r.some(t => /지원T/.test(t) && /OFF \(월 직보\)/.test(t)), JSON.stringify(r));
  r = await page.evaluate(() => { const n = document.querySelector('.wk-big .wk-ch + .toff-ctr'); return n ? n.textContent : ''; });
  ok('확대: 센터 소제목 아래 빨간 휴무 줄', r === '지원T OFF (월 직보)', r);
  await page.evaluate(() => { weekZoomDay = null; render(); });
  await page.waitForTimeout(200);

  await page.click('.toff-open');
  await page.click('#modal-box .toff-existing .toff-chip');
  r = await page.evaluate(() => ({
    txt: document.getElementById('modal-box').textContent,
    reason: document.getElementById('toff-reason').value,
    placeholder: document.getElementById('toff-reason').placeholder,
    del: getComputedStyle(document.getElementById('toff-del')).display
  }));
  ok('설정창: 제목 변경·불필요 안내 제거', /휴무일 변경 기록/.test(r.txt) &&
     !/선생님의 근무 표시만|원래 수업 날짜 기준|회차/.test(r.txt), r.txt);
  ok('설정창: 사유 예시 월 직보', r.placeholder === '예: 월 직보');
  ok('설정창: 기존 사유와 해제 버튼', r.reason === '월 직보' && r.del !== 'none', JSON.stringify(r));
  ok('설정창: 남은 수업은 자동 변경하지 않음', /수업 1개가 남아 있습니다.*자동으로 바뀌지 않아요/.test(r.txt), r.txt);

  await page.fill('#toff-reason', '월 직보 완료');
  await page.click('button:text("휴무 저장")');
  await page.waitForTimeout(100);
  ok('저장: 별도 테이블 UPSERT', writes.some(x => x.method === 'POST' && /on_conflict=off_date,teacher/.test(x.url) && /월 직보 완료/.test(x.body)), JSON.stringify(writes));

  await page.evaluate(({ mon }) => { teacherOffs = [{ date:mon, teacher:'지원', reason:'월 직보' }]; openTeacherOff(mon, '지원'); }, { mon:MON });
  await page.click('#toff-del');
  await page.waitForTimeout(100);
  ok('해제: 해당 날짜·선생님 행만 DELETE', writes.some(x => x.method === 'DELETE' && /off_date=eq\./.test(x.url) && /teacher=eq\./.test(x.url)), JSON.stringify(writes));

  // ── 오늘의 시간표에도 휴무 표시 (2026-09-30 사용자 요청) ──
  const TD = ymd(now), TDAY = '일월화수목금토'[now.getDay()];
  const CLS_T = [{ id:'r002', day:TDAY, start:'4:00', end:'5:30', loc:'본원', teacher:'지원', cls:'고1 나', students:['김하나'] },
                 { id:'r003', day:TDAY, start:'4:00', end:'5:30', loc:'본원', teacher:'은지', cls:'고2 가', students:['박둘'] }];
  const p2 = await ctx.newPage();
  await p2.addInitScript(({ cls, td }) => {
    sessionStorage.setItem('tt_mode', 'today'); sessionStorage.setItem('tt_book', '정규');
    localStorage.setItem('ttc:list:정규', JSON.stringify({ t:Date.now(), d:{ classes:cls, onceMoves:[] } }));
    localStorage.setItem('ttc:toff:' + td, JSON.stringify({ t:Date.now(), d:[{ date:td, teacher:'지원', reason:'병원' }] }));
  }, { cls:CLS_T, td:TD });
  await p2.goto('http://127.0.0.1:' + port + '/timetable.html');
  await p2.waitForSelector('.today-head', { timeout:15000 });
  await p2.waitForTimeout(300);
  r = await p2.evaluate(() => ({
    strip: (document.querySelector('.toff-strip') || {}).textContent || '',
    heads: [...document.querySelectorAll('.thead')].map(x => x.textContent),
    cards: document.querySelectorAll('.blk').length
  }));
  ok('오늘: 휴무 요약 줄', /오늘 교사 휴무/.test(r.strip) && /지원T OFF \(병원\)/.test(r.strip), r.strip);
  ok('오늘: 휴무 강사 열 머리글 표시', r.heads.some(h => /지원/.test(h) && /OFF \(병원\)/.test(h)), JSON.stringify(r.heads));
  ok('오늘: 다른 강사 머리글엔 없음', r.heads.filter(h => /은지/.test(h)).every(h => !/OFF/.test(h)), JSON.stringify(r.heads));
  ok('오늘: 수업 카드 그대로', r.cards >= 2, String(r.cards));

  // 휴대폰 목록 보기(주차별): 요일 탭에 휴무 표시
  await page.evaluate(() => { weekListDay = '월'; });
  r = await page.evaluate(() => { var el = buildWeekList(); return [...el.querySelectorAll('.toff-tab')].length; });
  ok('휴대폰 목록: 요일 탭에 휴무 표시', r === 1, String(r));
  r = await page.evaluate(() => { var el = buildWeekList(); var n = el.querySelector('.dl-time + .toff-ctr'); return n ? n.previousElementSibling.textContent + '|' + n.textContent : ''; });
  ok('휴대폰 목록: 센터 제목 아래 빨간 휴무 줄', r === '본원|지원T OFF (월 직보)', r);
  await p2.close();

  // 어댑터: ttBoot 가 오늘 날짜 휴무를 함께 받아 온다
  const ctx3 = await b.newContext({ viewport:{ width:1300, height:900 }, timezoneId:'Asia/Seoul' });
  await ctx3.route(/fonts\.g/, r => r.abort());
  let offUrls = [];
  await ctx3.route(/supabase\.co/, async r => {
    const u = r.request().url();
    if (/tt_teacher_days_off/.test(u)){ offUrls.push(u);
      return r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify([{ off_date:TD, teacher:'지원', reason:'연수' }]) }); }
    await r.fulfill({ status:200, contentType:'application/json', body:'[]' });
  });
  await ctx3.route(/script\.google\.com|googleusercontent/, r => r.fulfill({ status:200, contentType:'application/json', body:'{"result":"error"}' }));
  const p3 = await ctx3.newPage();
  await p3.addInitScript(() => { sessionStorage.setItem('tt_mode', 'today'); sessionStorage.setItem('tt_book', '정규'); });
  await p3.goto('http://127.0.0.1:' + port + '/timetable.html');
  await p3.waitForSelector('.toff-strip', { timeout:15000 }).catch(() => {});
  r = await p3.evaluate(() => ({ strip: (document.querySelector('.toff-strip') || {}).textContent || '',
    cache: localStorage.getItem('ttc:toff:' + todayStr()) || '' }));
  ok('어댑터: 오늘 날짜로 휴무 조회', offUrls.some(u => u.indexOf('off_date=gte.' + TD) >= 0 && u.indexOf('off_date=lte.' + TD) >= 0), JSON.stringify(offUrls));
  ok('어댑터: 받은 휴무를 오늘 화면에 표시·캐시', /지원T OFF \(연수\)/.test(r.strip) && /연수/.test(r.cache), JSON.stringify(r));
  await ctx3.close();

  console.log('통과 ' + pass + ' / 실패 ' + fail);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
