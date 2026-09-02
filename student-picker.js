/* ============================================================
   student-picker.js  ·  공용 학생 선택 위젯  (의존성 없음)
   ------------------------------------------------------------
   '학생정보'(지필고사 리포트 시트)에서 재원 학생 명단을 불러와
   대상유형(전 학년 / 학년 / 개인 / 일부)을 선택하는 UI를 그려준다.
   공지(notice.html)뿐 아니라 H WORK · 클리닉 등에서 재사용한다.

   사용법:
     <link rel="stylesheet" href="student-picker.css">
     <div id="picker"></div>
     <script src="student-picker.js"></script>
     <script>
       var picker = StudentPicker.create(document.getElementById('picker'), {
         onChange: function(sel){ ... }   // 선택 바뀔 때마다 호출(없으면 생략)
       });
       // 제출 시:
       var sel = picker.getSelection();
       //  → null(미완성) 또는
       //    { type:'전체'|'학년'|'개인'|'일부', target:'고1, 고2'|'박보검'|..., count:N, summary:'...' }
     </script>

   옵션: { endpoint, onChange, onReady, allowAll(기본 true) }
     - type/target 값은 시트 '공지' 탭의 B대상유형 · C대상에 그대로 들어가는 형식.
   ============================================================ */
(function(){
  var DEFAULT_ENDPOINT =
    "https://script.google.com/macros/s/AKfycbzhCncBwn-JlqXARC3wfrWUCuNHzlNK2df0bdhx-w78Xr8mzYUcIYZOJdRi9N4bHtsb/exec";

  var MODES = [
    { key:'전체', label:'전 학년' },
    { key:'학년', label:'학년' },
    { key:'개인', label:'개인' },
    { key:'일부', label:'일부' }
  ];

  function esc(s){
    return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function create(container, opts){
    opts = opts || {};
    var endpoint = opts.endpoint || DEFAULT_ENDPOINT;
    var allowAll = opts.allowAll !== false;
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function(){};

    var students = [];            // [{name, school, grade, teacher}]
    var grades   = [];            // 정렬된 학년 목록
    var mode     = allowAll ? '전체' : '학년';
    var gradeSel = {};            // 학년 모드: { '고1':true }
    var one      = null;          // 개인 모드: 선택 키(skey) 한 명
    var many     = {};            // 일부 모드: { skey:true }
    var fGrade   = '';            // 개인/일부 목록 필터: 학년
    var fSchool  = '';            // 개인/일부 목록 필터: 학교
    var nameCount = {};           // 동명이인 감지용: { '이서윤': 2 }
    var byKey    = {};            // skey → 학생

    // 학생 고유 키 (동명이인 구분: 이름+학교+학년)
    function skey(s){ return s.name + '|' + (s.school||'') + '|' + (s.grade||''); }
    // 시트에 저장하는 대상 토큰 — 이름이 유일하면 이름만(기존 방식과 호환),
    // 동명이인이면 '이름|학교|학년' (백엔드가 학교·학년까지 대조해 구분)
    function token(s){
      if ((nameCount[s.name]||0) <= 1) return s.name;
      return [s.name, String(s.school||'').replace(/\s+/g,''), String(s.grade||'').replace(/\s+/g,'')].join('|');
    }
    // 사람이 읽는 표시용 이름
    function label(s){
      if ((nameCount[s.name]||0) <= 1) return s.name;
      return s.name + '(' + [s.school, s.grade].filter(Boolean).join(' ') + ')';
    }

    // ── 스켈레톤 ──
    var root = document.createElement('div');
    root.className = 'sp-root';
    var visibleModes = MODES.filter(function(m){ return allowAll || m.key !== '전체'; });
    root.innerHTML =
      '<div class="sp-tabs">' +
        visibleModes.map(function(m){
          return '<button type="button" class="sp-tab' + (m.key===mode?' on':'') + '" data-mode="'+m.key+'">'+esc(m.label)+'</button>';
        }).join('') +
      '</div>' +
      '<div class="sp-body"><div class="sp-loading">학생 명단을 불러오는 중…</div></div>' +
      '<div class="sp-summary" aria-live="polite"></div>';
    container.innerHTML = '';
    container.appendChild(root);

    var tabsEl = root.querySelector('.sp-tabs');
    var bodyEl = root.querySelector('.sp-body');
    var sumEl  = root.querySelector('.sp-summary');

    tabsEl.addEventListener('click', function(e){
      var b = e.target.closest('.sp-tab'); if(!b) return;
      mode = b.getAttribute('data-mode');
      tabsEl.querySelectorAll('.sp-tab').forEach(function(t){ t.classList.toggle('on', t===b); });
      renderBody();
      fire();
    });

    function gradeCount(g){
      var n = 0; for (var i=0;i<students.length;i++) if (students[i].grade===g) n++; return n;
    }

    // ── 본문 렌더 ──
    function renderBody(){
      if (mode === '전체'){
        bodyEl.innerHTML = '<div class="sp-note"><b>전 학년 공지</b> — 모든 재원 학생('+students.length+'명)의 개별 페이지에 표시됩니다.</div>';
        return;
      }
      if (mode === '학년'){
        if (!grades.length){ bodyEl.innerHTML = '<div class="sp-empty">학년 정보가 없습니다.</div>'; return; }
        bodyEl.innerHTML = '<div class="sp-grades">' +
          grades.map(function(g){
            return '<button type="button" class="sp-chip'+(gradeSel[g]?' on':'')+'" data-grade="'+esc(g)+'">'+esc(g)+' <span style="opacity:.7">'+gradeCount(g)+'</span></button>';
          }).join('') + '</div>';
        bodyEl.querySelector('.sp-grades').addEventListener('click', function(e){
          var c = e.target.closest('.sp-chip'); if(!c) return;
          var g = c.getAttribute('data-grade');
          if (gradeSel[g]) delete gradeSel[g]; else gradeSel[g] = true;
          c.classList.toggle('on');
          fire();
        });
        return;
      }
      // 개인 / 일부 — 학년·학교 필터 + 검색 + 목록
      var multi = (mode === '일부');
      fGrade = ''; fSchool = '';
      var gradeOpts = '<option value="">전체 학년</option>' + grades.map(function(g){ return '<option value="'+esc(g)+'">'+esc(g)+'</option>'; }).join('');
      bodyEl.innerHTML =
        '<div class="sp-filters">' +
          '<select class="sp-fgrade">'+gradeOpts+'</select>' +
          '<select class="sp-fschool"><option value="">전체 학교</option></select>' +
        '</div>' +
        (multi ? '<div class="sp-hint2">학년·학교로 거른 뒤 <b>‘보이는 학생 모두 선택’</b>을 누르면 특정 학년·학교만 한 번에 담을 수 있어요.</div>' : '') +
        '<input type="text" class="sp-search" placeholder="이름 검색">' +
        '<div class="sp-list"></div>' +
        (multi ? '<div class="sp-selbar"><span class="sp-count"></span><span class="sp-actions2"><button type="button" class="sp-all">보이는 학생 모두 선택</button><button type="button" class="sp-clear">전체 해제</button></span></div>' : '');
      var searchEl = bodyEl.querySelector('.sp-search');
      var listEl   = bodyEl.querySelector('.sp-list');
      var fgEl     = bodyEl.querySelector('.sp-fgrade');
      var fsEl     = bodyEl.querySelector('.sp-fschool');
      function rebuildSchools(){
        var seen = {}, schools = [];
        students.forEach(function(s){ if ((!fGrade || s.grade===fGrade) && s.school && !seen[s.school]){ seen[s.school]=1; schools.push(s.school); } });
        schools.sort(function(a,b){ return a.localeCompare(b, 'ko'); });
        fsEl.innerHTML = '<option value="">전체 학교</option>' + schools.map(function(s){ return '<option value="'+esc(s)+'">'+esc(s)+'</option>'; }).join('');
      }
      rebuildSchools();
      fgEl.addEventListener('change', function(){ fGrade=fgEl.value; fSchool=''; rebuildSchools(); renderList(listEl, searchEl.value, multi); });
      fsEl.addEventListener('change', function(){ fSchool=fsEl.value; renderList(listEl, searchEl.value, multi); });
      searchEl.addEventListener('input', function(){ renderList(listEl, searchEl.value, multi); });
      if (multi){
        bodyEl.querySelector('.sp-clear').addEventListener('click', function(){
          many = {}; renderList(listEl, searchEl.value, true); updateCount(); fire();
        });
        bodyEl.querySelector('.sp-all').addEventListener('click', function(){
          filteredRows(searchEl.value).forEach(function(s){ many[skey(s)] = true; });
          renderList(listEl, searchEl.value, true); updateCount(); fire();
        });
      }
      renderList(listEl, '', multi);
    }

    function filteredRows(q){
      q = (q||'').trim();
      return students.filter(function(s){
        if (fGrade  && s.grade  !== fGrade)  return false;
        if (fSchool && s.school !== fSchool) return false;
        if (q && !((s.name && s.name.indexOf(q)>=0) || (s.school && s.school.indexOf(q)>=0))) return false;
        return true;
      });
    }
    function renderList(listEl, q, multi){
      q = (q||'').trim();
      var rows = filteredRows(q);
      if (!rows.length){ listEl.innerHTML = '<div class="sp-empty">검색 결과가 없어요.</div>'; return; }
      listEl.innerHTML = rows.map(function(s){
        var k = skey(s);
        var sel = multi ? !!many[k] : (one===k);
        var meta = [s.school, s.grade].filter(Boolean).join(' · ');
        return '<div class="sp-item'+(multi?'':' sp-radio')+(sel?' on':'')+'" data-key="'+esc(k)+'">' +
                 '<span class="sp-box">'+(sel?'✓':'')+'</span>' +
                 '<span class="sp-name">'+esc(s.name)+'</span>' +
                 '<span class="sp-meta">'+esc(meta)+'</span>' +
               '</div>';
      }).join('');
      listEl.onclick = function(e){
        var it = e.target.closest('.sp-item'); if(!it) return;
        var k = it.getAttribute('data-key');
        if (multi){
          if (many[k]) delete many[k]; else many[k] = true;
          updateCount();
        } else {
          one = (one===k) ? null : k;
        }
        renderList(listEl, q, multi);
        fire();
      };
      if (multi) updateCount();
    }

    function updateCount(){
      var c = bodyEl.querySelector('.sp-count');
      if (c) c.textContent = '선택 ' + Object.keys(many).length + '명';
    }

    // ── 선택값 ──
    function getSelection(){
      if (mode === '전체'){
        return { type:'전체', target:'', count:students.length, summary:'전 학년 — 모든 재원 학생('+students.length+'명)' };
      }
      if (mode === '학년'){
        var gs = grades.filter(function(g){ return gradeSel[g]; });
        if (!gs.length) return null;
        var n = students.filter(function(s){ return gradeSel[s.grade]; }).length;
        return { type:'학년', target:gs.join(', '), count:n, summary:gs.join(', ')+' — '+n+'명' };
      }
      if (mode === '개인'){
        if (!one || !byKey[one]) return null;
        var st1 = byKey[one];
        return { type:'개인', target:token(st1), count:1, summary:'개인 — '+label(st1) };
      }
      if (mode === '일부'){
        var sel2 = Object.keys(many).map(function(k){ return byKey[k]; }).filter(Boolean);
        if (!sel2.length) return null;
        var toks = sel2.map(token), labs = sel2.map(label);
        return { type:'일부', target:toks.join(', '), count:sel2.length, summary:'일부 — '+sel2.length+'명 ('+labs.join(', ')+')' };
      }
      return null;
    }

    function fire(){
      var sel = getSelection();
      sumEl.textContent = sel ? ('✓ ' + sel.summary) : '대상을 선택해 주세요.';
      onChange(sel);
    }

    /* 밖에서 학생 묶음을 골라 넣는다 — 키는 '이름|학교|학년'(skey).
     * 클리닉 배정에서 '반으로 고르기'가 쓴다: 시간표 반 명단을 이 위젯의 '일부' 선택으로 옮겨
     * 선택의 원본이 한 곳(위젯)에 남게 한다. 못 찾은 키는 돌려줘 화면에서 알릴 수 있다. */
    function selectByKeys(keys){
      var okKeys = [], missed = [];
      (keys || []).forEach(function(k){ if (byKey[k]) okKeys.push(k); else missed.push(k); });
      mode = '일부';
      tabsEl.querySelectorAll('.sp-tab').forEach(function(t){ t.classList.toggle('on', t.getAttribute('data-mode') === mode); });
      many = {};
      okKeys.forEach(function(k){ many[k] = true; });
      renderBody(); fire();
      return { matched: okKeys.length, missed: missed };
    }

    function reset(){
      gradeSel = {}; one = null; many = {};
      mode = allowAll ? '전체' : '학년';
      tabsEl.querySelectorAll('.sp-tab').forEach(function(t){ t.classList.toggle('on', t.getAttribute('data-mode')===mode); });
      renderBody(); fire();
    }

    function load(){
      bodyEl.innerHTML = '<div class="sp-loading">학생 명단을 불러오는 중…</div>';
      fetch(endpoint + '?action=roster&t=' + Date.now())
        .then(function(r){ return r.json(); })
        .then(function(d){
          if (!d || d.result !== 'success' || !Array.isArray(d.students)){
            bodyEl.innerHTML = '<div class="sp-empty">명단을 불러오지 못했어요.'+(d&&d.message?'<br>'+esc(d.message):'')+'</div>';
            return;
          }
          students = d.students;
          // 동명이인 감지 + 키 맵 (동명이인은 저장 시 이름|학교|학년 으로 구분)
          nameCount = {}; byKey = {};
          students.forEach(function(s){
            nameCount[s.name] = (nameCount[s.name]||0) + 1;
            byKey[skey(s)] = s;
          });
          // 학년 목록(중복 제거 + 정렬)
          var seen = {};
          students.forEach(function(s){ if (s.grade) seen[s.grade] = true; });
          grades = Object.keys(seen).sort(function(a,b){ return a.localeCompare(b, 'ko'); });
          renderBody(); fire();
          if (typeof opts.onReady === 'function') opts.onReady(students);
        })
        .catch(function(){
          bodyEl.innerHTML = '<div class="sp-empty">명단을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</div>';
        });
    }

    load();
    return { getSelection:getSelection, reset:reset, reload:load, selectByKeys:selectByKeys,
             get students(){ return students; } };
  }

  window.StudentPicker = { create:create };
})();
