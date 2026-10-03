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
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
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
        const sent = body.items.map(it => ({ student: it.student, ok: it.to !== '01099990000', message: it.to === '01099990000' ? '수신 불가' : '보냈어요' }));
        sent.forEach((x, i) => { if (x.ok) logRows.unshift({ ts: ymd + ' 18:3' + i, kind:'absent', student:x.student, who: body.items[i].who, to: body.items[i].to, cls: body.items[i].cls, date: ymd, ok:true, message:'' }); });
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result:'success', sent, okCount: sent.filter(x=>x.ok).length, failCount: sent.filter(x=>!x.ok).length }) });
      }
      if (body.action === 'alimDiscover') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result:'success', savedPfId:'KA01PF260912155016737BPjigUV32pr', channels:[{ pfId:'KA01PF260912155016737BPjigUV32pr', name:'이수경국어', searchId:'@이수경국어' }], templates:{ absent:{ label:'결석 안내', saved:'', pending:true, found:1 } }, notes:["'결석 안내' 템플릿이 아직 승인 전이에요 (PENDING) — 승인되면 다시 눌러 주세요."] }) });
      if (body.action === 'alimConfigSet') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result:'success', saved: Object.keys(body).filter(k => !['action','pw'].includes(k)) }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"success"}' });
    }
    if (u.includes('action=alimConfig')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) });
    if (u.includes('action=alimLog')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result:'success', rows: logRows }) });
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
  await page.click('.mbtns button');   // 보내지 않기
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
  await page.click('.mbtns button');   // 보내지 않기
  ok('보내지 않기 → POST 없음', posts.filter(p => p.action === 'alimSend').length === n3);

  // 4) 연락처 없는 학생
  await page.evaluate(() => openAttend(classes[0], '정서현'));
  await page.click('.att-btns .pick-abs');
  await page.waitForSelector('#al-rows');
  ok('연락처 없음 → 체크 없음·안내', (await whoBoxes(0)).length === 0 && (await modalText()).includes('등록된 연락처가 없습니다'));
  await page.click('#al-go');
  ok('보낼 학생 없으면 오류 문구', (await page.textContent('#al-err')).includes('체크'));
  await page.evaluate(() => closeModal());

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

  console.log(fail ? ('✗ ' + fail + '건 실패 / ' + pass + '건 통과') : ('✓ ' + pass + '건 통과'));
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
