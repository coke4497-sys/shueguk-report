#!/usr/bin/env node
/* 수정 요청함 슈국 조교 슈콩이 검증 (timetable.html, 2026-10-23 원장님 "수정 요청함을 슈콩이 조교로 의인화")
 *   NODE_PATH=$(npm root -g) node tools/req-shukong-e2e.js   (SHOT=폴더 면 화면을 찍어 둔다)
 * ① 맞이 말풍선 — 확인할 요청이 있으면 책상 슈콩 + 'n건 확인', 없으면 응원 슈콩 ② 처리 결과 = 슈콩 말풍선(완료 엄지 · 보류 확성기 '확인이 필요해요')
 * ⑧ 작성자 = 로그인한 계정 이름(고르거나 고칠 칸 없음, 2026-10-24) — 로그인 없으면 남기지 않음
 * ③ 접수됨 = '슈국 조교 슈콩이가 확인할 거예요' ④ 수업 리포트·별 사유 요청은 세지 않음 ⑤ 남긴 뒤 안내 ⑥ 목록 실패 ⑦ 그림 불러옴 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.png') ? 'image/png' : 'text/html;charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
let REQS, listFail = false, WHO = '김현지', SENT = null;
const BASE = [
  { row: 2, ts: '2026-10-23 15:00:00', writer: '최예나', screen: '주차별 시간표', text: '고1 백양B 명단에 김민준이 두 번 있어요', status: '접수됨', note: '', doneTs: '' },
  { row: 3, ts: '2026-10-22 16:00:00', writer: '김상우', screen: '오늘의 시간표', text: '박서연 출석이 안 찍혀요', status: '처리 완료', note: '10/22 박서연 출석을 다시 찍어 두었어요.', doneTs: '2026-10-22 16:20' },
  { row: 4, ts: '2026-10-21 18:00:00', writer: '조예나', screen: '전체 시간표', text: '반을 옮겨 주세요', status: '보류', note: '어느 반으로 옮길지 원장님 확인이 필요해요.', doneTs: '2026-10-21 18:30' },
  { row: 5, ts: '2026-10-21 19:00:00', writer: '', screen: '수업 리포트', text: '[수업 리포트] …', status: '접수됨', note: '', doneTs: '' },
  { row: 6, ts: '2026-10-21 19:10:00', writer: '', screen: '별 사유', text: '[별 사유] …', status: '접수됨', note: '', doneTs: '' },
];
(async () => {
  const b = await chromium.launch();
  async function open(vp){
    const ctx = await b.newContext({ viewport: vp || { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
    await ctx.route(/fonts\.g/, r => r.abort());
    await ctx.route(/teacher-name\.js/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.shuegukTeacherName=function(){return Promise.resolve(' + JSON.stringify(WHO) + ')};' }));
    await ctx.route(/supabase\.co/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await ctx.route(/script\.google\.com|googleusercontent/, async r => {
      const u = r.request().url(), body = r.request().postData() || '';
      if (u.includes('editReqList')) return listFail ? r.abort() : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'success', reqs: REQS }) });
      if (body.includes('editReqAdd')){ SENT = JSON.parse(body); REQS.unshift({ row: 9, ts: '2026-10-23 16:00:00', writer: '', screen: '기타', text: '새 요청', status: '접수됨', note: '', doneTs: '' }); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"success"}' }); }
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' });
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => { fail++; console.log('  ✗ 페이지 오류 ' + e.message); });
    await page.addInitScript(() => { sessionStorage.setItem('tt_mode', 'today'); sessionStorage.setItem('tt_book', '정규'); });
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    await page.waitForSelector('#ab-req', { timeout: 15000 });
    return { ctx, page };
  }
  const src = (page, sel) => page.$eval(sel, e => e.getAttribute('src'));

  REQS = BASE.map(x => ({ ...x }));
  let { ctx, page } = await open();
  await page.click('#ab-req');
  await page.waitForSelector('#req-list .req-item');
  ok('맞이 = 책상 슈콩', (await src(page, '#req-sk img')) === 'assets/sk-desk.png');
  const say = await page.textContent('#req-sk .req-bub');
  ok('말풍선 = 슈국 조교 슈콩이 · 요청 1건 확인 중(수업 리포트·별 사유 빼고)', say.includes('슈국 조교 슈콩이') && say.includes('요청 1건'), say);
  ok('목록 3건(수업 리포트·별 사유 없음)', (await page.$$('#req-list .req-item')).length === 3);
  const items = await page.$$eval('#req-list .req-item', es => es.map(e => e.textContent));
  ok('접수됨 = 슈국 조교 슈콩이가 확인할 거예요', items[0].includes('슈국 조교 슈콩이가 확인할 거예요'));
  ok('처리 완료 = 슈콩 말풍선 + 엄지 슈콩', items[1].includes('슈국 조교 슈콩이') && items[1].includes('다시 찍어 두었어요'));
  ok('처리 완료 그림', (await page.$$eval('#req-list .req-reply img', es => es.map(e => e.getAttribute('src')))).join() === 'assets/sk-best.png,assets/sk-notice.png');
  ok('보류 = 확인이 필요해요', items[2].includes('확인이 필요해요') && await page.$('#req-list .req-reply.hold') !== null);
  await page.waitForTimeout(300);
  ok('그림을 모두 불러옴', await page.$$eval('#modal-box img', es => es.length >= 4 && es.every(e => e.complete && e.naturalWidth > 0)));
  if (process.env.SHOT) await page.screenshot({ path: path.join(process.env.SHOT, 'req-shukong.png'), clip: await page.$eval('#modal-box', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 900) }; }) });
  ok('작성자 입력칸 없음', await page.$('#req-writer') === null && await page.$('#modal-box .req-form input') === null);
  await page.waitForFunction(() => document.getElementById('req-who').textContent.includes('김현지'));
  ok('작성자 = 로그인한 계정 이름', (await page.textContent('#req-who')).includes('로그인한 계정으로 기록됩니다'));
  await page.fill('#req-text', '새 요청');
  await page.click('#modal-box .mbtns .primary');
  await page.waitForFunction(() => (document.getElementById('req-msg') || {}).textContent.includes('슈국 조교 슈콩이가 요청을 받았어요'));
  ok('남긴 뒤 = 슈국 조교 슈콩이가 받았어요', true);
  ok('보낸 작성자 = 로그인 이름', SENT && SENT.writer === '김현지', JSON.stringify(SENT));
  await page.waitForFunction(() => document.querySelector('#req-sk .req-bub').textContent.includes('요청 2건'));
  ok('다시 받으면 말풍선 숫자 갱신', true);
  await ctx.close();

  REQS = BASE.filter(x => x.status !== '접수됨');
  ({ ctx, page } = await open({ width: 390, height: 844 }));
  await page.click('#ab-req');
  await page.waitForSelector('#req-list .req-item');
  ok('모두 처리 = 응원 슈콩', (await src(page, '#req-sk img')) === 'assets/sk-cheer.png' && (await page.textContent('#req-sk')).includes('모두 처리했어요'));
  ok('휴대폰 가로 넘침 없음', await page.$eval('#modal-box', e => e.scrollWidth <= e.clientWidth + 1));
  await ctx.close();

  WHO = ''; SENT = null;
  ({ ctx, page } = await open());
  await page.click('#ab-req');
  await page.waitForFunction(() => document.getElementById('req-who').textContent.includes('찾지 못했습니다'));
  ok('로그인 없음 = 안내 + 로그인 링크', (await page.$('#req-who.none a[href*="login.html"]')) !== null);
  await page.fill('#req-text', '새 요청');
  await page.click('#modal-box .mbtns .primary');
  await page.waitForTimeout(400);
  ok('로그인 없음 = 남기지 않음', SENT === null && (await page.textContent('#req-err')).includes('로그인'));
  await ctx.close();
  WHO = '김현지';

  listFail = true;
  ({ ctx, page } = await open());
  await page.click('#ab-req');
  await page.waitForFunction(() => document.getElementById('req-list').textContent.includes('불러오지 못했어요'));
  ok('목록 실패 = 기본 안내 말풍선', (await page.textContent('#req-sk')).includes('적어 주세요'));
  await ctx.close();

  await b.close(); srv.close();
  console.log(`\n${pass} / ${pass + fail} 통과`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
