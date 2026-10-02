/* 학생 페이지(s.html)로 돌아가는 '← 내 페이지로' 링크 (2026-10-02 원장님 "지필고사 리포트에서 메인 페이지로 돌아가는 기능이 없었어요").
 * 모든 학생 화면이 coke4497-sys.github.io 한 곳에 있어 저장 공간을 같이 쓴다.
 *  - s.html 에서는 지금 주소(?key=…)를 기억해 둔다:  <script src="me-back.js" data-mode="remember"></script>
 *  - 다른 페이지에서는 그 주소로 가는 링크를 body 맨 위에 넣는다(넘어온 주소가 s.html 이면 그것이 먼저).
 *    기억된 주소가 없으면(학생 페이지를 거치지 않고 바로 연 경우) 아무것도 넣지 않는다.
 *    data-anchor="선택자" 를 주면 그 요소 바로 앞에 넣는다. ?preview=1(선생님 미리보기)이면 넣지 않는다. */
(function(){
  var KEY = 'shueguk_me';
  var me = document.currentScript;
  var mode = me && me.getAttribute('data-mode');
  var isMe = function(u){ return /\/shueguk-report\/s\.html\?/.test(String(u || '')) && /[?&](key|id)=/.test(String(u || '')); };
  function get(store){ try { return window[store].getItem(KEY) || ''; } catch(e){ return ''; } }
  function put(v){ try { sessionStorage.setItem(KEY, v); } catch(e){} try { localStorage.setItem(KEY, v); } catch(e){} }
  if (mode === 'remember'){ if (isMe(location.href)) put(location.href); return; }
  if (/[?&]preview=1/.test(location.search)) return;
  var url = isMe(document.referrer) ? document.referrer : (get('sessionStorage') || get('localStorage'));
  if (!isMe(url)) return;
  if (isMe(document.referrer)) put(document.referrer);
  function add(){
    if (document.getElementById('me-back')) return;
    var st = document.createElement('style');
    st.textContent = '#me-back-row{max-width:560px;margin:0 auto;padding:12px 16px 2px;box-sizing:border-box;}' +
      '#me-back{display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:13px;font-weight:700;color:#4F5C56;' +
      'text-decoration:none;background:rgba(255,255,255,.75);border-radius:999px;padding:6px 13px 6px 10px;-webkit-tap-highlight-color:transparent;}' +
      '#me-back:hover{background:#fff;}#me-back svg{width:15px;height:15px;}';
    document.head.appendChild(st);
    var row = document.createElement('div'); row.id = 'me-back-row';
    row.innerHTML = '<a id="me-back" href=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>내 페이지로</a>';
    row.firstChild.href = url;
    var sel = me && me.getAttribute('data-anchor'), anchor = sel && document.querySelector(sel);
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(row, anchor);
    else document.body.insertBefore(row, document.body.firstChild);
  }
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
})();
