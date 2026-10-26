/* 교과서 목차 고르기 — 시험범위 '교과서 내 범위'를 적는 대신 목차에서 골라 더한다 (2026-10-26 원장님
 * "교과서 내 범위는 입력방식이 아니라 이미 기록된 것을 드롭다운 선택 추가 방식, 교과서외는 직접 기록 방식").
 * 데이터 = 같은 폴더의 textbook-toc.json(tools/textbook_toc.py 가 원장님 목차 xlsx 에서 만든 것 — 2022 개정 중1·중2·고1·고2 42권).
 * 쓰는 곳: timetable.html(수업 기록 창 시험범위 직접 입력 · 수정 요청함 '내신 시험 범위' 양식) · naeshin.html(내신대비 피드백 시험범위).
 *
 *   TextbookToc.ready()                       → Promise(데이터)
 *   TextbookToc.match({grade, school, text, period}) → 알맞은 책부터 정렬한 목록(책 이름·학교·학기로 점수)
 *   TextbookToc.mount(el, opt)                → 고르기 UI. opt = {grade, school, text(반이름 괄호·저장된 교과서), period, book(저장된 교과서 이름),
 *                                               lines(저장된 교과서 내 범위 줄), onChange(fn)}  반환 {get(), set(book, lines), destroy()}
 *     get() = { book: '천재 공통국어2'(목록 밖이면 적은 이름), bookId: 'T2'|'' , lines: ['2(1) …', …] }
 * 고른 줄의 글자(label)가 그대로 naeshin_records '범위'의 교과서 내 범위 한 줄 = 진도 단원 하나가 된다. 목록에 없는 옛 줄은 지우지 않고 '목록 밖' 칩으로 둔다.
 * 교과서가 목록에 없으면(중3·고3 등) 옛날처럼 교과서 이름 칸 + 한 줄에 하나 적는 칸.
 *   TextbookToc.mountOut(el, {lines, onChange})   → 교과서 외 범위 고르기(2026-10-26 원장님 "교과서 외의 경우에도 문법, 문학, 독서, 화법, 작문, 기타를
 *     드롭다운으로 고르고 제목을 적는 방식"): 영역 드롭다운 + 제목 칸 + [+](2026-10-26 원장님 "더하기 -> +") → 줄 '[문학] 청산별곡'(OUT_RE). 영역 없는 옛 줄은 '구분 없음' 칩으로 보존.
 *     get() = { lines: ['[문학] 청산별곡', …] }. 표시가 필요한 곳은 TextbookToc.parseOut(line) → {area, title}. */
(function (w, d) {
  var here = (d.currentScript && d.currentScript.src) ? d.currentScript.src.replace(/[^/]*$/, '') : '';
  var URL = here + 'textbook-toc.json';
  var P = null, DATA = null;
  function ready(){ if (!P) P = fetch(URL).then(function (r) { if (!r.ok) throw new Error('toc ' + r.status); return r.json(); }).then(function (j) { DATA = j; return j; }); return P; }
  function data(){ return DATA; }
  function books(grade){ return DATA ? DATA.books.filter(function (b) { return !grade || b.grade === grade; }) : []; }
  function byId(id){ return DATA ? DATA.books.filter(function (b) { return b.id === id; })[0] || null : null; }
  var PUBS = ['미래엔', '지학사', '천재', '비상', '해냄', '창비', '지학', '동아', '미래'];
  var PUB_FULL = { 지학: '지학사', 미래: '미래엔' };
  var HINT = { 수: '김수학', 영: '박영민', 현: '박현숙', 민: '민병곤', 신: '신유식', 강: '강호영' };
  var FULL = { 공국1: '공통국어1', 공국2: '공통국어2', 화언: '화법과 언어', 독작: '독서와 작문', 문영: '문학과 영상', 매체: '매체 의사소통', 독토: '독서 토론과 글쓰기', 주탐: '주제 탐구 독서', 언매: '언어와 매체', 화작: '화법과 작문' };
  function ns(s){ return String(s || '').replace(/\s+/g, ''); }
  /* 글(반이름 괄호 '천재수 공통국어2'·'비상(영)'·저장된 교과서 '비상 문학')에서 출판사·저자 힌트·책 이름을 읽는다 */
  function parseText(text){
    var t = ns(text), out = { pub: '', hint: '', names: [] };
    if (!t) return out;
    PUBS.some(function (p) { var i = t.indexOf(p); if (i >= 0) { out.pub = PUB_FULL[p] || p; var c = t.charAt(i + p.length); if (c === '(') c = t.charAt(i + p.length + 1); if (HINT[c]) out.hint = HINT[c]; return true; } return false; });
    Object.keys(FULL).forEach(function (k) { if (t.indexOf(k) >= 0) out.names.push(ns(FULL[k])); });
    var m = t.match(/(공통국어[12]|국어[1-3]-[12]|화법과언어|독서와작문|문학과영상|매체의사소통|독서토론과글쓰기|주제탐구독서|언어와매체|화법과작문|문학|독서|국어)/g);
    (m || []).forEach(function (x) { if (out.names.indexOf(x) < 0) out.names.push(x); });
    return out;
  }
  function semOf(period){ var m = String(period || '').match(/^\d\d-([12])-/); return m ? m[1] : ''; }
  /* 점수: 책 이름 정확 4 · 출판사 3 · 저자 힌트 2 · 학교 2 · 학기 1. 학년이 주어지면 그 학년 책만 */
  function match(opt){
    opt = opt || {};
    var cand = books(opt.grade), px = parseText(opt.text), sem = semOf(opt.period), school = ns(opt.school).replace(/(등학교|학교)$/, '');
    var scored = cand.map(function (b) {
      var sc = 0, bn = ns(b.name);
      if (px.names.length) { if (px.names.indexOf(bn) >= 0) sc += 4; else if (px.names.some(function (n) { return bn.indexOf(n) === 0 && n.length >= 2; })) sc += 2; }
      if (px.pub && b.pub === px.pub) sc += 3; else if (px.pub) sc -= 2;
      if (px.hint && b.author === px.hint) sc += 2; else if (px.hint && px.pub === b.pub) sc -= 1;
      if (school && b.schools.some(function (x) { return x.indexOf(school) === 0 || school.indexOf(x.replace(/[고중]$/, '')) === 0; })) sc += 2;
      if (sem && /[12]$/.test(bn) && bn.slice(-1) === sem) sc += 1;
      return { b: b, sc: sc };
    }).sort(function (a, b) { return b.sc - a.sc; });
    return scored;
  }
  function best(opt){ var m = match(opt); return m.length && m[0].sc > 0 ? m[0].b : null; }
  /* ── UI ── */
  var CSS = '.toc{display:flex;flex-direction:column;gap:6px;font-size:.84rem;}' +
    '.toc select,.toc input{font:inherit;font-size:.84rem;border:1px solid #D7E0DB;border-radius:9px;padding:6px 8px;background:#fff;color:inherit;max-width:100%;}' +
    '.toc .toc-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;} .toc .toc-row > small{color:#65726B;font-size:.74rem;}' +
    '.toc select.toc-unit{width:100%;}' +
    '.toc .toc-chips{display:flex;flex-wrap:wrap;gap:5px;min-height:22px;}' +
    '.toc .toc-chip{font-size:.78rem;background:#EDE4F4;color:#5A4A6A;border-radius:8px;padding:2px 4px 2px 9px;display:inline-flex;align-items:center;gap:2px;line-height:1.45;}' +
    '.toc .toc-chip.free{background:#F2F5F3;color:#65726B;} .toc .toc-chip.free::before{content:"목록 밖";font-size:.66rem;margin-right:4px;opacity:.8;}' +
    '.toc .toc-chip button{border:0;background:none;color:inherit;cursor:pointer;font-size:.9rem;padding:0 4px;line-height:1;}' +
    '.toc .toc-out select.toc-area{width:auto;flex:0 0 auto;} .toc .toc-out input.toc-title{flex:1;min-width:160px;width:auto;} .toc .toc-add{font:inherit;font-size:1rem;line-height:1;border:0;border-radius:999px;width:34px;height:34px;padding:0;background:#EDE4F4;color:#5A4A6A;cursor:pointer;white-space:nowrap;}' +
    '.toc .toc-chip.out{background:#F9EFD0;color:#5F4E14;} .toc .toc-chip .toc-tag{font-style:normal;font-size:.66rem;background:rgba(255,255,255,.7);border-radius:6px;padding:0 5px;margin-right:5px;}' +
    '.toc .toc-chip.out.noarea{background:#F2F5F3;color:#65726B;} .toc .toc-chip.out.noarea::before{content:"구분 없음";font-size:.66rem;margin-right:4px;opacity:.8;}' +
    '.toc .toc-dim{font-size:.74rem;color:#65726B;} .toc textarea{font:inherit;font-size:.84rem;border:1px solid #D7E0DB;border-radius:9px;padding:6px 8px;min-height:72px;width:100%;box-sizing:border-box;}';
  function css(){ if (d.getElementById('tocStyle')) return; var s = d.createElement('style'); s.id = 'tocStyle'; s.textContent = CSS; d.head.appendChild(s); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mount(el, opt){
    opt = opt || {}; css();
    var st = { bookId: '', bookName: String(opt.book || '').trim(), lines: (opt.lines || []).map(function (x) { return String(x).trim(); }).filter(Boolean), none: false, ready: false, dead: false };
    el.classList.add('toc');
    el.innerHTML = '<span class="toc-dim">교과서 목차를 불러오는 중…</span>';
    function fire(){ if (opt.onChange) opt.onChange(get()); }
    function book(){ return st.bookId ? byId(st.bookId) : null; }
    function get(){
      var b = book();
      return { book: b ? b.short : st.bookName, bookId: b ? b.id : '', lines: st.lines.slice() };
    }
    function pickBook(){
      // 저장된 교과서 이름이 먼저(반이름 괄호 → 학교) — 목록에 없는 이름이면 '목록에 없음'으로 두고 그 이름을 유지
      var byName = st.bookName ? best({ grade: opt.grade, text: st.bookName, school: opt.school, period: opt.period }) : null;
      if (byName && (parseText(st.bookName).names.length || parseText(st.bookName).pub)) { st.bookId = byName.id; return; }
      if (st.bookName) { st.none = true; return; }
      var b = best({ grade: opt.grade, text: opt.text, school: opt.school, period: opt.period });
      if (b) st.bookId = b.id;
    }
    function render(){
      if (st.dead) return;
      var b = book(), list = match({ grade: opt.grade, text: opt.text || st.bookName, school: opt.school, period: opt.period });
      var h = '<div class="toc-row"><select class="toc-book" aria-label="교과서">' +
        list.map(function (x) { return '<option value="' + esc(x.b.id) + '"' + (b && b.id === x.b.id ? ' selected' : '') + '>' + esc(x.b.label) + (x.b.schools.length ? ' · ' + esc(x.b.schools.join('·')) : '') + '</option>'; }).join('') +
        '<option value=""' + (!b ? ' selected' : '') + '>목록에 없는 교과서 — 직접 적기</option></select>' +
        (b ? '<small>' + b.items.length + '개 항목' + (opt.grade ? '' : ' · ' + esc(b.grade)) + '</small>' : '') + '</div>';
      if (b){
        var inSet = {}; st.lines.forEach(function (l) { inSet[l] = 1; });
        var groups = [], gi = {};
        b.items.forEach(function (it) { var k = it.u + '|' + it.ut; if (!gi[k]) { gi[k] = { u: it.u, ut: it.ut, items: [] }; groups.push(gi[k]); } gi[k].items.push(it); });
        h += '<select class="toc-unit" aria-label="단원·작품 고르기"><option value="">＋ 단원·작품 고르기 (목차에서 하나씩 더해요)</option>' +
          groups.map(function (g) {
            var left = g.items.filter(function (it) { return !inSet[it.label]; });
            var name = (g.u === '책' ? '책 부록' : g.u + '. ' + g.ut);
            return '<optgroup label="' + esc(name) + '">' + (left.length > 1 ? '<option value="__u|' + esc(g.u) + '|' + esc(g.ut) + '">— ' + esc(name) + ' 남은 ' + left.length + '개 모두 더하기</option>' : '') +
              g.items.map(function (it) { return '<option value="' + esc(it.label) + '"' + (inSet[it.label] ? ' disabled' : '') + '>' + esc(it.label) + (inSet[it.label] ? ' ✓' : '') + '</option>'; }).join('') + '</optgroup>';
          }).join('') + '</select>';
        var order = {}; b.items.forEach(function (it, i) { order[it.label] = i; });
        var sorted = st.lines.slice().sort(function (x, y) { var a = order[x], c = order[y]; if (a == null && c == null) return 0; if (a == null) return 1; if (c == null) return -1; return a - c; });
        h += '<div class="toc-chips">' + (sorted.length ? sorted.map(function (l) { return '<span class="toc-chip' + (order[l] == null ? ' free' : '') + '">' + esc(l) + '<button type="button" data-rm="' + esc(l) + '" aria-label="' + esc(l) + ' 빼기">×</button></span>'; }).join('') : '<span class="toc-dim">아직 고른 단원이 없어요</span>') + '</div>' +
          '<span class="toc-dim">목차에 없는 자료(학습지·프린트·외부 지문)는 교과서 외 범위에 적어 주세요.</span>';
      } else {
        h += '<div class="toc-row"><input class="toc-bookname" placeholder="교과서 이름 — 예) 창비 공통국어2" value="' + esc(st.bookName) + '"></div>' +
          '<textarea class="toc-free" placeholder="교과서 내 범위 — 한 줄에 한 단원·작품&#10;예) 2(1) 청산별곡">' + esc(st.lines.join('\n')) + '</textarea>' +
          '<span class="toc-dim">' + (DATA ? '이 교과서는 목차 목록에 없어 직접 적습니다(중3·고3은 목록에 없어요).' : '교과서 목차를 불러오지 못해 직접 적습니다.') + '</span>';
      }
      el.innerHTML = h;
    }
    el.addEventListener('change', function (e) {
      var t = e.target;
      if (t.classList.contains('toc-book')) { st.bookId = t.value; st.none = !t.value; if (t.value) st.bookName = ''; render(); fire(); }
      else if (t.classList.contains('toc-unit')) {
        var v = t.value; t.value = ''; if (!v) return;
        var b = book(); if (!b) return;
        if (v.indexOf('__u|') === 0) { var p = v.split('|'); b.items.forEach(function (it) { if (it.u === p[1] && it.ut === p[2] && st.lines.indexOf(it.label) < 0) st.lines.push(it.label); }); }
        else if (st.lines.indexOf(v) < 0) st.lines.push(v);
        render(); fire();
      }
    });
    el.addEventListener('input', function (e) {
      var t = e.target;
      if (t.classList.contains('toc-bookname')) { st.bookName = t.value.trim(); fire(); }
      else if (t.classList.contains('toc-free')) { st.lines = t.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); fire(); }
    });
    el.addEventListener('click', function (e) {
      var bt = e.target.closest('button[data-rm]'); if (!bt) return;
      var l = bt.getAttribute('data-rm'); st.lines = st.lines.filter(function (x) { return x !== l; }); render(); fire();
    });
    ready().then(function () { if (st.dead) return; st.ready = true; pickBook(); render(); }, function () { if (st.dead) return; st.ready = true; render(); });
    return { get: get, set: function (bookName, lines) { st.bookName = bookName || ''; st.bookId = ''; st.lines = (lines || []).slice(); if (st.ready) { pickBook(); render(); } }, destroy: function () { st.dead = true; } };
  }
  /* ── 교과서 외 범위: 영역 + 제목 ── */
  var AREAS = ['문법', '문학', '독서', '화법', '작문', '기타'];
  var OUT_RE = /^\[(문법|문학|독서|화법|작문|기타)\]\s*(.*)$/;
  function parseOut(line){ var m = OUT_RE.exec(String(line || '').trim()); return m ? { area: m[1], title: m[2] } : { area: '', title: String(line || '').trim() }; }
  function mountOut(el, opt){
    opt = opt || {}; css();
    var st = { lines: (opt.lines || []).map(function (x) { return String(x).trim(); }).filter(Boolean), area: AREAS.indexOf(opt.area) >= 0 ? opt.area : '문학', dead: false };
    el.classList.add('toc');
    function get(){ return { lines: st.lines.slice() }; }
    function fire(){ if (opt.onChange) opt.onChange(get()); }
    function render(keepTitle){
      if (st.dead) return;
      var title = keepTitle ? ((el.querySelector('.toc-title') || {}).value || '') : '';
      el.innerHTML = '<div class="toc-row toc-out"><select class="toc-area" aria-label="영역">' + AREAS.map(function (a) { return '<option value="' + a + '"' + (a === st.area ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select>' +
        '<input class="toc-title" maxlength="80" placeholder="제목 — 예) 청산별곡 · 2503 고1 독서(사회) 형사법과 민사법 · 학습지 3회" value="' + esc(title) + '"><button type="button" class="toc-add" aria-label="더하기" title="더하기">+</button></div>' +
        '<div class="toc-chips">' + (st.lines.length ? st.lines.map(function (l) { var p = parseOut(l); return '<span class="toc-chip out' + (p.area ? '' : ' noarea') + '">' + (p.area ? '<i class="toc-tag">' + p.area + '</i>' : '') + esc(p.title) + '<button type="button" data-rm="' + esc(l) + '" aria-label="' + esc(p.title) + ' 빼기">×</button></span>'; }).join('') : '<span class="toc-dim">아직 더한 것이 없어요</span>') + '</div>';
    }
    function add(){
      var inp = el.querySelector('.toc-title'), t = inp ? inp.value.trim() : '';
      if (!t) { if (inp) inp.focus(); return; }
      var line = '[' + st.area + '] ' + t;
      if (st.lines.indexOf(line) < 0) st.lines.push(line);
      render(false); fire();
      var n = el.querySelector('.toc-title'); if (n) n.focus();
    }
    el.addEventListener('change', function (e) { if (e.target.classList.contains('toc-area')) st.area = e.target.value; });
    el.addEventListener('click', function (e) {
      if (e.target.closest('.toc-add')) { add(); return; }
      var bt = e.target.closest('button[data-rm]'); if (!bt) return;
      var l = bt.getAttribute('data-rm'); st.lines = st.lines.filter(function (x) { return x !== l; }); render(true); fire();
    });
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.classList.contains('toc-title')) { e.preventDefault(); add(); } });
    render(false);
    return { get: get, set: function (lines) { st.lines = (lines || []).slice(); render(false); }, destroy: function () { st.dead = true; }, add: add };
  }
  w.TextbookToc = { ready: ready, data: data, books: books, byId: byId, match: match, best: best, parseText: parseText, mount: mount, mountOut: mountOut, parseOut: parseOut, AREAS: AREAS, url: URL };
})(window, document);
