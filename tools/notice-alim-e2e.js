/* 공지 알림톡 + 학생 페이지 미확인 공지 팝업 브라우저 E2E (2026-09-15)
 * 가짜 백엔드(script.google.com)·가짜 수파베이스로 실제 페이지를 띄워
 *   ① notice.html — 알림톡 설정 상태 표시, 등록 뒤 대상 학생 고르기(학년·개인), 연락처 없는 학생 안내,
 *      50명씩 나눠 alimSend(kind = 고른 공지 종류 notice_*) 호출, 종류 드롭다운·준비 전 종류 잠금, 중복 키·변수, 숨김 공지는 안 보냄, 설정 전엔 체크 잠금
 *   ② s.html — 확인 안 한 공지가 있으면 첫 화면 팝업, [확인했습니다]로 notice_read_submit, 같은 묶음은 다시 안 뜸,
 *      '나중에 볼게요' 뒤 뱃지 유지, 확인 뒤 사라짐
 * 원격에는 아무것도 보내지 않는다.
 *   실행: NODE_PATH=$(npm root -g) node tools/notice-alim-e2e.js */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const PORT = 8995, SB = 'https://bangdbhqpphqqdwcledg.supabase.co';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
let n = 0, bad = 0;
const ok = (c, l) => { n++; if (!c) { bad++; console.error('  ✗', l); } else console.log('  ✓', l); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 가짜 명단 — 고1 120명(알림톡 50명 단위 나누기 검사), 고2 3명(한 명은 번호 없음), 동명이인 2명 */
const STUDENTS = [];
for (let i = 0; i < 120; i++) STUDENTS.push({ name: '고일' + String(i + 1).padStart(3, '0'), school: '화정고', grade: '2026 고등 1학년', student_id: String(20000000 + i), code: 'c1' + i, enrolled: '재원', phone_student: '0101' + String(1000000 + i).slice(-7), phone_parent1: '0102' + String(1000000 + i).slice(-7), phone_parent2: '' });
STUDENTS.push({ name: '박보검', school: '능곡고', grade: '2026 고등 2학년', student_id: '30000001', code: 'c21', enrolled: '재원', phone_student: '01031110001', phone_parent1: '01032220001', phone_parent2: '' });
STUDENTS.push({ name: '김없음', school: '능곡고', grade: '2026 고등 2학년', student_id: '30000002', code: 'c22', enrolled: '재원', phone_student: '', phone_parent1: '', phone_parent2: '' });
STUDENTS.push({ name: '이퇴원', school: '능곡고', grade: '2026 고등 2학년', student_id: '30000003', code: 'c23', enrolled: '퇴원', phone_student: '01031110003', phone_parent1: '', phone_parent2: '' });
STUDENTS.push({ name: '한동명', school: '화정고', grade: '2026 고등 2학년', student_id: '30000004', code: 'c24', enrolled: '재원', phone_student: '01031110004', phone_parent1: '', phone_parent2: '' });
STUDENTS.push({ name: '한동명', school: '능곡고', grade: '2026 고등 2학년', student_id: '30000005', code: 'c25', enrolled: '재원', phone_student: '01031110005', phone_parent1: '', phone_parent2: '' });
STUDENTS.push({ name: '김코드없음', school: '능곡고', grade: '2026 고등 2학년', student_id: '30000006', code: '', enrolled: '재원', phone_student: '01031110006', phone_parent1: '01032220006', phone_parent2: '' });   // 접근코드 없음 → 버튼 주소를 못 만들어 제외
const ROSTER = STUDENTS.filter(s => s.enrolled !== '퇴원').map(s => ({ name: s.name, school: s.school, grade: s.grade }));
const LINK = 'https://coke4497-sys.github.io/shueguk-report/s.html?key=#{접근코드}';
const ntpl = (label, ready) => ({ label, notice: true, ready, vars: ['학생명', '제목', '접근코드'],
  text: '[이수경국어학원] ' + label + '\n#{학생명} 학생에게 ' + label + '가 도착했어요.\n\n▶ #{제목}\n\n학생 페이지에서 내용을 확인해 주세요.',
  buttons: [{ name: '학생 페이지 열기', type: 'WL', linkMo: LINK, linkPc: LINK }] });
/* 공지 종류 여섯(2026-09-17) — H WORK 안내만 아직 심사 전(ready:false)인 상황 */
let ALIM_CFG = { result: 'success', ready: true, smsFallback: false, has: { key: true, secret: true, pfId: true, from: false },
  templates: { absent: { label: '결석 안내', text: 'x', vars: [], ready: true },
               notice_mock: ntpl('주말 실전 모의고사 신청 안내', true), notice_hwork: ntpl('H WORK 안내', false), notice_report: ntpl('지필고사 리포트 업데이트 안내', true),
               notice_voca: ntpl('어휘 테스트 참여 안내', true), notice_gramma: ntpl('문법 테스트 참여 안내', true), notice_event: ntpl('행사 안내', true) } };
const posts = [];   // 백엔드 POST 본문
let NOTICES = [];   // 학생 페이지에 줄 공지
const reads = [];   // notice_read_submit 호출

const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, ''));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p));
});
async function route(page){
  await page.route('**/*', r => {
    const u = r.request().url(), m = r.request().method();
    const j = (o, st) => r.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.startsWith('http://127.0.0.1:' + PORT)) return r.continue();
    if (u.startsWith(SB + '/auth/')) return j({ access_token: 'T', expires_in: 3600 });
    if (u.startsWith(SB + '/rest/v1/rpc/notice_read_submit')) { reads.push(JSON.parse(r.request().postData()).p); return j({ result: 'success', already: false }); }
    if (u.startsWith(SB + '/rest/v1/rpc/')) return j({ error: 'nope' }, 500);   // 학생 페이지 → 옛 백엔드 폴백
    if (u.startsWith(SB + '/rest/v1/students') && m === 'GET') return j(STUDENTS);
    if (u.startsWith(SB + '/rest/v1/')) return r.fulfill({ status: 204, body: '' });
    if (/script\.google/.test(u)) {
      const q = new URL(u).searchParams;
      if (m === 'POST') {
        const b = JSON.parse(r.request().postData() || '{}'); posts.push(b);
        if (b.action === 'alimSend') {
          const sent = b.items.map((it, i) => (i === 0 && b.items[0].student === '고일001') ? { student: it.student, ok: true, dup: true, message: '이미 보냈어요' } : { student: it.student, ok: true, message: '보냈어요' });
          return j({ result: 'success', sent, okCount: sent.filter(x => !x.dup).length, failCount: 0 });
        }
        return j({ result: 'success', already: false });
      }
      if (q.get('action') === 'roster') return j({ result: 'success', students: ROSTER });
      if (q.get('action') === 'alimConfig') return j(ALIM_CFG);
      if (q.get('action') === 'noticeList') return j({ result: 'success', notices: [] });
      if (q.get('key')) return j({ result: 'success', info: { name: '박보검', id: '30000001', school: '능곡고', grade: '2026 고등 2학년', teacher: '이수경', enrolled: '재원', classA: '금 5:30', classB: '' },
        authed: false, examCount: 0, notices: NOTICES, homework: [], analyses: [], clinic: null, stars: { total: 3 }, mockGates: { grades: [], open: false }, clinicEligible: false, vocaTaken: false, mockSignups: [] });
      return j({ result: 'success' });
    }
    return r.fulfill({ status: 204, body: '' });
  });
}
const alimSends = () => posts.filter(b => b.action === 'alimSend');

(async () => {
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => { bad++; console.error('  ✗ pageerror', e.message); });
  await route(page);
  const NURL = 'http://127.0.0.1:' + PORT + '/notice.html';

  console.log('① 공지 등록 화면 — 알림톡');
  /* 종류 드롭다운은 체크박스와 같은 label 안에 있어 체크가 잠기면 Playwright가 select도 잠긴 것으로 봐서(브라우저에서는 정상 동작) 값을 직접 넣는다 */
  const pickKind = k => page.evaluate(k => { const s = document.getElementById('alimKind'); s.value = k; s.dispatchEvent(new Event('change')); }, k);
  await page.goto(NURL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('alimOn').disabled, { timeout: 8000 });
  ok(true, '설정이 준비되면 [알림톡도 보내기] 체크가 열린다');
  ok((await page.$$eval('#alimKind option', els => els.map(o => o.value + ':' + o.textContent))).join('|') === 'notice_mock:주말 실전 모의고사 신청 안내|notice_hwork:H WORK 안내 (준비 전)|notice_report:지필고사 리포트 업데이트 안내|notice_voca:어휘 테스트 참여 안내|notice_gramma:문법 테스트 참여 안내|notice_event:행사 안내', '종류 드롭다운 = 여섯 종류, 심사 전은 “(준비 전)”');
  ok(await page.$eval('#alimKind', e => e.value) === 'notice_mock' && /“주말 실전 모의고사 신청 안내” 알림톡/.test(await page.$eval('#alimNote', e => e.textContent)), '기본 종류 = 준비된 첫 종류(모의고사 신청 안내) + 안내 문구');
  await pickKind('notice_hwork');
  ok(await page.$eval('#alimOn', e => e.disabled && !e.checked) && /이 종류의 템플릿은 아직 없어요/.test(await page.$eval('#alimNote', e => e.textContent)), '준비 전 종류를 고르면 체크가 잠기고 안내');
  await pickKind('notice_mock');
  ok(!(await page.$eval('#alimOn', e => e.disabled)), '준비된 종류로 돌리면 다시 열린다');
  await page.waitForFunction(() => document.querySelectorAll('#picker .sp-summary').length === 1 && !/불러오는/.test(document.getElementById('picker').textContent));
  // 학년 고1 선택은 위젯 조작 대신 선택값을 직접 넣는다(위젯 자체는 다른 E2E가 검사)
  await page.evaluate(() => { currentSel = { type: '학년', target: '2026 고등 1학년', count: 120, summary: '2026 고등 1학년 — 120명' }; });
  await page.fill('#title', '추석 휴강 안내');
  await page.fill('#body', '9/25~9/27 휴강입니다.');
  await page.check('#alimOn');
  await page.selectOption('#alimWho', '학생');
  await page.click('#submitBtn');
  await page.waitForFunction(() => document.getElementById('alimBox').style.display === 'block' && document.getElementById('alimGo'), { timeout: 8000 });
  ok(posts.some(b => b.action === 'addNotice' && b.title === '추석 휴강 안내' && b.target === '2026 고등 1학년'), '공지 등록 POST');
  const boxTxt = await page.$eval('#alimBox', e => e.textContent);
  ok(/120명/.test(boxTxt) && /학생 번호로/.test(boxTxt) && /50명씩/.test(boxTxt), '확인 상자: 120명 · 학생 번호 · 50명씩 나눠 보냄 (' + boxTxt.slice(0, 60).replace(/\s+/g, ' ') + ')');
  ok(/고일001 학생에게 주말 실전 모의고사 신청 안내가 도착했어요/.test(boxTxt) && /▶ 추석 휴강 안내/.test(boxTxt) && /공지 알림톡 · 주말 실전 모의고사 신청 안내/.test(boxTxt), '미리보기 = 고른 종류(모의고사 신청 안내) 문구에 학생명·제목이 채워진다');
  ok(await page.$eval('#alimBox .alim-btn', e => e.textContent) === '학생 페이지 열기', '미리보기 아래 템플릿 버튼 [학생 페이지 열기]');
  ok(!/연락처가 없어/.test(boxTxt), '고1은 전원 번호 있음 → 안내 없음');
  await page.click('#alimGo');
  await page.waitForFunction(() => /공지 알림톡/.test(document.getElementById('status').textContent), { timeout: 8000 });
  const sends = alimSends();
  ok(sends.length === 3 && sends.map(b => b.items.length).join(',') === '50,50,20', 'alimSend 3번(50·50·20명)');
  const it0 = sends[0].items[0];
  ok(sends.every(b => b.kind === 'notice_mock') && it0.who === '학생' && it0.to === '01011000000' && it0.cls === '공지', 'kind = 고른 종류(notice_mock) · 학생 번호 · 반 “공지”');
  ok(/^N:\d{4}-\d{2}-\d{2}\|추석 휴강 안내$/.test(it0.date) && it0.vars['제목'] === '추석 휴강 안내' && it0.vars['학생명'] === '고일001' && it0.vars['접근코드'] === 'c10', '중복 키 N:날짜|제목 + 변수(학생명·제목·접근코드=학생 페이지 키)');
  const st = await page.$eval('#status', e => e.textContent);
  ok(/119건 보냈어요/.test(st) && /이미 보낸 1명/.test(st), '결과 문구: 119건 + 중복 1명 (' + st + ')');
  ok(await page.$eval('#alimBox', e => e.style.display) === 'none', '보낸 뒤 상자 닫힘');

  console.log('①-b 학부모1 · 연락처 없음 · 동명이인 · 퇴원 제외');
  posts.length = 0;
  await page.evaluate(() => { currentSel = { type: '학년', target: '2026 고등 2학년', count: 4, summary: '2026 고등 2학년 — 4명' }; });
  await page.fill('#title', '모의고사 안내');
  await pickKind('notice_event');
  await page.check('#alimOn'); await page.selectOption('#alimWho', '학부모1');
  await page.click('#submitBtn');
  await page.waitForFunction(() => document.getElementById('alimBox').style.display === 'block' && document.getElementById('alimGo'), { timeout: 8000 });
  const t2 = await page.$eval('#alimBox', e => e.textContent);
  ok(/1명에게 학부모1 번호로/.test(t2), '학부모1 번호가 있는 1명만 (' + t2.match(/\d+명에게[^.]*/)[0] + ')');
  ok(/연락처가 없어 못 보내는 학생 3명: 김없음, 한동명, 한동명/.test(t2), '학부모1 번호 없는 3명 안내(퇴원생은 아예 제외)');
  ok(/접근코드가 없어 못 보내는 학생 1명: 김코드없음/.test(t2), '접근코드 없는 학생은 번호가 있어도 제외하고 따로 안내');
  await page.click('#alimGo');
  await page.waitForFunction(() => /공지 알림톡 1건/.test(document.getElementById('status').textContent), { timeout: 8000 });
  ok(alimSends().length === 1 && alimSends()[0].items[0].student === '박보검' && alimSends()[0].items[0].to === '01032220001' && alimSends()[0].items[0].who === '학부모1', '박보검 학부모1 번호로 1건');
  ok(alimSends()[0].kind === 'notice_event' && /행사 안내가 도착했어요/.test(t2), '다른 종류(행사 안내)를 고르면 그 종류로 보낸다');

  console.log('①-c 개인 공지 · 동명이인 토큰 · 숨김 공지 · 설정 전');
  posts.length = 0;
  await page.evaluate(() => { currentSel = { type: '일부', target: '한동명|능곡고|2026고등2학년, 박보검', count: 2, summary: '일부 — 2명' }; });
  await page.fill('#title', '개별 안내'); await page.check('#alimOn'); await page.selectOption('#alimWho', '학생');
  await page.click('#submitBtn');
  await page.waitForFunction(() => document.getElementById('alimBox').style.display === 'block' && document.getElementById('alimGo'), { timeout: 8000 });
  ok(/2명에게 학생 번호로/.test(await page.$eval('#alimBox', e => e.textContent)), '일부(동명이인 토큰 포함) → 2명');
  await page.click('#alimGo');
  await page.waitForFunction(() => /공지 알림톡 2건/.test(document.getElementById('status').textContent), { timeout: 8000 });
  ok(alimSends()[0].items.map(x => x.to).sort().join() === '01031110001,01031110005', '능곡고 한동명(01031110005)만 — 화정고 한동명은 제외');
  posts.length = 0;
  await page.evaluate(() => { currentSel = { type: '전체', target: '', count: 125, summary: '전 학년' }; });
  await page.fill('#title', '숨김 공지'); await page.check('#alimOn'); await page.uncheck('#pub');
  await page.click('#submitBtn');
  await page.waitForFunction(() => /등록됐어요/.test(document.getElementById('status').textContent), { timeout: 8000 });
  await sleep(400);
  ok(posts.some(b => b.action === 'addNotice' && b.hidden === true) && await page.$eval('#alimBox', e => e.style.display) === 'none', '숨김으로 저장한 공지는 알림톡을 묻지 않는다');
  ALIM_CFG = Object.assign({}, ALIM_CFG, { templates: { absent: ALIM_CFG.templates.absent, notice_mock: ntpl('주말 실전 모의고사 신청 안내', false), notice_hwork: ntpl('H WORK 안내', false), notice_event: ntpl('행사 안내', false) } });
  await page.goto(NURL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /템플릿이 아직 없어요/.test(document.getElementById('alimNote').textContent), { timeout: 8000 });
  ok(await page.$eval('#alimOn', e => e.disabled), '공지 템플릿이 하나도 없으면 체크가 잠기고 안내');

  console.log('② 학생 페이지 — 미확인 공지 팝업');
  NOTICES = [
    { date: '2026-09-15', type: '학년', target: '고2', title: '추석 휴강 안내', body: '9/25~9/27 휴강입니다.', key: '2026-09-15|추석 휴강 안내', checked: false },
    { date: '2026-09-14', type: '전체', target: '', title: '어휘 테스트', body: '', key: '2026-09-14|어휘 테스트', checked: false },
    { date: '2026-09-10', type: '전체', target: '', title: '이미 확인한 공지', body: '', key: '2026-09-10|이미 확인한 공지', checked: true },
  ];
  const sp = await ctx.newPage();
  sp.on('pageerror', e => { bad++; console.error('  ✗ pageerror(s.html)', e.message); });
  await route(sp);
  const SURL = 'http://127.0.0.1:' + PORT + '/s.html?key=abc';
  await sp.goto(SURL, { waitUntil: 'domcontentloaded' });
  await sp.waitForFunction(() => document.getElementById('ntModal').classList.contains('show'), { timeout: 15000 });
  ok(true, '확인 안 한 공지가 있으면 팝업이 뜬다');
  ok(await sp.$eval('#ntTitle', e => e.textContent) === '새 공지가 2건 있어요', '제목: 새 공지가 2건 있어요');
  ok(await sp.$$eval('#ntList .notice-item', els => els.length) === 2 && await sp.$$eval('#ntList .nchk-btn', els => els.length) === 2, '미확인 2건만 + 확인 버튼');
  ok(/추석 휴강 안내/.test(await sp.$eval('#ntList', e => e.textContent)) && !/이미 확인한 공지/.test(await sp.$eval('#ntList', e => e.textContent)), '확인한 공지는 팝업에 없음');
  await sp.click('#ntList .nchk-btn');
  await sp.waitForFunction(() => document.querySelectorAll('#ntList .nchk-done').length === 1, { timeout: 8000 });
  ok(reads.length === 1 && reads[0].noticeKey === '2026-09-15|추석 휴강 안내' && reads[0].key === 'abc', '팝업 안 [확인했습니다] → notice_read_submit');
  ok(/별 1개를 받았어요/.test(await sp.$eval('#ntList .nchk-done', e => e.textContent)), '확인 문구 + 별 +1');
  await sp.click('#ntModal .mc-cancel');
  await sleep(300);
  ok(!(await sp.$eval('#ntModal', e => e.classList.contains('show'))), '[나중에 볼게요]로 닫힘');
  ok(/확인할 공지 1건/.test(await sp.$eval('#menu', e => e.textContent)), '닫은 뒤 허브 뱃지는 남은 1건');
  await sp.reload({ waitUntil: 'domcontentloaded' });
  await sp.waitForFunction(() => document.getElementById('menu') && /알려드립니다/.test(document.getElementById('menu').textContent), { timeout: 15000 });
  await sleep(600);
  ok(!(await sp.$eval('#ntModal', e => e.classList.contains('show'))), '같은 공지 묶음은 이 탭에서 다시 안 뜬다(sessionStorage)');
  NOTICES = NOTICES.map(x => Object.assign({}, x, { checked: true }));
  await ctx.clearCookies();
  const sp2 = await ctx.newPage(); await route(sp2);
  await sp2.goto(SURL, { waitUntil: 'domcontentloaded' });
  await sp2.waitForFunction(() => document.getElementById('menu') && /알려드립니다/.test(document.getElementById('menu').textContent), { timeout: 15000 });
  await sleep(600);
  ok(!(await sp2.$eval('#ntModal', e => e.classList.contains('show'))), '모두 확인한 상태면 팝업 없음');
  NOTICES = [NOTICES[0], Object.assign({}, NOTICES[1], { checked: false, key: '2026-09-16|새 공지 A' }), { date: '2026-09-16', type: '전체', target: '', title: 'B', body: '', key: 'kB', checked: false }, { date: '2026-09-16', type: '전체', target: '', title: 'C', body: '', key: 'kC', checked: false }, { date: '2026-09-16', type: '전체', target: '', title: 'D', body: '', key: 'kD', checked: false }];
  const sp3 = await ctx.newPage(); await route(sp3);
  await sp3.goto(SURL, { waitUntil: 'domcontentloaded' });
  await sp3.waitForFunction(() => document.getElementById('ntModal').classList.contains('show'), { timeout: 15000 });
  ok(await sp3.$$eval('#ntList .notice-item', els => els.length) === 3 && /그 밖에 1건/.test(await sp3.$eval('#ntList', e => e.textContent)), '4건이면 3건 + “그 밖에 1건”');
  await sp3.click('#ntModal .mc-ok');
  await sleep(300);
  ok(await sp3.$eval('#noticeView', e => e.style.display) === 'block' && !(await sp3.$eval('#ntModal', e => e.classList.contains('show'))), '[공지 화면 열기] → 공지 화면');

  await browser.close(); srv.close();
  console.log('\n' + (bad ? '✗ ' + bad + ' / ' + n + ' 실패' : '✓ ' + n + '건 모두 통과'));
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
