/* 티쳐스 활동 → 원장님 슈톡 알림 (2026-10-27 원장님 "누군가가 티쳐스 페이지에 … 모든 작업을 할 때 나에게 알람이 오면" → 섞기 + 이름)
 *
 * 쓰는 법:  <script src="https://coke4497-sys.github.io/shueguk-report/activity.js"></script>
 *           shuegukActivity('시험 범위', '저장', '고1 화정 · 26-2-기말', '교과서: …', true);   // 즉시 알림
 *           shuegukActivity('출석', '결석', '고1 가 · 10/27 · 김민준', '병결');                // 묶음(2시간마다 요약)
 *           shuegukActivity.many([{ what, action, target, detail, urgent }, …]);
 *
 * · 허브 엣지 함수 `activity`(allow: 활성 교사 JWT 또는 공용 교사 계정 JWT)에 보낸다. 작성자 이름은 서버가 허브 개인 로그인에서
 *   확인하고, 개인 로그인이 없을 때만 여기서 보낸 이름(teacher-name.js → 이 기기 이름 tt_task_who)을 쓴다.
 * · 신분증: 허브 개인 로그인(localStorage shueguk_teacher_session_v2 — 만료 전) → 공용 교사 계정 조각이 받아 둔 것(sb_teacher_tok_v1).
 *   둘 다 없으면 보내지 않는다(기록만 빠질 뿐 화면은 그대로).
 * · 절대 던지지 않는다 — 저장 흐름을 막지 않도록 뒤에서 보내고 실패는 조용히 버린다(keepalive). 0.5초 안에 쌓인 것은 한 번에.
 * · github.io 가 아닌 곳(로컬 미리보기·검사)에서도 보낸다 — 검사는 요청을 가로채 본문을 확인한다. */
(function (global) {
  var FN = 'https://bangdbhqpphqqdwcledg.supabase.co/functions/v1/activity';
  var KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT';
  var queue = [], timer = null;
  function raw(){ return global.__sbRawFetch || global.fetch.bind(global); }
  function token(){
    try {
      var s = JSON.parse(localStorage.getItem('shueguk_teacher_session_v2') || 'null');
      if (s && s.access_token && Number(s.expires_at || 0) > Date.now() / 1000 + 30) return s.access_token;
    } catch (e) {}
    try {
      var c = JSON.parse(localStorage.getItem('sb_teacher_tok_v1') || 'null');
      if (c && c.t && c.u > Date.now()) return c.t;
    } catch (e) {}
    return '';
  }
  function fallbackName(){
    var p = typeof global.shuegukTeacherName === 'function' ? global.shuegukTeacherName() : Promise.resolve('');
    return p.then(function (n) { if (n) return n; try { return localStorage.getItem('tt_task_who') || ''; } catch (e) { return ''; } }, function () { return ''; });
  }
  function flush(){
    timer = null;
    var rows = queue.splice(0, 50);
    if (!rows.length) return;
    var t = token();
    if (!t){ if (queue.length) timer = setTimeout(flush, 500); return; }
    fallbackName().then(function (nm) {
      rows.forEach(function (r) { r.author = nm; });
      return raw()(FN, { method: 'POST', keepalive: true,
        headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'log', rows: rows }) });
    }).catch(function () {}).then(function () { if (queue.length && !timer) timer = setTimeout(flush, 0); });
  }
  function page(){ try { return (location.pathname.split('/').filter(Boolean).slice(-2).join('/') || '').slice(0, 60); } catch (e) { return ''; } }
  function add(r){
    if (!r || !r.what) return;
    queue.push({ page: page(), what: String(r.what), action: String(r.action || ''), target: String(r.target || ''), detail: String(r.detail || ''), urgent: !!r.urgent });
    if (!timer) timer = setTimeout(flush, 500);
  }
  function one(what, action, target, detail, urgent){ add({ what: what, action: action, target: target, detail: detail, urgent: urgent }); }
  one.many = function (rows) { (rows || []).forEach(add); };
  global.shuegukActivity = one;
})(window);
