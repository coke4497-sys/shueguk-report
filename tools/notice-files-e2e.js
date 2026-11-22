/* 공지 첨부 파일(055) 브라우저 E2E (2026-10-18)
 * 가짜 백엔드·가짜 수파베이스(표·저장소)로 실제 페이지를 띄워
 *   ① notice.html — 파일을 고르고 공지 등록 → 저장소 POST(교사 신분, 경로 n/무작위.pdf) + notice_files 줄(공지 키 '오늘|제목'),
 *      20MB 넘는 파일은 등록 전에 막음, 목록에 파일 칩·지우기, [파일 추가]
 *   ② s.html — 공지 카드에 첨부 파일 줄 + [내려받기] → notice_file_url → 저장소 authenticated 경로로 받아 원래 이름으로 저장
 * 원격에는 아무것도 보내지 않는다.   실행: NODE_PATH=$(npm root -g) node tools/notice-files-e2e.js */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const PORT = 8996, SB = 'https://bangdbhqpphqqdwcledg.supabase.co';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
let n = 0, bad = 0;
const ok = (c, l) => { n++; if (!c) { bad++; console.error('  ✗', l); } else console.log('  ✓', l); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = (() => { const d = new Date(Date.now() + 9 * 3600000); return d.toISOString().slice(0, 10); })();

const posts = [], uploads = [], rows = [], dels = [], rpcs = [];
let NOTICE_ROWS = [];
const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, ''));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p));
});
async function route(page){
  await page.route('**/*', r => {
    const u = r.request().url(), m = r.request().method(), h = r.request().headers();
    const j = (o, st) => r.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.startsWith('http://127.0.0.1:' + PORT)) return r.continue();
    if (u.startsWith(SB + '/auth/')) return j({ access_token: 'T', expires_in: 3600 });
    if (u.startsWith(SB + '/storage/v1/object/authenticated/notice-files/')) {
      if (m === 'GET') return r.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-test' });
    }
    if (u.startsWith(SB + '/storage/v1/object/notice-files/')) {
      if (m === 'POST') { uploads.push({ path: u.split('/notice-files/')[1], auth: h.authorization, type: h['content-type'], size: (r.request().postDataBuffer() || Buffer.alloc(0)).length }); return j({ Key: 'x' }); }
      if (m === 'DELETE') { dels.push('obj:' + u.split('/notice-files/')[1]); return j({}); }
    }
    if (u.startsWith(SB + '/rest/v1/notice_files')) {
      if (m === 'GET') return j(rows);
      if (m === 'POST') { const b = JSON.parse(r.request().postData()); b.id = rows.length + 1; rows.push(b); return r.fulfill({ status: 201, body: '' }); }
      if (m === 'DELETE') { const id = +(/id=eq\.(\d+)/.exec(u) || [])[1]; dels.push('row:' + id); const i = rows.findIndex(x => x.id === id); if (i >= 0) rows.splice(i, 1); return r.fulfill({ status: 204, body: '' }); }
    }
    if (u.startsWith(SB + '/rest/v1/rpc/notice_files_mine')) { rpcs.push(['mine', JSON.parse(r.request().postData()).p]); return j({ ok: true, files: [{ id: 7, key: '2026-10-18|OX 정답과 해설', name: 'OX 정답과 해설.pdf', size: 1063000 }] }); }
    if (u.startsWith(SB + '/rest/v1/rpc/notice_file_url')) { rpcs.push(['url', JSON.parse(r.request().postData()).p]); return j({ ok: true, bucket: 'notice-files', path: 'n/abc.pdf', name: 'OX 정답과 해설.pdf', size: 9 }); }
    if (u.startsWith(SB + '/rest/v1/rpc/')) return j({ error: 'nope' }, 500);
    if (u.startsWith(SB + '/rest/v1/teacher_accounts')) return j([{ display_name: '김현지 선생님', login_id: 'hj' }]);
    if (u.startsWith(SB + '/rest/v1/')) return j([]);
    if (/script\.google/.test(u)) {
      const q = new URL(u).searchParams;
      if (m === 'POST') { const b = JSON.parse(r.request().postData() || '{}'); posts.push(b);
        if (b.action === 'addNotice') NOTICE_ROWS = [{ rowIndex: 2, date: today, type: b.type, target: b.target, title: b.title, body: b.body, hidden: false }];
        return j({ result: 'success' }); }
      if (q.get('action') === 'roster') return j({ result: 'success', students: [] });
      if (q.get('action') === 'alimConfig') return j({ result: 'success', ready: false, has: {}, templates: {} });
      if (q.get('action') === 'noticeList') return j({ result: 'success', notices: NOTICE_ROWS });
      if (q.get('key')) return j({ result: 'success', info: { name: '김철수', id: '12345678', school: '화정고', grade: '2026 고등 3학년', teacher: '이수경', enrolled: '재원', classA: '', classB: '' },
        authed: false, examCount: 0, notices: [{ date: '2026-10-18', type: '학년', title: 'OX 정답과 해설', body: '', key: '2026-10-18|OX 정답과 해설', checked: true }],
        homework: [], analyses: [], clinic: null, stars: { total: 3 }, mockGates: { grades: [], open: false }, clinicEligible: false, vocaTaken: false, mockSignups: [] });
      return j({ result: 'success' });
    }
    return r.fulfill({ status: 204, body: '' });
  });
}

(async () => {
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => { bad++; console.error('  ✗ pageerror', e.message); });
  page.on('dialog', d => d.accept());
  await route(page);

  console.log('① 공지 등록 — 첨부 파일');
  await page.goto('http://127.0.0.1:' + PORT + '/notice.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('mgrList') && !/불러오는/.test(document.getElementById('mgrList').textContent), { timeout: 8000 });
  ok(await page.$('#nfFiles') !== null, '작성 칸에 첨부 파일 입력');
  // 20MB 넘는 파일은 막는다
  await page.setInputFiles('#nfFiles', [{ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(21 * 1024 * 1024, 1) }]);
  ok(/20MB가 넘는 파일/.test(await page.$eval('#nfNote', e => e.textContent)), '20MB 넘는 파일 안내');
  await page.evaluate(() => { currentSel = { type: '학년', target: '고3', count: 90, summary: '고3' }; });
  await page.fill('#title', 'OX 정답과 해설');
  await page.click('#submitBtn');
  await sleep(300);
  ok(!posts.some(b => b.action === 'addNotice'), '큰 파일이 있으면 등록 요청을 보내지 않는다');
  await page.setInputFiles('#nfFiles', [{ name: 'OX 정답과 해설.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') }]);
  ok(/붙일 파일 1개: OX 정답과 해설\.pdf/.test(await page.$eval('#nfNote', e => e.textContent)), '고른 파일 이름 표시');
  await page.click('#submitBtn');
  await page.waitForFunction(() => /첨부 파일 1개를 올렸습니다/.test(document.getElementById('status').textContent), { timeout: 8000 });
  const add = posts.find(b => b.action === 'addNotice');
  ok(add && add.type === '학년' && add.target === '고3' && add.title === 'OX 정답과 해설', 'addNotice 본문(고3 학년 공지)');
  ok(uploads.length === 1 && /^n\/[0-9a-f]{24}\.pdf$/.test(uploads[0].path) && uploads[0].auth === 'Bearer T' && uploads[0].type === 'application/pdf' && uploads[0].size === 13, '저장소 올리기 — 무작위 경로·교사 신분·형식·크기');
  ok(rows.length === 1 && rows[0].notice_key === today + '|OX 정답과 해설' && rows[0].name === 'OX 정답과 해설.pdf' && rows[0].path === uploads[0].path, 'notice_files 줄 — 공지 키 오늘|제목 · 원래 이름');
  ok(await page.$eval('#nfFiles', e => e.files.length) === 0, '등록 뒤 파일 칸 비움');
  await page.waitForFunction(() => document.querySelector('#mgrList .n-file'), { timeout: 5000 });
  ok(/OX 정답과 해설\.pdf/.test(await page.$eval('#mgrList .n-file', e => e.textContent)), '목록 공지에 파일 칩');
  ok(await page.$('#mgrList .addf') !== null, '목록에 [파일 추가]');
  await page.click('#mgrList .n-file button');
  await page.waitForFunction(() => !document.querySelector('#mgrList .n-file'), { timeout: 5000 });
  ok(dels.includes('obj:' + uploads[0].path) && dels.includes('row:1'), '× = 저장소 파일과 줄을 함께 지움');

  console.log('② 학생 페이지 — 내려받기');
  await page.goto('http://127.0.0.1:' + PORT + '/s.html?key=tok-kim', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.STATE && STATE.noticeFiles && Object.keys(STATE.noticeFiles).length, { timeout: 10000 });
  ok(rpcs[0] && rpcs[0][0] === 'mine' && rpcs[0][1].key === 'tok-kim', 'notice_files_mine 은 접근코드로');
  await page.evaluate(() => openNotices());
  await page.waitForFunction(() => document.querySelector('#noticeList .nf-dl'), { timeout: 5000 });
  ok(/OX 정답과 해설\.pdf/.test(await page.$eval('#noticeList .nfile', e => e.textContent)) && /1\.0MB/.test(await page.$eval('#noticeList .nfile', e => e.textContent)), '공지 카드에 파일 이름·크기');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#noticeList .nf-dl')]);
  ok(dl.suggestedFilename() === 'OX 정답과 해설.pdf', '원래 이름으로 저장');
  const u = rpcs.find(x => x[0] === 'url');
  ok(u && u[1].key === 'tok-kim' && u[1].file === 7, 'notice_file_url 에 파일 번호');

  await browser.close(); srv.close();
  console.log(bad ? `\n실패 ${bad} / ${n}` : `\n통과 ${n}건`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
