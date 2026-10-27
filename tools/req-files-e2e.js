#!/usr/bin/env node
/* 수정 요청함 첨부 파일·내신 시험 범위 양식 검증 (timetable.html, 2026-10-26 원장님 "수정 요청에 파일이나 캡쳐 복사붙이기" + "내신 시험 범위를 수정요청함에 받아 기록")
 *   LC_ALL=C.UTF-8 NODE_PATH=$(npm root -g) node tools/req-files-e2e.js
 * ① [파일 첨부]·Ctrl+V 그림 붙여넣기(캡처_ 이름)·글만 붙이면 그대로·20MB 넘으면 뺌 → 요청 남기기 = 저장소 올리기(교사 신분, r/rq_…/…) + edit_req_files 줄 + 글 끝 '[첨부 n] … #rq_…'
 * ② 목록 = 첨부 표시 줄을 떼고 첨부 칩(열쇠로 조회), 칩을 누르면 교사 신분으로 받아 연다 ③ 올리기 실패면 요청을 남기지 않는다
 * ④ 화면 '내신 시험 범위' — 기간 알약(기본 다가오는 시험)·학년·학교(내신 반이름 → 공유 키)·지금 저장된 범위 → 글 머리 '[내신 시험 범위] 기간 · 고1 화정 (공유:고1|화정) · 교과서: …'
 * ⑤ 수업 기록 창 '수정 요청함으로 보내기' → 그 반의 기간·학교가 미리 골라진다 */
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
const TODAY = new Intl.DateTimeFormat('ko-KR', { weekday: 'narrow', timeZone: 'Asia/Seoul' }).format(new Date());
const TODAYSTR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const PERS = (() => { const m = +TODAYSTR.split('-')[1], y = +TODAYSTR.split('-')[0]; const sy = m >= 3 ? y : y - 1, sem = (m >= 3 && m <= 7) ? 1 : 2, yy = String(sy).slice(2);
  return { mid: yy + '-' + sem + '-중간', fin: yy + '-' + sem + '-기말', upcoming: ((m >= 8 && m <= 9) || (m >= 3 && m <= 4)) ? yy + '-' + sem + '-중간' : yy + '-' + sem + '-기말' }; })();
const P = TODAYSTR.split('-'), T0 = new Date(+P[0], +P[1] - 1, +P[2]), pad = n => String(n).padStart(2, '0');
const WEDS = []; for (let k = -21; k <= 21; k += 7){ const d = new Date(T0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 2 + k); WEDS.push(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())); }
let REQS, SENT = [], UPFAIL = false;
const st = { store: [], files: [], gets: [] };
const BASE = [
  { row: 2, ts: '2026-10-26 15:00', writer: '최예나', screen: '주차별 시간표', text: '고1 백양B 명단 확인해 주세요\n[첨부 2] 캡처_1026_150012.png · 시험 범위 안내.pdf · #rq_abc123def456', status: '접수됨', note: '', doneTs: '' },
  { row: 3, ts: '2026-10-25 16:00', writer: '김상우', screen: '오늘의 시간표', text: '박서연 출석이 안 찍혀요', status: '처리 완료', note: '다시 찍어 두었어요.', doneTs: '2026-10-25 16:20' },
];
const FILES = [
  { id: 11, req_key: 'rq_abc123def456', path: 'r/rq_abc123def456/aaaa.png', name: '캡처_1026_150012.png', size: 2048, mime: 'image/png' },
  { id: 12, req_key: 'rq_abc123def456', path: 'r/rq_abc123def456/bbbb.pdf', name: '시험 범위 안내.pdf', size: 4096, mime: 'application/pdf' },
];
const NS_CLASSES = [{ name: '고1 화정A(천재수 공통국어2)' }, { name: '고1 화정B(천재수 공통국어2)' }, { name: '고2 서정A(천재 독작)' }, { name: '고1 확인' }, { name: '고3파이널A' }, { name: '중2 화정A(비상(영))' }];
const NS_SCOPE_T2 = '교과서: 천재수 공통국어2\n교과서 내 범위: 2(1) 청산별곡\n2(2) 속미인곡\n교과서 외 범위: 학습지 1~3';
const NS_SCOPE = { period: PERS.fin, class_key: '공유:고1|화정', kind: '범위', week: '', student: '', text1: JSON.stringify({ book: '천재수 공통국어2', inRange: '2(1) 청산별곡\n2(2) 속미인곡', extra: '', outRange: '학습지 1~3' }), text2: '교과서: 천재수 공통국어2\n교과서 내 범위: 2(1) 청산별곡\n2(2) 속미인곡\n교과서 외 범위: 학습지 1~3' };
(async () => {
  const b = await chromium.launch();
  async function open(opt){
    opt = opt || {};
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
    await ctx.route(/fonts\.g/, r => r.abort());
    await ctx.route(/teacher-name\.js/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.shuegukTeacherName=function(){return Promise.resolve("김현지")};' }));
    await ctx.route(/supabase\.co/, async r => {
      const req = r.request(), u = decodeURIComponent(req.url()), m = req.method(), h = req.headers();
      const json = (s, o) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
      if (/\/auth\/v1\//.test(u)) return json(200, { access_token: 'T', expires_in: 3600 });
      if (/\/storage\/v1\//.test(u)){
        st.store.push({ m, u, auth: h['authorization'] || '', type: h['content-type'] || '', upsert: h['x-upsert'] || '', size: (req.postDataBuffer() || Buffer.alloc(0)).length });
        if (m === 'GET') return r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('fakepng') });
        if (UPFAIL) return json(500, { message: 'boom' });
        return json(200, { Key: 'x' });
      }
      let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (e) {}
      if (m !== 'GET') (st.writes = st.writes || []).push({ m, u, body });   // 수파베이스 쓰기 기록(⑥ 시험 범위 저장)
      if (/\/edit_req_files/.test(u)){
        if (m === 'POST'){ st.files.push({ body, auth: h['authorization'] || '' }); return r.fulfill({ status: 201, body: '' }); }
        st.gets.push(u);
        const keys = ((u.match(/req_key=in\.\(([^)]*)\)/) || [])[1] || '').split(',').map(x => x.replace(/"/g, ''));
        return json(200, FILES.concat(st.files.flatMap(f => f.body.map((x, i) => Object.assign({ id: 100 + i }, x)))).filter(f => keys.includes(f.req_key)));
      }
      if (/\/tt_classes\?book=eq\.내신.*select=name$/.test(u)) return json(200, NS_CLASSES);   // 수정 요청함 양식의 반이름 조회(이름만)
      if (/\/naeshin_records\?/.test(u)){
        st.gets.push(u);
        if (m !== 'GET') return r.fulfill({ status: 201, body: '' });
        const per = (u.match(/period=(?:eq\.|in\.\()([^&)]*)/) || [])[1] || '';
        const hit = per.split(',').map(x => x.replace(/"/g, '')).includes(NS_SCOPE.period) && (!/class_key=eq/.test(u) || /공유:고1\|화정/.test(u));   // 목록 조회(class_key 조건 없음)도 범위를 돌려준다
        return json(200, hit ? [NS_SCOPE] : []);
      }
      if (/\/tt_classes\?/.test(u) && opt.rows) return json(200, u.indexOf('book=eq.내신') >= 0 ? opt.rows : []);
      if (/\/tt_period/.test(u)) return json(200, opt.rows ? WEDS.map(w => ({ week_wednesday: w, book: '내신' })) : []);
      if (/\/students\?/.test(u)) return json(200, [{ name: '박보검', school: '화정고', grade: '2026 고등 1학년', code: 'k1', enrolled: '재원' }]);
      return json(m === 'GET' ? 200 : 201, []);
    });
    await ctx.route(/script\.google\.com|googleusercontent/, async r => {
      const u = r.request().url(), body = r.request().postData() || '';
      if (body){ try { (st.gas = st.gas || []).push(JSON.parse(body)); } catch (e) {} }   // 옛 백엔드 POST 기록(시트 사본)
      if (u.includes('editReqList')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'success', reqs: REQS }) });
      if (body.includes('editReqAdd')){ const s = JSON.parse(body); SENT.push(s); REQS.unshift({ row: 9, ts: '2026-10-26 16:00', writer: s.writer, screen: s.screen, text: s.text, status: '접수됨', note: '', doneTs: '' }); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"success"}' }); }
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"success"}' });
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => { fail++; console.log('  ✗ 페이지 오류 ' + e.message); });
    page.on('dialog', d => d.accept());
    await page.addInitScript(o => { sessionStorage.setItem('tt_mode', 'today'); sessionStorage.setItem('tt_book', o.bk); localStorage.clear(); }, { bk: opt.rows ? '내신' : '정규' });
    await page.goto('http://127.0.0.1:' + port + '/timetable.html');
    await page.waitForSelector('#ab-req', { timeout: 15000 });
    return { ctx, page };
  }
  const paste = (page, kind) => page.evaluate(k => {
    const dt = new DataTransfer();
    if (k === 'img') dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' }));
    else dt.setData('text/plain', '글만');
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.getElementById('req-text').dispatchEvent(ev); return ev.defaultPrevented;
  }, kind);

  // ① 첨부 + 보내기
  REQS = BASE.map(x => ({ ...x })); SENT = [];
  let { ctx, page } = await open();
  await page.click('#ab-req');
  await page.waitForSelector('#req-list .req-item');
  ok('[파일 첨부] 버튼·붙여넣기 안내', !!(await page.$('#req-file-btn')) && /Ctrl\+V/.test(await page.textContent('.req-tools')));
  await page.setInputFiles('#req-file', [{ name: '시험 범위.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') }]);
  ok('고른 파일이 칩으로', (await page.textContent('#req-pend')).includes('시험 범위.pdf'));
  await page.focus('#req-text');
  ok('그림 붙여넣기 → 캡처_ 이름 칩 + 미리보기', (await paste(page, 'img')) && /캡처_\d{4}_\d{6}\.png/.test(await page.textContent('#req-pend')) && !!(await page.$('#req-pend img')));
  ok('글만 붙이면 그대로', !(await paste(page, 'text')));
  await page.setInputFiles('#req-file', [{ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(21 * 1024 * 1024, 1) }]);
  ok('20MB 넘는 파일은 뺀다', (await page.textContent('#req-err')).includes('20MB') && !(await page.textContent('#req-pend')).includes('big.png'));
  await page.click('#req-pend [data-rm="0"]');
  ok('칩 ×로 빼기', !(await page.textContent('#req-pend')).includes('시험 범위.pdf') && (await page.$$('#req-pend .req-pf')).length === 1);
  await page.fill('#req-text', '고1 백양B 칩이 잘려요');
  await page.waitForFunction(() => document.getElementById('req-who').textContent.includes('김현지'));
  await page.click('#req-submit');
  await page.waitForFunction(() => (document.getElementById('req-msg') || {}).textContent.includes('요청을 받았어요'), null, { timeout: 8000 });
  const up = st.store.filter(x => x.m === 'POST');
  ok('저장소 올리기 = 교사 신분 · r/rq_…/무작위.png · image/png · 덮어쓰기 없음', up.length === 1 && /Bearer T/.test(up[0].auth) && /\/object\/edit-req-files\/r\/rq_[a-z0-9]{12}\/[a-z0-9]{16}\.png$/.test(up[0].u) && up[0].type === 'image/png' && up[0].upsert === 'false' && up[0].size === 4, JSON.stringify(up));
  const fr = st.files[0];
  ok('edit_req_files 한 줄(열쇠·작성자·이름·크기·mime)', fr && fr.body.length === 1 && /^rq_/.test(fr.body[0].req_key) && fr.body[0].writer === '김현지' && /캡처_/.test(fr.body[0].name) && fr.body[0].size === 4 && fr.body[0].mime === 'image/png', JSON.stringify(fr));
  const key = fr && fr.body[0].req_key;
  ok('요청 글 끝에 [첨부 1] 이름 · #rq_…', SENT.length === 1 && SENT[0].screen === '오늘의 시간표' && new RegExp('^고1 백양B 칩이 잘려요\\n\\[첨부 1\\] 캡처_\\d{4}_\\d{6}\\.png · #' + key + '$').test(SENT[0].text), JSON.stringify(SENT));
  ok('보낸 뒤 칩 비움', (await page.$$('#req-pend .req-pf')).length === 0);
  // ② 목록
  await page.waitForFunction(() => document.querySelectorAll('#req-list .req-att').length >= 3, null, { timeout: 8000 });
  const items = await page.$$eval('#req-list .req-item', es => es.map(e => ({ text: e.querySelector('.req-text').textContent, att: [...e.querySelectorAll('.req-att span')].map(x => x.textContent) })));
  ok('목록: 첨부 표시 줄을 떼고 글만', items[1].text === '고1 백양B 명단 확인해 주세요' && items[0].text === '고1 백양B 칩이 잘려요', JSON.stringify(items));
  ok('목록: 열쇠로 받은 첨부 칩 2개 + 방금 올린 1개', items[1].att.join('|') === '캡처_1026_150012.png|시험 범위 안내.pdf' && items[1].att.length === 2 && items[0].att.length === 1, JSON.stringify(items));
  ok('첨부 조회는 열쇠 묶음 한 번', st.gets.filter(u => /edit_req_files/.test(u)).length <= 2 && st.gets.some(u => /req_key=in\.\("rq_abc123def456"/.test(u)), JSON.stringify(st.gets));
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#req-list .req-att[data-fid="11"]')]);
  await page.waitForFunction(() => /blob:/.test([...document.querySelectorAll('*')].length ? '' : '') || true);
  await page.waitForTimeout(500);
  const got = st.store.filter(x => x.m === 'GET');
  ok('칩을 누르면 교사 신분으로 받아 새 창', got.length === 1 && /r\/rq_abc123def456\/aaaa\.png$/.test(got[0].u) && /Bearer T/.test(got[0].auth) && popup && /^blob:/.test(popup.url()), JSON.stringify(got) + ' ' + (popup && popup.url()));
  await popup.close().catch(() => {});
  ok('첨부 없는 글은 내용 필수', await page.evaluate(() => { document.getElementById('req-text').value = ''; reqSubmit(); return document.getElementById('req-err').textContent; }) === '내용을 적거나 파일을 붙여 주세요.');
  await ctx.close();

  // ③ 올리기 실패 → 요청 안 남김
  REQS = BASE.map(x => ({ ...x })); SENT = []; UPFAIL = true; st.store.length = 0; st.files.length = 0;
  ({ ctx, page } = await open());
  await page.click('#ab-req');
  await page.waitForSelector('#req-list .req-item');
  await page.setInputFiles('#req-file', [{ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('xx') }]);
  await page.fill('#req-text', '실패 검사');
  await page.waitForFunction(() => document.getElementById('req-who').textContent.includes('김현지'));
  await page.click('#req-submit');
  await page.waitForFunction(() => /올리지 못했어요/.test(document.getElementById('req-err').textContent), null, { timeout: 8000 });
  ok('올리기 실패 = 요청 안 남김 · 표에 안 적음 · 파일 칩 유지', SENT.length === 0 && st.files.length === 0 && (await page.$$('#req-pend .req-pf')).length === 1 && !(await page.$eval('#req-submit', e => e.disabled)));
  UPFAIL = false;
  await ctx.close();

  // ④ 내신 시험 범위 양식
  REQS = BASE.map(x => ({ ...x })); SENT = []; st.gets.length = 0; st.store.length = 0; st.files.length = 0;
  ({ ctx, page } = await open());
  await page.click('#ab-req');
  await page.waitForSelector('#req-list .req-item');
  ok('화면 목록에 내신 시험 범위 · 양식은 숨김', (await page.$$eval('#req-screen option', es => es.map(e => e.textContent))).includes('내신 시험 범위') && await page.$eval('#req-ns', e => e.hidden));
  await page.selectOption('#req-screen', '내신 시험 범위');
  await page.waitForFunction(() => document.querySelectorAll('#req-ns-key option').length > 2, null, { timeout: 8000 });
  let r = await page.evaluate(() => ({ hid: document.getElementById('req-ns').hidden, lb: document.getElementById('req-text-lb').textContent, ph: document.getElementById('req-text').placeholder,
    per: [...document.querySelectorAll('#req-ns-per button')].map(x => x.textContent + (x.classList.contains('on') ? '*' : '')),
    opts: [...document.querySelectorAll('#req-ns-key option')].map(x => x.value + '=' + x.textContent), now: document.getElementById('req-ns-now').textContent }));
  ok('양식 보임 · 글 칸은 "메모 (선택)" · 교과서 내 범위는 목차에서, 교과서 외 범위는 영역+제목 안내', !r.hid && r.lb === '메모 (선택)' && /교과서 내 범위는 위 목차에서/.test(r.ph) && /학년·학교를 고르면 그 학교 교과서 목차/.test(await page.textContent('#req-ns-toc')) && !!(await page.$('#req-ns-outp .toc-area')), JSON.stringify(r));
  ok('기간 알약 둘 · 다가오는 시험이 기본', r.per.length === 2 && r.per.includes(PERS.upcoming + '*'), JSON.stringify(r.per));
  ok('학년·학교 = 내신 반이름의 공유 키(확인·고3파이널 제외, 교과서 붙임, 목록에 없음)', r.opts.join('|') === '=학년·학교를 고르세요|공유:중2|화정=중2 화정 · 비상(영)|공유:고1|화정=고1 화정 · 천재수 공통국어2|공유:고2|서정=고2 서정 · 천재 독서와 작문|__none=목록에 없음 — 글에 학년·학교를 적어 주세요', r.opts.join('|'));
  ok('고르기 전 안내', /학년·학교를 고르면/.test(r.now));
  await page.selectOption('#req-ns-key', '공유:고1|화정');
  await page.click('#req-ns-per button:not(.on)');   // 다른 기간으로
  await page.click('#req-ns-per button:not(.on)');   // 다시 기본(기말)
  await page.waitForFunction(() => /청산별곡/.test(document.getElementById('req-ns-now').textContent), null, { timeout: 8000 });
  ok('지금 저장된 범위를 보여 준다', /교과서: 천재수 공통국어2/.test(await page.textContent('#req-ns-now')) && st.gets.some(u => new RegExp('period=eq\\.' + PERS.fin + '.*kind=eq\\.범위.*class_key=eq\\.공유:고1\\|화정').test(u)), JSON.stringify(st.gets));
  await page.click('#req-ns-per button:not(.on)');   // 중간으로
  await page.waitForFunction(() => /아직 없어요/.test(document.getElementById('req-ns-now').textContent), null, { timeout: 8000 });
  ok('범위가 없는 기간은 "아직 없어요"', true);
  await page.click('#req-ns-per button:not(.on)');   // 기말로
  await page.waitForFunction(() => /청산별곡/.test(document.getElementById('req-ns-now').textContent), null, { timeout: 8000 });
  await page.waitForFunction(() => document.getElementById('req-who').textContent.includes('김현지'));
  await page.waitForSelector('#req-ns-toc select.toc-unit', { timeout: 8000 });
  r = await page.evaluate(() => ({ book: document.querySelector('#req-ns-toc .toc-book').value, txt: document.querySelector('#req-ns-toc .toc-book option:checked').textContent, meta: document.querySelector('#req-ns-toc .toc-meta').textContent }));
  ok('학년·학교를 고르면 그 학교 교과서 목차 — 고1 화정 + 천재수 공통국어2 → 천재(김수학) 공통국어2', r.book === 'T2' && /천재\(김수학\) 공통국어2/.test(r.txt), JSON.stringify(r));
  ok('드롭다운은 교과서 이름만, 옆 작은 글씨 = n개 항목 · 쓰는 학교(학교가 맨 뒤)', r.txt.trim() === '천재(김수학) 공통국어2' && /^\d+개 항목 · [가-힣·]+고$/.test(r.meta.trim()), JSON.stringify(r));
  ok('단원도 글도 파일도 없으면 거절', await page.evaluate(() => { reqSubmit(); return document.getElementById('req-err').textContent; }) === '교과서 내 범위를 고르거나, 교과서 외 범위를 더하거나, 안내문 사진을 붙여 주세요.');
  await page.selectOption('#req-ns-toc .toc-unit', '1(1) 주체적으로 감상하기 · 뉴욕제과점(김연수)');
  await page.selectOption('#req-ns-outp .toc-area', '기타');
  await page.fill('#req-ns-outp .toc-title', '학습지 4~6');
  await page.click('#req-ns-outp .toc-add');
  await page.fill('#req-text', '범위 확정본이에요');
  await page.click('#req-submit');
  await page.waitForFunction(() => (document.getElementById('req-msg') || {}).textContent.includes('요청을 받았어요'), null, { timeout: 8000 });
  ok('보낸 글 = 머리 + 교과서 내 범위(고른 줄) + 교과서 외 범위([영역] 제목) + 메모', SENT.length === 1 && SENT[0].screen === '내신 시험 범위' &&
     SENT[0].text === '[내신 시험 범위] ' + PERS.fin + ' · 고1 화정 (공유:고1|화정) · 교과서: 천재 공통국어2\n교과서 내 범위:\n- 1(1) 주체적으로 감상하기 · 뉴욕제과점(김연수)\n교과서 외 범위:\n- [기타] 학습지 4~6\n메모:\n범위 확정본이에요', JSON.stringify(SENT));
  await page.selectOption('#req-ns-key', '__none');
  ok('목록에 없음 → 안내', /글 맨 앞에 학년·학교/.test(await page.textContent('#req-ns-now')));
  await page.setInputFiles('#req-file', [{ name: 'notice.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpg') }]);
  await page.click('#req-submit');
  await page.waitForFunction(() => (document.getElementById('req-msg') || {}).textContent.includes('요청을 받았어요'), null, { timeout: 8000 });
  ok('사진만 보내면 "(첨부한 안내문 사진 참고)" + 첨부 줄', SENT.length === 2 && new RegExp('^\\[내신 시험 범위\\] ' + PERS.fin + ' · 학년·학교는 글 참고\\n\\(첨부한 안내문 사진 참고\\)\\n\\[첨부 1\\] notice\\.jpg · #rq_[a-z0-9]{12}$').test(SENT[1].text), JSON.stringify(SENT[1]));
  await page.selectOption('#req-screen', '기타');
  ok('다른 화면으로 돌아가면 양식 숨김·글 칸 이름 복귀', await page.$eval('#req-ns', e => e.hidden) && (await page.textContent('#req-text-lb')) === '무엇을 고칠까요?');
  await ctx.close();

  // ⑤ 수업 기록 창(내신 진도, 범위 없음) → [수정 요청함으로 보내기]
  REQS = BASE.map(x => ({ ...x })); SENT = []; st.gets.length = 0;
  ({ ctx, page } = await open({ rows: [{ class_id: 'n001', day: TODAY, start_time: '5:30', end_time: '7:00', location: '본원', teacher: '현지', name: '고2 서정A(천재 독작)', roster: '박보검', kind: '' }] }));
  await page.waitForFunction(() => [...document.querySelectorAll('.blk')].some(x => x.querySelector('.crbtn')), null, { timeout: 15000 });
  await page.evaluate(() => { CR_NS_SPLIT_FROM = '2000-01-01'; CR_NS_SPLIT_TO = '2000-01-02'; });   // 고1·고2 예외 기간(내신 시간표로 정규 수업, ~11/3)은 날짜에 묶여 있어 검사에서는 끈다
  await page.evaluate(() => document.querySelector('.blk .crbtn').click());
  await page.waitForSelector('#cr-ns-req', { timeout: 8000 });
  ok('범위 없는 진도 수업 = 안내 + [수정 요청함으로 보내기]', /아직 없습니다/.test(await page.textContent('#cr-scope')));
  await page.click('#cr-ns-req');
  await page.waitForFunction(() => document.getElementById('req-ns-key') && document.getElementById('req-ns-key').value === '공유:고2|서정', null, { timeout: 8000 });
  r = await page.evaluate(() => ({ scr: document.getElementById('req-screen').value, per: [...document.querySelectorAll('#req-ns-per button.on')].map(x => x.textContent), key: document.getElementById('req-ns-key').value }));
  ok('수정 요청 창이 내신 시험 범위 · 그 반 기간·학교로 열린다', r.scr === '내신 시험 범위' && r.per.join() === PERS.upcoming && r.key === '공유:고2|서정', JSON.stringify(r));

  // ⑥ 슈국 스케쥴 [시험 범위] 탭 — 기간 × 학년·학교(공유 키) 카드, 목차 고르기 + 영역·제목으로 적고 naeshin_records '범위'에 저장(2026-10-26 원장님)
  await ctx.close();
  st.gets.length = 0; st.writes = []; st.gas = [];
  ({ ctx, page } = await open({ rows: [
    { class_id: 'n001', day: TODAY, start_time: '5:30', end_time: '7:00', location: '화정센터', teacher: '현지', name: '고1 화정A(천재수 공통국어2)', roster: '박보검', kind: '' },
    { class_id: 'n002', day: TODAY, start_time: '7:30', end_time: '9:00', location: '화정센터', teacher: '연주', name: '고1 확인', roster: '(화정)박보검', kind: '' },
    { class_id: 'n015', day: TODAY, start_time: '7:30', end_time: '9:00', location: '본원', teacher: '슈', name: '고3파이널A', roster: '김하늘', kind: '' }] }));
  await page.evaluate(() => setMode('scope'));
  await page.waitForSelector('.sc-card', { timeout: 10000 });
  r = await page.evaluate(() => ({ on: document.getElementById('v-scope').classList.contains('on'), hint: document.querySelector('.hint').textContent,
    per: [...document.querySelectorAll('#sc-per button')].map(x => x.textContent + (x.classList.contains('on') ? '*' : '')),
    cards: [...document.querySelectorAll('.sc-card')].map(c => c.querySelector('h4').textContent + '|' + c.querySelector('.sc-cls').textContent + '|' + c.querySelector('[data-scedit]').textContent),
    sum: (document.getElementById('sc-sum') || {}).textContent || '', body: document.querySelector('.sc-card[data-key="공유:고1|화정"]').textContent }));
  ok('[시험 범위] 탭: 기본 기간 = 다가오는 시험(26-2-기말) · 내신 진도반을 학년·학교로 묶은 카드(확인·고3 제외) · 입력/고치기', r.on && /학년·학교마다 시험범위/.test(r.hint) && r.per.includes(PERS.fin + '*') &&
     r.cards.length === 1 && /고1 화정/.test(r.cards[0]) && /항목 3개/.test(r.cards[0]) && /고1 화정A\(천재수 공통국어2\) · 현지T/.test(r.cards[0]) && /고치기$/.test(r.cards[0]) && /입력 완료 0 \/ 1 · 일부 기록 1/.test(r.sum) && /일부 기록 · 항목 3개/.test(r.cards[0]) && /청산별곡/.test(r.body) && /학습지 1~3/.test(r.body), JSON.stringify(r));
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '/6-시험범위탭-카드.png', clip: { x: 0, y: 0, width: 1300, height: 560 } });
  // ⑥-1 학년별 구역(2026-10-27 원장님 "학년별로 표시되도록" + "전체 화면에서도 학년별 그룹이 가시화되도록") — '전체'에서도 중2·고1·고2 머리 띠 + 그 학년 입력 수, 학년을 고르면 그 구역만
  r = await page.evaluate(() => {
    window.__scOrig = SC.targets;
    SC.targets = scopeTargetsOf([
      { class_id: 'n101', name: '고2 서정A(천재 독작)', teacher: '주혜' }, { class_id: 'n102', name: '중2 화정A(비상(영))', teacher: '은지' },
      { class_id: 'n103', name: '중2 백양(비상(현))', teacher: '은지' }, { class_id: 'n001', name: '고1 화정A(천재수 공통국어2)', teacher: '현지' },
      { class_id: 'n104', name: '고1 능곡(해냄 공통국어2)', teacher: '현지' }]);
    SC.grade = ''; render();
    const secs = [...document.querySelectorAll('.sc-sec')].map(s => s.getAttribute('data-grade') + '|' + s.querySelector('.sc-sec-h .sc-cnt').textContent + '|' + [...s.querySelectorAll('.sc-card h4')].map(h => h.firstChild.textContent).join(','));
    return { secs, sum: document.getElementById('sc-sum').textContent, grades: [...document.querySelectorAll('#sc-grade button')].map(b => b.textContent) };
  });
  ok('[전체] = 학년 구역 중2 → 고1 → 고2, 띠마다 그 학년 입력 수, 카드는 학교 가나다', r.secs.join(';') === '중2|입력 완료 0 / 2|중2 백양,중2 화정;고1|입력 완료 0 / 2 · 일부 기록 1|고1 능곡,고1 화정;고2|입력 완료 0 / 1|고2 서정' && r.sum === PERS.fin + ' · 입력 완료 0 / 5 · 일부 기록 1' && r.grades.join(',') === '전체,중2,고1,고2', JSON.stringify(r));
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '/6b-시험범위탭-학년별.png', clip: { x: 0, y: 0, width: 1300, height: 900 } });
  await page.click('#sc-grade [data-scgr="고1"]');
  r = await page.evaluate(() => ({ secs: [...document.querySelectorAll('.sc-sec')].map(s => s.getAttribute('data-grade')), n: document.querySelectorAll('.sc-card').length, all: document.querySelector('.sc-sec-h .sc-cnt').className }));
  ok('학년을 고르면 그 학년 구역만(머리 띠는 남음)', r.secs.join() === '고1' && r.n === 2 && !/all/.test(r.all), JSON.stringify(r));
  await page.evaluate(() => { SC.targets = window.__scOrig; SC.grade = ''; render(); });
  r = await page.evaluate(() => ({ secs: [...document.querySelectorAll('.sc-sec .sc-cnt')].map(e => e.className + ':' + e.textContent) }));
  ok('일부 기록만 있으면 띠는 "입력 완료 0 / 1 · 일부 기록 1"', r.secs.join() === 'sc-cnt:입력 완료 0 / 1 · 일부 기록 1', JSON.stringify(r));
  // ⑥-2 입력 상태(2026-10-27 원장님 "그 버튼을 일부 기록, 입력 완료로 바뀌도록 … 상태가 바뀌도록 표시하는 버튼") — 카드 [입력 완료로 표시] → done 만 바꿔 저장, 알약·띠·합계가 바뀜, [일부 기록으로] 되돌림
  st.writes = [];
  await page.click('.sc-card [data-scdone][data-to="1"]');
  await page.waitForFunction(() => /입력 완료/.test((document.getElementById('sc-msg') || {}).textContent || ''), null, { timeout: 8000 });
  const dw = st.writes.filter(w => /naeshin_records/.test(w.u)).pop(), dt = dw && JSON.parse(dw.body[0].text1);
  r = await page.evaluate(() => ({ st: document.querySelector('.sc-card .sc-st').className + ':' + document.querySelector('.sc-card .sc-st').textContent, cnt: document.querySelector('.sc-sec .sc-cnt').className + ':' + document.querySelector('.sc-sec .sc-cnt').textContent,
    sum: document.getElementById('sc-sum').textContent, btn: document.querySelector('.sc-card [data-scdone]').textContent, body: document.querySelector('.sc-card').textContent }));
  ok('[입력 완료로 표시] → 범위는 그대로(청산별곡·학습지) + done:true 저장, 알약 "입력 완료 · 항목 3개"(세이지), 띠 "모두 완료", 단추는 [일부 기록으로]',
     dt && dt.done === true && dt.inRange === '2(1) 청산별곡\n2(2) 속미인곡' && dt.outRange === '학습지 1~3' && dw.body[0].text2 === NS_SCOPE_T2 &&
     r.st === 'sc-st ok:입력 완료 · 항목 3개' && r.cnt === 'sc-cnt all:입력 완료 1 / 1 · 모두 완료' && /입력 완료 1 \/ 1 · 모두 완료/.test(r.sum) && r.btn === '일부 기록으로' && /청산별곡/.test(r.body), JSON.stringify({ dt, r }));
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '/6c-시험범위탭-입력완료.png', clip: { x: 0, y: 0, width: 1300, height: 560 } });
  await page.click('.sc-card [data-scdone][data-to="0"]');
  await page.waitForFunction(() => /일부 기록/.test((document.getElementById('sc-msg') || {}).textContent || ''), null, { timeout: 8000 });
  const pw = st.writes.filter(w => /naeshin_records/.test(w.u)).pop(), pt = pw && JSON.parse(pw.body[0].text1);
  r = await page.evaluate(() => document.querySelector('.sc-card .sc-st').className + ':' + document.querySelector('.sc-card .sc-st').textContent);
  ok('[일부 기록으로] → done 없이 저장, 알약 "일부 기록"(연노랑)', pt && !('done' in pt) && r === 'sc-st part:일부 기록 · 항목 3개', JSON.stringify({ pt, r }));
  await page.click('.sc-card [data-scedit]');
  await page.waitForSelector('.sc-card.on .sc-toc select.toc-unit', { timeout: 8000 });
  r = await page.evaluate(() => ({ book: document.querySelector('.sc-card.on .toc-book').value, chips: [...document.querySelectorAll('.sc-card.on .sc-toc .toc-chip')].map(x => x.className + ':' + x.firstChild.textContent),
    outs: [...document.querySelectorAll('.sc-card.on .sc-outp .toc-chip')].map(x => x.textContent.replace(/×$/, '')) }));
  ok('[고치기] → 교과서 목차(천재 공통국어2) · 옛 자유 글 줄은 "목록 밖" 칩으로 보존 · 교과서 외 범위 칩', r.book === 'T2' && r.chips.length === 2 && r.chips.every(c => /free/.test(c)) && r.outs.join() === '학습지 1~3', JSON.stringify(r));
  r = await page.evaluate(() => [...document.querySelectorAll('.sc-card.on .sc-stsel button')].map(b => b.className + ':' + b.textContent));
  ok('입력 중 상태 알약 [일부 기록][입력 완료] — 지금 상태(일부 기록)가 켜져 있음', r.join() === 'on part:일부 기록,:입력 완료', JSON.stringify(r));
  await page.click('.sc-card.on [data-scsel="1"]');
  await page.waitForSelector('.sc-card.on .sc-stsel button.on[data-scsel="1"]');
  await page.selectOption('.sc-card.on .toc-unit', '1(1) 주체적으로 감상하기 · 뉴욕제과점(김연수)');
  await page.selectOption('.sc-card.on .toc-area', '문학');
  await page.fill('.sc-card.on .toc-title', '학습지 4');
  await page.press('.sc-card.on .toc-title', 'Enter');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '/7-시험범위탭-입력중.png', clip: { x: 0, y: 0, width: 1300, height: 720 } });
  await page.click('.sc-card.on [data-scsave]');
  await page.waitForFunction(() => /저장했어요/.test((document.getElementById('sc-msg') || {}).textContent || ''), null, { timeout: 8000 });
  const sw = st.writes.filter(w => /naeshin_records/.test(w.u)).pop();
  const t1 = sw && JSON.parse(sw.body[0].text1);
  ok('저장 → naeshin_records(범위 · 공유:고1|화정 · 그 기간) — 교과서 내 = 옛 줄 + 고른 목차 줄, 교과서 외 = 옛 줄 + [문학] 학습지 4', sw && sw.body[0].period === PERS.fin && sw.body[0].class_key === '공유:고1|화정' && sw.body[0].kind === '범위' && t1 && t1.book === '천재 공통국어2' &&
     t1.inRange === '2(1) 청산별곡\n2(2) 속미인곡\n1(1) 주체적으로 감상하기 · 뉴욕제과점(김연수)' && t1.outRange === '학습지 1~3\n[문학] 학습지 4', JSON.stringify(sw && sw.body));
  ok('입력 중 [입력 완료]를 골라 저장하면 done:true 가 함께', t1 && t1.done === true, JSON.stringify(t1));
  ok('시트 사본 naeshinSet(범위 · scopeKey)', st.gas.some(g => g.action === 'naeshinSet' && g.kind === '범위' && g.scopeKey === '공유:고1|화정' && g.period === PERS.fin));
  r = await page.evaluate(() => ({ on: !!document.querySelector('.sc-card.on'), head: document.querySelector('.sc-card h4').textContent, body: document.querySelector('.sc-card').textContent, msg: document.getElementById('sc-msg').textContent }));
  ok('저장 뒤 카드 = 입력 완료 · 항목 5개 · 영역 태그 · 안내', !r.on && /입력 완료 · 항목 5개/.test(r.head) && /뉴욕제과점/.test(r.body) && /문학학습지 4/.test(r.body) && /같은 학교·학년 반/.test(r.msg), JSON.stringify(r));
  await page.click('#sc-per button:not(.on)');
  await page.waitForFunction(() => /아직 없어요/.test(document.querySelector('.sc-card h4').textContent), null, { timeout: 8000 });
  ok('다른 기간으로 바꾸면 그 기간 범위(없음 → "아직 없어요" · [입력])', (await page.$eval('.sc-card [data-scedit]', e => e.textContent)) === '입력' && st.gets.some(u => /naeshin_records\?period=eq\./.test(u) && !/class_key=eq/.test(u)));
  await ctx.close();

  await b.close(); srv.close();
  console.log(`\n${pass} / ${pass + fail} 통과`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
