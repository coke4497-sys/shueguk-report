#!/usr/bin/env node
/* 오늘 할 일 · 전달 사항 (2026-10-08 원장님 요청, 045) 검증
 *   NODE_PATH=$(npm root -g) node tools/tt-tasks-test.js
 * 가짜 수파베이스(tt_tasks 표를 흉내)로 오늘의 시간표를 띄워 —
 * ① 옆 패널 위쪽 상자(오늘 보충 위)·탭 배지·안 한 일/지난 요청 수·학생 칩 붉은 점
 * ② 남기기(센터 알약·학생 이름 자동 찾기·작성자) ③ [완료] = PATCH + 처리한 조교 이름·시각
 * ④ [못 했어요] = 이유 필수 + 내일로 넘김 + 이력 ⑤ [완료 기록] ⑥ 센터 필터 ⑦ 이름 없으면 한 번 묻기
 * ⑧ 좁은 화면 접힌 줄 ⑨ 표가 없으면 안내 ⑩ 주차별 '이 주' 상자 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': /\.js$/.test(f) ? 'text/javascript' : 'text/html;charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
const TODAY = new Intl.DateTimeFormat('ko-KR', { weekday: 'narrow', timeZone: 'Asia/Seoul' }).format(new Date());
const TS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const shift = (ymd, n) => { const p = ymd.split('-').map(Number); const d = new Date(p[0], p[1]-1, p[2]+n); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const YDAY = shift(TS, -1), TMRW = shift(TS, 1);
const CLASSES = [
  { id:'r01', day:TODAY, start:'5:30', end:'8:30', loc:'본원', teacher:'슈', cls:'고3파이널A', students:['민서연','이채민','허민'], wk:'' },
  { id:'r02', day:TODAY, start:'5:30', end:'7:00', loc:'화정센터', teacher:'지원', cls:'고1 확인', students:['박세연','(화정)심지후'], wk:'' },
];
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

function makeStore(){
  let seq = 10;
  const rows = [
    { id:1, ymd:YDAY, loc:'본원', text:'10/7 결석 학생 보충 일정 확인', student:'이채민', author:'이수경', status:'대기', done_by:'', done_at:null, done_ymd:null,
      history:[{ ymd:YDAY, loc:'본원', by:'김상우', reason:'학생이 전화를 안 받아서', to:TS, at:YDAY+'T20:10:00+09:00' }], created_at:YDAY+'T16:20:00+09:00', updated_at:YDAY+'T20:10:00+09:00' },
    { id:2, ymd:TS, loc:'본원', text:'허민 병결 반영 부탁드립니다', student:'허민', author:'이수경', status:'대기', done_by:'', done_at:null, done_ymd:null, history:[], created_at:TS+'T09:12:00+09:00', updated_at:TS+'T09:12:00+09:00' },
    { id:3, ymd:TS, loc:'전체', text:'출석 체크는 수업 시작 10분 안에', student:'', author:'이수경', status:'완료', done_by:'박언호', done_at:TS+'T14:02:00+09:00', done_ymd:TS, history:[], created_at:TS+'T09:10:00+09:00', updated_at:TS+'T14:02:00+09:00' },
  ];
  const writes = [];
  return {
    rows, writes, raceOnce: false,
    list(){ return rows.filter(r => (r.status === '대기' && r.ymd <= TS) || (r.status === '완료' && r.done_ymd === TS)); },
    handle(req){
      const url = req.url(), m = req.method();
      if (m === 'GET'){
        if (/ymd\.gte\./.test(url)) return JSON.stringify(rows);
        if (/id=eq\.(\d+)/.test(url)){ const rr = rows.filter(r => r.id === +RegExp.$1); const out = JSON.stringify(rr); if (this.raceOnce && rr[0]){ Object.assign(rr[0], { status:'완료', done_by:'김상우', done_at:TS+'T15:00:30+09:00', done_ymd:TS }); this.raceOnce = false; } return out; }
        return JSON.stringify(this.list());
      }
      const body = req.postData() ? JSON.parse(req.postData()) : null;
      writes.push({ method:m, url, body });
      if (m === 'POST'){ const r = Object.assign({ id: ++seq, status:'대기', done_by:'', done_at:null, done_ymd:null, history:[], created_at: TS+'T15:00:00+09:00', updated_at: TS+'T15:00:00+09:00' }, body[0]); rows.push(r); return JSON.stringify([r]); }
      const id = +(/id=eq\.(\d+)/.exec(url) || [])[1];
      const r = rows.find(x => x.id === id);
      if (m === 'PATCH'){ if (!r || (/status=eq\./.test(url) && r.status !== '대기') || (/ymd=eq\.([\d-]+)/.test(url) && r.ymd !== RegExp.$1)) return '[]'; Object.assign(r, body); r.updated_at = TS+'T15:01:00+09:00'; return JSON.stringify([r]); }
      if (m === 'DELETE'){ const i = rows.indexOf(r); if (i >= 0) rows.splice(i, 1); return ''; }
      return '{}';
    }
  };
}

(async () => {
  const b = await chromium.launch();
  async function open(opts){
    opts = opts || {};
    const store = opts.store || makeStore();
    const ctx = await b.newContext({ viewport: { width: opts.width || 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
    await ctx.route(/fonts\.g/, r => r.abort());
    await ctx.route(/supabase\.co/, async r => {
      const req = r.request();
      if (/tt_tasks/.test(req.url())){
        if (opts.missing) return r.fulfill({ status:404, contentType:'application/json', body:'{"code":"42P01","message":"relation tt_tasks does not exist"}' });
        return r.fulfill({ status: req.method() === 'POST' ? 201 : 200, contentType:'application/json', body: store.handle(req) });
      }
      if (req.method() === 'GET') return r.fulfill({ status:500, contentType:'application/json', body:'{}' });
      await r.fulfill({ status:200, contentType:'application/json', body:'{}' });
    });
    await ctx.route(/script\.google\.com|googleusercontent/, r => r.fulfill({ status:200, contentType:'application/json', body:'{"result":"error"}' }));
    const page = await ctx.newPage();
    await page.addInitScript(({ cls, mode, who, vloc, vmopen }) => {
      sessionStorage.setItem('tt_mode', mode); sessionStorage.setItem('tt_book', '정규');
      sessionStorage.setItem('tt_vmopen', vmopen); sessionStorage.setItem('tt_chopen', '0');
      if (vloc) sessionStorage.setItem('tt_vloc', vloc);
      if (who) localStorage.setItem('tt_task_who', who);
      localStorage.setItem('ttc:list:정규', JSON.stringify({ t: Date.now(), d: { classes: cls, onceMoves: [] } }));
    }, { cls: CLASSES, mode: opts.mode || 'today', who: opts.who === undefined ? '박언호' : opts.who, vloc: opts.vloc || '', vmopen: opts.vmopen || '1' });
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    await page.waitForSelector('.blk, .wk-mini, .tk-week', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('#tk-list') && !/불러오는 중/.test(document.querySelector('#tk-list').textContent) || document.querySelector('.tk-week'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
    return { page, ctx, store };
  }

  /* ① 패널 구성 */
  let { page, ctx, store } = await open();
  let r = await page.evaluate(() => {
    const inner = document.getElementById('vm-inner');
    const order = [...inner.children].map(e => e.id || e.className);
    const chip = [...document.querySelectorAll('.blk .stus button')].find(e => e.textContent.trim() === '허민');
    return { order, badge: document.getElementById('tk-cnt').textContent, badgeHidden: document.getElementById('tk-cnt').hidden,
             sub: document.getElementById('tk-sub').textContent, tab: document.getElementById('vm-tab').textContent.replace(/\s/g,''),
             items: [...document.querySelectorAll('#tk-list .tk-item')].map(e => ({ id: e.dataset.id, done: e.classList.contains('done'), txt: e.textContent })),
             carried: !!document.querySelector('#tk-list .tk-item[data-id="1"] .carried'),
             hist: document.querySelector('#tk-list .tk-item[data-id="1"] .tk-hist') ? document.querySelector('#tk-list .tk-item[data-id="1"] .tk-hist').textContent : '',
             chipTask: !!(chip && chip.classList.contains('task')), chipTitle: chip ? chip.title : '',
             other: [...document.querySelectorAll('.blk .stus button.task')].map(e => e.textContent.trim()),
             pills: [...document.querySelectorAll('#tk-pills button')].map(e => e.textContent + (e.classList.contains('on') ? '*' : '')),
             who: document.querySelector('.tk-who').textContent, open: !document.getElementById('vmpanel').classList.contains('closed') };
  });
  ok('① 할 일 상자가 오늘 보충 위에', r.order.indexOf('tk-list') >= 0 && r.order.indexOf('tk-list') < r.order.indexOf('vm-side'), JSON.stringify(r.order));
  ok('① 탭에 안 한 일 개수 배지 2', r.badge === '2' && !r.badgeHidden && /할일·보충/.test(r.tab), JSON.stringify([r.badge, r.tab]));
  ok('① 머리: 안 한 일 2 · 지난 요청 1', r.sub === '안 한 일 2 · 지난 요청 1', r.sub);
  ok('① 대기 2건 + 완료 1건(처리한 조교 이름·시각)', r.items.length === 3 && r.items.filter(x => x.done).length === 1 && /완료 · 박언호 14:02/.test(r.items[2].txt), JSON.stringify(r.items.map(x => x.txt.slice(0, 40))));
  ok('① 어제 요청은 "지난 요청" + 못 함 이력', r.carried && /김상우.*못 함: 학생이 전화를 안 받아서/.test(r.hist), r.hist);
  ok('① 허민 칩에 붉은 점 + 설명', r.chipTask && /할 일: 허민 병결 반영/.test(r.chipTitle) && r.other.join() === '이채민,허민', JSON.stringify([r.chipTask, r.chipTitle, r.other]));
  ok('① 쓰기 줄: 센터 알약(본원 기본)·작성자 이름', r.pills.join() === '본원*,화정센터,민초센터,정리정독,전체' && /작성자 박언호/.test(r.who), JSON.stringify([r.pills, r.who]));

  /* ② 남기기 */
  await page.click('#tk-pills button[data-loc="화정센터"]');
  await page.fill('#tk-in', '고1 확인 교재 6권 본원에서 가져오기');
  await page.click('#tk-add');
  await page.waitForFunction(() => document.querySelectorAll('#tk-list .tk-item').length === 4, null, { timeout: 8000 });
  let w = store.writes[store.writes.length - 1];
  ok('② POST tt_tasks: 센터·내용·작성자·오늘 날짜', w.method === 'POST' && w.body[0].loc === '화정센터' && w.body[0].text === '고1 확인 교재 6권 본원에서 가져오기' && w.body[0].author === '박언호' && w.body[0].ymd === TS && w.body[0].student === '', JSON.stringify(w.body));
  await page.fill('#tk-in', '이채민 보충 교재 챙겨 주세요');
  await page.press('#tk-in', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#tk-list .tk-item').length === 5, null, { timeout: 8000 });
  w = store.writes[store.writes.length - 1];
  ok('② 글 안의 학생 이름을 찾아 student로', w.body[0].student === '이채민' && w.body[0].loc === '화정센터', JSON.stringify(w.body));
  r = await page.evaluate(() => ({ badge: document.getElementById('tk-cnt').textContent, loc: localStorage.getItem('tt_task_loc') }));
  ok('② 배지 4 · 고른 센터 기억', r.badge === '4' && r.loc === '화정센터', JSON.stringify(r));

  /* ③ 완료 */
  await page.click('#tk-list .tk-item[data-id="2"] button[data-act="done"]');
  await page.waitForFunction(() => document.querySelector('#tk-list .tk-item[data-id="2"].done'), null, { timeout: 8000 });
  w = store.writes.find(x => x.method === 'PATCH');
  r = await page.evaluate(() => {
    const it = document.querySelector('#tk-list .tk-item[data-id="2"]');
    const chip = [...document.querySelectorAll('.blk .stus button')].find(e => e.textContent.trim() === '허민');
    return { txt: it.textContent, acts: it.querySelectorAll('button').length, badge: document.getElementById('tk-cnt').textContent, chipTask: chip.classList.contains('task'), sec: it.previousElementSibling && it.previousElementSibling.textContent };
  });
  ok('③ PATCH: 대기인 줄만 · 완료 · 처리한 조교 · 오늘', /id=eq\.2&status=eq\./.test(w.url) && w.body.status === '완료' && w.body.done_by === '박언호' && w.body.done_ymd === TS && /T\d\d:\d\d/.test(w.body.done_at), JSON.stringify(w));
  ok('③ 완료 묶음으로 내려가고 이름·시각, 버튼 없음', /완료 · 박언호/.test(r.txt) && r.acts === 0 && r.badge === '3', JSON.stringify([r.txt.slice(0, 60), r.acts, r.badge]));
  ok('③ 허민 칩의 점이 사라짐', !r.chipTask);

  /* ④ 못 했어요 */
  await page.click('#tk-list .tk-item[data-id="1"] button[data-act="fail"]');
  r = await page.evaluate(() => ({ box: !!document.querySelector('#tk-list .tk-item[data-id="1"] .tk-reason'), sel: document.querySelector('#tk-list .tk-item[data-id="1"] .tk-reason select').value,
    opt: document.querySelector('#tk-list .tk-item[data-id="1"] .tk-reason select option:checked').textContent }));
  ok('④ 이유 칸 + 넘길 곳(같은 센터 기본, 내일부터)', r.box && r.sel === '본원' && /같은 곳/.test(r.opt), JSON.stringify(r));
  const before = store.writes.length;
  await page.click('#tk-list .tk-item[data-id="1"] button[data-act="fail-save"]');
  await page.waitForTimeout(300);
  ok('④ 이유 없이 저장하면 보내지 않음', store.writes.length === before && (await page.evaluate(() => !!document.querySelector('#tk-list .tk-item[data-id="1"] .tk-reason'))));
  await page.fill('#tk-list .tk-item[data-id="1"] .tk-reason textarea', '학생이 오늘 안 와서');
  await page.click('#tk-list .tk-item[data-id="1"] button[data-act="fail-save"]');
  await page.waitForFunction(() => !document.querySelector('#tk-list .tk-item[data-id="1"]'), null, { timeout: 8000 });
  w = store.writes[store.writes.length - 1];
  ok('④ PATCH 조건: 대기 상태 + 읽은 날짜 그대로일 때만(동시 처리 방지)', /id=eq\.1&status=eq\./.test(w.url) && new RegExp('ymd=eq\\.' + YDAY).test(w.url), w.url);
  ok('④ PATCH: 내일 날짜 + 이력(이유·누가·어디로)', w.method === 'PATCH' && w.body.ymd === TMRW && w.body.history.length === 2 && w.body.history[1].reason === '학생이 오늘 안 와서' && w.body.history[1].by === '박언호' && w.body.history[1].to === TMRW && w.body.history[1].ymd === YDAY && w.body.loc === '본원', JSON.stringify(w.body));
  r = await page.evaluate(() => ({ badge: document.getElementById('tk-cnt').textContent, status: document.getElementById('status').textContent }));
  ok('④ 오늘 목록에서 빠지고 안내', r.badge === '2' && /넘겼어요/.test(r.status), JSON.stringify(r));

  /* ⑤ 완료 기록 */
  await page.click('#tk-logbtn');
  await page.waitForSelector('#tk-list .tk-log .tk-day', { timeout: 8000 });
  r = await page.evaluate(() => ({ days: [...document.querySelectorAll('#tk-list .tk-day')].map(e => e.textContent), lines: [...document.querySelectorAll('#tk-list .tk-ln')].map(e => e.textContent), comp: document.getElementById('tk-compose').innerHTML, sub: document.getElementById('tk-sub').textContent }));
  ok('⑤ 완료 기록: 날짜별(오늘 먼저) · 완료한 조교 · 못 함 이력', r.days.length === 2 && /오늘/.test(r.days[0]) && r.lines.some(l => /출석 체크는.*완료 · 박언호 14:02/.test(l)) && r.lines.some(l => /허민 병결.*완료 · 박언호/.test(l)) && r.lines.some(l => /김상우 못 함 →/.test(l)) && r.lines.some(l => /박언호 못 함 →/.test(l)) && r.comp === '' && r.sub === '최근 7일', JSON.stringify([r.days, r.lines]));
  await page.click('#tk-logbtn');
  r = await page.evaluate(() => ({ list: document.querySelectorAll('#tk-list .tk-item').length, comp: !!document.getElementById('tk-in') }));
  ok('⑤ 다시 누르면 목록·쓰기 줄로 돌아옴', r.list === 4 && r.comp, JSON.stringify(r));
  await ctx.close();

  /* ⑥ 센터 필터 */
  ({ page, ctx, store } = await open({ vloc: '화정센터' }));
  r = await page.evaluate(() => ({ items: [...document.querySelectorAll('#tk-list .tk-item')].map(e => e.querySelector('.tk-loc').textContent), badge: document.getElementById('tk-cnt').textContent, pill: document.querySelector('#tk-pills button.on').textContent, note: document.querySelector('#tk-list .mdesc') ? document.querySelector('#tk-list .mdesc').textContent : '' }));
  ok('⑥ 화정센터로 거르면 화정·전체 요청만, 배지는 전체 수', r.items.join() === '전체' && r.badge === '2' && /화정센터과 전체 요청만/.test(r.note), JSON.stringify(r));
  ok('⑥ 작성 센터 알약은 보기 거르기를 따라가지 않음(기억한 값 없으면 본원 — Codex P2)', r.pill === '본원', r.pill);
  await ctx.close();

  /* ⑦ 이름 없으면 한 번 묻기 */
  ({ page, ctx, store } = await open({ who: '' }));
  await page.click('#tk-list .tk-item[data-id="2"] button[data-act="done"]');
  r = await page.evaluate(() => ({ on: document.getElementById('modal').classList.contains('on'), txt: document.getElementById('modal').textContent, who: document.querySelector('.tk-who').textContent }));
  ok('⑦ 이름 모르면 창이 뜨고 저장은 아직', r.on && /이름을 적어 주세요/.test(r.txt) && store.writes.length === 0 && /처음 남길 때 이름을 물어요/.test(r.who), JSON.stringify([r.txt.slice(0, 40), store.writes.length]));
  await page.fill('#tk-who-in', '조예나');
  await page.click('#tk-who-ok');
  await page.waitForFunction(() => document.querySelector('#tk-list .tk-item[data-id="2"].done'), null, { timeout: 8000 });
  w = store.writes.find(x => x.method === 'PATCH');
  r = await page.evaluate(() => ({ saved: localStorage.getItem('tt_task_who'), who: document.querySelector('.tk-who').textContent }));
  ok('⑦ 적은 이름으로 완료 기록 + 이 기기에 기억', w.body.done_by === '조예나' && r.saved === '조예나' && /작성자 조예나/.test(r.who), JSON.stringify([w.body, r]));
  await ctx.close();

  /* ⑧ 좁은 화면: 접힌 줄 */
  ({ page, ctx, store } = await open({ width: 900, vmopen: '0' }));
  await page.waitForSelector('#tk-strip', { timeout: 8000 });
  await page.waitForFunction(() => /안 한 일/.test(document.getElementById('tk-strip').textContent), null, { timeout: 8000 });
  r = await page.evaluate(() => ({ txt: document.getElementById('tk-strip').textContent, closed: document.getElementById('vmpanel').classList.contains('closed') }));
  ok('⑧ 시간표 위 접힌 줄: 안 한 일 2 · 지난 요청 1, 패널은 닫힘', /안 한 일 2 · 지난 요청 1/.test(r.txt) && r.closed, JSON.stringify(r));
  await page.click('#tk-strip');
  await page.waitForTimeout(400);
  r = await page.evaluate(() => document.getElementById('vmpanel').classList.contains('closed'));
  ok('⑧ 누르면 옆 패널이 열림', !r);
  await ctx.close();
  ({ page, ctx, store } = await open({ width: 1300 }));
  r = await page.evaluate(() => !!document.getElementById('tk-strip'));
  ok('⑧ 넓은 화면에는 접힌 줄 없음(패널에 있으니)', !r);
  await ctx.close();

  /* ⑨ 표가 없으면 안내 */
  ({ page, ctx, store } = await open({ missing: true }));
  r = await page.evaluate(() => ({ txt: document.getElementById('tk-list').textContent, comp: document.getElementById('tk-compose').innerHTML, sub: document.getElementById('tk-sub').textContent, badge: document.getElementById('tk-cnt').hidden }));
  ok('⑨ 마이그레이션 045 안내 + 쓰기 줄 없음', /마이그레이션 045/.test(r.txt) && r.comp === '' && r.sub === '준비 전' && r.badge, JSON.stringify(r));
  await ctx.close();

  /* ⑩ 주차별: 이 주 할 일 */
  ({ page, ctx, store } = await open({ mode: 'week' }));
  await page.waitForFunction(() => document.querySelector('.tk-week .tk-wd'), null, { timeout: 10000 });
  r = await page.evaluate(() => ({ title: document.querySelector('.tk-week .memotitle').textContent, rows: document.querySelectorAll('.tk-week .tk-wd').length, lines: [...document.querySelectorAll('.tk-week .tk-ln')].map(e => e.textContent), after: document.querySelector('.tk-week').previousElementSibling.className }));
  ok('⑩ 주간 메모 아래 "이 주" 상자, 날짜 7줄', /할 일 · 전달 사항 — 이 주/.test(r.title) && r.rows === 7 && r.after === 'memobox', JSON.stringify([r.title, r.rows, r.after]));
  ok('⑩ 대기·완료·못 함 이력이 날짜 줄에', r.lines.some(l => /허민 병결.*대기/.test(l)) && r.lines.some(l => /출석 체크는.*완료 · 박언호 14:02/.test(l)) && r.lines.some(l => /보충 일정 확인.*김상우 못 함 →/.test(l)), JSON.stringify(r.lines));
  await ctx.close();

  /* ⑪ Codex 검토 반영(2026-10-08): 앞 괄호 이름 · 동시 처리 · 보기 거르기와 저장 위치 */
  ({ page, ctx, store } = await open());
  await page.fill('#tk-in', '심지후 교재 전달 부탁드립니다');
  await page.press('#tk-in', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#tk-list .tk-item').length === 4, null, { timeout: 8000 });
  w = store.writes[store.writes.length - 1];
  r = await page.evaluate(() => { const c = [...document.querySelectorAll('.blk .stus button')].find(e => /심지후/.test(e.textContent)); return { has: !!c, task: !!(c && c.classList.contains('task')), title: c ? c.title : '' }; });
  ok('⑪ "(화정)심지후" 명단 학생도 앞 괄호 뗀 이름으로 저장 + 칩에 붉은 점', w.body[0].student === '심지후' && r.has && r.task && /할 일: 심지후 교재 전달/.test(r.title), JSON.stringify([w.body[0].student, r]));
  // 읽은 직후 다른 조교가 [완료]를 누른 상황 — 못 함 PATCH가 완료된 줄을 덮어쓰지 않는다
  store.raceOnce = true;
  await page.click('#tk-list .tk-item[data-id="1"] button[data-act="fail"]');
  await page.fill('#tk-list .tk-item[data-id="1"] .tk-reason textarea', '시간이 없어서');
  const nw = store.writes.length;
  await page.click('#tk-list .tk-item[data-id="1"] button[data-act="fail-save"]');
  await page.waitForFunction(() => /먼저 처리/.test(document.getElementById('status').textContent), null, { timeout: 8000 });
  r = store.rows.find(x => x.id === 1);
  ok('⑪ 동시 처리: PATCH는 보냈지만 조건에 걸려 아무 줄도 안 바뀌고 안내', store.writes.length === nw + 1 && r.status === '완료' && r.ymd === YDAY && r.history.length === 1, JSON.stringify([store.writes.length - nw, r.status, r.ymd, r.history.length]));
  await page.waitForFunction(() => document.querySelector('#tk-list .tk-item[data-id="1"].done'), null, { timeout: 8000 });
  ok('⑪ 목록을 다시 불러와 완료 줄로 보임', true);
  await ctx.close();
  // 기억한 작성 센터가 본원인 조교가 화정센터 보기로 거르고 남겨도 본원으로 저장된다
  ({ page, ctx, store } = await open({ vloc: '화정센터' }));
  await page.evaluate(() => localStorage.setItem('tt_task_loc', '본원'));
  await page.reload(); await page.waitForSelector('#tk-pills', { timeout: 15000 }); await page.waitForTimeout(400);
  await page.fill('#tk-in', '프린터 토너 교체');
  await page.press('#tk-in', 'Enter');
  await page.waitForFunction(s => s.writes.length >= 1, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
  w = store.writes[store.writes.length - 1];
  ok('⑪ 화정센터 보기 중에도 기억한 본원으로 저장(보기는 저장 위치를 바꾸지 않음)', w && w.method === 'POST' && w.body[0].loc === '본원', JSON.stringify(w && w.body));
  await ctx.close();

  await b.close(); srv.close();
  console.log(fail ? ('통과 ' + pass + ' / 실패 ' + fail) : ('✓ ' + pass + '건 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
