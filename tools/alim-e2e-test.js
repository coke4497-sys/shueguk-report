#!/usr/bin/env node
/* 카카오 알림톡 결석 알림 — 화면 검증 (timetable.html, 2026-09-11).
 *   NODE_PATH=$(npm root -g) node tools/alim-e2e-test.js
 * 가짜 응답으로 실제 페이지를 띄워: 결석 저장 → 확인 창(받는 분 기본 학부모1·미리보기) → [알림톡 보내기]의
 * POST 내용 / 연락처 없는 학생 / 설정 전이면 창 없음 / 출석 창의 '보냄' 표시와 다시 보내기(force) /
 * 복수 선택 일괄 결석 → 여러 명 창 / [알림톡] 설정 저장은 채운 칸만. 네트워크는 전부 가짜. */
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
const CLASSES = [ mk('r010', DN, '5:30', '7:00', '화정센터', '지원', '고1 가', ['박지우','최민하(9/20부터)','정서현']) ];
const PHONES = [
  { name: '박지우', phone_student: '01011112222', phone_parent1: '01033334444', phone_parent2: '01055556666' },
  { name: '최민하', phone_student: '', phone_parent1: '01077778888', phone_parent2: '' },
];
const TPL = '[이수경국어학원] 결석 안내\n#{학생명} 학생이 #{수업일} #{반이름} 수업에 결석했습니다.';
let cfg = { result:'success', ready:true, has:{ key:true, secret:true, from:false, pfId:true }, smsFallback:false,
            templates:{ absent:{ label:'결석 안내', text: TPL, vars:['학생명','수업일','반이름'], ready:true } } };
let logRows = [];
const posts = [];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.route(/fonts\.g/, r => r.abort());
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('/students?select=name,phone_')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PHONES) });
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
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(({ cls }) => {
    sessionStorage.setItem('tt_mode', 'today'); sessionStorage.setItem('tt_book', '정규');
    localStorage.setItem('ttc:list:정규', JSON.stringify({ t: Date.now(), d: { classes: cls, onceMoves: [] } }));
  }, { cls: CLASSES });
  await page.goto('http://127.0.0.1:' + port + '/timetable.html');
  await page.waitForFunction(() => typeof classes !== 'undefined' && classes.length === 1, null, { timeout: 15000 });
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
  const modalText = () => page.textContent('#modal-box');

  // 1) 결석 저장 → 확인 창
  await page.evaluate(() => openAttend(classes[0], '박지우'));
  await page.click('.att-btns .pick-abs');
  await page.waitForSelector('#al-rows', { timeout: 8000 });
  ok('창 제목 결석 알림톡', (await modalText()).includes('결석 알림톡'));
  ok('받는 분 기본 학부모1', (await page.inputValue('#al-to0')).startsWith('학부모1|01033334444'));
  ok('학부모2·학생도 선택지', (await page.$$('#al-to0 option')).length === 3);
  ok('체크 기본 켜짐', await page.isChecked('#al-ck0'));
  const prev = await page.textContent('.al-prev');
  ok('미리보기 채움', prev.includes('박지우 학생이') && prev.includes('고1 가 수업에') && prev.includes('5:30'), prev);
  ok('발신번호 없음 안내', (await modalText()).includes('문자로 대체되지 않아요'));
  await page.selectOption('#al-to0', '학부모2|01055556666');
  await page.click('#al-go');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('보냈어요'));
  const p1 = posts.filter(p => p.action === 'alimSend').pop();
  ok('POST alimSend 1건', p1 && p1.kind === 'absent' && p1.items.length === 1 && !p1.force, JSON.stringify(p1));
  ok('보낸 항목 내용', p1 && p1.items[0].student === '박지우' && p1.items[0].who === '학부모2' && p1.items[0].to === '01055556666' && p1.items[0].date === ymd && p1.items[0].cls === '고1 가' && p1.items[0].vars['학생명'] === '박지우', JSON.stringify(p1 && p1.items[0]));
  ok('상태 문구 1건', (await page.textContent('#status')).includes('1건 보냈어요'));

  // 2) 출석 창에 '보냄' 표시 + 다시 보내기(force)
  await page.evaluate(() => openAttend(classes[0], '박지우'));
  await page.waitForFunction(() => (document.getElementById('att-alim') || {}).textContent.includes('보냄'), null, { timeout: 8000 });
  ok('출석 창 보냄 표시', (await page.textContent('#att-alim')).includes('학부모2께 알림톡 보냄'));
  await page.click('#att-alim button');
  await page.waitForSelector('#al-rows');
  ok('다시 보내기 창 체크 켜짐', await page.isChecked('#al-ck0'));
  await page.click('#al-go');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('보냈어요'));
  const p2 = posts.filter(p => p.action === 'alimSend').pop();
  ok('다시 보내기는 force=1', p2 && p2.force === '1');

  // 3) 특이사항 괄호 이름 → 괄호 뗀 이름으로, 연락처 매칭
  await page.evaluate(() => openAttend(classes[0], '최민하(9/20부터)'));
  await page.click('.att-btns .pick-abs');
  await page.waitForSelector('#al-rows');
  ok('괄호 뗀 이름·학부모1만', (await page.textContent('.al-row b')) === '최민하' && (await page.$$('#al-to0 option')).length === 1);
  await page.click('.mbtns button');   // 보내지 않기
  ok('보내지 않기 → POST 없음', posts.filter(p => p.action === 'alimSend').length === 2);

  // 4) 연락처 없는 학생
  await page.evaluate(() => openAttend(classes[0], '정서현'));
  await page.click('.att-btns .pick-abs');
  await page.waitForSelector('#al-rows');
  ok('연락처 없음 → 체크 잠김·안내', await page.isDisabled('#al-ck0') && (await modalText()).includes('등록된 연락처가 없어요'));
  await page.click('#al-go');
  ok('보낼 학생 없으면 오류 문구', (await page.textContent('#al-err')).includes('체크'));
  await page.evaluate(() => closeModal());

  // 5) 복수 선택 일괄 결석 → 여러 명 창
  await page.evaluate(() => { attend = {}; multiMode = true; multiSel = { a: { cid:'r010', nm:'박지우' }, b: { cid:'r010', nm:'최민하(9/20부터)' } }; multiApply('결석'); });
  await page.waitForSelector('#al-rows');
  ok('여러 명 창 2줄', (await page.$$('#al-rows .al-row')).length === 2 && (await modalText()).includes('(2명)'));
  ok('이미 보낸 박지우는 체크 꺼짐·보냄 표시', !(await page.isChecked('#al-ck0')) && (await page.textContent('#al-rows .al-row')).includes('보냄'));
  ok('최민하는 체크', await page.isChecked('#al-ck1'));
  await page.evaluate(() => closeModal());

  // 6) [알림톡] 창 — 상태·기록·설정 저장
  await page.evaluate(() => openAlim());
  await page.waitForFunction(() => document.querySelectorAll('#al-log .al-row').length > 0, null, { timeout: 8000 });
  const st = await page.textContent('#al-state');
  ok('설정 상태 배지', st.includes('솔라피 API 키 준비됨') && st.includes('결석 안내 템플릿 준비됨') && st.includes('발신번호 없음'));
  ok('문구 표시', st.includes('결석 안내'));
  ok('기록 줄', (await page.textContent('#al-log')).includes('박지우'));
  await page.click('#al-cfg summary');
  await page.click('#al-disc-btn');
  await page.waitForFunction(() => (document.getElementById('al-disc') || {}).textContent.includes('pfId 저장'));
  const disc = await page.textContent('#al-disc');
  ok('자동 가져오기 결과 표시', disc.includes('KA01PF260912155016737BPjigUV32pr') && disc.includes('이수경국어') && disc.includes('승인 전'));
  ok('alimDiscover POST', posts.some(p => p.action === 'alimDiscover'));
  await page.click('#al-cfg details summary');
  await page.fill('#al-tpl-absent', 'KA01TP_NEW');
  await page.fill('#al-from', '031-111-2222');
  await page.click('#al-cfg .primary');
  await page.waitForFunction(() => (document.getElementById('al-cfg-msg') || {}).textContent.includes('저장'));
  const pc = posts.filter(p => p.action === 'alimConfigSet').pop();
  ok('설정 저장은 채운 칸만', pc && pc.tpl && pc.tpl.absent === 'KA01TP_NEW' && pc.from === '031-111-2222' && !('apiKey' in pc) && !('apiSecret' in pc), JSON.stringify(pc));
  ok('저장 뒤 칸 비움', (await page.inputValue('#al-tpl-absent')) === '');
  await page.evaluate(() => closeModal());

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
