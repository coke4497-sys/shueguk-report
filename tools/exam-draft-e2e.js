#!/usr/bin/env node
/* 지필 리포트 자동 생성 검증 (2026-09-29, 수파베이스 036).
 *   NODE_PATH=$(npm root -g) node tools/exam-draft-e2e.js
 * ① 방법 고르기 화면 — 자동/수동 두 카드, 수동 화면은 숨김, 자동 생성 목록(만드는 중·완료·보류·등록됨)
 * ② 자동 생성 — 빈 칸 막기, 제목 미리보기, 파일(사진·PDF) 올리기 → exam_drafts POST·저장소 올리기·files PATCH·수정 요청함(화면 '지필 초안')
 * ③ [리포트 만들기] — 수동 화면에 제목·범위·총평·문항(지문 묶음·단독) 채움, 목록 밖 값 정리, 확인할 점 안내, 등록하면 report_id 기록
 * ④ 옮긴 글 보기·원본 보기, [다시 알리기]
 * ⑤ 수정 모드(?id=)는 방법 고르기 없이 바로 수동 화면 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
const DRAFT = {
  text: '[1~3] 다음 글을 읽고 물음에 답하시오.\n(가) …',
  answers: [{ no: '1', ans: '③' }, { no: '2', ans: '⑤' }],
  scope: '천재(정) 1~3단원',
  review: ['## 출제 경향', '문학 비중이 컸습니다.\n- 현대시 두 편\n- 고전소설 한 편'],
  notes: ['7번 선지 ④가 흐려 읽지 못했습니다.'],
  questions: [
    { no: '1', group: '(가) 현대시', area: '문학', detail: '현대시', type: '객관식', lv: '상', txt: '표현상의 특징과 그 효과', multi: false },
    { no: '2', group: '(가) 현대시', area: '문학', detail: '현대시', type: '객관식', lv: '최상', txt: '<보기>를 바탕으로 지문 이해\n<보기>: 작가 연보', multi: true },
    { no: '3', group: '', area: '화법', detail: '', type: '서술형', lv: '없는난이도', txt: '말하기 방식의 특징을 서술하기', multi: false },
  ],
};
const ROWS0 = [
  { id: 7, title: '26-2-중간-화정고1-공통국어2', status: '완료', note: '초안을 만들어 두었어요.', report_id: '', created_at: '2026-09-29T02:00:00Z',
    files: [{ path: 'd7/aa.pdf', name: '시험지.pdf', kind: '시험지', size: 2048, mime: 'application/pdf' }, { path: 'd7/bb.jpg', name: '정답.jpg', kind: '정답지', size: 1024, mime: 'image/jpeg' }] },
  { id: 6, title: '26-2-중간-서정고2-문학', status: '요청', note: '', report_id: '', created_at: '2026-09-29T01:00:00Z', files: [{ path: 'd6/x.jpg', name: 'p1.jpg', kind: '시험지', size: 10 }] },
  { id: 5, title: '26-2-중간-백양고2-독서와 작문', status: '보류', note: '사진이 흐려 읽지 못했어요.', report_id: '', created_at: '2026-09-28T01:00:00Z', files: [] },
  { id: 4, title: '26-2-중간-능곡고2-문학', status: '완료', note: '', report_id: '26-2-중간-능곡고2-문학', created_at: '2026-09-27T01:00:00Z', files: [] },
];

(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0, perr = 0;
  const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
  async function open(q){
    const st = { rest: [], store: [], gas: [], rows: JSON.parse(JSON.stringify(ROWS0)) };
    const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } });
    await ctx.route(/fonts\.g/, r => r.abort());
    await ctx.route(/script\.google\.com|googleusercontent/, r => {
      const req = r.request(), u = decodeURIComponent(req.url());
      let body = {}; if (req.method() === 'POST'){ try { body = JSON.parse(req.postData() || '{}'); } catch (e) {} st.gas.push(body); }
      const json = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (/action=roster/.test(u)){ st.gasRoster = (st.gasRoster || 0) + 1; } if (/action=roster/.test(u)) return json({ result: 'success', students: [{ name: '박보검', school: '화정고', grade: '2026 고등 1학년' }, { name: '김하늘', school: '서정고', grade: '2026 고등 2학년' }] });
      if (/[?&]id=/.test(u) && req.method() === 'GET') return json({ result: 'success', title: '26-2-중간-옛시험', scope: '', review: [], questions: [DRAFT.questions[0]] });
      if (/assignList/.test(u)) return json({ result: 'success', assignments: [] });
      return json({ result: 'success' });
    });
    await ctx.route(/supabase\.co/, async r => {
      const req = r.request(), u = decodeURIComponent(req.url()), m = req.method();
      const json = (s, o) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
      if (/\/auth\/v1\//.test(u)) return json(200, { access_token: 't', expires_in: 3600 });
      if (/\/storage\/v1\//.test(u)){
        st.store.push({ m, u, auth: req.headers()['authorization'] || '', type: req.headers()['content-type'] || '', body: req.postData() || '' });
        if (m === 'GET') return r.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4 fake' });
        return json(200, { Key: 'x' });
      }
      let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (e) {}
      if (/\/exam_drafts/.test(u)){
        st.rest.push({ m, u, body });
        if (m === 'POST'){ const row = Object.assign({ id: 12, files: [], note: '', report_id: '', created_at: new Date().toISOString() }, body); st.rows.unshift(row); return json(201, [row]); }
        const id = +((u.match(/id=eq\.(\d+)/) || [])[1] || 0);
        if (m === 'PATCH'){ const row = st.rows.find(x => x.id === id); if (row) Object.assign(row, body); return r.fulfill({ status: 204, body: '' }); }
        if (m === 'DELETE'){ const i = st.rows.findIndex(x => x.id === id); if (i >= 0) st.rows.splice(i, 1); return r.fulfill({ status: 204, body: '' }); }
        if (id){ const row = st.rows.find(x => x.id === id); return json(200, row ? [Object.assign({ period: '26-2-중간', school: '화정고', grade: '1', subject: '공통국어2', scope: '', draft: (id === 7 || id === 5) ? DRAFT : null }, row)] : []); }
        return json(200, st.rows);
      }
      if (m === 'GET' && /\/exams\?report_id=eq\./.test(u)) return json(200, [{ report_id: '26-2-중간-옛시험', title: '26-2-중간-옛시험', scope: '', review: '' }]);
      if (m === 'GET' && /\/exam_questions\?report_id=eq\./.test(u)) return json(200, [{ no: '1', area: '문학', qtype: '객관식', lv: '상', txt: '표현상의 특징과 그 효과', detail: '현대시', grp: '', multi: false }]);
      if (/\/assignments/.test(u) && m !== 'GET'){ (st.asg = st.asg || []).push({ m, u, body }); }
      if (/\/students\?/.test(u)){ st.stuGets = (st.stuGets || 0) + 1; return json(200, [
        { name: '박보검', school: '화정고', grade: '2026 고등 1학년', enrolled: '재원' },
        { name: '김하늘', school: '서정고', grade: '2026 고등 2학년', enrolled: '재원' },
        { name: '최도래', school: '도래울고', grade: '2026 고등 1학년', enrolled: '재원' },
        { name: '한예고', school: '고양예고', grade: '2026 고등 1학년', enrolled: '재원' },
        { name: '이퇴원', school: '퇴원고', grade: '2026 고등 1학년', enrolled: '퇴원' },
        { name: '김둘', school: '화정고', grade: '2026 고등 2학년', enrolled: '재원' },
        { name: '이동명', school: '화정고', grade: '2026 고등 1학년', enrolled: '재원' },
        { name: '이동명', school: '서정고', grade: '2026 고등 1학년', enrolled: '재원' },
        { name: '나퇴원', school: '화정고', grade: '2026 고등 1학년', enrolled: '퇴원' }]); }
      if (/\/naeshin_records\?/.test(u)){
        (st.nsGets = st.nsGets || []).push(u);
        const keys = ((u.match(/class_key=in\.\(([^)]*)\)/) || [])[1] || '').split(',').map(x => x.replace(/"/g, ''));
        const DB = {
          '공유:고1|화정': { text1: '{"book":"천재(정)"}', text2: '교과서: 천재(정)\n교과서 내 범위: 1-(1) 운수 좋은 날' },
          '공유:고2|서정': { text1: '{"book":"미래엔","inRange":"2-(1) 봄봄","extra":"","outRange":"수특 문학 3강"}', text2: '' },   // JSON만 남은 옛 기록
          '공유:고1|고양예고': { text1: '', text2: '교과서: 비상(한)' },   // 약칭 끝이 '고'인 반
        };
        if (!/period=eq\.26-2-중간/.test(u) || !/kind=eq\.범위/.test(u)) return json(200, []);
        return json(200, keys.filter(k => DB[k]).map(k => Object.assign({ class_key: k }, DB[k])));
      }
      if (m !== 'GET') return json(201, []);
      return json(200, []);
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => { perr++; console.log('  ✗ pageerror', e.message); });
    page.on('dialog', d => { (st.dlg = st.dlg || []).push(d.message()); d.accept(); });
    await page.goto('http://localhost:' + port + '/m.html' + (q || ''));
    await page.waitForTimeout(700);
    return { page, st, ctx };
  }
  const vis = (page, sel) => page.$eval(sel, e => getComputedStyle(e).display !== 'none' && e.offsetParent !== null).catch(() => false);

  // ① 방법 고르기
  let { page, st, ctx } = await open('');
  ok('① 고르기 화면 보임', await vis(page, '#chooseView'));
  ok('① 수동 화면 숨김', !(await vis(page, '#manualView')));
  ok('① 자동 화면 숨김', !(await vis(page, '#autoView')));
  ok('① 카드 두 장', (await page.$$('.mk-choice')).length === 2);
  await page.waitForSelector('#drList .dr-row');
  const rows = await page.$$eval('#drList .dr-row', els => els.map(e => ({ id: e.dataset.id, st: e.querySelector('.dr-st').textContent, btn: [...e.querySelectorAll('button')].map(x => x.textContent), note: (e.querySelector('.dr-note') || {}).textContent || '' })));
  ok('① 목록 4건', rows.length === 4, JSON.stringify(rows));
  ok('① 완료 → 리포트 만들기·옮긴 글', rows[0].st === '완료' && rows[0].btn.includes('리포트 만들기') && rows[0].btn.includes('옮긴 글 보기'));
  ok('① 요청 → 만드는 중·다시 알리기', rows[1].st === '만드는 중' && rows[1].btn.includes('다시 알리기') && !rows[1].btn.includes('리포트 만들기'));
  ok('① 보류 → 이유 표시', rows[2].st === '보류' && /흐려/.test(rows[2].note));
  ok('① 등록된 것 표시', rows[3].st === '리포트 등록됨');
  ok('① 목록 조회는 최근 20건', st.rest.some(x => x.m === 'GET' && /limit=20/.test(x.u) && /order=id\.desc/.test(x.u)));

  // ② 자동 생성
  await page.click('#mkAuto');
  ok('② 자동 화면', await vis(page, '#autoView') && !(await vis(page, '#chooseView')));
  await page.click('#drGo');
  ok('② 빈 칸 막기', /모두 골라/.test(await page.textContent('#drStatus')));
  await page.click('#drPeriodChips [data-p="26-2-중간"]');
  await page.selectOption('#dr_school', '화정고');
  await page.selectOption('#dr_gradeN', '1');
  await page.fill('#dr_subject', '공통국어2');
  ok('② 제목 미리보기', (await page.textContent('#drTitlePv')) === '26-2-중간-화정고1-공통국어2');
  ok('② 학교 목록은 수파베이스에서(재원만)', st.stuGets >= 1 && await page.$$eval('#dr_school option', o => o.map(x => x.value).join(',')) === ',고양예고,도래울고,서정고,화정고');   // 도래울고는 수파베이스에만 있음
  await page.waitForTimeout(300);
  ok('② 시험 범위 자동 불러오기', (await page.inputValue('#dr_scope')) === '교과서: 천재(정)\n교과서 내 범위: 1-(1) 운수 좋은 날' && /불러왔습니다/.test(await page.textContent('#drScopeNote')));
  await page.selectOption('#dr_school', '도래울고');
  await page.waitForTimeout(300);
  ok('② 범위 없는 학교는 안내만, 적어 둔 범위 유지', /아직 없어요/.test(await page.textContent('#drScopeNote')) && /운수 좋은 날/.test(await page.inputValue('#dr_scope')));
  await page.fill('#dr_scope', '직접 적은 범위');
  await page.selectOption('#dr_school', '화정고');
  await page.waitForTimeout(300);
  ok('② 적어 둔 범위는 자동으로 덮지 않음', (await page.inputValue('#dr_scope')) === '직접 적은 범위' && /바꾸려면/.test(await page.textContent('#drScopeNote')));
  await page.click('#drScopeBtn');
  await page.waitForTimeout(300);
  ok('② [불러오기]는 확인 뒤 바꿈', /운수 좋은 날/.test(await page.inputValue('#dr_scope')));
  ok('② 범위 키·기간 규칙', st.nsGets.some(x => /공유:고1\|화정/.test(x)) && st.nsGets.some(x => /공유:고1\|도래울/.test(x)));
  // JSON만 남은 기록도 라벨 줄로 복원(Codex 검토) · 약칭 끝이 '고'인 학교(Codex 검토)
  await page.fill('#dr_scope', '');
  await page.selectOption('#dr_gradeN', '2'); await page.selectOption('#dr_school', '서정고');
  await page.waitForTimeout(300);
  ok('② JSON 범위 기록 복원', (await page.inputValue('#dr_scope')) === '교과서: 미래엔\n교과서 내 범위: 2-(1) 봄봄\n교과서 외 범위: 수특 문학 3강', await page.inputValue('#dr_scope'));
  await page.fill('#dr_scope', '');
  await page.selectOption('#dr_gradeN', '1'); await page.selectOption('#dr_school', '고양예고');
  await page.waitForTimeout(300);
  ok('② 약칭 끝이 고인 학교 키', (await page.inputValue('#dr_scope')) === '교과서: 비상(한)' && st.nsGets.some(x => /공유:고1\|고양예"/.test(x) && /공유:고1\|고양예고"/.test(x)), await page.inputValue('#dr_scope'));
  await page.selectOption('#dr_school', '화정고'); await page.fill('#dr_scope', '천재(정) 1~3단원');
  await page.click('#drGo');
  ok('② 시험지 없으면 막기', /시험지 파일/.test(await page.textContent('#drStatus')));
  await page.setInputFiles('#drExam', [
    { name: '시험지1.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpegdata') },
    { name: '시험지2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
  ]);
  await page.setInputFiles('#drKey', [{ name: '정답.png', mimeType: 'image/png', buffer: Buffer.from('png') }]);
  ok('② 고른 파일 목록', (await page.$$('#drExamSel li')).length === 2 && (await page.$$('#drKeySel li')).length === 1);
  await page.fill('#dr_scope', '천재(정) 1~3단원');
  await page.fill('#dr_memo', '서술형이 변별 문항');
  await page.click('#drGo');
  await page.waitForFunction(() => document.getElementById('chooseView').style.display !== 'none', null, { timeout: 5000 }).catch(() => {});
  const post = st.rest.find(x => x.m === 'POST');
  ok('② exam_drafts POST', post && post.body.title === '26-2-중간-화정고1-공통국어2' && post.body.status === '요청' && post.body.memo === '서술형이 변별 문항' && post.body.scope === '천재(정) 1~3단원' && post.body.grade === '1', JSON.stringify(post && post.body));
  const ups = st.store.filter(x => x.m === 'POST');
  ok('② 저장소에 3개', ups.length === 3, ups.length);
  ok('② 경로 d12/…·교사 신분', ups.every(x => /\/object\/exam-drafts\/d12\/[0-9a-f]{24}\.(jpg|pdf|png)$/.test(x.u) && x.auth === 'Bearer t'), JSON.stringify(ups.map(x => x.u)));
  ok('② PDF 형식 유지', ups.some(x => /\.pdf$/.test(x.u) && x.type === 'application/pdf'));
  const patch = st.rest.find(x => x.m === 'PATCH' && x.body && x.body.files);
  ok('② files PATCH(종류·이름·순서)', patch && patch.body.files.map(f => f.kind + ':' + f.name).join(',') === '시험지:시험지1.jpg,시험지:시험지2.pdf,정답지:정답.png', JSON.stringify(patch && patch.body));
  const g = st.gas.find(x => x.action === 'editReqAdd');
  ok('② 수정 요청함 호출', g && g.screen === '지필 초안' && g.pw === 'sh' && /^\[지필 초안\] d12 · 26-2-중간-화정고1-공통국어2 · 시험지 2개 · 정답지 1개/.test(g.text), JSON.stringify(g));
  ok('② 목록으로 돌아와 안내', await vis(page, '#chooseView') && /요청했습니다/.test(await page.textContent('#drListNote')));
  ok('② 새 요청이 목록 맨 위', (await page.$eval('#drList .dr-row', e => e.dataset.id)) === '12');
  ok('② 파일 칸 비움', (await page.$eval('#drExam', e => e.files.length)) === 0);

  // ④ 다시 알리기
  st.gas.length = 0;
  await page.click('.dr-row[data-id="6"] button:has-text("다시 알리기")');
  await page.waitForTimeout(300);
  ok('④ 다시 알리기', st.gas.some(x => x.action === 'editReqAdd' && /d6 ·/.test(x.text)));
  // 옮긴 글
  await page.click('.dr-row[data-id="7"] button:has-text("옮긴 글 보기")');
  await page.waitForSelector('#drModal:not([style*="none"])');
  const mt = await page.textContent('#drModalB');
  ok('④ 옮긴 글·정답·확인할 점', /다음 글을 읽고/.test(mt) && /1번 ③/.test(mt) && /흐려 읽지/.test(mt));
  await page.keyboard.press('Escape');
  await page.click('.dr-row[data-id="7"] button:has-text("원본 보기")');
  const ft = await page.textContent('#drModalB');
  ok('④ 원본 목록', /시험지\.pdf/.test(ft) && /정답지/.test(ft));
  const [pop] = await Promise.all([page.waitForEvent('popup', { timeout: 3000 }).catch(() => null), page.click('.dr-files button >> nth=0')]);
  await page.waitForTimeout(300);
  ok('④ 원본 내려받기(교사 신분)', st.store.some(x => x.m === 'GET' && /exam-drafts\/d7\/aa\.pdf/.test(x.u) && x.auth === 'Bearer t'));
  if (pop) await pop.close();
  await page.click('.dr-x');

  // ⑥ 초안 지우기 — 파일 있는 줄은 저장소 파일부터, 파일 없는 줄은 바로 줄만
  ok('⑥ 모든 줄에 지우기 버튼', (await page.$$('#drList .dr-del')).length === (await page.$$('#drList .dr-row')).length);
  st.store.length = 0; st.rest.length = 0; st.dlg = [];
  await page.click('.dr-row[data-id="6"] button:has-text("삭제")');
  await page.waitForTimeout(400);
  ok('⑥ 확인 창(파일 함께 삭제 안내)', st.dlg.length === 1 && /파일도 함께/.test(st.dlg[0]) && /만드는 중/.test(st.dlg[0]), JSON.stringify(st.dlg));
  const sdel = st.store.find(x => x.m === 'DELETE' && /object\/exam-drafts$/.test(x.u.replace(/\?.*$/, '')));
  ok('⑥ 저장소 파일 삭제(prefixes)', !!sdel && /"prefixes"/.test(sdel.body) && /d6\/x\.jpg/.test(sdel.body), JSON.stringify(st.store));
  ok('⑥ exam_drafts 줄 삭제', st.rest.some(x => x.m === 'DELETE' && /id=eq\.6/.test(x.u)));
  ok('⑥ 목록에서 사라짐 + 안내', !(await page.$('.dr-row[data-id="6"]')) && /지웠습니다/.test(await page.textContent('#drListNote')));
  st.store.length = 0; st.rest.length = 0; st.dlg = [];
  await page.click('.dr-row[data-id="4"] button:has-text("삭제")');
  await page.waitForTimeout(400);
  ok('⑥ 등록된 리포트는 남는다 안내', st.dlg.length === 1 && /리포트는 그대로/.test(st.dlg[0]), JSON.stringify(st.dlg));
  ok('⑥ 파일 없는 줄은 저장소 호출 없음', !st.store.some(x => x.m === 'DELETE') && st.rest.some(x => x.m === 'DELETE' && /id=eq\.4/.test(x.u)));
  ok('⑥ 지운 뒤 목록 3건', (await page.$$('#drList .dr-row')).length === 3);

  // ③ 리포트 만들기
  await page.click('.dr-row[data-id="7"] button:has-text("리포트 만들기")');
  await page.waitForFunction(() => document.getElementById('manualView').style.display !== 'none', null, { timeout: 4000 }).catch(() => {});
  ok('③ 수동 화면으로', await vis(page, '#manualView') && !(await vis(page, '#chooseView')));
  ok('③ 되돌아가기 링크', await vis(page, '#mkBackManual'));
  ok('③ 제목', (await page.inputValue('#f_title')) === '26-2-중간-화정고1-공통국어2');
  ok('③ 학교·학년·과목', (await page.inputValue('#f_school')) === '화정고' && (await page.inputValue('#f_gradeN')) === '1' && (await page.inputValue('#f_subject')) === '공통국어2');
  ok('③ 범위', (await page.inputValue('#f_scope')) === '천재(정) 1~3단원');
  ok('③ 총평 문단', (await page.inputValue('#f_review')) === DRAFT.review.join('\n\n'));
  ok('③ 안내 배너·확인할 점', await vis(page, '#drBanner') && /흐려 읽지/.test(await page.textContent('#drBanner')));
  const c = await page.evaluate(() => collect());
  ok('③ 문항 3개·묶음 2+단독 1', c.questions.length === 3 && (await page.$$('#blockList > .block.passage')).length === 1 && (await page.$$('#blockList > .block.solo')).length === 1);
  ok('③ 묶음 영역·세부', c.questions[0].group === '(가) 현대시' && c.questions[1].area === '문학' && c.questions[1].detail === '현대시');
  ok('③ 드롭다운 유형 선택', await page.$eval('#blockList .subq .txt-sel', e => e.value) === '표현상의 특징과 그 효과');
  ok('③ <보기> 내용·복수 선택', c.questions[1].txt === DRAFT.questions[1].txt && c.questions[1].multi === true);
  ok('③ 목록 밖 난이도 → 상, 직접 입력', c.questions[2].lv === '상' && c.questions[2].type === '서술형' && c.questions[2].txt === '말하기 방식의 특징을 서술하기');
  // 학교·학년 자동 배정(2026-10-01) — 화정고 1학년 재원생만, 동명이인은 토큰, 다른 학년·퇴원생은 빠짐
  ok('③ 자동 배정 안내', await vis(page, '#autoAssign') && !(await vis(page, '#manualAssign')) && /화정고 1학년 재원생 2명/.test(await page.textContent('#autoAssign')));
  await page.evaluate(() => saveReport());
  await page.waitForTimeout(1200);
  let cr0 = st.gas.filter(x => x.action === 'createReport').pop();
  ok('③ 자동 배정으로 등록 — 화정고 1학년만', cr0 && cr0.assignType === '일부' && cr0.assignTarget === '박보검, 이동명|화정고|2026고등1학년', cr0 && cr0.assignTarget);
  const rp = st.rest.find(x => x.m === 'PATCH' && /id=eq\.7/.test(x.u) && x.body && x.body.report_id);
  ok('③ 등록하면 report_id 기록', rp && rp.body.report_id === '26-2-중간-화정고1-공통국어2', JSON.stringify(st.rest.filter(x => x.m === 'PATCH').map(x => x.u + ' ' + JSON.stringify(x.body))));
  // 되돌아가기
  await page.click('#mkBackManual');
  ok('③ 방법 다시 고르기', await vis(page, '#chooseView'));
  // 다른 초안 — 명단에 없는 학교·학년이면 자동 배정이 막고, 직접 고르기는 한 번 직접 골라야 등록(Codex 검토 P1)
  st.rows.find(x => x.id === 5).status = '완료';
  await page.evaluate(() => drLoad());
  await page.waitForSelector('.dr-row[data-id="5"] button:has-text("리포트 만들기")');
  await page.click('.dr-row[data-id="5"] button:has-text("리포트 만들기")');
  await page.waitForFunction(() => document.getElementById('manualView').style.display !== 'none', null, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.getElementById('f_school').value = '고양예고'; document.getElementById('f_gradeN').value = '2'; composeTitle(); });
  const gasN = st.gas.filter(x => x.action === 'createReport').length;
  await page.evaluate(() => saveReport());
  await page.waitForTimeout(400);
  ok('③ 재원생이 없으면 자동 배정 등록 막힘', /고양예고 2학년 재원생이 명단에 없습니다/.test(await page.textContent('#status')) && st.gas.filter(x => x.action === 'createReport').length === gasN);
  await page.click('#autoAssign .asg-mode');
  ok('③ 직접 고르기로 바꿈', await vis(page, '#manualAssign') && !(await vis(page, '#autoAssign')));
  ok('③ 다음 초안에서 앞 배정 비움', await page.evaluate(() => { const s = assignSel || (assignPicker && assignPicker.getSelection()); return !s || s.type !== '학년'; }));
  await page.evaluate(() => saveReport());
  await page.waitForTimeout(400);
  ok('③ 직접 고르기는 확인 전 등록 막힘', /직접 골라/.test(await page.textContent('#status')) && st.gas.filter(x => x.action === 'createReport').length === gasN);
  await page.click('#assignPicker .sp-tab >> nth=1');
  ok('③ 배정 칸을 누르면 확인됨', await page.evaluate(() => DR.assignOk === true));
  await page.evaluate(() => { assignSel = { type: '학년', target: '고1', count: 1, summary: '고1' }; saveReport(); });
  await page.waitForTimeout(1200);
  cr0 = st.gas.filter(x => x.action === 'createReport').pop();
  ok('③ 직접 고른 배정으로 등록', cr0 && cr0.assignType === '학년' && cr0.assignTarget === '고1', cr0 && cr0.assignType);
  await page.click('#mkBackManual');
  await ctx.close();

  // ⑤ 수정 모드
  ({ page, st, ctx } = await open('?id=' + encodeURIComponent('26-2-중간-옛시험')));
  await page.waitForTimeout(500);
  ok('⑤ 수정 모드는 바로 수동 화면', await vis(page, '#manualView') && !(await vis(page, '#chooseView')) && !(await vis(page, '#mkBackManual')));
  ok('⑤ 수정 모드는 목록 조회 안 함', !st.rest.some(x => x.m === 'GET'));
  // 배정 칸을 건드리지 않고 수정 저장하면 배정을 보내지 않는다(위젯 기본값 '전 학년'이 실려 전 학생에게 배정된 사고 — 2026-10-01)
  await page.waitForFunction(() => document.getElementById('f_title').value, null, { timeout: 6000 }).catch(() => {});
  // 위젯 안 안내 글을 누르기만 한 것은 고른 게 아니다(Codex 검토 P1)
  await page.waitForSelector('#assignPicker .sp-summary', { timeout: 4000 });
  await page.click('#assignPicker .sp-summary');
  await page.evaluate(() => saveReport());
  await page.waitForTimeout(500);
  let cr = st.gas.filter(x => x.action === 'createReport').pop();
  ok('⑤ 수정 모드는 직접 고르기 화면 + 다시 배정 버튼', await vis(page, '#manualAssign') && !(await vis(page, '#autoAssign')) && /다시 배정/.test(await page.textContent('#asgBack')));
  ok('⑤ 배정 그대로 두면 배정 안 보냄(기존 유지)', cr && cr.assignType === '' && cr.assignTarget === '', cr && cr.assignType);
  await ctx.close();
  // 배정 칸을 직접 고르면 그 값이 간다
  ({ page, st, ctx } = await open('?id=' + encodeURIComponent('26-2-중간-옛시험')));
  await page.waitForTimeout(500);
  await page.waitForSelector('#assignPicker button, #assignPicker input', { timeout: 4000 });
  await page.click('#assignPicker button >> nth=0');
  await page.evaluate(() => saveReport());
  await page.waitForTimeout(500);
  cr = st.gas.filter(x => x.action === 'createReport').pop();
  ok('⑤ 배정 칸을 직접 고르면 배정 보냄', cr && cr.assignType !== '', cr && cr.assignType);
  await ctx.close();

  // 휴대폰 폭 — 카드 한 줄씩
  ({ page, st, ctx } = await open(''));
  await page.setViewportSize({ width: 390, height: 800 });
  const [a1, a2] = await page.$$eval('.mk-choice', els => els.map(e => e.getBoundingClientRect().top));
  ok('휴대폰 카드 세로로', a2 > a1);
  ok('휴대폰 가로 넘침 없음', await page.evaluate(() => document.documentElement.scrollWidth <= 390));
  await ctx.close();

  ok('페이지 오류 없음', perr === 0, perr);
  console.log('통과 ' + pass + ' · 실패 ' + fail);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
