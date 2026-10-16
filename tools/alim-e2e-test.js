#!/usr/bin/env node
/* 카카오 알림톡 결석 알림 — 화면 검증 (timetable.html, 2026-09-11).
 *   NODE_PATH=$(npm root -g) node tools/alim-e2e-test.js
 * 가짜 응답으로 실제 페이지를 띄워: 결석 저장 → 확인 창(받는 분 기본 학부모1·미리보기) → [알림톡 보내기]의
 * POST 내용 / 연락처 없는 학생 / 설정 전이면 창 없음 / 출석 창의 '보냄' 표시와 다시 보내기(force) /
 * 복수 선택 일괄 결석 → 여러 명 창 / 50건씩 나눠 보내기 / 취소한 force가 새지 않음 / 같은 번호 합치기 / 실패 결과 창과 다시 보내기 /
 * 연락처 조회 실패 안내와 다시 불러오기. 네트워크는 전부 가짜. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
const today = new Date(), DN = ['일','월','화','수','목','금','토'][today.getDay()];
const ymd = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
const mk = (id, day, st, en, loc, t, cls, stu) => ({ id, day, start: st, end: en, loc, teacher: t, cls, students: stu });
const BIG = Array.from({ length: 18 }, (_, i) => '학생' + String(i + 1).padStart(2, '0'));   // 18명 × 받는 분 3 = 54건 → 50건씩 두 번
const CLASSES = [ mk('r010', DN, '5:30', '7:00', '화정센터', '지원', '고1 가', ['박지우','최민하(9/20부터)','정서현','이같은']),
                  mk('r011', DN, '7:30', '9:00', '화정센터', '지원', '고2 가', BIG) ];
const PHONES = [
  { name: '박지우', phone_student: '01011112222', phone_parent1: '01033334444', phone_parent2: '01055556666' },
  { name: '최민하', phone_student: '', phone_parent1: '01077778888', phone_parent2: '' },
  { name: '이같은', phone_student: '01012341234', phone_parent1: '01012341234', phone_parent2: '01099990000' },   // 학생 번호 = 학부모1 번호
].concat(BIG.map((n, i) => ({ name: n, phone_student: '0102000' + String(i).padStart(4, '0'), phone_parent1: '0103000' + String(i).padStart(4, '0'), phone_parent2: '0104000' + String(i).padStart(4, '0') })));
let phonesFail = false;
const TPL = '[이수경국어학원] 결석 안내\n#{학생명} 학생이 #{수업일} #{반이름} 수업에 결석했습니다.';
let cfg = { result:'success', ready:true, has:{ key:true, secret:true, from:false, pfId:true }, smsFallback:false,
            templates:{ absent:{ label:'결석 안내', text: TPL, vars:['학생명','수업일','반이름'], ready:true },
                        notice_mock:{ label:'주말 실전 모의고사 신청 안내', notice:true, text:'[이수경국어학원] 주말 실전 모의고사 신청 안내\n…', vars:['학생명','제목','접근코드'], ready:true, buttons:[{ name:'학생 페이지 열기', type:'WL', linkMo:'https://coke4497-sys.github.io/shueguk-report/s.html?key=#{접근코드}', linkPc:'https://coke4497-sys.github.io/shueguk-report/s.html?key=#{접근코드}' }] },
                        notice_hwork:{ label:'H WORK 안내', notice:true, text:'[이수경국어학원] H WORK 안내\n…', vars:['학생명','제목','접근코드'], ready:false, buttons:[] } } };
let logRows = [];
const posts = [];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.route(/fonts\.g/, r => r.abort());
  // 허브 개인 로그인 — 알림톡 기록의 '보낸 사람'(2026-10-03)
  await ctx.addInitScript(() => localStorage.setItem('shueguk_teacher_session_v2', JSON.stringify({
    access_token: 'me-tok', refresh_token: 'me-ref', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u-1' } })));
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('/teacher_accounts')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ display_name: '김현지 선생님', login_id: 'hj' }]) });
    if (u.includes('/students?select=name,phone_')) return phonesFail ? r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PHONES) });
    if (u.includes('/attendance') && r.request().method() === 'POST') return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    if (u.includes('/attendance') && r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return r.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"no"}' });
  });
  await ctx.route(/script\.google\.com|googleusercontent/, r => {
    const req = r.request(), u = req.url();
    if (req.method() === 'POST'){
      const body = JSON.parse(req.postData() || '{}'); posts.push(body);
      if (body.action === 'alimSend'){
        // 실제 백엔드처럼 결과에 who를 담고, 순서는 요청과 다르게(뒤집어서) 돌려준다 — 화면이 자리가 아니라 키로 짝짓는지 검사(Codex P1)
        const sent = body.items.map(it => ({ student: it.student, who: it.who, ok: it.to !== '01099990000', message: it.to === '01099990000' ? '수신 불가' : '보냈어요' }));
        sent.forEach((x, i) => { if (x.ok) logRows.unshift({ ts: ymd + ' 18:3' + i, kind: body.kind, student:x.student, who: body.items[i].who, to: body.items[i].to, cls: body.items[i].cls, date: body.items[i].date, ok:true, message:'' }); });
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result:'success', sent: sent.slice().reverse(), okCount: sent.filter(x=>x.ok).length, failCount: sent.filter(x=>!x.ok).length }) });
      }
      if (body.action === 'alimDiscover') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result:'success', savedPfId:'KA01PF260912155016737BPjigUV32pr', channels:[{ pfId:'KA01PF260912155016737BPjigUV32pr', name:'이수경국어', searchId:'@이수경국어' }], templates:{ absent:{ label:'결석 안내', saved:'', pending:true, found:1 } }, notes:["'결석 안내' 템플릿이 아직 승인 전이에요 (PENDING) — 승인되면 다시 눌러 주세요."] }) });
      if (body.action === 'alimConfigSet') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result:'success', saved: Object.keys(body).filter(k => !['action','pw'].includes(k)) }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"success"}' });
    }
    if (u.includes('action=alimConfig')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) });
    if (u.includes('action=alimLog')){ const q = new URL(u).searchParams, f = q.get('from'), t = q.get('to');   // 실제 백엔드처럼 수업일로 거른다
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result:'success', rows: logRows.filter(x => !f || (x.date >= f && x.date <= t)) }) }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"error"}' });
  });
  const page = await ctx.newPage();
  await page.exposeFunction('posts_len', () => posts.filter(p => p.action === 'alimSend').length);
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(({ cls }) => {
    sessionStorage.setItem('tt_mode', 'today'); sessionStorage.setItem('tt_book', '정규');
    localStorage.setItem('ttc:list:정규', JSON.stringify({ t: Date.now(), d: { classes: cls, onceMoves: [] } }));
  }, { cls: CLASSES });
  await page.goto('http://127.0.0.1:' + port + '/timetable.html');
  await page.waitForFunction(() => typeof classes !== 'undefined' && classes.length === 2, null, { timeout: 15000 });
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
  const modalText = () => page.textContent('#modal-box');

  // 1) 결석 저장 → 확인 창
  await page.evaluate(() => openAttend(classes[0], '박지우'));
  await page.click('.att-btns .pick-abs');
  await page.waitForSelector('#al-rows', { timeout: 8000 });
  ok('창 제목 결석 알림톡', (await modalText()).includes('결석 알림톡'));
  const whoBoxes = i => page.$$eval('#al-rows .al-row[data-i="' + i + '"] input[data-who]', els => els.map(e => e.getAttribute('data-who') + (e.checked ? '+' : '-')));
  ok('받는 분 학부모1·학부모2·학생 모두 기본 체크', (await whoBoxes(0)).join() === '학부모1+,학부모2+,학생+', (await whoBoxes(0)).join());
  const prev = await page.textContent('.al-prev');
  ok('미리보기 채움', prev.includes('박지우 학생이') && prev.includes('고1 가 수업에') && prev.includes('5:30'), prev);
  ok('발신번호 없음 안내', (await modalText()).includes('문자로 대체되지 않아요'));
  await page.uncheck('#al-t0_2');   // 학생은 빼고 학부모 둘에게
  await page.click('#al-go');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('보냈어요'));
  const p1 = posts.filter(p => p.action === 'alimSend').pop();
  ok('POST alimSend 2건(받는 분마다 한 건)', p1 && p1.kind === 'absent' && p1.items.length === 2 && !p1.force, JSON.stringify(p1));
  ok('보낸 사람(허브에 로그인한 선생님) 동봉', p1 && p1.by === '김현지', p1 && p1.by);
  ok('보낸 항목 내용', p1 && p1.items.map(x => x.who + ':' + x.to).join() === '학부모1:01033334444,학부모2:01055556666' && p1.items.every(x => x.student === '박지우' && x.date === ymd && x.cls === '고1 가' && x.vars['학생명'] === '박지우'), JSON.stringify(p1 && p1.items));
  ok('상태 문구 2건', (await page.textContent('#status')).includes('2건 보냈어요'));

  // 2) 출석 창에 '보냄' 표시 + 다시 보내기(force)
  await page.evaluate(() => openAttend(classes[0], '박지우'));
  await page.waitForFunction(() => (document.getElementById('att-alim') || {}).textContent.includes('보냄'), null, { timeout: 8000 });
  const attTxt = await page.textContent('#att-alim');
  ok('출석 창 보냄 표시 + 못 받은 분', attTxt.includes('학부모님1·학부모님2께 알림톡 보냄') && attTxt.includes('학생 아직 안 보냄'), attTxt);
  await page.click('#att-alim button');
  await page.waitForSelector('#al-rows');
  ok('다시 보내기 = 못 받은 학생만 체크', (await whoBoxes(0)).join() === '학부모1-,학부모2-,학생+', (await whoBoxes(0)).join());
  await page.click('#al-go');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('1건 보냈어요'));
  const p2 = posts.filter(p => p.action === 'alimSend').pop();
  ok('못 받은 분에게는 force 없이', p2 && !p2.force && p2.items.length === 1 && p2.items[0].who === '학생');
  await page.evaluate(() => openAttend(classes[0], '박지우'));
  await page.waitForFunction(() => (document.getElementById('att-alim') || {}).textContent.includes('학생께') || (document.getElementById('att-alim') || {}).textContent.includes('·학생'), null, { timeout: 8000 });
  await page.click('#att-alim button');
  await page.waitForSelector('#al-rows');
  ok('모두 받은 뒤 다시 보내기 = 모두 체크', (await whoBoxes(0)).join() === '학부모1+,학부모2+,학생+', (await whoBoxes(0)).join());
  await page.click('#al-go');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('3건 보냈어요'));
  const p2b = posts.filter(p => p.action === 'alimSend').pop();
  ok('모두 받은 뒤 다시 보내기는 force=1', p2b && p2b.force === '1');
  // 2b) 다시 보내기 창을 '보내지 않기'로 닫아도 — force가 다음 발송에 남지 않고, 출석 창 '보냄' 표시도 그대로
  await page.evaluate(() => openAttend(classes[0], '박지우'));
  await page.waitForFunction(() => (document.getElementById('att-alim') || {}).textContent.includes('보냄'), null, { timeout: 8000 });
  await page.click('#att-alim button');
  await page.waitForSelector('#al-rows');
  ok('모두 받은 뒤 한 번 더 보내는 창에만 [닫기]', (await page.$$eval('#modal-box .mbtns button', els => els.map(e => e.textContent.trim()))).join() === '닫기,알림톡 보내기');
  await page.click('.mbtns button');   // 닫기
  await page.evaluate(() => openAttend(classes[0], '박지우'));
  await page.waitForFunction(() => (document.getElementById('att-alim') || {}).textContent.includes('보냄'), null, { timeout: 8000 });
  ok('취소 뒤 출석 창 보냄 표시 유지(캐시 안 지움)', (await page.textContent('#att-alim')).includes('알림톡 보냄'));
  await page.evaluate(() => closeModal());
  const nSendBefore = posts.filter(p => p.action === 'alimSend').length;
  await page.evaluate(() => openAttend(classes[0], '이같은'));
  await page.fill('#att-memo', '몸살');
  await page.click('.att-btns .pick-abs');
  await page.waitForSelector('#al-rows');
  ok('같은 번호(학생=학부모1)는 한 건으로 합쳐 표시', (await whoBoxes(0)).join() === '학부모1+,학부모2+' && (await page.textContent('#al-rows')).includes('학부모님1·학생'), (await whoBoxes(0)).join());
  ok('같은 번호 학생의 결석 사유 표시', (await page.textContent('#al-rows')).includes('사유 · 몸살'));
  await page.click('#al-go');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('보냈어요'));
  const p2c = posts.filter(p => p.action === 'alimSend').pop();
  ok('취소한 force가 다음 발송에 새지 않음', posts.filter(p => p.action === 'alimSend').length === nSendBefore + 1 && !p2c.force && p2c.items.length === 2, JSON.stringify(p2c));
  // 2c) 실패 건이 있으면 결과 창 + [다시 보내기]
  await page.waitForSelector('#al-retry', { timeout: 5000 });
  const resTxt = await modalText();
  ok('실패 결과 창(실패 1건·수신 불가)', resTxt.includes('알림톡 결과') && resTxt.includes('실패 1건') && resTxt.includes('수신 불가') && resTxt.includes('이같은 학부모님2'), resTxt);
  await page.click('#al-retry');
  await page.waitForFunction(() => !document.getElementById('al-retry') || document.getElementById('al-retry').disabled);
  await page.waitForFunction(n => posts_len() > n, nSendBefore + 1).catch(() => {});
  const p2d = posts.filter(p => p.action === 'alimSend').pop();
  ok('실패한 분께만 다시 보내기', p2d && p2d.items.length === 1 && p2d.items[0].who === '학부모2' && p2d.items[0].to === '01099990000', JSON.stringify(p2d && p2d.items));
  await page.waitForSelector('#al-retry', { timeout: 5000 });   // 또 실패 → 결과 창 다시
  await page.evaluate(() => closeModal());

  // 3) 특이사항 괄호 이름 → 괄호 뗀 이름으로, 연락처 매칭
  const n3 = posts.filter(p => p.action === 'alimSend').length;
  await page.evaluate(() => openAttend(classes[0], '최민하(9/20부터)'));
  await page.click('.att-btns .pick-abs');
  await page.waitForSelector('#al-rows');
  ok('괄호 뗀 이름·학부모1만', (await page.textContent('.al-row b')) === '최민하' && (await whoBoxes(0)).join() === '학부모1+');
  // 3b) [보내지 않기]가 없다 — 보내기만 할 수 있고 바깥을 눌러도 안 닫힌다(2026-10-03 원장님 "보내지 않기는 없애주세요")
  const btnTexts = await page.$$eval('#modal-box .mbtns button', els => els.map(e => e.textContent.trim()));
  ok('확인 창 버튼은 [알림톡 보내기] 하나', btnTexts.join() === '알림톡 보내기', btnTexts.join());
  ok('창 머리글에 반드시 보낸다는 안내', (await modalText()).includes('결석 알림톡은 반드시 보냅니다'));
  await page.mouse.click(5, 5);   // 바깥(배경) 누르기
  await page.waitForTimeout(150);
  ok('바깥을 눌러도 창이 안 닫힘', await page.evaluate(() => document.getElementById('modal').classList.contains('on')));
  await page.evaluate(() => closeModal());   // 검사 진행용
  ok('안 보내고 닫으면 POST 없음', posts.filter(p => p.action === 'alimSend').length === n3);

  // 4) 연락처 없는 학생
  await page.evaluate(() => openAttend(classes[0], '정서현'));
  await page.click('.att-btns .pick-abs');
  await page.waitForSelector('#al-rows');
  ok('연락처 없음 → 체크 없음·안내', (await whoBoxes(0)).length === 0 && (await modalText()).includes('등록된 연락처가 없습니다'));
  ok('보낼 곳이 없으면 보내기 버튼 대신 안내 + [닫기]', !(await page.$('#al-go')) && (await modalText()).includes('보낼 연락처가 없어') && (await page.$$eval('#modal-box .mbtns button', els => els.map(e => e.textContent.trim()))).join() === '닫기');
  await page.click('#modal-box .mbtns button');
  ok('[닫기]로 닫힘', !(await page.evaluate(() => document.getElementById('modal').classList.contains('on'))));

  // 5) 복수 선택 일괄 결석 → 여러 명 창
  await page.evaluate(() => { attend = {}; multiMode = true; multiSel = { a: { cid:'r010', nm:'박지우' }, b: { cid:'r010', nm:'최민하(9/20부터)' } }; multiApply('결석'); });
  await page.waitForSelector('#al-rows');
  ok('여러 명 창 2줄', (await page.$$('#al-rows .al-row')).length === 2 && (await modalText()).includes('(2명)'));
  ok('이미 보낸 박지우는 체크 꺼짐·보냄 표시', (await whoBoxes(0)).every(x => x.endsWith('-')) && (await page.textContent('#al-rows .al-row')).includes('보냄'));
  ok('최민하는 체크', (await whoBoxes(1)).join() === '학부모1+');
  await page.evaluate(() => closeModal());

  // 5b) 복수 선택 18명 × 3 = 54건 → 50건씩 두 번 나눠 보냄(백엔드 50건 상한)
  await page.evaluate(() => { attend = {}; multiMode = true; multiSel = {}; classes[1].students.forEach(function(nm){ multiSel[nm] = { cid:'r011', nm: nm }; }); multiApply('결석'); });
  await page.waitForSelector('#al-rows');
  ok('18명 창', (await page.$$('#al-rows .al-row')).length === 18);
  const nBefore = posts.filter(p => p.action === 'alimSend').length;
  await page.click('#al-go');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('54건 보냈어요'), null, { timeout: 10000 });
  const chunks = posts.filter(p => p.action === 'alimSend').slice(nBefore);
  ok('50건 + 4건 두 번으로 나눠 보냄', chunks.length === 2 && chunks[0].items.length === 50 && chunks[1].items.length === 4, chunks.map(c => c.items.length).join());
  ok('모두 성공이면 결과 창 없음', !(await page.$('#al-retry')) && !(await page.evaluate(() => document.getElementById('modal').classList.contains('on'))));

  // 5c) 연락처 조회 실패 → '불러오지 못했습니다' + [다시 불러오기]로 복구
  phonesFail = true;
  await page.evaluate(() => { stuPhones = null; attend = {}; openAttend(classes[0], '박지우'); });
  await page.click('.att-btns .pick-abs');
  await page.waitForSelector('#al-rows');
  ok('조회 실패 안내 + 다시 불러오기 버튼', (await modalText()).includes('연락처를 불러오지 못했습니다') && !!(await page.$('.al-warn button')) && (await whoBoxes(0)).length === 0);
  phonesFail = false;
  await page.click('.al-warn button');
  await page.waitForFunction(() => document.querySelectorAll('#al-rows input[data-who]').length === 3, null, { timeout: 8000 });
  ok('다시 불러오면 받는 분 셋', (await whoBoxes(0)).length === 3 && !(await page.$('.al-warn button')));
  await page.evaluate(() => closeModal());

  // 6) [알림톡] 버튼 — 설정·기록 창은 슈국 운영 → 알림톡 메뉴로 옮겼다(2026-10-01). 새 탭으로 그 메뉴를 연다.
  const opened = await page.evaluate(() => { var u = null, o = window.open; window.open = function(x){ u = x; }; openAlim(); window.open = o; return u; });
  ok('[알림톡] → 허브 알림톡 메뉴 설정 카드', opened === 'https://coke4497-sys.github.io/shueguk-hub/alimtalk.html#settings');
  ok('옛 설정 창 함수 없음', await page.evaluate(() => typeof alimCfgSave === 'undefined' && typeof alimDiscover === 'undefined'));

  // 7) 설정 전이면 창 없음 + 출석 창 안내
  cfg = { result:'success', ready:false, has:{}, smsFallback:false, templates:{ absent:{ label:'결석 안내', text: TPL, ready:false } } };
  await page.evaluate(() => { alimCfg = null; attend = {}; });
  await page.evaluate(() => openAttend(classes[0], '박지우'));
  await page.click('.att-btns .pick-abs');
  await page.waitForTimeout(700);
  ok('설정 전 → 확인 창 없음', !(await page.$('#al-rows')));
  await page.evaluate(() => { attend[attKey('r010','박지우')] = { status:'결석', memo:'' }; openAttend(classes[0], '박지우'); });
  await page.waitForFunction(() => (document.getElementById('att-alim') || {}).textContent.includes('설정 전'), null, { timeout: 5000 });
  ok('출석 창 설정 전 안내', true);

  // 12) 결석을 찍은 뒤 다른 날 보충으로 1회 이동이 잡힌 학생 — 칩이 '1회↗'로 바뀌어 1회 이동 창으로 열리는데,
  //     그 창에도 그 날 출석 기록과 결석 알림톡 줄이 있어야 한다(2026-10-08 수정 요청함 최예나 "출석 창에 뜨지 않아요").
  cfg = { result:'success', ready:true, has:{ key:true, secret:true, from:false, pfId:true }, smsFallback:false, templates:{ absent:{ label:'결석 안내', text: TPL, vars:['학생명','수업일','반이름'], ready:true } } };
  const wkTo = await page.evaluate(() => { closeModal(); multiMode = false; multiSel = {}; moving = null; alimCfg = null;
    attend = {}; attend[attKey('r010', '정서현')] = { status: '결석', memo: '병결' };
    var to = thisWeekRange().to;
    onceMoves.push({ row: 9001, kind: '1회', student: '정서현', fromId: 'r010', toId: 'r011', ymd: to, date: todayStr(), reason: '결석 보충' });
    render(); return to; });
  const awayChip = await page.$('.stus button[data-nm="정서현"][data-away-row]');
  ok('보충 1회 이동이 잡힌 학생 칩은 1회↗(away)', !!awayChip);
  await awayChip.click();
  await page.waitForFunction(() => (document.getElementById('att-alim') || {}).textContent.includes('알림톡'), null, { timeout: 8000 });
  const omTxt = await modalText();
  ok('1회 이동 창에 그 날 출석 기록(결석 · 병결)', omTxt.includes('1회 이동 학생') && omTxt.includes('출석 기록') && omTxt.includes('결석') && omTxt.includes('병결'), omTxt);
  ok('이동이 다른 날이면 그 날짜를 적는다', wkTo === ymd ? omTxt.includes('이 날은 이동한 반에서') : omTxt.includes('에 이동한 반에서 수업해요'), omTxt);
  const omAlim = await page.textContent('#att-alim');
  ok('결석 알림톡 줄 — 아직 안 보냄 + [알림톡 보내기]', omAlim.includes('아직 안 보냄') && (await page.textContent('#att-alim button')) === '알림톡 보내기', omAlim);
  await page.click('#att-alim button');
  await page.waitForFunction(() => document.getElementById('modal-box').textContent.includes('결석 알림톡'), null, { timeout: 8000 });
  ok('[알림톡 보내기] → 결석 알림톡 확인 창', (await modalText()).includes('결석 알림톡'));
  await page.evaluate(() => { closeModal(); onceMoves = onceMoves.filter(o => o.row !== 9001); attend = {}; render(); });

  // 13) 결석 예고(2026-10-16 원장님 "내일 결석 친구가 오늘 결석 통보를 해서 기록하면 바로 보낼 수 있도록") —
  //     앞날 수업에 결석을 기록하면 결석 안내 대신 결석 예고 창(사유·보충 안내), 그 날이 되면 결석 안내는 체크 없이
  const PTPL = '[이수경국어학원] 결석 예고 안내\n#{학생명} 학생이 #{수업일} #{반이름} 수업에 결석한다는 연락을 #{알린분} 받았습니다.\n사유: #{사유}\n#{보충안내}\n내용이 다르면 학원으로 연락 부탁드립니다.';
  const FRO = ['학부모님께', '학생에게'];
  const MKO = ['보충 일정은 별도 안내드립니다.', '당일 결석이므로 보충을 진행하지 않습니다.'];
  cfg = { result:'success', ready:true, has:{ key:true, secret:true, from:true, pfId:true }, smsFallback:true,
          templates:{ absent:{ label:'결석 안내', text: TPL, vars:['학생명','수업일','반이름'], ready:true },
                      preabsent:{ label:'결석 예고 안내', text: PTPL, vars:['학생명','수업일','반이름','알린분','사유','보충안내'], options:{ '알린분': FRO, '보충안내': MKO }, ready:false } } };
  const tmr = await page.evaluate(() => { closeModal(); alimCfg = null; alimLogByDate = {}; var d = new Date(); d.setDate(d.getDate() + 1);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); });
  // 13-0) 템플릿 준비 전 — 앞날 결석을 기록해도 결석 안내('결석했습니다')는 뜨지 않는다
  let nSend = await page.evaluate(() => posts_len());
  await page.evaluate(t => openAttend(classes[0], '박지우', t), tmr);
  ok('앞날 출석 창 — 메모 칸 안내가 사유', (await page.getAttribute('#att-memo', 'placeholder')).includes('결석 예고'));
  await page.fill('#att-memo', '학교 체험학습');
  await page.click('.att-btns .pick-abs');
  await page.waitForTimeout(900);
  ok('예고 템플릿 준비 전이면 앞날 결석에 결석 안내 창이 뜨지 않음', !(await page.$('#al-rows')), await modalText());
  await page.evaluate(t => { attend[attKey('r010', '박지우')] = { status: '결석', memo: '학교 체험학습' }; openAttend(classes[0], '박지우', t); }, tmr);
  await page.waitForFunction(() => (document.getElementById('att-alim') || {}).textContent.includes('준비 전'), null, { timeout: 5000 }).catch(() => {});
  ok('출석 창 줄 — 결석 예고 준비 전 안내', (await page.textContent('#att-alim') || '').includes('결석 예고 알림톡은 준비 전'), await page.textContent('#att-alim'));
  // 13-1) 준비된 뒤 — 결석 기록 → 결석 예고 창
  cfg.templates.preabsent.ready = true;
  await page.evaluate(() => { closeModal(); alimCfg = null; attend = {}; });
  await page.evaluate(t => openAttend(classes[0], '박지우', t), tmr);
  await page.fill('#att-memo', '학교 체험학습');
  await page.click('.att-btns .pick-abs');
  await page.waitForSelector('#al-rows', { timeout: 8000 });
  const pt = await modalText();
  ok('결석 예고 창 제목·안내', pt.includes('결석 예고 알림톡') && pt.includes('앞날 결석을 기록했습니다'), pt);
  ok('사유 칸에 출석 메모가 미리 들어간다', (await page.inputValue('#al-rs0')) === '학교 체험학습');
  ok('보충 안내 두 가지, 첫째가 기본', (await page.$$eval('input[name="al-mk"]', e => e.map(x => x.value + (x.checked ? '+' : '')).join('|'))) === MKO[0] + '+|' + MKO[1]);
  let pv = await page.textContent('.al-prev');
  ok('미리보기 — 예고 문구·사유·보충 안내', pv.includes('결석한다는 연락을') && pv.includes('사유: 학교 체험학습') && pv.includes(MKO[0]), pv);
  ok('알린 분 두 가지, 기본값 없음', (await page.$$eval('input[name="al-from"]', e => e.map(x => x.value + (x.checked ? '+' : '')).join('|'))) === FRO.join('|'));
  ok('알린 분을 안 고르면 미리보기에 자리 표시', pv.includes('(학부모님께/학생에게)'), pv);
  ok('결석 예고 창도 [보내지 않기]·[닫기] 없음', !(await page.$('#modal-box .mbtns button:not(#al-go)')));
  await page.click('input[name="al-mk"][value="' + MKO[1] + '"]');
  ok('보충 안내를 바꾸면 미리보기도', (await page.textContent('.al-prev')).includes(MKO[1]));
  await page.fill('#al-rs0', '');
  nSend = await page.evaluate(() => posts_len());
  await page.click('#al-go');
  ok('사유가 비면 보내지 않고 안내', (await page.textContent('#al-err')).includes('사유') && (await page.evaluate(() => posts_len())) === nSend);
  await page.fill('#al-rs0', '병원 진료');
  await page.click('input[name="al-mk"][value="' + MKO[0] + '"]');
  nSend = await page.evaluate(() => posts_len());
  await page.click('#al-go');
  ok('알린 분을 안 고르면 보내지 않고 안내', (await page.textContent('#al-err')).includes('누가 결석을 알렸는지') && (await page.evaluate(() => posts_len())) === nSend);
  await page.click('input[name="al-from"][value="' + FRO[0] + '"]');
  ok('알린 분을 고르면 미리보기 — 학부모님께 받았습니다', (await page.textContent('.al-prev')).includes('연락을 학부모님께 받았습니다'));
  await page.click('#al-go');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('결석 예고 알림톡'), null, { timeout: 8000 });
  const pp = posts.filter(p => p.action === 'alimSend').pop();
  ok('POST kind preabsent·앞날 날짜·사유·보충 안내', pp && pp.kind === 'preabsent' && pp.items.length === 3 && pp.items.every(x => x.date === tmr && x.vars['사유'] === '병원 진료' && x.vars['알린분'] === FRO[0] && x.vars['보충안내'] === MKO[0] && x.vars['학생명'] === '박지우'), JSON.stringify(pp));
  ok('상태 줄 — 결석 예고 알림톡 n건', (await page.textContent('#status')).includes('결석 예고 알림톡 3건 보냈어요'));
  // 13-2) 출석 창 줄 — 결석 예고 보냄
  await page.evaluate(t => { attend[attKey('r010', '박지우')] = { status: '결석', memo: '병원 진료' }; openAttend(classes[0], '박지우', t); }, tmr);
  await page.waitForFunction(() => (document.getElementById('att-alim') || {}).textContent.includes('보냄'), null, { timeout: 8000 });
  ok('앞날 출석 창 줄 — 결석 예고 알림톡 보냄', (await page.textContent('#att-alim')).includes('결석 예고 알림톡 보냄'), await page.textContent('#att-alim'));
  // 13-3) 그 날이 오면 — 결석 안내 창은 체크 없이·닫을 수 있게
  await page.evaluate(t => { closeModal(); window.__realToday = todayStr; todayStr = function(){ return t; }; alimLogByDate = {}; }, tmr);
  await page.evaluate(t => openAttend(classes[0], '박지우', t), tmr);
  await page.waitForFunction(() => (document.getElementById('att-alim') || {}).textContent.includes('결석 예고 보냄'), null, { timeout: 8000 });
  ok('그 날 출석 창 — 결석 예고 보냄 + [결석 안내도 보내기]', (await page.textContent('#att-alim button')) === '결석 안내도 보내기', await page.textContent('#att-alim'));
  await page.click('#att-alim button');
  await page.waitForSelector('#al-rows', { timeout: 8000 });
  ok('결석 안내 창 — 예고 보냄 표시·체크 없음', (await modalText()).includes('결석 예고') && (await whoBoxes(0)).every(x => x.endsWith('-')), (await whoBoxes(0)).join());
  ok('결석 안내 창 — [닫기]로 닫을 수 있다', !!(await page.$('#modal-box .mbtns button:not(#al-go)')));
  await page.evaluate(() => { closeModal(); todayStr = window.__realToday; });

  console.log(fail ? ('✗ ' + fail + '건 실패 / ' + pass + '건 통과') : ('✓ ' + pass + '건 통과'));
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
