/* 허브에 로그인한 선생님 이름 — 알림톡 기록의 '보낸 사람'에 쓴다 (2026-10-03 원장님 요청).
 *
 * 쓰는 법:  <script src="https://coke4497-sys.github.io/shueguk-report/teacher-name.js"></script>
 *           shuegukTeacherName().then(function(n){ ... });   // 로그인 전이면 ''
 *
 * · 허브 개인 로그인(localStorage 'shueguk_teacher_session_v2')을 읽어 teacher_accounts 의 이름을 받아 온다.
 *   학생 화면들과 같은 github.io 한 출처라 저장소가 달라도 그대로 읽힌다.
 * · 공용 교사 계정 조각이 window.fetch 를 바꿔 둔 페이지(timetable·analyses 등)에서도 개인 신분으로 묻도록
 *   __sbRawFetch 가 있으면 그것을 쓴다(analyses.html alLoginTeacher 와 같은 규칙).
 * · 한 번 받으면 그 화면에서는 다시 묻지 않는다. 실패하면 빈 값 — 부르는 쪽이 멈추지 않게. */
(function (global) {
  var REST = 'https://bangdbhqpphqqdwcledg.supabase.co/rest/v1';
  var KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT';
  var LS = 'shueguk_teacher_session_v2';
  var cache = null;

  function raw(){ return global.__sbRawFetch || global.fetch.bind(global); }
  function tr(v){ return String(v == null ? '' : v).trim(); }

  function session(){
    var s;
    try { s = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { s = null; }
    if (!s || !s.access_token || !s.refresh_token) return Promise.resolve(null);
    if (Number(s.expires_at || 0) > Date.now() / 1000 + 90) return Promise.resolve(s);
    return raw()(REST.replace('/rest/v1', '') + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh_token }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.access_token) return null;
        var n = { access_token: d.access_token, refresh_token: d.refresh_token,
                  expires_at: Number(d.expires_at || (Date.now() / 1000 + Number(d.expires_in || 3600))),
                  user: d.user || s.user || null };
        try { localStorage.setItem(LS, JSON.stringify(n)); } catch (e) {}
        return n;
      });
  }

  function load(){
    return session().then(function (s) {
      var uid = s && s.user && s.user.id;
      if (!uid) return '';
      return raw()(REST + '/teacher_accounts?select=display_name,login_id&active=is.true&limit=1&user_id=eq.' + encodeURIComponent(uid),
          { headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token }, cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
          var t = rows && rows[0];
          return t ? tr(t.display_name || t.login_id).replace(/\s*(선생님|쌤|T)$/, '') : '';
        });
    }).catch(function () { return ''; });
  }

  global.shuegukTeacherName = function (){
    if (!cache) cache = load().then(function (n) { return n || ''; });
    return cache;
  };
})(window);
