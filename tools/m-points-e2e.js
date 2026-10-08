#!/usr/bin/env node
/* 시험 등록(m.html) 문항 배점(046, 2026-10-08) 검증.
 *   NODE_PATH=$(npm root -g) node tools/m-points-e2e.js
 * ① 수정 모드 프리필 — exam_questions.pts 가 배점 칸에, 합계 100 표시, collect() 에 pts
 * ② 문항을 더하면 '더 적어 주세요' 경고 + validateForm 이 막음 → [배점 균등 배분] → 합계 100 → 하나를 바꾸면 합계 경고
 * ③ [배점 비우기] → 균등 안내, validateForm 통과(배점 사유 없음), 미리보기에는 배점 배지 없음
 * ④ 저장 — exam_questions POST 본문에 pts, 열이 없는 DB(400 'pts')면 배점 없이 다시 저장 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0, perr = 0;
  const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
  async function open(q, opt){
    const st = { qPosts: [], gas: [], ptsFail: !!(opt && opt.ptsFail) };
    const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } });
    await ctx.route(/fonts\.g/, r => r.abort());
    await ctx.route(/script\.google\.com|googleusercontent/, r => {
      const req = r.request(); let body = {}; if (req.method() === 'POST'){ try { body = JSON.parse(req.postData() || '{}'); } catch (e) {} st.gas.push(body); }
      const u = decodeURIComponent(req.url());
      const json = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (/action=roster/.test(u)) return json({ result: 'success', students: [] });
      if (/assignList/.test(u)) return json({ result: 'success', assignments: [] });
      return json({ result: 'success' });
    });
    await ctx.route(/supabase\.co/, async r => {
      const req = r.request(), u = decodeURIComponent(req.url()), m = req.method();
      const json = (s, o) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
      if (/\/auth\/v1\//.test(u)) return json(200, { access_token: 't', expires_in: 3600 });
      let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (e) {}
      if (m === 'GET' && /\/exams\?report_id=eq\./.test(u)) return json(200, [{ report_id: '26-2-중간-옛시험', title: '26-2-중간-옛시험', scope: '', review: '' }]);
      if (m === 'GET' && /\/exam_questions\?report_id=eq\./.test(u)) return json(200, [
        { no: '1', area: '문학', qtype: '객관식', lv: '상', txt: '표현상의 특징과 그 효과', detail: '현대시', grp: '', multi: false, pts: 40 },
        { no: '2', area: '문학', qtype: '객관식', lv: '상', txt: '표현상의 특징과 그 효과', detail: '현대시', grp: '', multi: false, pts: '60' }]);
      if (m === 'POST' && /\/exam_questions$/.test(u)){
        st.qPosts.push(body);
        if (st.ptsFail && body.some(x => 'pts' in x)) return json(400, { code: 'PGRST204', message: "Could not find the 'pts' column of 'exam_questions' in the schema cache" });
        return json(201, []);
      }
      if (m !== 'GET') return json(201, []);
      return json(200, []);
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => { perr++; console.log('  ✗ pageerror', e.message); });
    page.on('dialog', d => { (st.dlg = st.dlg || []).push(d.message()); d.accept(); });
    await page.goto('http://localhost:' + port + '/m.html' + (q || ''));
    await page.waitForFunction(() => document.querySelectorAll('#blockList .pts-in').length >= 2, null, { timeout: 6000 }).catch(() => {});
    return { page, st, ctx };
  }
  const ptsVals = page => page.$$eval('#blockList .pts-in', es => es.map(e => e.value));
  const sumMsg = page => page.textContent('#ptsSumMsg');

  console.log('① 수정 모드 프리필');
  let { page, st, ctx } = await open('?id=26-2-중간-옛시험');
  ok('배점 칸 40·60', JSON.stringify(await ptsVals(page)) === '["40","60"]', JSON.stringify(await ptsVals(page)));
  ok('합계 100 표시', /배점 합계 100점/.test(await sumMsg(page)), await sumMsg(page));
  let c = await page.evaluate(() => collect());
  ok('collect() pts', c.questions.map(q => q.pts).join(',') === '40,60', JSON.stringify(c.questions.map(q => q.pts)));
  ok('수정 모드 validateForm 배점 통과', !/배점/.test(await page.evaluate(() => validateForm(collect()))));

  console.log('② 문항 추가 → 경고 → 균등 배분 → 합계 어긋남');
  await page.evaluate(() => addSolo());
  ok('문항 3개', (await ptsVals(page)).length === 3);
  ok('더 적어 주세요 경고', /1문항 더 적어/.test(await sumMsg(page)), await sumMsg(page));
  await page.$eval('#blockList .block:last-child .no-in', e => e.value = '3');
  await page.$eval('#blockList .block:last-child .area-in', e => { e.value = '문학'; e.dispatchEvent(new Event('change')); });
  await page.evaluate(() => setQTxt(document.querySelector('#blockList .block:last-child'), '표현상의 특징과 그 효과'));
  let v = await page.evaluate(() => validateForm(collect()));
  ok('validateForm 이 빠진 배점을 막음', /배점을 모든 문항에/.test(v), v);
  await page.evaluate(() => ptsEven());
  ok('균등 배분 확인 창', st.dlg && st.dlg.length === 1 && /같은 점수로/.test(st.dlg[0]));
  ok('33.33 · 33.33 · 33.34', JSON.stringify(await ptsVals(page)) === '["33.33","33.33","33.34"]', JSON.stringify(await ptsVals(page)));
  ok('합계 100', /배점 합계 100점/.test(await sumMsg(page)), await sumMsg(page));
  await page.fill('#blockList .block:last-child .pts-in', '50');
  ok('합계 어긋남 경고(116.66)', /배점 합계 116.66점/.test(await sumMsg(page)), await sumMsg(page));
  v = await page.evaluate(() => validateForm(collect()));
  ok('validateForm 이 합계를 막음', /배점 합계가 116.66점/.test(v), v);
  await page.evaluate(() => { document.getElementById('previewBtn').click(); });
  const pv = await page.textContent('#preview');
  ok('미리보기 배점 배지', /33\.33점/.test(pv) && /50점/.test(pv));
  await page.evaluate(() => { document.getElementById('previewBtn').click(); });

  console.log('③ 배점 비우기 → 균등');
  await page.evaluate(() => ptsClear());
  ok('모두 비움', (await ptsVals(page)).every(x => x === ''));
  ok('균등 안내(33.33점)', /문항당 33\.33점/.test(await sumMsg(page)), await sumMsg(page));
  v = await page.evaluate(() => validateForm(collect()));
  ok('빈 배점은 validateForm 통과', !/배점/.test(v), v);
  c = await page.evaluate(() => collect());
  ok('collect() pts 0', c.questions.every(q => q.pts === 0));
  await page.evaluate(() => { document.getElementById('previewBtn').click(); });
  ok('미리보기 배점 배지 없음', !/점<\/span>/.test(await page.innerHTML('#preview')));
  await ctx.close();

  console.log('④ 저장 본문');
  ({ page, st, ctx } = await open('?id=26-2-중간-옛시험'));
  await page.evaluate(() => fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'createReport', pw: 'x', id: '26-2-중간-옛시험', title: '26-2-중간-옛시험', review: [], scope: '', questions: collect().questions }) }).then(r => r.json()));
  await page.waitForTimeout(300);
  ok('exam_questions POST 한 번, pts 40·60', st.qPosts.length === 1 && st.qPosts[0].map(x => x.pts).join(',') === '40,60', JSON.stringify(st.qPosts.map(p => p.map(x => x.pts))));
  ok('시트 사본에도 pts', st.gas.some(g => g.action === 'createReport' && g.questions && g.questions[0].pts === 40));
  await ctx.close();

  ({ page, st, ctx } = await open('?id=26-2-중간-옛시험', { ptsFail: true }));
  const res = await page.evaluate(() => fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'createReport', pw: 'x', id: '26-2-중간-옛시험', title: '26-2-중간-옛시험', review: [], scope: '', questions: collect().questions }) }).then(r => r.json()));
  await page.waitForTimeout(300);
  ok('pts 열 없음(046 전) → 배점 없이 다시 저장', st.qPosts.length === 2 && 'pts' in st.qPosts[0][0] && !('pts' in st.qPosts[1][0]) && res.result === 'success', JSON.stringify([st.qPosts.length, res]));
  await ctx.close();

  await b.close(); srv.close();
  console.log(`통과 ${pass} · 실패 ${fail}${perr ? ' · 페이지 오류 ' + perr : ''}`);
  process.exit(fail || perr ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
