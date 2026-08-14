/**
 * SHUEGUK 시험 복기 — 통합 Apps Script 웹앱 v5
 *  (읽기 + 제출 수집 + 제출결과 조회 + 시험 등록 / 시험범위·세부유형·지문그룹 지원)
 *
 *  (1) 보고서 읽기   : ?id=서정고3화작 → 제목·시험범위·총평·문항(영역·세부유형·형식·난도·내용·지문그룹) 반환
 *  (2) 제출 수집     : 학생 '선생님께 제출' → '제출결과' 탭에 한 행씩 저장
 *  (3) 제출결과 조회 : ?results=서정고3화작 → 제출 학생 목록 반환
 *  (4) 보고서 목록   : ?list=1 → 등록된 시험 목록 반환
 *  (5) 시험 등록     : m.html POST(action:createReport) → '보고서목록'·'문항' 탭에 저장
 *  (6) 학생 개별페이지: ?key=토큰 → 학생 식별(성적 잠금). ?key=토큰&pw=부모님8자리 → 성적까지 반환 (s.html)
 *      · 접근코드(토큰) 생성: 편집기에서 assignAccessCodes() 한 번 실행 → '학생정보' L열 자동 채움
 *  (7) 선생님 한마디 저장: t.html POST(action:saveTeacherNote, rowIndex, name, note) → '제출결과' I열 기록
 *
 * ───────────────────────────────────────────────────────────────
 * [시트 탭 / 열]  ※ v4에서 새 열을 "뒤에 추가"만 했으므로 기존 시험도 그대로 동작합니다.
 *  ① 보고서목록   A:ID | B:제목 | C:총평 | D:시험범위                                  ★D 신규
 *  ② 문항         A:보고서ID | B:번호 | C:영역(상위) | D:형식(객/서술) | E:난도 | F:내용 | G:세부유형(하위) | H:지문그룹   ★G·H 신규
 *  ③ 제출결과     제출일시 | 시험 | 학교 | 학년 | 이름 | 틀린문항수 | 틀린문항·반성 | 다음시험다짐 | 선생님의한마디 | 예상점수 | 부모님연락처   ★K 신규(010 제외 8자리 · 학생 매칭 키)
 *  ④ 학생정보     A:학생ID(부모님8자리=비밀번호) | B:이름 | C:학교 | D:학년 | E:담당교사 | F:메모 | G:정규가 | H:정규나 | I:내신진도 | J:내신확인 | K:재원여부 | L:접근코드(토큰)   ★신규 탭
 *  ⑤ 공지         A:작성일 | B:대상유형(전체/학년/개인/일부) | C:대상 | D:제목 | E:내용 | F:게시(빈칸=노출, N/숨김/off=숨김)   ★알려드립니다 탭
 *
 * [업데이트] 기존 코드를 전부 지우고 이 코드로 교체 → 저장
 *   → 배포 → 배포 관리 → 기존 배포 옆 연필(편집) → 버전 '새 버전' → 배포  (같은 URL 유지)
 *   ※ '보고서목록'·'문항' 탭의 새 열 머리글(D / G·H)은 시험을 한 번 등록하면 자동으로 채워집니다.
 * ───────────────────────────────────────────────────────────────
 */

var TAB_LIST     = '보고서목록';
var TAB_ITEMS    = '문항';
var TAB_RESULT   = '제출결과';
var TAB_STUDENTS = '학생정보';   // 학생 명단 (A:학생ID=부모님번호8자리 | B:이름 | C:학교 | D:학년 | E:담당교사 | F:메모 | G~J:시간표 | K:재원여부)
var TAB_NOTICE   = '공지';        // 알려드립니다 (A:작성일 | B:대상유형(전체/학년/개인/일부) | C:대상 | D:제목 | E:내용 | F:게시)
var TAB_ASSIGN   = '배정';        // 도구별 배정 (A:작성일 | B:도구 | C:항목 | D:대상유형 | E:대상 | F:마감 | G:비고) — H WORK·클리닉·주말 공용
var ANALYSIS_TOOL = '지필고사 분석지';   // '배정' 탭에서 지필고사 분석지 배정을 구분하는 도구명 (항목=시험ID)

// 클리닉 신청(별도 스프레드시트) — 학생 페이지에 '내 클리닉 신청'을 토큰으로 조회해 표시
var CLINIC_SHEET_ID = '1q-D_cGhSpVgX5epGKIVy-HH9P26ygj-TeT9yrMaHAO8';
var CLINIC_TAB      = '응답';     // 제출시각|이름|학교|전화뒤4|클리닉시간|유형|영역|구체내용|질문개수|메모|토큰(신규)

// ── 슈퍼스타 별(경험치) 시스템 ─────────────────────────────
// 별 적립 규칙(자동): 지필 평가지 시험당 +2 / 클리닉 주·시간대당 +1 / 어휘 주차당 +1 / 과제 항목당 +1
// (모든 항목이 '단위' 기준 — 같은 것을 여러 번 제출·신청해도 별은 1회분만)
// 깜짝 보너스(수동): '별' 탭에 로그로 기록 (star.html에서 부여)
var TAB_STARS  = '별';   // A:일시 B:학생ID C:이름 D:학교 E:별 F:사유
var STAR_RULES = { exam: 2, clinic: 1, voca: 1, hwork: 1, notice: 1, mock: 1, hwcheck: 1 };   // notice = 공지 확인 1건당, mock = 모의고사 응시 회차당, hwcheck = 숙제 검사 만점(100%) 주차당
var TAB_NOTICE_READ = '공지확인';   // A:일시 B:학생ID C:이름 D:학교 E:공지키(작성일|제목)
// 어휘·H WORK·주말 모의고사 자동 적립용 스프레드시트 ID (비우면 그 항목은 0으로 계산)
var VOCA_SHEET_ID  = '1AVDyKpBj9kSW5hzSzOieVIZpV6FnIpcFMjsjUyuGAbE';   // 어휘 결과 시트
var HWORK_SHEET_ID = '1nFZ2HVAnCyCv_NOoAPXhA1VC_T7BBqwUWNWBta4-qFE';   // H WORK 시트
var HWORK_TAB      = '제출기록';   // H WORK 제출 기록 탭 이름 (H WORK 백엔드의 SHEET_SUB와 동일)
var OMR_SHEET_ID   = '1hd1huZpppBue5rlBVMZc2-wAbZ91PitFiBGT12Cq7YQ';   // 주말 모의고사 점수입력(OMR) 시트
var OMR_TAB        = '응답';       // OMR 제출 기록 탭 (omr_code.gs의 응답 시트)
var SIGNUP_SHEET_ID = '1pB05VXT__-kJHoNpQxQSxbm4PhlB6XuJ7EvVG79pW14'; // 주말 모의고사 신청 시트 (퇴원 정리 검색용)
var SIGNUP_TAB      = '신청';

// 설정 탭 — 학생 페이지 기능 켜고/끄기 (A:항목 | B:값). 예: '어휘 테스트' | '중단'
var TAB_CONFIG = '설정';
var TEACHER_PW = 'sh';   // 티쳐스 페이지에서 어휘 켜기/끄기 할 때 쓰는 비밀번호 (원하면 변경)

// ── 숙제 검사 (정규 수업 기간, hwcheck.html) ─────────────────
// '숙제검사' 탭: A일시 B주차(수~일 단위 주의 수요일 yyyy-MM-dd) C접근코드 D이름 E학교 F학년
//               G항목점수(JSON) H만점 I점수% J공개메모 K비공개메모 L상태('미제출'/빈칸) M대책 N대책완료('완료'/빈칸)
// 항목 목록은 '설정' 탭의 '숙제검사 항목'(쉼표 구분). 주차·학생당 1행(덮어쓰기).
// 미제출이면 점수 0% + 이후 대책(재검사 약속 등)을 기록. 대책은 교사 화면에만 보이고,
// 교사 화면의 '미제출 대책' 목록에서 확인(완료) 표시로 처리 여부를 관리한다.
// 만점(100%) 주차는 슈퍼스타 별 1개로 집계(STAR_RULES.hwcheck).
var TAB_HWCHECK = '숙제검사';

// ── 정규 시간표 (timetable.html) ──────────────────────────────
// '정규시간표' 탭이 반 편성의 원본. 학생 이동 시 '학생정보'의 정규가/나 열도 함께 갱신되어
// 학생 개별 페이지(s.html)·숙제 검사(hwcheck.html)에 자동 반영된다.
var TAB_TIMETABLE = '정규시간표';   // A:반ID B:요일 C:시작 D:끝 E:위치 F:담당T G:반이름 H:학생명단(공백 구분)
var TAB_TIMETABLE_EXAM = '내신시간표';   // 내신 대비 시간표 — 구조 동일, 학생정보 정규가/나에는 반영하지 않음
var TAB_TT_LOG = '시간표이동기록';  // A:일시 B:구분(영구/1회/추가/빼기) C:학생 D:from반ID E:from반 F:to반ID G:to반 H:사유 I:시간표(정규/내신)
var TT_ONCE_DAYS = 8;               // 1회 이동을 시간표에 표시하는 기간(일)
var TAB_ATTEND = '출석기록';        // A:날짜(yyyy-MM-dd) B:시간표(정규/내신) C:반ID D:학생 E:상태(출석/지각/결석) F:메모 G:기록일시

var HWCHECK_ITEMS_KEY = '숙제검사 항목';
var HWCHECK_DEFAULT_ITEMS = ['숙제 수행', '오답 처리'];
var HWCHECK_STARS_MAX = 6;   // 항목당 별 0~6개

/* ── 접속 폭주 대비 (성능) ─────────────────────────────────────
 * 학생 개인 페이지 요청 1건이 시트를 10번 넘게(외부 스프레드시트 4개 포함) 읽어
 * 접속이 몰리면 서버가 밀리던 문제를 줄인다.
 *  ① tabValues_ : 한 요청 안에서 같은 탭을 여러 번 읽지 않는 실행 단위 메모.
 *     (Apps Script는 요청마다 전역이 초기화되므로 요청 사이에는 남지 않는다)
 *  ② extSnap_ : 외부 스프레드시트(클리닉·어휘·H WORK·OMR)를 필요한 문자열만
 *     압축해 짧게 캐시 — 전 학생이 같은 스냅샷을 공유한다. 캐시 실패(용량 초과 등)
 *     시에는 그냥 매번 읽으므로 동작은 같고 속도만 떨어진다.
 *     ※ 새 제출은 캐시 수명(어휘·H WORK·OMR 60초, 클리닉 30초) 안에만 늦게 보인다. */
var MEMO_ = {};
/* 학생 페이지가 매번 읽는 탭은 짧게 캐시해 전 학생이 공유한다.
 * (제출결과는 크기·최신성 때문에 캐시하지 않고 요청 내 메모만 사용)
 * 관리 기능이 해당 탭을 고치면 dropTab_ 으로 즉시 비워 반영이 늦지 않게 한다.
 * ※ 캐시를 거친 값은 날짜가 ISO 문자열로 돌아오는데, 이 탭들의 소비처는 모두
 *   String()/new Date() 변환을 거치므로 표시·판정이 달라지지 않는다. */
var TAB_CACHE_TTL_ = {};
TAB_CACHE_TTL_[TAB_STUDENTS] = 60;
TAB_CACHE_TTL_[TAB_NOTICE] = 60;
TAB_CACHE_TTL_[TAB_NOTICE_READ] = 60;
TAB_CACHE_TTL_[TAB_ASSIGN] = 60;
TAB_CACHE_TTL_[TAB_CONFIG] = 60;
TAB_CACHE_TTL_[TAB_STARS] = 60;
TAB_CACHE_TTL_[TAB_LIST] = 120;
TAB_CACHE_TTL_[TAB_ITEMS] = 120;
TAB_CACHE_TTL_[TAB_HWCHECK] = 60;
function tabValues_(ss, tab) {
  var k = 'tab:' + tab;
  if (k in MEMO_) return MEMO_[k];
  var ttl = TAB_CACHE_TTL_[tab];
  if (ttl) {
    try {
      var hit = CacheService.getScriptCache().get(k);
      if (hit) return (MEMO_[k] = JSON.parse(hit));
    } catch (e) {}
  }
  var sh = ss.getSheetByName(tab);
  var v = sh ? sh.getDataRange().getValues() : null;
  if (ttl && v) { try { CacheService.getScriptCache().put(k, JSON.stringify(v), ttl); } catch (e) {} }  // 100KB 초과 등이면 캐시 없이 진행
  return (MEMO_[k] = v);
}
function dropTab_(tab) {
  delete MEMO_['tab:' + tab];
  try { CacheService.getScriptCache().remove('tab:' + tab); } catch (e) {}
}
function extSnap_(key, ttlSec, build) {
  var mk = 'snap:' + key;
  if (MEMO_[mk]) return MEMO_[mk];
  try {
    var hit = CacheService.getScriptCache().get(key);
    if (hit) return (MEMO_[mk] = JSON.parse(hit));
  } catch (e) {}
  var snap = build();
  try { CacheService.getScriptCache().put(key, JSON.stringify(snap), ttlSec); } catch (e) {}
  return (MEMO_[mk] = snap);
}

/* H WORK '제출기록' 스냅샷 — 행: [강사, 제목, 이름, 학교, 학년] (모두 문자열) */
function hworkSnap_() {
  return extSnap_('hworkSnap', 60, function () {
    var snap = { ok: false, has: {}, rows: [] };
    if (!HWORK_SHEET_ID) return snap;
    var sh = null;
    try {
      var hss = SpreadsheetApp.openById(HWORK_SHEET_ID);
      if (HWORK_TAB) sh = hss.getSheetByName(HWORK_TAB);
      if (!sh) {   // 탭 이름이 비어 있으면 '제출시각'+'이름' 머리글이 있는 탭을 자동 탐색
        var all = hss.getSheets();
        for (var t = 0; t < all.length; t++) {
          if (all[t].getLastRow() < 1) continue;
          var head = all[t].getRange(1, 1, 1, Math.max(all[t].getLastColumn(), 1)).getValues()[0]
            .map(function (h) { return String(h || '').trim().toLowerCase(); });
          if (idxOfAny_(head, ['이름', 'name']) >= 0 && idxOfAny_(head, ['제출시각', '제출일시', 'time']) >= 0) { sh = all[t]; break; }
        }
      }
    } catch (e) { return snap; }
    if (!sh) return snap;
    var v = sh.getDataRange().getValues();
    snap.ok = true;
    if (v.length < 2) return snap;
    var H = v[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
    var iName = idxOfAny_(H, ['name', '이름']), iSchool = idxOfAny_(H, ['school', '학교']);
    var iTitle = idxOfAny_(H, ['제목', 'title']), iTeach = idxOfAny_(H, ['강사']), iGrade = idxOfAny_(H, ['학년', 'grade']);
    snap.has = { name: iName >= 0, school: iSchool >= 0, title: iTitle >= 0, teacher: iTeach >= 0, grade: iGrade >= 0 };
    for (var i = 1; i < v.length; i++) {
      snap.rows.push([
        iTeach  >= 0 ? String(v[i][iTeach]  || '') : '',
        iTitle  >= 0 ? String(v[i][iTitle]  || '') : '',
        iName   >= 0 ? String(v[i][iName]   || '') : '',
        iSchool >= 0 ? String(v[i][iSchool] || '') : '',
        iGrade  >= 0 ? String(v[i][iGrade]  || '') : ''
      ]);
    }
    return snap;
  });
}

/* 어휘 결과 시트 스냅샷 — 행: [이름, 주차, 학년, 학교] */
function vocaSnap_() {
  return extSnap_('vocaSnap', 60, function () {
    var snap = { ok: false, has: {}, rows: [] };
    if (!VOCA_SHEET_ID) return snap;
    var sh;
    try { sh = SpreadsheetApp.openById(VOCA_SHEET_ID).getSheets()[0]; } catch (e) { return snap; }
    if (!sh) return snap;
    var v = sh.getDataRange().getValues();
    snap.ok = true;
    if (v.length < 2) return snap;
    var H = v[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
    var iName = idxOfAny_(H, ['name', '이름']), iRound = idxOfAny_(H, ['round', '주차', '회차']), iGrade = idxOfAny_(H, ['grade', '학년']), iSchool = idxOfAny_(H, ['school', '학교']);
    snap.has = { name: iName >= 0, round: iRound >= 0, grade: iGrade >= 0, school: iSchool >= 0 };
    for (var i = 1; i < v.length; i++) {
      snap.rows.push([
        iName   >= 0 ? String(v[i][iName]   || '') : '',
        iRound  >= 0 ? String(v[i][iRound]  || '') : '',
        iGrade  >= 0 ? String(v[i][iGrade]  || '') : '',
        iSchool >= 0 ? String(v[i][iSchool] || '') : ''
      ]);
    }
    return snap;
  });
}

/* 주말 모의고사(OMR) 응답 스냅샷 — 행: [학생ID, 이름, 학교, 회차, 학년] */
function omrSnap_() {
  return extSnap_('omrSnap', 60, function () {
    var snap = { ok: false, has: {}, rows: [] };
    if (!OMR_SHEET_ID) return snap;
    var sh;
    try { sh = SpreadsheetApp.openById(OMR_SHEET_ID).getSheetByName(OMR_TAB); } catch (e) { return snap; }
    if (!sh) return snap;
    snap.ok = true;
    if (sh.getLastRow() < 2) return snap;
    var v = sh.getDataRange().getValues();
    var H = v[0];
    var iId = H.indexOf('학생ID'), iN = H.indexOf('이름'), iS = H.indexOf('학교'), iE = H.indexOf('회차'), iG = H.indexOf('학년');
    snap.has = { id: iId >= 0, name: iN >= 0, school: iS >= 0, round: iE >= 0, grade: iG >= 0 };
    for (var i = 1; i < v.length; i++) {
      snap.rows.push([
        iId >= 0 ? String(v[i][iId] || '') : '',
        iN  >= 0 ? String(v[i][iN]  || '') : '',
        iS  >= 0 ? String(v[i][iS]  || '') : '',
        iE  >= 0 ? String(v[i][iE]  || '') : '',
        iG  >= 0 ? String(v[i][iG]  || '') : ''
      ]);
    }
    return snap;
  });
}

/* 클리닉 '응답' 스냅샷 — 행: [토큰, 학생ID, 클리닉시간, 신청주키, 제출시각문자열]
 * (신청주키·제출시각은 원본 셀 값으로 미리 계산해 두어 기존 표시·집계와 동일) */
function clinicSnap_() {
  // 캐시 키 clinicSnap2: 행 형식이 바뀌어(요청 상세 추가) 옛 캐시와 충돌하지 않게 함
  return extSnap_('clinicSnap2', 30, function () {
    var snap = { ok: false, has: {}, rows: [] };
    var sh;
    try { sh = SpreadsheetApp.openById(CLINIC_SHEET_ID).getSheetByName(CLINIC_TAB); } catch (e) { return snap; }
    if (!sh) return snap;
    var v = sh.getDataRange().getValues();
    snap.ok = true;
    if (v.length < 2) return snap;
    var H = v[0];
    var iTok = H.indexOf('토큰'), iSid = H.indexOf('학생ID'), iDate = H.indexOf('제출시각'), iTime = H.indexOf('클리닉시간');
    var iType = H.indexOf('유형'), iArea = H.indexOf('영역'), iCont = H.indexOf('구체내용'),
        iCnt = H.indexOf('질문개수'), iMemo = H.indexOf('메모');
    snap.has = { tok: iTok >= 0, sid: iSid >= 0, date: iDate >= 0, time: iTime >= 0 };
    // 시트가 제출시각을 날짜 값으로 바꿔둔 경우도 "yyyy-MM-dd HH:mm" 문자열로 통일
    function ts(x) {
      if (x instanceof Date && !isNaN(x.getTime())) return Utilities.formatDate(x, 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
      return String(x || '').trim();
    }
    function cell(idx, i) { return idx >= 0 ? String(v[i][idx] || '').trim() : ''; }
    for (var i = 1; i < v.length; i++) {
      snap.rows.push([
        iTok  >= 0 ? String(v[i][iTok]  || '') : '',
        iSid  >= 0 ? String(v[i][iSid]  || '') : '',
        iTime >= 0 ? String(v[i][iTime] || '') : '',
        clinicWeekKey_(iDate >= 0 ? v[i][iDate] : ''),
        ts(iDate >= 0 ? v[i][iDate] : ''),
        cell(iType, i), cell(iArea, i), cell(iCont, i), cell(iCnt, i), cell(iMemo, i)
      ]);
    }
    return snap;
  });
}

/* ── 주말 모의고사 신청 조회 (학생 개별 페이지용) ─────────────────
 * 학생 페이지가 신청 서버(JSONP)를 따로 부를 때 시간 초과로 '신청함' 표시가
 * 오락가락하던 문제를 없애기 위해, 리포트 응답에 이번 주 신청 내역을 함께 담는다.
 * 매칭·주차 규칙은 신청 백엔드(signup_code.gs mySignups)와 동일. */
var SIGNUP_SHEET_ID = '1pB05VXT__-kJHoNpQxQSxbm4PhlB6XuJ7EvVG79pW14';
var SIGNUP_TAB = '신청';

// 화요일 시작 주 키 (신청 백엔드 weekKey_와 동일 규칙 · Asia/Seoul)
function signupWeekKey_(v) {
  var d;
  if (v instanceof Date) d = v;
  else {
    var s = String(v || '').trim();
    if (!s) return '';
    d = new Date(s.indexOf('T') > -1 ? s : s.replace(' ', 'T'));
  }
  if (!d || isNaN(d.getTime())) return '';
  var ymd = Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd').split('-');
  var dow = new Date(Date.UTC(+ymd[0], +ymd[1] - 1, +ymd[2], 12)).getUTCDay(); // 0=일..6=토
  var since = (dow - 2 + 7) % 7;                                               // 화요일(2)로부터 지난 날 수
  var tue = new Date(Date.UTC(+ymd[0], +ymd[1] - 1, +ymd[2] - since, 12));
  return Utilities.formatDate(tue, 'Asia/Seoul', 'yyyy-MM-dd');
}
// 주 키(화요일)와 요일로 실제 응시 날짜 라벨 (토=화+4, 일=화+5 — 신청 백엔드와 동일)
function signupDateLabel_(weekKey, day) {
  var p = String(weekKey || '').split('-');
  if (p.length !== 3) return '';
  var offset = (day === '토요일') ? 4 : (day === '일요일') ? 5 : 0;
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + offset, 12));
  return (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일';
}

/* 신청 시트 스냅샷 — 행: [이름, 학교, 학생ID, 응시요일, 신청주키] */
function signupSnap_() {
  return extSnap_('signupSnap', 30, function () {
    var snap = { ok: false, rows: [] };
    var sh;
    try { sh = SpreadsheetApp.openById(SIGNUP_SHEET_ID).getSheetByName(SIGNUP_TAB); } catch (e) { return snap; }
    if (!sh) return snap;
    var v = sh.getDataRange().getValues();
    snap.ok = true;
    if (v.length < 2) return snap;
    var H = v[0];
    var iN = H.indexOf('이름'), iS = H.indexOf('학교'), iId = H.indexOf('학생ID'),
        iDay = H.indexOf('응시요일'), iT = H.indexOf('제출시각');
    for (var i = 1; i < v.length; i++) {
      snap.rows.push([
        iN   >= 0 ? String(v[i][iN]   || '') : '',
        iS   >= 0 ? String(v[i][iS]   || '') : '',
        iId  >= 0 ? String(v[i][iId]  || '') : '',
        iDay >= 0 ? String(v[i][iDay] || '') : '',
        signupWeekKey_(iT >= 0 ? v[i][iT] : '')
      ]);
    }
    return snap;
  });
}

/* 이번 주 모의고사 신청 내역 [{day, date}] — 없으면 [], 시트 접근 실패 시 null */
function collectMockSignups_(info) {
  try {
    var name = String((info && info.name) || '').trim();
    if (!name) return [];
    var school = String((info && info.school) || '').trim();
    var sid = String((info && info.id) || '').trim();
    var uniq = info && info.nameDup === false;   // 이름이 유일하면 학생ID 불일치는 무시
    var snap = signupSnap_();
    if (!snap.ok) return null;
    var week = signupWeekKey_(new Date());
    var days = ['토요일', '일요일'];
    var seen = {}, out = [];
    for (var i = 0; i < snap.rows.length; i++) {
      var r = snap.rows[i];
      var rn = r[0].trim();
      if (rn !== name && rn !== baseName_(name)) continue;   // 접미사 동명이인(김은수A) 대비
      var rs = r[1].trim();
      if (school && rs && !schoolMatch_(rs, school)) continue;
      var rid = r[2].replace(/^'/, '').trim();
      if (!uniq && rid && sid && rid !== sid) continue;      // 동명이인 구분(양쪽에 ID 있을 때만)
      if (r[4] !== week) continue;                           // 이번 주만
      var day = r[3].trim();
      if (days.indexOf(day) === -1 || seen[day]) continue;
      seen[day] = true;                                      // 같은 요일 중복 신청은 1건으로
      out.push({ day: day, date: signupDateLabel_(week, day) });
    }
    return out;
  } catch (e) { return null; }
}

function doGet(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  // 어휘 테스트 켜짐 상태 + 열린 주차 조회 (티쳐스 페이지 토글·주차 드롭다운용)
  if (p.action === 'vocaStatus') {
    var ssv = SpreadsheetApp.getActiveSpreadsheet();
    var wkv = configVal_(ssv, '어휘 주차', '');
    return json({ result:'success', open: configOpen_(ssv, '어휘 테스트', true), week: wkv ? parseInt(wkv, 10) : null });
  }
  // 어휘 테스트 켜기/끄기 (비밀번호 필요) — '설정' 탭에 열림/중단 기록
  if (p.action === 'setVoca') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    var vopen = (p.open === '1' || p.open === 'true');
    var ssv2 = SpreadsheetApp.getActiveSpreadsheet();
    setConfig_(ssv2, '어휘 테스트', vopen ? '열림' : '중단');
    logConfig_(ssv2, '어휘 테스트', vopen ? '열림' : '중단');
    return json({ result:'success', open: vopen });
  }
  // 열린 어휘 주차 지정 (비밀번호 필요) — '설정' 탭에 주차 번호 기록
  if (p.action === 'setVocaWeek') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    var wset = parseInt(p.w, 10);
    if (!(wset >= 1)) return json({ result:'error', message:'bad week' });
    var ssw = SpreadsheetApp.getActiveSpreadsheet();
    setConfig_(ssw, '어휘 주차', String(wset));
    logConfig_(ssw, '어휘 주차', String(wset));
    return json({ result:'success', week: wset });
  }
  // 학생 명단(roster) — 티쳐스 공지·선택 위젯용. 민감정보(학생ID=비밀번호)는 제외.
  if (p.action === 'roster')     { return getRoster(); }
  // 문항 내용 패턴 — 지금까지 등록된 문항에서 반복 유형을 빈도순으로 (m.html 드롭다운용)
  if (p.action === 'txtPatterns') { return getTxtPatterns(); }
  // 공지 목록(관리용) — 비밀번호 필요
  if (p.action === 'noticeList') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    return getNoticeList();
  }
  // 학생 개인 페이지 링크 목록(관리용, links.html) — 비밀번호 필요 (접근코드 포함이므로 공개 금지)
  if (p.action === 'studentLinks') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    return getStudentLinks();
  }
  // 정규 시간표 조회(교사용, timetable.html) — 비밀번호 필요
  if (p.action === 'timetableList') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    return getTimetable(p.book);
  }
  // 정규 시간표 이동 기록 (timetable.html) — 비밀번호 필요
  if (p.action === 'timetableLog') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    return getTimetableLog();
  }
  // 출석 기록 조회 (timetable.html 오늘의 시간표) — 비밀번호 필요
  if (p.action === 'attendList') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    return getAttendList(p.date, p.book);
  }
  // 별 보너스 로그(관리용) — 비밀번호 필요
  // 슈퍼스타 TOP 10 순위 — 전 재원생 별 집계 (비밀번호 필요)
  if (p.action === 'starRank') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    return getStarRanking();
  }
  if (p.action === 'starLog') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    return getStarLog();
  }
  // 퇴원 정리 — 전 시트에서 학생 기록 검색 (개인정보 포함이므로 비밀번호 필요)
  if (p.action === 'exitScan') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    return exitScan(p.name, p.sid);
  }
  // 배정 목록(도구별) — 비밀번호 필요. ?action=assignList&tool=H WORK[&item=...]
  if (p.action === 'assignList') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    return getAssignList(p.tool ? String(p.tool).trim() : '', p.item ? String(p.item).trim() : '');
  }
  // 숙제 검사 — 주차별 기록·항목 조회 (hwcheck.html) — 비밀번호 필요. ?action=hwcheckData[&week=yyyy-MM-dd]
  if (p.action === 'hwcheckData') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    return getHwcheckData(p.week);
  }
  // 숙제 검사 — 미제출 대책 목록(전 주차) — 비밀번호 필요
  if (p.action === 'hwcheckPlans') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    return getHwcheckPlans();
  }
  if (p.list)    { return getList(); }
  if (p.results) { return getResults(String(p.results).trim()); }
  if (p.key)     { return getStudent({ key: p.key, pw: p.pw }); }     // ?key=토큰[&pw=번호] → 학생 허브
  if (p.student) { return getStudent({ id: p.student, pw: p.pw }); }  // (테스트용) ?student=학생ID[&pw=번호]
  var id = p.id ? String(p.id).trim() : '';
  if (!id) {
    return json({ result: 'error', message: 'id 파라미터가 없습니다. 예: ?id=서정고3화작' });
  }
  return getReport(id);
}

/* ===== (4) 보고서 목록 전체 ===== */
function getList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_LIST);
  var reports = [];
  if (sh) {
    var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      var id = String(v[i][0]||'').trim();
      if (!id) continue;
      reports.push({ id: id, title: String(v[i][1]||'').trim(), school: String(v[i][4]||'').trim(), grade: String(v[i][5]||'').trim() });
    }
  }
  return json({ result:'success', reports: reports });
}

/* ===== (1) 보고서 읽기 ===== */
function getReport(id) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var listSh = ss.getSheetByName(TAB_LIST);
  var title = '', review = '', scope = '', found = false;
  if (listSh) {
    var lv = listSh.getDataRange().getValues();
    for (var i = 1; i < lv.length; i++) {
      if (String(lv[i][0]).trim() === id) {
        title  = String(lv[i][1] || '');
        review = String(lv[i][2] || '');
        scope  = String(lv[i][3] || '');   // D열: 시험범위
        found = true;
        break;
      }
    }
  }
  if (!found) {
    return json({ result: 'error', message: "'" + id + "' 보고서를 찾을 수 없습니다." });
  }
  var itemSh = ss.getSheetByName(TAB_ITEMS);
  var questions = [];
  if (itemSh) {
    var iv = itemSh.getDataRange().getValues();
    for (var j = 1; j < iv.length; j++) {
      if (String(iv[j][0]).trim() === id) {
        questions.push({
          no:     String(iv[j][1]||''),
          area:   String(iv[j][2]||''),          // C: 영역(상위)
          type:   String(iv[j][3]||''),          // D: 형식(객/서술)
          lv:     String(iv[j][4]||'').trim(),   // E: 난도
          txt:    String(iv[j][5]||''),          // F: 내용
          detail: String(iv[j][6]||''),          // G: 세부유형(하위)
          group:  String(iv[j][7]||''),          // H: 지문그룹
          multi:  isMulti_(iv[j][8])             // I: 복수선택 유형
        });
      }
    }
  }
  var reviewArr = review.split(/\n\s*\n/).map(function(s){return s.trim();}).filter(Boolean);
  return json({ result:'success', title:title, scope:scope, review:reviewArr, questions:questions });
}

/* ===== (3) 제출결과 조회 ===== */
function getResults(reportId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_RESULT);
  if (!sh) return json({ result:'success', students: [] });

  var matchTitle = '';
  if (reportId && reportId !== 'ALL') {
    var listSh = ss.getSheetByName(TAB_LIST);
    if (listSh) {
      var lv = listSh.getDataRange().getValues();
      for (var k = 1; k < lv.length; k++) {
        if (String(lv[k][0]).trim() === reportId) { matchTitle = String(lv[k][1]||'').trim(); break; }
      }
    }
  }

  // 학생정보 매핑(접근코드·학생ID 조회용): 부모님번호(A) 우선, 이름(B) 보조
  var byPhone = {}, byName = {}, byPhoneName = {}, phoneCount = {}, byBase = {};
  var stSh = ss.getSheetByName(TAB_STUDENTS);
  if (stSh) {
    var stv = stSh.getDataRange().getValues();
    var codeColR = findHeaderCol_(stv[0], '접근코드', STU_CODE_COL);
    for (var s = 1; s < stv.length; s++) {
      var sId = String(stv[s][0] || '').trim();
      var sNm = String(stv[s][1] || '').trim();
      var code = String(stv[s][codeColR] || '').trim();
      if (sId) {
        phoneCount[sId] = (phoneCount[sId] || 0) + 1;
        byPhone[sId] = { code: code, id: sId };
        if (sNm) byPhoneName[sId + '|' + sNm] = { code: code, id: sId };   // 형제 공유번호 구분용
      }
      if (sNm && !byName[sNm]) byName[sNm] = { code: code, id: sId };   // 동명이인은 첫 행만
      // 접미사 제거 이름(이수빈A→이수빈)으로도 찾을 수 있게 — 후보가 여럿이면 번호로 구분
      var bn = baseName_(sNm);
      if (bn && bn !== sNm) { (byBase[bn] = byBase[bn] || []).push({ code: code, id: sId }); }
    }
  }

  var v = sh.getDataRange().getValues();
  // 헤더: 0제출일시 1시험 2학교 3학년 4이름 5틀린문항수 6틀린문항·반성 7다짐 8선생님의한마디 9예상점수 10부모님연락처
  var students = [];
  for (var i = 1; i < v.length; i++) {
    var row = v[i];
    if (!row[4]) continue;
    var examVal = String(row[1]).trim();
    if (reportId && reportId !== 'ALL') {
      if (examVal !== reportId && examVal !== matchTitle) continue;
    }
    var phone = String(row[10] || '').trim();
    var nm = String(row[4] || '').trim();
    // 번호+이름 → 이름 → 번호(그 번호의 학생이 1명일 때만) 순으로 매칭.
    // 형제가 같은 번호를 공유해도 이름으로 구분돼 다른 형제의 링크가 잡히지 않는다.
    var roster = (phone && byPhoneName[phone + '|' + nm])
              || byName[nm]
              || basePick_(byBase[nm], phone)
              || ((phone && phoneCount[phone] === 1) ? byPhone[phone] : null);
    students.push({
      rowIndex: i + 1,
      submittedAt: row[0] ? Utilities.formatDate(new Date(row[0]), 'GMT+9', 'yyyy-MM-dd HH:mm') : '',
      title: String(row[1]||''),
      school: String(row[2]||''),
      grade: String(row[3]||''),
      name: String(row[4]||''),
      wrongCount: row[5] || 0,
      wrongText: String(row[6]||''),
      vow: String(row[7]||''),
      teacherNote: String(row[8]||''),
      score: String(row[9]||''),
      parentPhone: phone,                          // K: 부모님 연락처(010 제외 8자리)
      studentId: roster ? roster.id : phone,       // 학생정보의 학생ID
      accessCode: roster ? roster.code : ''        // 개별 페이지 링크용 토큰
    });
  }
  return json({ result:'success', students: students });
}

/* ===== (6) 학생 개별 페이지 (비밀 링크 + 비밀번호) =====
 *  s.html?key=<접근코드>            → 학생 식별(1차). info(이름·학교·시간표 등)만 반환, 성적은 미포함.
 *  s.html?key=<접근코드>&pw=<번호>  → 비밀번호(=부모님 8자리=학생ID) 일치 시 exams(성적)까지 반환.
 *  (테스트용) ?student=<학생ID> 로도 동일하게 동작. pw 없으면 잠금 상태(authed:false).
 *
 *  '학생정보' 탭 열: 0학생ID(=부모님8자리,비밀번호) 1이름 2학교 3학년 4담당교사 5메모
 *                    6정규가 7정규나 8내신진도 9내신확인 10재원여부 11접근코드(토큰)
 */
var STU_CODE_COL = 11;   // L열: 접근코드(토큰). 헤더로 못 찾으면 이 위치를 사용.

function getStudent(opts) {
  opts = opts || {};
  var key = String(opts.key || '').trim();
  var id  = String(opts.id  || '').trim();
  var pw  = String(opts.pw  || '').trim();
  if (!key && !id) return json({ result:'error', message:'학생 식별 정보가 없습니다.' });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sv = tabValues_(ss, TAB_STUDENTS);
  if (!sv) return json({ result:'error', message:"'" + TAB_STUDENTS + "' 탭이 없습니다." });
  var codeCol = findHeaderCol_(sv[0], '접근코드', STU_CODE_COL);

  // 학생 행 찾기 (토큰 우선, 없으면 학생ID)
  var r = null;
  for (var i = 1; i < sv.length; i++) {
    var matchRow = key ? (String(sv[i][codeCol] || '').trim() === key)
                       : (String(sv[i][0] || '').trim() === id);
    if (matchRow) { r = sv[i]; break; }
  }
  if (!r) return json({ result:'error', message: key ? '유효하지 않은 링크입니다.' : '학생을 찾을 수 없습니다.' });

  var sid = String(r[0] || '').trim();   // 학생ID(=부모님 8자리)=비밀번호
  var info = {
    id:       sid,
    name:     String(r[1]  || '').trim(),
    school:   String(r[2]  || ''),
    grade:    String(r[3]  || ''),
    teacher:  String(r[4]  || ''),
    memo:     String(r[5]  || ''),
    classA:   String(r[6]  || ''),
    classB:   String(r[7]  || ''),
    progress: String(r[8]  || ''),
    checkup:  String(r[9]  || ''),
    enrolled: String(r[10] || '')
  };

  // 형제 구분: 같은 부모님 8자리(=학생ID)를 가진 학생이 2명 이상이면 '공유 번호'.
  // 이 경우 성적 매칭에 이름까지 확인해 형제 기록이 섞이지 않게 한다.
  var shareCount = 0;
  for (var s2 = 1; s2 < sv.length; s2++) {
    if (String(sv[s2][0] || '').trim() === sid) shareCount++;
  }
  var siblingShared = shareCount > 1;

  // 동명이인 여부: 접미사를 뗀 이름(이승준A→이승준)이 같은 재원 학생이 2명 이상이면 true.
  // 모의고사 신청·성적 조회에서 '이름이 유일하면 8자리 오타가 있어도 매칭'하기 위한 신호
  // (신청서·OMR에 번호를 잘못 적는 경우가 있어, 동명이인일 때만 ID를 엄격 대조).
  // 접미사 등록(이승준A/B/C)도 실명 제출 기록은 '이승준'으로 오므로 같은 가족으로 센다.
  var myBase = baseName_(info.name), nameDupCount = 0;
  for (var n3 = 1; n3 < sv.length; n3++) {
    var rn3 = String(sv[n3][1] || '').trim();
    if (!rn3 || baseName_(rn3) !== myBase) continue;
    if (/^(퇴원|n|no|off|x|중단|비재원)$/i.test(String(sv[n3][10] || '').trim())) continue;
    nameDupCount++;
  }
  info.nameDup = nameDupCount > 1;

  // 비밀번호 검증: 입력값이 학생ID(부모님 8자리)와 일치해야 성적 공개
  var pwTried = pw !== '';
  var authed  = pwTried && pw === sid;

  var resp = { result:'success', info: info, authed: authed, pwTried: pwTried };
  // 알려드립니다: 이 학생에게 해당하는 공지(비밀번호 없이 key만으로 표시)
  resp.notices = collectNotices_(ss, info, key);
  // 배정된 H WORK: 이 학생에게 배정된 과제만 (학생 개인 페이지용)
  resp.homework = collectAssignments_(ss, info, key, 'H WORK');
  // 제출 여부 표시: H WORK '제출기록'과 대조해 각 과제에 done을 붙인다
  var hwDone = hworkDoneSet_(info.name, String(info.school || '').trim(), String(info.grade || ''));
  resp.homework.forEach(function(h){
    var t = String(h.teacher || '').trim(), c = String(h.code || '').trim();
    h.done = !!(hwDone.byKey[t + '|' + c] || (!t && hwDone.byCode[c]));
  });
  // 지필고사 분석지: 배정(전체/학년/개인/일부) 또는 학교·학년 일치 시험만(최신순). done=복기 제출 여부
  resp.analyses = collectAnalyses_(ss, info, key);
  // 클리닉 신청: 이 학생의 신청 내역 목록(토큰, 토큰 없는 옛 행은 학생ID로 매칭. 없거나 실패 시 null)
  resp.clinic = collectClinic_(key, info.id);
  // 주말 모의고사: 이번 주 신청 내역 — 학생 페이지가 신청 서버를 따로 부르지 않아도 되도록
  // 리포트 응답에 함께 담는다 (실패 시 null → 학생 페이지가 기존 직접 조회로 폴백)
  resp.mockSignups = collectMockSignups_(info);
  // 숙제 검사: 주차별 점수 %와 공개 메모 (비공개 메모는 절대 포함하지 않음)
  resp.hwcheck = collectHwchecks_(ss, key);
  // 슈퍼스타 별: 총 별 개수 + 출처별 내역 + 최근 깜짝 보너스
  resp.stars = collectStars_(ss, info, key, siblingShared);
  // 어휘 테스트 켜짐/꺼짐 (설정 탭의 '어휘 테스트' 값. 기본 열림)
  resp.vocaOpen = configOpen_(ss, '어휘 테스트', true);
  // 어휘 주차: 교사가 연 주차(없으면 null → 학생 카드 준비 중)
  var vwk = configVal_(ss, '어휘 주차', '');
  resp.vocaWeek = vwk ? parseInt(vwk, 10) : null;
  if (authed) {
    var exams = collectExams_(ss, sid, info.name, siblingShared, String(info.school || '').trim(), !info.nameDup, String(info.grade || ''));
    // 각 시험에 보고서 상세(시험범위·총평·문항)를 붙여 PDF/HTML 리포트와 동일하게 표시
    var idx = getReportsIndex_(ss);
    exams.forEach(function(x){
      var key = String(x.title || '').trim();
      var rep = idx.byTitle[key] || idx.byId[key] || null;
      x.scope     = rep ? rep.scope : '';
      x.review    = rep ? rep.review : [];
      x.questions = rep ? rep.questions : [];
    });
    resp.exams = exams;
  } else {
    resp.examCount = countExams_(ss, sid, info.name, siblingShared, String(info.school || '').trim());   // 잠금 상태에선 개수만 안내
  }
  return json(resp);
}

/** '보고서목록'+'문항'을 한 번에 읽어 제목/ID로 조회 가능한 인덱스 생성. */
function getReportsIndex_(ss) {
  var byId = {}, byTitle = {};
  var lv = tabValues_(ss, TAB_LIST);
  if (lv) {
    for (var i = 1; i < lv.length; i++) {
      var id = String(lv[i][0] || '').trim();
      if (!id) continue;
      var rec = {
        id: id,
        title: String(lv[i][1] || '').trim(),
        review: String(lv[i][2] || '').split(/\n\s*\n/).map(function(s){return s.trim();}).filter(Boolean),
        scope: String(lv[i][3] || ''),
        questions: []
      };
      byId[id] = rec;
      if (rec.title) byTitle[rec.title] = rec;
    }
  }
  var iv = tabValues_(ss, TAB_ITEMS);
  if (iv) {
    for (var j = 1; j < iv.length; j++) {
      var rid = String(iv[j][0] || '').trim();
      if (!byId[rid]) continue;
      byId[rid].questions.push({
        no:   String(iv[j][1]||''),
        area: String(iv[j][2]||''),
        type: String(iv[j][3]||''),
        lv:   String(iv[j][4]||'').trim(),
        txt:  String(iv[j][5]||''),
        detail: String(iv[j][6]||''),
        group:  String(iv[j][7]||''),
        multi:  isMulti_(iv[j][8])
      });
    }
  }
  return { byId: byId, byTitle: byTitle };
}

/** 제출결과 행 매칭 규칙 — collectExams_와 압축 색인(countExams_)이 완전히 같은 판정을 쓴다. */
function examRowMatch_(phone, nm, rsc, rgdRaw, sid, name, strictName, school, uniq, myGd) {
  // 동명이인(uniq=false): 기록의 번호가 본인 번호와 다르면 다른 학생의 것으로 보고 제외.
  if (!uniq && phone && sid && phone !== sid) return false;
  var nameSchoolOk = (nm === name || (nm !== '' && nm === baseName_(name))) && (uniq || !rsc || !school || schoolMatch_(rsc, school));
  var match;
  if (strictName) {
    match = phone ? ((phone === sid && nm === name) || nameSchoolOk) : (nm === name);
  } else {
    match = (phone && phone === sid) || nameSchoolOk;
  }
  if (!match) return false;
  // 학년 모순 차단: 번호가 정확히 일치하지 않는 기록이 학년까지 다르면 다른 동명이인의 것
  if (!(phone && sid && phone === sid) && myGd) {
    var rGd = gradeDigit_(rgdRaw);
    if (rGd && rGd !== myGd) return false;
  }
  return true;
}

/** 제출결과 압축 색인 — [시험명, 학교, 학년, 이름, 번호]만 뽑아 60초 캐시.
 *  잠금 전 화면(별 집계·기록 개수)은 이 색인만 쓰므로 큰 제출결과 탭을 매번 읽지 않는다.
 *  (비밀번호 입력 후 상세 조회는 기존대로 전체를 읽는다 — 새 제출 즉시 반영) */
function examIndex_(ss) {
  var mk = 'snap:examIdx';
  if (MEMO_[mk]) return MEMO_[mk];
  try {
    var hit = CacheService.getScriptCache().get('examIdx');
    if (hit) return (MEMO_[mk] = JSON.parse(hit));
  } catch (e) {}
  var rows = [];
  var v = tabValues_(ss, TAB_RESULT);
  if (v) for (var i = 1; i < v.length; i++) {
    if (!v[i][4]) continue;
    rows.push([String(v[i][1] || ''), String(v[i][2] || '').trim(),
               String(v[i][3] == null ? '' : v[i][3]), String(v[i][4] || '').trim(),
               String(v[i][10] || '').trim()]);
  }
  try { CacheService.getScriptCache().put('examIdx', JSON.stringify(rows), 60); } catch (e) {}
  return (MEMO_[mk] = rows);
}
function dropExamIdx_() {
  delete MEMO_['snap:examIdx'];
  try { CacheService.getScriptCache().remove('examIdx'); } catch (e) {}
}

/** 제출결과에서 이 학생의 시험 기록을 모은다(최신순).
 *  기본: 부모님번호 매칭(옛 기록은 이름 보조). 단 strictName=true(형제가 같은 번호 공유)면
 *  번호가 같아도 이름까지 일치해야 인정 → 형제 성적이 섞이지 않는다.
 *  uniq=true(이름이 명단에서 유일)면 학교 표기 차이(오타 등)가 있어도 인정 — TOP10 순위와 동일 규칙.
 *  단, 기록의 학년이 학생의 학년(grade)과 모순되면 명단 밖 동명이인으로 보고 불인정
 *  (번호가 정확히 일치하는 기록은 본인 확실 → 예외). */
function collectExams_(ss, sid, name, strictName, school, uniq, grade) {
  var myGd = gradeDigit_(grade);
  var exams = [];
  var rv = tabValues_(ss, TAB_RESULT);
  if (rv) {
    // 0제출일시 1시험 2학교 3학년 4이름 5틀린문항수 6틀린문항·반성 7다짐 8선생님의한마디 9예상점수 10부모님연락처
    for (var j = 1; j < rv.length; j++) {
      var row = rv[j];
      if (!row[4]) continue;
      var phone = String(row[10] || '').trim();
      var nm    = String(row[4]  || '').trim();
      var rsc   = String(row[2]  || '').trim();
      if (!examRowMatch_(phone, nm, rsc, row[3], sid, name, strictName, school, uniq, myGd)) continue;
      exams.push({
        submittedAt: row[0] ? Utilities.formatDate(new Date(row[0]), 'GMT+9', 'yyyy-MM-dd HH:mm') : '',
        title:       String(row[1] || ''),
        school:      String(row[2] || ''),
        grade:       String(row[3] || ''),
        wrongCount:  row[5] || 0,
        wrongText:   String(row[6] || ''),
        vow:         String(row[7] || ''),
        teacherNote: String(row[8] || ''),
        score:       String(row[9] || '')
      });
    }
  }
  exams.sort(function(a, b){ return a.submittedAt < b.submittedAt ? 1 : (a.submittedAt > b.submittedAt ? -1 : 0); });
  return exams;
}

function countExams_(ss, sid, name, strictName, school, uniq, grade) {
  // 시험명 단위 중복 제거 — 같은 리포트를 여러 번 제출해도 별은 시험당 1회분(×2)만.
  // 압축 색인 사용(60초 캐시) — 잠금 전 화면에서 큰 제출결과 탭을 매번 읽지 않는다.
  var myGd = gradeDigit_(grade);
  var idx = examIndex_(ss);
  var set = {};
  for (var i = 0; i < idx.length; i++) {
    var r = idx[i];   // [시험명, 학교, 학년, 이름, 번호]
    if (!examRowMatch_(r[4], r[3], r[1], r[2], sid, name, strictName, school, uniq, myGd)) continue;
    var t = r[0].replace(/\s+/g, '');
    set[t || ('r' + i)] = true;
  }
  return Object.keys(set).length;
}

/* ===== 알려드립니다(공지) =====
 *  '공지' 탭에서 이 학생에게 해당하는 공지만 골라 최신순으로 반환.
 *  열(헤더로 찾고, 없으면 A~F 고정): A작성일 B대상유형 C대상 D제목 E내용 F게시
 *  대상유형:  전체 → 모든 학생 / 학년 → C열 학년과 일치 / 개인·일부 → C열 명단(이름·ID·접근코드)에 포함
 *  게시: 'N'·'숨김'·'off'·'x'면 숨김, 그 외(빈칸 포함)는 노출
 */
function collectNotices_(ss, info, key) {
  var v = tabValues_(ss, TAB_NOTICE);
  if (!v || v.length < 2) return [];

  var H = v[0];
  var cDate  = findHeaderCol_(H, '작성일',   0);
  var cType  = findHeaderCol_(H, '대상유형', 1);
  var cTarget= findHeaderCol_(H, '대상',     2);
  var cTitle = findHeaderCol_(H, '제목',     3);
  var cBody  = findHeaderCol_(H, '내용',     4);
  var cShow  = findHeaderCol_(H, '게시',     5);

  var stu = {
    sid:    String(info.id     || '').trim(),
    name:   String(info.name   || '').trim(),
    grade:  String(info.grade  || '').trim(),
    school: String(info.school || '').trim(),
    code:   String(key         || '').trim()
  };

  var out = [];
  for (var i = 1; i < v.length; i++) {
    var row = v[i];
    var title = String(row[cTitle] || '').trim();
    var body  = String(row[cBody]  || '').trim();
    if (!title && !body) continue;

    var show = String(row[cShow] || '').trim().toLowerCase();
    if (show === 'n' || show === 'no' || show === '숨김' || show === 'off' || show === 'x') continue;

    var type   = String(row[cType]   || '').trim();
    var target = String(row[cTarget] || '').trim();
    if (!noticeMatches_(type, target, stu)) continue;

    var d = row[cDate], dateStr = '';
    if (d) {
      try { dateStr = Utilities.formatDate(new Date(d), 'GMT+9', 'yyyy-MM-dd'); }
      catch (e) { dateStr = String(d).trim(); }
    }
    out.push({ date: dateStr, type: type, title: title, body: body, _row: i });
  }

  // 최신순: 작성일 내림차순, 같으면 시트에서 나중에 입력한 행이 위로
  out.sort(function(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b._row - a._row;
  });
  out.forEach(function(o) { delete o._row; });

  // 확인 여부 표시 — '확인했습니다' 버튼(1건당 별 1개)용
  var checks = readNoticeChecks_(ss, stu.sid, stu.name, stu.school, info.nameDup === false);   // 유일 이름일 때만 완화
  out.forEach(function(o) { o.key = noticeKey_(o.date, o.title); o.checked = !!checks[o.key]; });
  return out;
}

/* ===== 배정된 항목(도구별) 조회 ===== 학생 개인 페이지(s.html)
 *  '배정' 탭에서 이 학생에게 해당하는 항목만(공지와 동일한 noticeMatches_ 규칙) 최신순 반환.
 *  열: A작성일 B도구 C항목 D대상유형 E대상 F마감 G비고.  항목 "강사 / 제목" → teacher·code로 분리.
 */
function collectAssignments_(ss, info, key, tool) {
  var v = tabValues_(ss, TAB_ASSIGN);
  if (!v || v.length < 2) return [];

  var H = v[0];
  var cDate  = findHeaderCol_(H, '작성일',   0);
  var cTool  = findHeaderCol_(H, '도구',     1);
  var cItem  = findHeaderCol_(H, '항목',     2);
  var cType  = findHeaderCol_(H, '대상유형', 3);
  var cTarget= findHeaderCol_(H, '대상',     4);
  var cDue   = findHeaderCol_(H, '마감',     5);
  var cMemo  = findHeaderCol_(H, '비고',     6);

  var stu = {
    sid:    String(info.id     || '').trim(),
    name:   String(info.name   || '').trim(),
    grade:  String(info.grade  || '').trim(),
    school: String(info.school || '').trim(),
    code:   String(key         || '').trim()
  };

  var out = [];
  for (var i = 1; i < v.length; i++) {
    var row = v[i];
    if (tool && String(row[cTool] || '').trim() !== tool) continue;
    var type   = String(row[cType]   || '').trim();
    var target = String(row[cTarget] || '').trim();
    if (!noticeMatches_(type, target, stu)) continue;

    var item = String(row[cItem] || '').trim();
    var teacher = '', code = item, idx = item.indexOf(' / ');
    if (idx >= 0) { teacher = item.slice(0, idx).trim(); code = item.slice(idx + 3).trim(); }

    out.push({
      teacher: teacher, code: code, item: item,
      due:  fmtCellDate_(row[cDue]),
      memo: String(row[cMemo] || '').trim(),
      date: fmtCellDate_(row[cDate]),
      _row: i
    });
  }
  out.sort(function(a, b){ if (a.date !== b.date) return a.date < b.date ? 1 : -1; return b._row - a._row; });
  out.forEach(function(o){ delete o._row; });
  return out;
}

/** 날짜 셀을 yyyy-MM-dd 문자열로 (빈값·문자열도 안전) */
function fmtCellDate_(d) {
  if (!d) return '';
  try { return (d instanceof Date) ? Utilities.formatDate(d, 'GMT+9', 'yyyy-MM-dd') : String(d).trim(); }
  catch (e) { return String(d).trim(); }
}

/** 공지 한 건이 이 학생에게 해당하는지 판단. */
function noticeMatches_(type, target, stu) {
  type   = String(type   || '').trim();
  target = String(target || '').trim();

  // 전체 (유형이 '전체'이거나, 유형·대상이 모두 비어 있으면 전체로 간주)
  if (type.indexOf('전체') >= 0) return true;
  if (type === '' && target === '') return true;

  // 대상 명단을 토큰으로 분리 (쉼표·줄바꿈·세미콜론·슬래시·가운뎃점·공백 구분)
  var tokens = target.split(/[,\n;\/·\s]+/).map(function(s){ return s.trim(); }).filter(Boolean);
  if (!tokens.length) return false;

  // 학년: 학생의 학년이 대상 토큰과 일치.
  // ⚠️ 공백을 구분자로 쓰면 '2026 고등 2학년'이 ['2026','고등','2학년']으로 쪼개져
  //    '2026'·'고등'이 전 학년에 부분일치 → 전 학년 노출 버그 (2026-07 수정).
  //    학년 토큰은 쉼표류로만 나누고, 학년 숫자·중/고가 모순되는 토큰은 제외한다.
  if (type.indexOf('학년') >= 0) {
    var g  = stu.grade.replace(/\s+/g, '');
    var sg = (stu.school + stu.grade).replace(/\s+/g, '');
    var gd = gradeDigit_(stu.grade);
    var lvS = /중/.test(g) ? '중' : (/고/.test(g) ? '고' : '');
    var gTokens = target.split(/[,\n;\/·]+/).map(function(s){ return s.trim(); }).filter(Boolean);
    return gTokens.some(function(t){
      var tt = t.replace(/\s+/g, '');
      if (!tt) return false;
      var td = gradeDigit_(tt);
      if (td && gd && td !== gd) return false;                    // 학년 숫자 모순 → 제외
      var lvT = /중/.test(tt) ? '중' : (/고/.test(tt) ? '고' : '');
      if (lvT && lvS && lvT !== lvS) return false;                // 중·고 모순 → 제외
      return tt === g || sg.indexOf(tt) >= 0 || g.indexOf(tt) >= 0;
    });
  }

  // 개인 · 일부 (그 외 유형 포함): 이름·ID·접근코드 중 하나라도 일치하면 노출.
  // 동명이인 구분 토큰 '이름|학교|학년' (student-picker가 이름이 겹칠 때 저장)은
  // 이름 + 학교(느슨 비교) + 학년까지 모두 맞아야 노출된다.
  return tokens.some(function(t){
    if (t.indexOf('|') >= 0) {
      var p = t.split('|');
      var tn = (p[0] || '').trim(), ts = (p[1] || '').trim(), tg = (p[2] || '').trim();
      if (!tn || tn !== stu.name) return false;
      if (ts && stu.school && !schoolMatch_(ts, stu.school)) return false;
      if (tg && stu.grade && tg.replace(/\s+/g, '') !== stu.grade.replace(/\s+/g, '')) return false;
      return true;
    }
    return t === stu.name || t === stu.sid || t === stu.code;
  });
}

/* ===== 클리닉 신청 조회 =====
 *  별도 스프레드시트(CLINIC_SHEET_ID)의 '응답' 탭에서 이 학생(토큰)의 신청을 찾아
 *  최근 신청 1건과 총 신청 수를 반환. '토큰' 열이 아직 없으면(클리닉 미배포) null.
 *  같은 제출시각+시간대는 한 '신청'으로 묶고, 요청 줄 수를 센다.
 */
function collectClinic_(token, sid) {
  token = String(token || '').trim();
  sid   = String(sid   || '').trim();
  if (!token && !sid) return null;
  var snap = clinicSnap_();
  if (!snap.ok || !snap.rows.length) return null;   // 권한·접근 실패 시 조용히 건너뜀(학생 페이지는 정상 동작)

  var apps = {};   // key: 제출시각|시간 → { date, time, count, requests, memo }
  for (var i = 0; i < snap.rows.length; i++) {
    var r = snap.rows[i];
    var tk = r[0].trim();
    var id = r[1].replace(/^'/, '').trim();
    // 토큰이 기록된 행은 토큰으로만, 토큰 없는 행(직접 링크·옛 신청)은 학생ID로 매칭
    // (countClinicApps_와 동일 규칙 — 쌍둥이는 학생ID가 같아 토큰 행을 ID로 잡으면 형제 신청까지 섞임)
    var match = tk ? (token && tk === token) : (sid && id === sid);
    if (!match) continue;
    var date = r[4];
    var time = r[2].trim();
    var k = date + '|' + time;
    if (!apps[k]) apps[k] = { date: date, time: time, count: 0, requests: [], memo: '' };
    apps[k].count++;
    var req = { type: r[5] || '', area: r[6] || '', content: r[7] || '', qcount: r[8] || '' };
    if (req.type || req.area || req.content) apps[k].requests.push(req);
    if (!apps[k].memo && r[9]) apps[k].memo = r[9];
  }
  var list = Object.keys(apps).map(function (k) { return apps[k]; });
  if (!list.length) return null;
  list.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });

  return { latest: list[0], total: list.length, list: list.slice(0, 20) };
}

/* ===== 지필고사 분석지(학생 개별 페이지) =====
 *  교사가 '배정'한 학생에게만 해당 분석지를 최신순으로 반환.
 *  배정은 '배정' 탭(도구=지필고사 분석지, 항목=시험ID)에 기록되며, 공지와 동일한
 *  noticeMatches_ 규칙(전체/학년/개인/일부)으로 이 학생 해당 여부를 판단한다.
 *  (학교+학년 자동배정은 선택과목 차이로 오배정 위험이 있어 사용하지 않는다.)
 *  각 시험에 done(이 학생이 이미 복기를 제출했는지)을 표시 → '복기 입력하기'/'입력 완료' 구분.
 */
function collectAnalyses_(ss, info, key) {
  var av = tabValues_(ss, TAB_ASSIGN);
  if (!av || av.length < 2) return [];

  var stu = {
    sid:    String(info.id     || '').trim(),
    name:   String(info.name   || '').trim(),
    grade:  String(info.grade  || '').trim(),
    school: String(info.school || '').trim(),
    code:   String(key         || '').trim()
  };

  var AH = av[0];
  var acTool  = findHeaderCol_(AH, '도구',     1);
  var acItem  = findHeaderCol_(AH, '항목',     2);
  var acType  = findHeaderCol_(AH, '대상유형', 3);
  var acTarget= findHeaderCol_(AH, '대상',     4);

  // 이 학생에게 배정된 분석지 ID (중복 제거)
  var assigned = {};
  for (var a = 1; a < av.length; a++) {
    if (String(av[a][acTool] || '').trim() !== ANALYSIS_TOOL) continue;
    var itemId = String(av[a][acItem] || '').trim();
    if (!itemId || assigned[itemId]) continue;
    if (noticeMatches_(String(av[a][acType]||''), String(av[a][acTarget]||''), stu)) assigned[itemId] = true;
  }
  if (!Object.keys(assigned).length) return [];

  // 보고서목록에서 제목 조회
  var titleById = {};
  var lv = tabValues_(ss, TAB_LIST);
  if (lv) {
    for (var i = 1; i < lv.length; i++) {
      var lid = String(lv[i][0] || '').trim();
      if (lid) titleById[lid] = String(lv[i][1] || '').trim();
    }
  }

  var done = submittedTitles_(ss, info);   // 이 학생이 제출한 시험(제목·ID) 집합
  var order = getListOrder_(ss);           // 보고서목록 등록 순서(최신순 정렬용)

  var out = [];
  Object.keys(assigned).forEach(function(id){
    var title = titleById[id] || id;
    out.push({
      id: id,
      title: title,
      done: !!(done[id] || (title && done[title])),
      _ord: (typeof order[id] === 'number') ? order[id] : -1
    });
  });
  // 최신순: 보고서목록에서 나중에 등록된 것이 위로
  out.sort(function(a, b){ return b._ord - a._ord; });
  out.forEach(function(o){ delete o._ord; });
  return out;
}

/** 보고서목록에서 각 ID의 행 위치(등록 순서)를 반환 { id: rowIndex }. 최신순 정렬용. */
function getListOrder_(ss) {
  var order = {};
  var lv = tabValues_(ss, TAB_LIST);
  if (!lv) return order;
  for (var i = 1; i < lv.length; i++) {
    var id = String(lv[i][0] || '').trim();
    if (id) order[id] = i;
  }
  return order;
}

/** 이 학생이 '제출결과'에 복기를 낸 시험(제목·ID)의 집합을 만든다.
 *  매칭: 부모님번호(K)=학생ID 또는 이름(E)=학생 이름. 값은 시험명(제출결과 B열). */
function submittedTitles_(ss, info) {
  var set = {};
  var sid  = String(info.id   || '').trim();
  var name = String(info.name || '').trim();
  var idx = examIndex_(ss);   // 압축 색인(60초 캐시)
  for (var i = 0; i < idx.length; i++) {
    var phone = idx[i][4], nm = idx[i][3];
    var match = (phone && phone === sid) || (nm && (nm === name || nm === baseName_(name)));
    if (!match) continue;
    var t = idx[i][0].trim();   // 시험명(=제목 또는 ID)
    if (t) set[t] = true;
  }
  return set;
}

/** 학년 문자열을 '고1/고2/고3/중1..' 형태로 정규화.
 *  "2026 고등 1학년"→"고1", "고3"→"고3", "1"→"" (학교급 불명은 빈값). */
function normGrade_(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return '';
  var m = s.match(/(고|중|초)\s*([1-6])/);   // "고3","중2" 등
  if (m) return m[1] + m[2];
  // "고등학교 1학년" / "고등 1학년"
  if (/고/.test(s)) { var g = s.match(/([1-3])\s*학?년?/); if (g) return '고' + g[1]; }
  if (/중/.test(s)) { var g2 = s.match(/([1-3])\s*학?년?/); if (g2) return '중' + g2[1]; }
  return '';
}

/* ===== 숙제 검사 (정규 수업 기간) ===== hwcheck.html
 *  조교·교사가 수업 중 학생별로 항목(기본: 숙제 수행·오답 처리)마다 별 0~6개를 매기면
 *  %로 환산한 주차 점수가 기록된다. 공개 메모는 학생 개별 페이지에 보이고,
 *  비공개 메모는 교사 화면에만 보인다. 주차 키 = 그 주 월요일(yyyy-MM-dd).
 */
function hwcheckSheet_(ss) {
  var sh = ss.getSheetByName(TAB_HWCHECK);
  if (!sh) {
    sh = ss.insertSheet(TAB_HWCHECK);
    sh.appendRow(['일시', '주차', '접근코드', '이름', '학교', '학년', '항목점수(JSON)', '만점', '점수%', '공개메모', '비공개메모', '상태', '대책', '대책완료']);
    sh.getRange(1, 1, 1, 14).setFontWeight('bold').setBackground('#DDE5E1');
  }
  return sh;
}
/** 검사 항목 목록 — '설정' 탭 '숙제검사 항목'(쉼표 구분), 없으면 기본 2개 */
function hwcheckItems_(ss) {
  var raw = configVal_(ss, HWCHECK_ITEMS_KEY, '');
  var items = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  return items.length ? items : HWCHECK_DEFAULT_ITEMS.slice();
}
/** 주차 셀 값 정규화 — 시트가 'yyyy-MM-dd'를 날짜 값으로 바꿔둔 경우도 문자열로 통일 */
function hwcheckWeekStr_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, 'GMT+9', 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}
/** 정규 수업 주차 키 — 수요일 시작(수목토일 단위 주), 그 주 수요일 yyyy-MM-dd */
function hwcheckWeekKey_(d) {
  var dt = (d instanceof Date) ? new Date(d.getTime()) : new Date();
  dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() - ((dt.getDay() + 4) % 7));   // 수요일(3)로부터 지난 날 수
  return Utilities.formatDate(dt, 'GMT+9', 'yyyy-MM-dd');
}
/** 주차별 기록·항목 조회 (교사 화면). 비공개 메모 포함 — pw 확인 뒤에만 호출된다. */
function getHwcheckData(weekParam) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var week = String(weekParam || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) week = hwcheckWeekKey_(new Date());
  var records = {};
  var v = tabValues_(ss, TAB_HWCHECK);
  if (v) for (var i = 1; i < v.length; i++) {
    if (hwcheckWeekStr_(v[i][1]) !== week) continue;
    var tok = String(v[i][2] || '').trim();
    if (!tok) continue;
    var scores = {}; try { scores = JSON.parse(v[i][6] || '{}'); } catch (e) {}
    records[tok] = { scores: scores, pct: Number(v[i][8]) || 0,
                     pub: String(v[i][9] || ''), priv: String(v[i][10] || ''),
                     missing: String(v[i][11] || '').trim() === '미제출',
                     plan: String(v[i][12] || '') };   // 뒤 행이 최신(같은 키 중복 대비)
  }
  return json({ result: 'success', week: week, items: hwcheckItems_(ss), records: records });
}
/** 한 학생의 주차 기록 저장(덮어쓰기). { pw, week, token, name, school, grade, scores:{항목:0~6}, pub, priv } */
function hwcheckSave(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result: 'error', message: 'unauthorized' });
  var week = String(data.week || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return json({ result: 'error', message: '주차가 올바르지 않습니다.' });
  var token = String(data.token || '').trim();
  if (!token) return json({ result: 'error', message: '학생 식별 정보(접근코드)가 없습니다.' });
  var scores = {}, sum = 0, n = 0;
  var raw = (data.scores && typeof data.scores === 'object') ? data.scores : {};
  Object.keys(raw).forEach(function (k) {
    var name = String(k).trim(); if (!name) return;
    var s = parseInt(raw[k], 10); if (isNaN(s)) s = 0;
    s = Math.max(0, Math.min(HWCHECK_STARS_MAX, s));
    scores[name] = s; sum += s; n++;
  });
  if (!n) return json({ result: 'error', message: '검사 항목 점수가 없습니다.' });
  var missing = (data.missing === true || data.missing === '1');
  var full = n * HWCHECK_STARS_MAX;
  var pct = missing ? 0 : Math.round(sum / full * 100);   // 미제출은 0%
  // 주차는 "'" 접두로 텍스트 저장 — 시트가 날짜 값으로 바꿔 조회가 어긋나는 것 방지
  var row = [new Date(), "'" + week, token, String(data.name || '').trim(), String(data.school || '').trim(),
             String(data.grade || '').trim(), JSON.stringify(scores), full, pct,
             String(data.pub || ''), String(data.priv || ''),
             missing ? '미제출' : '', String(data.plan || '')];
  var lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (e) { return json({ result: 'error', message: '잠시 후 다시 시도해 주세요.' }); }
  try {
    var sh = hwcheckSheet_(SpreadsheetApp.getActiveSpreadsheet());
    var at = -1, last = sh.getLastRow();
    if (last > 1) {
      var keys = sh.getRange(2, 2, last - 1, 2).getValues();   // B주차·C접근코드만 읽어 가볍게 탐색
      for (var i = 0; i < keys.length; i++) {
        if (hwcheckWeekStr_(keys[i][0]) === week && String(keys[i][1] || '').trim() === token) { at = i + 2; break; }
      }
    }
    row.push(at > 0 ? String(sh.getRange(at, 14).getValue() || '') : '');   // N대책완료는 저장 시 유지 (완료 표시는 별도 API)
    if (at > 0) sh.getRange(at, 1, 1, 14).setValues([row]);
    else sh.appendRow(row);
    dropTab_(TAB_HWCHECK);
    return json({ result: 'success', week: week, pct: pct });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
/** 검사 항목 목록 변경. { pw, items: ['숙제 수행', ...] } (항목 이름에 쉼표는 쓸 수 없음) */
function hwcheckSetItems(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result: 'error', message: 'unauthorized' });
  var items = (Array.isArray(data.items) ? data.items : []).map(function (s) {
    return String(s || '').replace(/,/g, ' ').trim();
  }).filter(Boolean);
  if (!items.length) return json({ result: 'error', message: '항목이 비어 있습니다.' });
  if (items.length > 8) return json({ result: 'error', message: '항목은 8개까지만 둘 수 있어요.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setConfig_(ss, HWCHECK_ITEMS_KEY, items.join(', '));
  return json({ result: 'success', items: items });
}
/** 미제출 대책 목록(전 주차) — 미제출이거나 대책이 적힌 기록을 최신 주차부터 반환. */
function getHwcheckPlans() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var v = tabValues_(ss, TAB_HWCHECK);
  var out = [];
  if (v) for (var i = 1; i < v.length; i++) {
    var missing = String(v[i][11] || '').trim() === '미제출';
    var plan = String(v[i][12] || '').trim();
    if (!missing && !plan) continue;
    out.push({ week: hwcheckWeekStr_(v[i][1]), token: String(v[i][2] || '').trim(),
               name: String(v[i][3] || '').trim(), school: String(v[i][4] || '').trim(),
               grade: String(v[i][5] || '').trim(), plan: plan, missing: missing,
               done: String(v[i][13] || '').trim() === '완료' });
  }
  out.sort(function (a, b) { return a.week < b.week ? 1 : (a.week > b.week ? -1 : a.name.localeCompare(b.name, 'ko')); });
  return json({ result: 'success', plans: out });
}
/** 대책 완료/취소 표시. { pw, week, token, done: '1'|'0' } */
function hwcheckPlanDone(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result: 'error', message: 'unauthorized' });
  var week = String(data.week || '').trim(), token = String(data.token || '').trim();
  if (!week || !token) return json({ result: 'error', message: '기록 식별 정보가 없습니다.' });
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_HWCHECK);
  if (!sh) return json({ result: 'error', message: '기록이 없습니다.' });
  var last = sh.getLastRow();
  var keys = last > 1 ? sh.getRange(2, 2, last - 1, 2).getValues() : [];
  for (var i = 0; i < keys.length; i++) {
    if (hwcheckWeekStr_(keys[i][0]) === week && String(keys[i][1] || '').trim() === token) {
      sh.getRange(i + 2, 14).setValue(String(data.done || '') === '1' ? '완료' : '');
      dropTab_(TAB_HWCHECK);
      return json({ result: 'success' });
    }
  }
  return json({ result: 'error', message: '기록을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.' });
}
/** 학생 개별 페이지용 — 주차별 점수 %·항목 점수·공개 메모(최신순 20주). 비공개 메모 제외. */
function collectHwchecks_(ss, key) {
  key = String(key || '').trim();
  if (!key) return [];
  var v = tabValues_(ss, TAB_HWCHECK);
  if (!v) return [];
  var byWeek = {};
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][2] || '').trim() !== key) continue;
    var wk = hwcheckWeekStr_(v[i][1]);
    if (!wk) continue;
    var scores = {}; try { scores = JSON.parse(v[i][6] || '{}'); } catch (e) {}
    byWeek[wk] = { week: wk, pct: Number(v[i][8]) || 0, scores: scores, pub: String(v[i][9] || '').trim(),
                   missing: String(v[i][11] || '').trim() === '미제출' };   // 대책(M열)은 교사용 — 학생에겐 보내지 않음
  }
  return Object.keys(byWeek).sort().reverse().slice(0, 20).map(function (k) { return byWeek[k]; });
}
/** 만점(100%) 주차 수 — 슈퍼스타 별 집계용 */
function countHwcheckPerfect_(ss, key) {
  var list = collectHwchecks_(ss, key);
  var n = 0;
  for (var i = 0; i < list.length; i++) { if (list[i].pct >= 100) n++; }
  return n;
}

/** 학교명 느슨한 일치: 공백 제거 후 완전 일치 또는 한쪽이 다른 쪽을 포함(예: "화정고"↔"화정고등학교"). */
/* ===== 슈퍼스타 TOP 10 순위 ===== star.html
 *  전 재원생의 별을 시트별 1회 읽기로 집계해 상위 10명을 반환.
 *  매칭 규칙은 학생 개인 페이지와 동일: 번호+이름 → 이름(명단에서 유일하면 학교 오타 무관 인정,
 *  동명이인은 학생ID→학교로 구분) → 접미사 이름 → 고유 번호.
 */
function getStarRanking() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stSh = ss.getSheetByName(TAB_STUDENTS);
  if (!stSh) return json({ result:'error', message:"'" + TAB_STUDENTS + "' 탭이 없습니다." });
  var sv = stSh.getDataRange().getValues();
  var codeCol = findHeaderCol_(sv[0], '접근코드', STU_CODE_COL);
  var stus = [], byIdName = {}, byName = {}, byBase = {}, byId = {}, idCount = {}, byToken = {};
  for (var i = 1; i < sv.length; i++) {
    var nm = String(sv[i][1] || '').trim();
    if (!nm) continue;
    if (/^(퇴원|n|no|off|x|중단|비재원)$/i.test(String(sv[i][10] || '').trim())) continue;
    var id = String(sv[i][0] || '').trim();
    var k = stus.length;
    stus.push({ id: id, name: nm, school: String(sv[i][2] || '').trim(), grade: String(sv[i][3] || '').trim(),
                exam: {}, clinic: {}, voca: {}, hwork: {}, mock: {}, notice: {}, hwcheck: {}, bonus: 0, bonusTs: 0 });
    if (id) { idCount[id] = (idCount[id] || 0) + 1; byId[id] = k; byIdName[id + '|' + nm] = k; }
    (byName[nm] = byName[nm] || []).push(k);
    var bn = baseName_(nm);
    if (bn && bn !== nm) { (byBase[bn] = byBase[bn] || []).push(k); }
    var tk = String(sv[i][codeCol] || '').trim();
    if (tk) byToken[tk] = k;
  }
  function resolve(id, nm, school, grade) {
    id = String(id || '').replace(/^'/, '').trim(); nm = String(nm || '').trim(); school = String(school || '').trim();
    if (id && nm && byIdName[id + '|' + nm] != null) return byIdName[id + '|' + nm];
    var gd = gradeDigit_(grade);
    // 후보 = 정확 이름 일치 + 접미사 이름(이승준A/B/C ← 실명 '이승준' 기록) — 한 목록으로 합쳐 같은 규칙 적용
    var cands = nm ? (byName[nm] || []).concat(byBase[nm] || []) : [];
    if (cands.length === 1) {
      // 이름이 명단에서 유일 → 학교 표기 차이(오타 등)가 있어도 인정 (개인 페이지와 동일 완화).
      // 단 기록의 학년이 그 학생의 학년과 모순되면 명단 밖 동명이인으로 보고 불인정.
      var kg = gradeDigit_(stus[cands[0]].grade);
      if (!(gd && kg && gd !== kg)) return cands[0];
    }
    if (cands.length > 1) {                          // 동명이인 → 학생ID → 학교+학년 → 학교 순으로 구분
      for (var j1 = 0; j1 < cands.length; j1++) { if (id && stus[cands[j1]].id === id) return cands[j1]; }
      // 기록의 번호가 후보의 번호와 다르면 그 후보 제외 (같은 학교·학년 동명이인은 번호로만 구분)
      function idClash(k) { return id && stus[k].id && stus[k].id !== id; }
      if (gd) { for (var j3 = 0; j3 < cands.length; j3++) {
        if (idClash(cands[j3])) continue;
        if (school && stus[cands[j3]].school && schoolMatch_(stus[cands[j3]].school, school) && gradeDigit_(stus[cands[j3]].grade) === gd) return cands[j3];
      } }
      for (var j2 = 0; j2 < cands.length; j2++) {
        if (idClash(cands[j2])) continue;
        if (school && stus[cands[j2]].school && schoolMatch_(stus[cands[j2]].school, school)) {
          var kg2 = gradeDigit_(stus[cands[j2]].grade);
          if (!(gd && kg2 && gd !== kg2)) return cands[j2];   // 학년 모순이면 다음 후보로
        }
      }
    }
    if (id && byId[id] != null && idCount[id] === 1) return byId[id];
    return -1;
  }
  // 각 단위(시험·주차 등)의 '획득 시각' = 그 단위의 첫 제출 시각. 중복 제출해도 처음 시각 유지.
  function tsOf_(v) {
    if (v instanceof Date) return v.getTime();
    if (!v) return 0;
    var t = new Date(String(v)).getTime();
    return isNaN(t) ? 0 : t;
  }
  function mark_(set, key, ts) { if (set[key] == null || ts < set[key]) set[key] = ts; }
  // 지필 제출 (시험명 단위 — 같은 리포트 중복 제출은 1개)
  var rSh = ss.getSheetByName(TAB_RESULT);
  if (rSh) {
    var rv = rSh.getDataRange().getValues();
    for (var r = 1; r < rv.length; r++) {
      if (!rv[r][4]) continue;
      var kr = resolve(rv[r][10], rv[r][4], rv[r][2], rv[r][3]);
      if (kr >= 0) mark_(stus[kr].exam, String(rv[r][1] || '').replace(/\s+/g, '') || ('r' + r), tsOf_(rv[r][0]));
    }
  }
  // 클리닉 신청 (신청 단위)
  try {
    var csh = SpreadsheetApp.openById(CLINIC_SHEET_ID).getSheetByName(CLINIC_TAB);
    if (csh) {
      var cv = csh.getDataRange().getValues(), CH = cv[0];
      var cT = CH.indexOf('토큰'), cS = CH.indexOf('학생ID'), cD = CH.indexOf('제출시각'), cTm = CH.indexOf('클리닉시간'), cN = CH.indexOf('이름');
      for (var c2 = 1; c2 < cv.length; c2++) {
        var kc = -1, tk2 = cT >= 0 ? String(cv[c2][cT] || '').trim() : '';
        if (tk2 && byToken[tk2] != null) kc = byToken[tk2];
        if (kc < 0) kc = resolve(cS >= 0 ? cv[c2][cS] : '', cN >= 0 ? cv[c2][cN] : '', '');
        if (kc < 0) continue;
        mark_(stus[kc].clinic, clinicWeekKey_(cD >= 0 ? cv[c2][cD] : '') + '|' + String(cv[c2][cTm] || ''), tsOf_(cD >= 0 ? cv[c2][cD] : ''));
      }
    }
  } catch (e) {}
  // 어휘 제출 (주차 단위)
  if (VOCA_SHEET_ID) { try {
    var vsh = SpreadsheetApp.openById(VOCA_SHEET_ID).getSheets()[0];
    var vv = vsh.getDataRange().getValues();
    var VH = vv[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
    var vN = idxOfAny_(VH, ['name', '이름']), vR = idxOfAny_(VH, ['round', '주차', '회차']), vS = idxOfAny_(VH, ['school', '학교']), vT = idxOfAny_(VH, ['time', '제출시각', '일시']), vG = idxOfAny_(VH, ['grade', '학년']);
    if (vN >= 0) for (var v2 = 1; v2 < vv.length; v2++) {
      var kv = resolve('', vv[v2][vN], vS >= 0 ? vv[v2][vS] : '', vG >= 0 ? vv[v2][vG] : '');
      if (kv < 0) continue;
      mark_(stus[kv].voca, vR >= 0 ? String(vv[v2][vR] || '').trim() : String(v2), tsOf_(vT >= 0 ? vv[v2][vT] : ''));
    }
  } catch (e) {} }
  // 과제 제출
  if (HWORK_SHEET_ID) { try {
    var hss = SpreadsheetApp.openById(HWORK_SHEET_ID);
    var hsh = HWORK_TAB ? hss.getSheetByName(HWORK_TAB) : hss.getSheets()[0];
    if (hsh) {
      var hv = hsh.getDataRange().getValues();
      var HH = hv[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
      var hN = idxOfAny_(HH, ['name', '이름']), hS = idxOfAny_(HH, ['school', '학교']);
      var hC = idxOfAny_(HH, ['제목', 'title']), hT = idxOfAny_(HH, ['강사']), hTs = idxOfAny_(HH, ['제출시각', '제출일시', 'time', '일시']), hG = idxOfAny_(HH, ['학년', 'grade']);
      if (hN >= 0) for (var h2 = 1; h2 < hv.length; h2++) {
        var kh = resolve('', hv[h2][hN], hS >= 0 ? hv[h2][hS] : '', hG >= 0 ? hv[h2][hG] : '');
        if (kh < 0) continue;
        var ht = hC >= 0 ? String(hv[h2][hC] || '').trim() : '';
        mark_(stus[kh].hwork, ht ? ((hT >= 0 ? String(hv[h2][hT] || '').trim() : '') + '|' + ht) : ('r' + h2), tsOf_(hTs >= 0 ? hv[h2][hTs] : ''));
      }
    }
  } catch (e) {} }
  // 주말 모의고사 응시 (회차 단위)
  if (OMR_SHEET_ID) { try {
    var osh = SpreadsheetApp.openById(OMR_SHEET_ID).getSheetByName(OMR_TAB);
    if (osh && osh.getLastRow() > 1) {
      var ov = osh.getDataRange().getValues(), OH = ov[0];
      var oId = OH.indexOf('학생ID'), oN = OH.indexOf('이름'), oS = OH.indexOf('학교'), oE = OH.indexOf('회차'), oT = OH.indexOf('제출시각'), oG = OH.indexOf('학년');
      if (oN >= 0) for (var o2 = 1; o2 < ov.length; o2++) {
        var ko = resolve(oId >= 0 ? ov[o2][oId] : '', ov[o2][oN], oS >= 0 ? ov[o2][oS] : '', oG >= 0 ? ov[o2][oG] : '');
        if (ko < 0) continue;
        mark_(stus[ko].mock, (oE >= 0 && String(ov[o2][oE] || '').trim()) || String(o2), tsOf_(oT >= 0 ? ov[o2][oT] : ''));
      }
    }
  } catch (e) {} }
  // 깜짝 보너스
  var bsh = ss.getSheetByName(TAB_STARS);
  if (bsh) {
    var bv = bsh.getDataRange().getValues();
    for (var b2 = 1; b2 < bv.length; b2++) {
      var kb = resolve(bv[b2][1], bv[b2][2], bv[b2][3], bv[b2].length > 6 ? bv[b2][6] : '');
      if (kb < 0) continue;
      stus[kb].bonus += (parseInt(bv[b2][4], 10) || 0);
      var bt = tsOf_(bv[b2][0]);
      if (bt > stus[kb].bonusTs) stus[kb].bonusTs = bt;
    }
  }
  // 공지 확인 (공지키 단위 — 같은 공지 중복 확인 행은 1개)
  var nsh2 = ss.getSheetByName(TAB_NOTICE_READ);
  if (nsh2) {
    var nv = nsh2.getDataRange().getValues();
    for (var n2 = 1; n2 < nv.length; n2++) {
      var kn = resolve(nv[n2][1], nv[n2][2], nv[n2][3]);
      if (kn >= 0) mark_(stus[kn].notice, String(nv[n2][4] || '').trim() || ('r' + n2), tsOf_(nv[n2][0]));
    }
  }
  // 숙제 검사 만점(100%) 주차 — 접근코드(토큰)로 매칭
  var hcSh = ss.getSheetByName(TAB_HWCHECK);
  if (hcSh && hcSh.getLastRow() > 1) {
    var hcv = hcSh.getDataRange().getValues();
    for (var hc = 1; hc < hcv.length; hc++) {
      if (!(Number(hcv[hc][8]) >= 100)) continue;
      var htk = String(hcv[hc][2] || '').trim();
      if (!htk || byToken[htk] == null) continue;
      mark_(stus[byToken[htk]].hwcheck, hwcheckWeekStr_(hcv[hc][1]) || ('r' + hc), tsOf_(hcv[hc][0]));
    }
  }
  // 동점 처리: '지금의 별 수에 먼저 도달한' 학생이 위 — 마지막 별의 획득 시각(earnedAt)이 이른 순.
  function setMax_(set, m) { for (var k in set) { if (set[k] > m) m = set[k]; } return m; }
  var out = stus.map(function (s) {
    var earnedAt = s.bonusTs;
    earnedAt = setMax_(s.exam, earnedAt); earnedAt = setMax_(s.clinic, earnedAt);
    earnedAt = setMax_(s.voca, earnedAt); earnedAt = setMax_(s.hwork, earnedAt);
    earnedAt = setMax_(s.mock, earnedAt); earnedAt = setMax_(s.notice, earnedAt);
    earnedAt = setMax_(s.hwcheck, earnedAt);
    var bd = { exam: Object.keys(s.exam).length, clinic: Object.keys(s.clinic).length,
               voca: Object.keys(s.voca).length, hwork: Object.keys(s.hwork).length,
               mock: Object.keys(s.mock).length, notice: Object.keys(s.notice).length,
               hwcheck: Object.keys(s.hwcheck).length, bonus: s.bonus };
    return { name: s.name, school: s.school, grade: s.grade, earnedAt: earnedAt, breakdown: bd,
      total: bd.exam * STAR_RULES.exam + bd.clinic * STAR_RULES.clinic
           + bd.voca * STAR_RULES.voca + bd.hwork * STAR_RULES.hwork
           + bd.mock * STAR_RULES.mock + bd.hwcheck * STAR_RULES.hwcheck
           + bd.notice * STAR_RULES.notice + bd.bonus };
  });
  out.sort(function (a, b) { return b.total - a.total || a.earnedAt - b.earnedAt || a.name.localeCompare(b.name, 'ko'); });
  return json({ result: 'success', top: out.slice(0, 10) });
}

/** 접미사 이름 후보 중 선택: 1명이면 그 학생, 여럿이면 부모님 번호가 일치하는 학생. */
function basePick_(cands, phone) {
  if (!cands || !cands.length) return null;
  if (cands.length === 1) return cands[0];
  for (var i = 0; i < cands.length; i++) { if (phone && cands[i].id === phone) return cands[i]; }
  return null;
}

/** 동명이인 구분용 접미사(이수빈A → 이수빈) 제거 — 학생이 제출 시 실제 이름만 적는 경우 대비 */
function baseName_(s) {
  return String(s == null ? '' : s).trim().replace(/[A-Za-z]$/, '');
}

function schoolMatch_(a, b) {
  a = String(a || '').replace(/\s+/g, '');
  b = String(b || '').replace(/\s+/g, '');
  if (!a || !b) return false;
  if (a === b) return true;
  // '고등학교'·'고' 접미어 차이를 흡수해 비교
  var na = a.replace(/(등학교|고등학교|중학교|학교|고|중)$/,'');
  var nb = b.replace(/(등학교|고등학교|중학교|학교|고|중)$/,'');
  if (na && nb && na === nb) return true;
  return a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
}

/* ===== 슈퍼스타 별(경험치) 집계 =====
 *  총 별 = 지필 시험당×2 + 클리닉 주·시간대당×1 + 어휘 주차당×1 + 과제 항목당×1 + 모의고사 회차당×1 + 깜짝 보너스 합.
 *  모두 '단위' 기준 중복 제거 — 같은 것을 여러 번 제출해도 별은 1회분만.
 *  등급 계산(12단계)은 학생 페이지(s.html)가 총 별 개수로 수행한다.
 */
function collectStars_(ss, info, key, siblingShared) {
  var sid  = String(info.id   || '').trim();
  var name = String(info.name || '').trim();
  var uniq = !info.nameDup;   // 이름이 명단에서 유일 → 학교 표기 차이 허용 (TOP10 순위와 동일 규칙)
  var grade = String(info.grade || '');
  var exam   = countExams_(ss, sid, name, siblingShared, String(info.school || '').trim(), uniq, grade);   // 지필 평가지 제출 수
  var clinic = countClinicApps_(key, sid);                     // 클리닉 신청 수(신청 단위)
  var voca   = countVoca_(name, grade, String(info.school || ''), uniq);   // 어휘 제출 수(주차 단위)
  var hwork  = countHwork_(name, String(info.school || ''), uniq, grade);   // 과제 제출 수
  var mock   = countMock_(name, String(info.school || ''), sid, uniq, grade);   // 모의고사 응시 수(회차 단위)
  var hwcheck = countHwcheckPerfect_(ss, key);                 // 숙제 검사 만점(100%) 주차 수
  var bonus  = sumBonus_(ss, sid, name, String(info.school || ''), String(info.grade || ''), uniq);   // {sum, latest}
  var noticeN = Object.keys(readNoticeChecks_(ss, sid, name, String(info.school || '').trim(), uniq)).length;   // 공지 확인 수
  var total = exam * STAR_RULES.exam + clinic * STAR_RULES.clinic
            + voca * STAR_RULES.voca + hwork * STAR_RULES.hwork
            + mock * STAR_RULES.mock + hwcheck * STAR_RULES.hwcheck
            + noticeN * STAR_RULES.notice + bonus.sum;
  return {
    total: total,
    breakdown: { exam: exam, clinic: clinic, voca: voca, hwork: hwork, mock: mock, hwcheck: hwcheck, notice: noticeN, bonus: bonus.sum },
    latestBonus: bonus.latest   // {stars, reason, date} 또는 null
  };
}

/** 주말 모의고사 응시 수(회차 단위 — 같은 회차 중복 제출은 1개).
 *  이름+학교 1차(느슨 비교), 학생ID(부모님 8자리)는 동명이인 구분 보조 (studentReports와 동일 규칙).
 *  uniq=true(이름 유일)면 학교·ID 오타가 있어도 인정. 단 학년 모순 기록은 불인정(ID 정확 일치는 예외). */
function countMock_(name, school, sid, uniq, grade) {
  if (!OMR_SHEET_ID || !name) return 0;
  var set = {}, myGd = gradeDigit_(grade);
  var snap = omrSnap_();
  if (!snap.ok || !snap.rows.length || !snap.has.name) return 0;
  for (var i = 0; i < snap.rows.length; i++) {
    var r = snap.rows[i];
    var rn = r[1].trim();
    if (!rn || (rn !== name && rn !== baseName_(name))) continue;   // 접미사 이름(이수빈A) 대비
    var rs = r[2].trim();
    if (!uniq && school && rs && !schoolMatch_(rs, school)) continue;
    var rid = r[0].replace(/^'/, '').trim();
    if (!uniq && rid && sid && rid !== sid) continue;   // 동명이인 구분(양쪽에 ID 있을 때만)
    if (!(rid && sid && rid === sid) && myGd && snap.has.grade) {   // 학년 모순 차단 (명단 밖 동명이인)
      var rGd = gradeDigit_(r[4]);
      if (rGd && rGd !== myGd) continue;
    }
    set[r[3].trim() || String(i + 1)] = true;
  }
  return Object.keys(set).length;
}

/* ===== 공지 '확인했습니다' — 확인 1건당 별 1개 =====
 *  '공지확인' 탭에 학생별 확인 로그를 남기고, 별 집계에 반영한다.
 *  공지키 = 작성일|제목. 공지가 나중에 삭제돼도 이미 받은 별은 유지된다.
 */
function noticeKey_(dateStr, title) { return String(dateStr || '') + '|' + String(title || ''); }

/** 이 학생이 확인한 공지키 집합. 학생ID(+이름) 우선, ID 없는 행은 이름+학교로 매칭.
 *  uniq=true(이름 유일)면 학교 표기 차이 허용. */
function readNoticeChecks_(ss, sid, name, school, uniq) {
  var set = {};
  var v = tabValues_(ss, TAB_NOTICE_READ);
  if (!v) return set;
  for (var i = 1; i < v.length; i++) {
    var rid = String(v[i][1] || '').replace(/^'/, '').trim();
    var rnm = String(v[i][2] || '').trim();
    var rsc = String(v[i][3] || '').trim();
    var match;
    if (rid) { match = (sid && rid === sid) && (!rnm || rnm === name); }   // 형제 공유번호 대비 이름까지
    else { match = (rnm === name); if (match && !uniq && rsc && school) match = schoolMatch_(rsc, school); }
    if (!match) continue;
    var k = String(v[i][4] || '').trim();
    if (k) set[k] = true;
  }
  return set;
}

/** 학생이 공지 확인 버튼을 눌렀을 때. { key(토큰) 또는 student(학생ID), noticeKey } */
function checkNotice(data) {
  var key  = String(data.key || '').trim();
  var id   = String(data.student || '').trim();
  var nKey = String(data.noticeKey || '').trim();
  if ((!key && !id) || !nKey) return json({ result: 'error', message: '요청 정보가 부족합니다.' });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stSh = ss.getSheetByName(TAB_STUDENTS);
  if (!stSh) return json({ result: 'error', message: "'" + TAB_STUDENTS + "' 탭이 없습니다." });
  var sv = stSh.getDataRange().getValues();
  var codeCol = findHeaderCol_(sv[0], '접근코드', STU_CODE_COL);
  var r = null;
  for (var i = 1; i < sv.length; i++) {
    var m = key ? (String(sv[i][codeCol] || '').trim() === key) : (String(sv[i][0] || '').trim() === id);
    if (m) { r = sv[i]; break; }
  }
  if (!r) return json({ result: 'error', message: '학생을 확인할 수 없습니다.' });
  var info = { id: String(r[0] || '').trim(), name: String(r[1] || '').trim(), school: String(r[2] || ''), grade: String(r[3] || '') };

  // 이 학생에게 실제로 보이는 공지인지 확인 (임의 키로 별을 쌓는 것 방지)
  var notices = collectNotices_(ss, info, key);
  var target = null;
  for (var n = 0; n < notices.length; n++) { if (notices[n].key === nKey) { target = notices[n]; break; } }
  if (!target) return json({ result: 'error', message: '해당 공지를 찾을 수 없습니다.' });
  if (target.checked) return json({ result: 'success', already: true });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) {}
  try {
    dropTab_(TAB_NOTICE_READ);   // 잠금 안에서는 메모·캐시를 버리고 반드시 새로 읽는다
    var checks = readNoticeChecks_(ss, info.id, info.name, String(info.school || '').trim());
    if (checks[nKey]) return json({ result: 'success', already: true });   // 동시 클릭 대비 재확인
    var sh = ss.getSheetByName(TAB_NOTICE_READ);
    if (!sh) {
      sh = ss.insertSheet(TAB_NOTICE_READ);
      sh.appendRow(['일시', '학생ID', '이름', '학교', '공지키']);
      sh.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#DDE5E1');
    }
    sh.appendRow([new Date(), info.id ? "'" + info.id : '', info.name, String(info.school || '').trim(), nKey]);
    dropTab_(TAB_NOTICE_READ);
    return json({ result: 'success', already: false });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** 신청 주(월요일 시작) 키 — 같은 주에 같은 시간대를 중복 신청해도 별은 1개만. */
function clinicWeekKey_(d) {
  var dt = (d instanceof Date) ? new Date(d.getTime()) : new Date(String(d || ''));
  if (isNaN(dt.getTime())) return String(d || '');
  dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));   // 그 주 월요일로
  return Utilities.formatDate(dt, 'GMT+9', 'yyyy-MM-dd');
}

/** 클리닉 신청 수 — 토큰 또는 학생ID가 일치하는 행을 '신청 주|시간대' 단위로 센다(중복 신청 1개). */
function countClinicApps_(token, sid) {
  token = String(token || '').trim(); sid = String(sid || '').trim();
  if (!token && !sid) return 0;
  var snap = clinicSnap_();
  if (!snap.ok) return 0;
  var apps = {};
  for (var i = 0; i < snap.rows.length; i++) {
    var r = snap.rows[i];
    var tk = r[0].trim();
    var id = r[1].replace(/^'/, '').trim();
    // 토큰이 기록된 행은 토큰으로만(쌍둥이는 학생ID가 같아 ID로는 형제 신청까지 잡힘), 옛 행만 ID로.
    var match = tk ? (token && tk === token) : (sid && id === sid);
    if (!match) continue;
    apps[r[3] + '|' + r[2]] = true;
  }
  return Object.keys(apps).length;
}

/** 어휘 제출 수 — 어휘 결과 시트에서 이름이 일치하는 행의 주차(round)를 중복 없이 센다.
 *  접미사 이름(이승준A)은 실명(이승준) 기록도 인정. 동명이인(uniq=false)은 학교까지 대조.
 *  학년 모순 기록은 명단 밖 동명이인으로 보고 불인정. */
function countVoca_(name, grade, school, uniq) {
  if (!VOCA_SHEET_ID || !name) return 0;
  var myGd = gradeDigit_(grade), base = baseName_(name);
  var snap = vocaSnap_();
  if (!snap.ok || !snap.rows.length || !snap.has.name) return 0;
  var rounds = {}, n = 0;
  for (var i = 0; i < snap.rows.length; i++) {
    var r = snap.rows[i];
    var rn = r[0].trim();
    if (rn !== name && rn !== base) continue;
    if (!uniq && school && snap.has.school) {
      var rs = r[3].trim();
      if (rs && !schoolMatch_(rs, school)) continue;
    }
    if (myGd && snap.has.grade) {
      var rGd = gradeDigit_(r[2]);
      if (rGd && rGd !== myGd) continue;
    }
    if (snap.has.round) { rounds[r[1].trim()] = true; }
    else { n++; }
  }
  return snap.has.round ? Object.keys(rounds).length : n;
}

/** 과제(H WORK) 제출 수 — '강사|제목' 단위 중복 제거(같은 과제 재제출은 1개). HWORK_SHEET_ID 비면 0.
 *  탭 이름(HWORK_TAB)이 비어 있으면 '제출시각'+'이름' 머리글이 있는 제출 기록 탭을 자동으로 찾는다.
 *  uniq=true(이름 유일)면 학교 표기 차이 허용. 접미사 이름은 실명 기록도 인정. 학년 모순 기록은 불인정. */
function countHwork_(name, school, uniq, grade) {
  if (!HWORK_SHEET_ID || !name) return 0;
  var snap = hworkSnap_();
  if (!snap.ok || !snap.rows.length || !snap.has.name) return 0;
  var set = {}, myGd = gradeDigit_(grade), base = baseName_(name);
  for (var i = 0; i < snap.rows.length; i++) {
    var r = snap.rows[i];
    var rn = r[2].trim();
    if (rn !== name && rn !== base) continue;
    if (myGd && snap.has.grade) {
      var rGd = gradeDigit_(r[4]);
      if (rGd && rGd !== myGd) continue;
    }
    if (!uniq && school && snap.has.school) {
      var sc = r[3].replace(/\s+/g, '');
      if (sc && school.replace(/\s+/g, '') && sc.indexOf(school.replace(/\s+/g, '')) < 0 && school.replace(/\s+/g, '').indexOf(sc) < 0) continue;
    }
    var t = snap.has.title ? r[1].trim() : '';
    set[t ? ((snap.has.teacher ? r[0].trim() : '') + '|' + t) : ('r' + (i + 1))] = true;
  }
  return Object.keys(set).length;
}

/** 이 학생이 제출한 H WORK 집합 — '제출기록'에서 이름(+학교 보조) 매칭.
 *  접미사 이름은 실명 기록도 인정, 학년 모순 기록은 제외.
 *  byKey: '강사|제목' / byCode: '제목' (배정 항목에 강사가 없을 때 보조) */
function hworkDoneSet_(name, school, grade) {
  var out = { byKey: {}, byCode: {} };
  if (!HWORK_SHEET_ID || !name) return out;
  var snap = hworkSnap_();
  if (!snap.ok || !snap.rows.length || !snap.has.title || !snap.has.name) return out;
  var sc = String(school || '').replace(/\s+/g, '');
  var base = baseName_(name), myGd = gradeDigit_(grade);
  for (var i = 0; i < snap.rows.length; i++) {
    var r = snap.rows[i];
    var rn = r[2].trim();
    if (rn !== name && rn !== base) continue;
    if (myGd && snap.has.grade) {
      var rGd = gradeDigit_(r[4]);
      if (rGd && rGd !== myGd) continue;
    }
    if (sc && snap.has.school) {
      var rs = r[3].replace(/\s+/g, '');
      if (rs && rs.indexOf(sc) < 0 && sc.indexOf(rs) < 0) continue;
    }
    var t = snap.has.teacher ? r[0].trim() : '';
    var c = r[1].trim();
    out.byKey[t + '|' + c] = true;
    out.byCode[c] = true;
  }
  return out;
}

function idxOfAny_(headerRow, names) {
  for (var i = 0; i < names.length; i++) {
    var at = headerRow.indexOf(names[i]);
    if (at >= 0) return at;
  }
  return -1;
}

/** 학년에서 1~3 숫자 추출 — '2026 고등 2학년'·'고3' 등 표기 차이 흡수 (마지막 학년 숫자). */
function gradeDigit_(s) {
  s = String(s || '').replace(/\s+/g, '');
  var m = s.match(/([1-3])학년/) || s.match(/고([1-3])/);
  if (m) return m[1];
  var a = s.match(/[1-3]/g);
  return a ? a[a.length - 1] : '';
}

/** '별' 탭에서 이 학생의 깜짝 보너스 합계와 최근 1건.
 *  학생ID가 기록된 행은 ID+이름(쌍둥이는 번호가 같아 이름까지 대조), 없으면 이름+학교(+학년)로 매칭.
 *  uniq=true(이름 유일)면 학교·학년 표기 차이 허용. */
function sumBonus_(ss, sid, name, school, grade, uniq) {
  var out = { sum: 0, latest: null };
  var v = tabValues_(ss, TAB_STARS);
  if (!v) return out;
  for (var i = 1; i < v.length; i++) {
    var rid = String(v[i][1] || '').replace(/^'/, '').trim();
    var rnm = String(v[i][2] || '').trim();
    var rsc = String(v[i][3] || '').trim();
    var match;
    if (rid) { match = (sid && rid === sid) && (!rnm || rnm === name); }
    else {
      match = (rnm === name);
      if (match && !uniq && rsc && school) match = schoolMatch_(rsc, school);   // 동명이인 구분
      if (match && !uniq) {                                                     // 같은 학교 동명이인은 학년으로 구분
        var rg = gradeDigit_(v[i].length > 6 ? v[i][6] : ''), mg = gradeDigit_(grade);
        if (rg && mg && rg !== mg) match = false;
      }
    }
    if (!match) continue;
    var n = parseInt(v[i][4], 10) || 0;
    out.sum += n;
    out.latest = { stars: n, reason: String(v[i][5] || '').trim(), date: fmtCellDate_(v[i][0]) };
  }
  return out;
}

/** '별' 탭이 없으면 만든다. 옛 시트에 '학년'(G열) 머리글이 없으면 추가. */
function ensureStarsSheet_(ss) {
  var sh = ss.getSheetByName(TAB_STARS);
  if (!sh) {
    sh = ss.insertSheet(TAB_STARS);
    sh.appendRow(['일시', '학생ID', '이름', '학교', '별', '사유', '학년']);
    sh.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#DDE5E1');
  } else if (String(sh.getRange(1, 7).getValue() || '').trim() !== '학년') {
    sh.getRange(1, 7).setValue('학년').setFontWeight('bold').setBackground('#DDE5E1');
  }
  return sh;
}

/** 깜짝 보너스 부여 (star.html). { pw, name, school, grade, stars, reason } */
function addStarBonus(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result: 'error', message: 'unauthorized' });
  var stars = parseInt(data.stars, 10);
  var name = String(data.name || '').trim();
  if (!name || !stars || stars < 1 || stars > 50) return json({ result: 'error', message: '학생과 별 개수(1~50)를 확인해주세요.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureStarsSheet_(ss);
  sh.appendRow([new Date(), String(data.id || '').trim() ? "'" + String(data.id).trim() : '', name, String(data.school || '').trim(), stars, String(data.reason || '').trim(), String(data.grade || '').trim()]);
  dropTab_(TAB_STARS);
  return json({ result: 'success' });
}

/** 보너스 로그(관리용, 최근이 위로). pw 필요. */
function getStarLog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_STARS);
  var out = [];
  if (sh) {
    var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      if (!String(v[i][2] || '').trim()) continue;
      out.push({
        rowIndex: i + 1, date: fmtCellDate_(v[i][0]),
        name: String(v[i][2] || '').trim(), school: String(v[i][3] || '').trim(),
        grade: String(v[i].length > 6 ? v[i][6] : '').trim(),
        stars: parseInt(v[i][4], 10) || 0, reason: String(v[i][5] || '').trim()
      });
    }
  }
  out.reverse();
  return json({ result: 'success', log: out.slice(0, 50) });
}

/** 보너스 한 건 삭제(실수 정정용). { pw, rowIndex, name[, school, stars] }
 *  이름 + (보내온 경우) 학교·별 개수까지 대조 — 목록이 낡았으면 삭제 대신 안내. */
function deleteStarBonus(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result: 'error', message: 'unauthorized' });
  var rowIndex = parseInt(data.rowIndex, 10);
  if (!rowIndex || rowIndex < 2) return json({ result: 'error', message: '잘못된 행입니다.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_STARS);
  if (!sh || rowIndex > sh.getLastRow()) return json({ result: 'error', message: '존재하지 않는 행입니다.' });
  var stale = false;
  if (data.name && String(sh.getRange(rowIndex, 3).getValue()).trim() !== String(data.name).trim()) stale = true;
  if (!stale && data.school != null && String(data.school).trim() &&
      String(sh.getRange(rowIndex, 4).getValue()).trim() !== String(data.school).trim()) stale = true;
  if (!stale && data.stars && (parseInt(sh.getRange(rowIndex, 5).getValue(), 10) || 0) !== parseInt(data.stars, 10)) stale = true;
  if (stale) return json({ result: 'error', message: '목록이 변경되었습니다. 새로고침 후 다시 시도하세요.' });
  sh.deleteRow(rowIndex);
  dropTab_(TAB_STARS);
  return json({ result: 'success' });
}

/* ===== 퇴원 정리 도구 (exit.html) =====
 *  이름(+선택 8자리)으로 전 시트에서 그 학생의 기록을 찾아 목록으로 반환하고,
 *  선택한 행들을 한 번에 삭제한다. 학생정보 행이 지워지면 개인 페이지 링크도 즉시 무효화된다.
 */
function exitSheets_() {
  return [
    { src: 'report', tab: TAB_STUDENTS,    label: '학생정보(명단)' },
    { src: 'report', tab: TAB_RESULT,      label: '지필 제출결과' },
    { src: 'report', tab: TAB_STARS,       label: '별(보너스)' },
    { src: 'report', tab: TAB_NOTICE_READ, label: '공지확인' },
    { src: 'omr',    tab: OMR_TAB,         label: '모의고사 OMR 응답' },
    { src: 'signup', tab: SIGNUP_TAB,      label: '모의고사 신청' },
    { src: 'clinic', tab: CLINIC_TAB,      label: '클리닉 신청' },
    { src: 'voca',   tab: '',              label: '어휘 결과' },
    { src: 'hwork',  tab: HWORK_TAB,       label: 'H WORK 제출기록' }
  ];
}
function exitOpen_(src, tab) {
  var ss;
  if (src === 'report')      ss = SpreadsheetApp.getActiveSpreadsheet();
  else if (src === 'omr')    ss = SpreadsheetApp.openById(OMR_SHEET_ID);
  else if (src === 'signup') ss = SpreadsheetApp.openById(SIGNUP_SHEET_ID);
  else if (src === 'clinic') ss = SpreadsheetApp.openById(CLINIC_SHEET_ID);
  else if (src === 'voca')   { ss = SpreadsheetApp.openById(VOCA_SHEET_ID); return ss.getSheets()[0] || null; }
  else if (src === 'hwork')  ss = SpreadsheetApp.openById(HWORK_SHEET_ID);
  else return null;
  return tab ? ss.getSheetByName(tab) : null;
}
function exitNameIdCols_(H) {
  var HL = H.map(function (h) { return String(h || '').trim().toLowerCase(); });
  return {
    n: idxOfAny_(HL, ['이름', 'name']),
    id: idxOfAny_(HL, ['학생id', '부모님연락처', '전화', 'phone4', '전화뒤4', '연락처'])
  };
}
function exitScan(name, sid) {
  name = String(name || '').trim(); sid = String(sid || '').trim();
  if (!name) return json({ result: 'error', message: '이름을 입력하세요.' });
  var base = baseName_(name), sid4 = sid.slice(-4);
  var items = [];
  exitSheets_().forEach(function (cfg) {
    var sh; try { sh = exitOpen_(cfg.src, cfg.tab); } catch (e) { sh = null; }
    if (!sh) return;
    var v = sh.getDataRange().getValues();
    if (v.length < 2) return;
    var cols = exitNameIdCols_(v[0]);
    if (cols.n < 0) return;
    for (var i = 1; i < v.length; i++) {
      var rn = String(v[i][cols.n] || '').trim();
      if (!rn) continue;
      // 실명·접미사 양방향 인정 (이승준 검색 → '이승준A' 행도, 이승준A 검색 → '이승준' 행도)
      if (rn !== name && rn !== base && baseName_(rn) !== name && baseName_(rn) !== base) continue;
      var rid = cols.id >= 0 ? String(v[i][cols.id] || '').replace(/^'/, '').trim() : '';
      var idMatch = null;   // null = 판단 불가(번호 없음), true/false = 8자리 대조 결과
      if (sid && rid) idMatch = (rid === sid || (rid.length === 4 && sid4 && rid === sid4));
      var parts = [];
      for (var c = 0; c < Math.min(v[i].length, 8) && parts.length < 4; c++) {
        if (c === cols.n || c === cols.id) continue;
        var cell = v[i][c];
        if (cell === '' || cell == null) continue;
        var s = (cell instanceof Date) ? Utilities.formatDate(cell, 'GMT+9', 'yyyy-MM-dd') : String(cell);
        s = s.replace(/\s+/g, ' ').trim();
        if (!s) continue;
        if (s.length > 22) s = s.slice(0, 22) + '…';
        parts.push(s);
      }
      items.push({ src: cfg.src, tab: sh.getName(), label: cfg.label, row: i + 1,
                   name: rn, id: rid, idMatch: idMatch, desc: parts.join(' · ') });
    }
  });
  return json({ result: 'success', items: items });
}
/** 선택한 행들을 삭제. { pw, items:[{src,tab,row,name}] } — 이름 재대조 후 큰 행부터 삭제(행 밀림 안전). */
function exitDelete(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result: 'error', message: 'unauthorized' });
  var items = (data.items || []).filter(function (it) { return it && it.src && it.tab && it.row; });
  if (!items.length) return json({ result: 'error', message: '삭제할 항목이 없습니다.' });
  if (items.length > 300) return json({ result: 'error', message: '한 번에 300건까지만 삭제할 수 있어요.' });
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return json({ result: 'error', message: '다른 작업이 진행 중이에요. 잠시 후 다시 시도해 주세요.' }); }
  try {
    var groups = {};
    items.forEach(function (it) { var k = String(it.src) + '::' + String(it.tab); (groups[k] = groups[k] || []).push(it); });
    var deleted = 0, skipped = 0;
    Object.keys(groups).forEach(function (k) {
      var p = k.split('::'), group = groups[k];
      var sh; try { sh = exitOpen_(p[0], p[1]); } catch (e) { sh = null; }
      if (!sh || sh.getName() !== p[1]) { skipped += group.length; return; }
      var cols = exitNameIdCols_(sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]);
      if (cols.n < 0) { skipped += group.length; return; }
      group.sort(function (a, b) { return b.row - a.row; });   // 큰 행부터 — 삭제로 행이 밀려도 안전
      group.forEach(function (it) {
        var r = parseInt(it.row, 10);
        if (!r || r < 2 || r > sh.getLastRow()) { skipped++; return; }
        var cellName = String(sh.getRange(r, cols.n + 1).getValue() || '').trim();
        if (cellName !== String(it.name || '').trim()) { skipped++; return; }   // 목록이 낡았으면 건너뜀
        sh.deleteRow(r); deleted++;
      });
    });
    // 삭제된 기록이 캐시에 남지 않게 관련 캐시를 전부 비운다
    [TAB_STUDENTS, TAB_STARS, TAB_NOTICE_READ].forEach(dropTab_);
    dropExamIdx_();
    ['hworkSnap', 'vocaSnap', 'omrSnap', 'clinicSnap2', 'signupSnap'].forEach(function (k) {
      delete MEMO_['snap:' + k];
      try { CacheService.getScriptCache().remove(k); } catch (e) {}
    });
    return json({ result: 'success', deleted: deleted, skipped: skipped });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* ===== 신입생 등록 (register.html) =====
 *  학생정보 탭에 새 행 추가 + 접근코드 자동 생성 → 개인 페이지 링크 즉시 발급.
 *  동명이인·번호 중복은 경고로 돌려주고, force='1'이면 그대로 등록(쌍둥이·접미사 등록용).
 */
function addStudent(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result: 'error', message: 'unauthorized' });
  var name    = String(data.name    || '').trim();
  var school  = String(data.school  || '').trim();
  var grade   = String(data.grade   || '').trim();
  var sid     = String(data.sid     || '').trim();
  var teacher = String(data.teacher || '').trim();
  var memo    = String(data.memo    || '').trim();
  var classA  = String(data.classA  || '').trim();
  var classB  = String(data.classB  || '').trim();
  var progress= String(data.progress|| '').trim();
  var checkup = String(data.checkup || '').trim();
  if (!name) return json({ result: 'error', message: '이름을 입력하세요.' });
  if (!/^\d{8}$/.test(sid)) return json({ result: 'error', message: '부모님 연락처 8자리(숫자)를 입력하세요. 성적 확인 비밀번호로 쓰여요.' });
  if (!school || !grade) return json({ result: 'error', message: '학교와 학년을 입력하세요.' });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_STUDENTS);
  if (!sh) return json({ result: 'error', message: "'" + TAB_STUDENTS + "' 탭이 없습니다." });
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return json({ result: 'error', message: '잠시 후 다시 시도해 주세요.' }); }
  try {
    var v = sh.getDataRange().getValues();
    var codeCol = findHeaderCol_(v[0], '접근코드', STU_CODE_COL);
    // 중복 검사 (재원생만) — 동명이인은 접미사 등록 안내, 같은 번호는 형제 확인
    var warns = [], base = baseName_(name), used = {};
    for (var i = 1; i < v.length; i++) {
      var tk = String(v[i][codeCol] || '').trim();
      if (tk) used[tk] = true;
      var rn = String(v[i][1] || '').trim();
      if (!rn) continue;
      if (/^(퇴원|n|no|off|x|중단|비재원)$/i.test(String(v[i][10] || '').trim())) continue;
      var rid = String(v[i][0] || '').replace(/^'/, '').trim();
      var who = rn + ' (' + String(v[i][2] || '') + ' ' + String(v[i][3] || '') + ')';
      if (rn === name) warns.push('같은 이름의 재원생이 이미 있어요: ' + who + ' — 동명이인이면 이름 뒤에 A·B 접미사를 붙여 등록하세요 (예: ' + name + 'B).');
      else if (baseName_(rn) === base) warns.push('접미사 동명이인이 있어요: ' + who + ' — 이 학생도 접미사를 붙여 등록하는 것을 권장해요.');
      if (rid && rid === sid) warns.push('같은 번호(8자리)의 재원생이 있어요: ' + who + ' — 형제(쌍둥이)라면 그대로 등록하세요.');
    }
    if (warns.length && String(data.force || '') !== '1') return json({ result: 'warn', warns: warns });

    // 접근코드 생성 (기존 코드와 충돌 없게)
    var token = '';
    do { token = randTok_(); } while (used[token]);
    var row = [];
    for (var c = 0; c <= Math.max(codeCol, 11); c++) row.push('');
    row[0] = "'" + sid; row[1] = name; row[2] = school; row[3] = grade;
    row[4] = teacher; row[5] = memo;
    row[6] = classA; row[7] = classB; row[8] = progress; row[9] = checkup;
    row[codeCol] = token;
    sh.appendRow(row);
    dropTab_(TAB_STUDENTS);
    return json({ result: 'success', name: name, token: token });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
function randTok_() {
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789', s = '';
  for (var i = 0; i < 10; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/** '설정' 탭에서 label 항목(A열)의 값(B열) 원문을 반환(없으면 dflt). */
function configVal_(ss, label, dflt) {
  var v = tabValues_(ss, TAB_CONFIG);
  if (!v) return dflt;
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0] || '').trim() === label) return String(v[i][1] || '').trim();
  }
  return dflt;
}

/** '설정' 탭에서 label 항목(A열)의 값(B열)을 보고 켜짐/꺼짐 판단.
 *  값이 중단·off·n·no·x·0·닫힘·꺼짐이면 false(끄기), 그 외/빈칸/항목없음은 dflt. */
function configOpen_(ss, label, dflt) {
  var v = tabValues_(ss, TAB_CONFIG);
  if (!v) return dflt;
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0] || '').trim() === label) {
      var s = String(v[i][1] || '').trim().toLowerCase();
      if (s === '') return dflt;
      return !(s === '중단' || s === 'off' || s === 'n' || s === 'no' || s === 'x' || s === '0' || s === '닫힘' || s === '꺼짐');
    }
  }
  return dflt;
}

/** '설정' 탭에 label(A열) 항목의 값(B열)을 기록(없으면 행 추가).
 *  ⚠️ 1행부터 훑고, 일치하는 행을 '전부' 갱신한다 — 예전 버전은 2행부터만 찾아서
 *  머리글이 없거나 항목이 1행에 있으면 아래에 중복 행을 만들고, 읽기(configVal_)는
 *  여전히 첫 행의 옛 값을 돌려주는 버그가 있었다 (2026-07 어휘 주차가 1로 되돌아가던 원인). */
function setConfig_(ss, label, value) {
  var sh = ss.getSheetByName(TAB_CONFIG);
  if (!sh) { sh = ss.insertSheet(TAB_CONFIG); sh.appendRow(['항목', '값']); sh.getRange(1,1,1,2).setFontWeight('bold'); }
  var v = sh.getDataRange().getValues();
  var found = false;
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0] || '').trim() !== label) continue;
    sh.getRange(i + 1, 2).setValue(value);   // 중복 행이 있어도 전부 같은 값으로 (읽기와 어긋나지 않게)
    found = true;
  }
  if (!found) sh.appendRow([label, value]);
  dropTab_(TAB_CONFIG);
}

/** 설정 변경 로그 — '설정로그' 탭에 일시·항목·값을 남긴다.
 *  설정이 저절로 되돌아가는 문제(2026-07 어휘 주차 2→1) 추적용:
 *  값이 바뀌었는데 여기에 기록이 없으면 페이지 저장이 아니라 시트에서 직접 바뀐 것(실행취소 등). */
function logConfig_(ss, label, value) {
  try {
    var sh = ss.getSheetByName('설정로그');
    if (!sh) { sh = ss.insertSheet('설정로그'); sh.appendRow(['일시', '항목', '값']); sh.getRange(1,1,1,3).setFontWeight('bold'); }
    sh.appendRow([new Date(), label, value]);
  } catch (e) {}
}

/** 머리글 행에서 label과 일치하는 열 인덱스를 찾고, 없으면 fallback 인덱스를 반환. */
function findHeaderCol_(headerRow, label, fallback) {
  if (headerRow) {
    for (var c = 0; c < headerRow.length; c++) {
      if (String(headerRow[c] || '').trim() === label) return c;
    }
  }
  return fallback;
}

/* ===== 접근코드(토큰) 일괄 생성 =====
 * Apps Script 편집기에서 이 함수를 한 번 실행하면 '학생정보' L열에
 * 비어 있는 학생마다 무작위 접근코드를 채운다(기존 코드는 보존).
 * 실행: 편집기 상단 함수 선택 → assignAccessCodes → 실행.
 */
function assignAccessCodes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_STUDENTS);
  if (!sh) throw new Error("'" + TAB_STUDENTS + "' 탭이 없습니다.");
  var last = sh.getLastRow();
  if (last < 2) return;

  var headerRow = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), STU_CODE_COL + 1)).getValues()[0];
  var codeCol = findHeaderCol_(headerRow, '접근코드', STU_CODE_COL);   // 0-base
  // 머리글 보장
  if (String(sh.getRange(1, codeCol + 1).getValue()).trim() === '') {
    sh.getRange(1, codeCol + 1).setValue('접근코드');
  }

  var rng = sh.getRange(2, codeCol + 1, last - 1, 1);
  var vals = rng.getValues();
  // 학생ID(A)·이름(B)을 함께 읽어, 둘 다 비어 있는 '구분용 빈 행'은 코드 생성에서 제외
  var idName = sh.getRange(2, 1, last - 1, 2).getValues();
  var used = {};
  for (var i = 0; i < vals.length; i++) { var c = String(vals[i][0] || '').trim(); if (c) used[c] = true; }

  var made = 0;
  for (var r = 0; r < vals.length; r++) {
    if (String(vals[r][0] || '').trim() !== '') continue;   // 이미 코드가 있으면 건너뜀
    var hasStudent = String(idName[r][0] || '').trim() !== '' || String(idName[r][1] || '').trim() !== '';
    if (!hasStudent) continue;                               // 이름·ID 둘 다 없는 빈 행은 건너뜀
    var code;
    do { code = genAccessCode_(); } while (used[code]);
    used[code] = true;
    vals[r][0] = code;
    made++;
  }
  rng.setValues(vals);
  SpreadsheetApp.getActive().toast(made + '개의 접근코드를 생성했습니다.', '완료', 5);
}

function genAccessCode_() {
  var charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';   // 헷갈리는 0,O,1,I,l 제외
  var s = '';
  for (var i = 0; i < 12; i++) { s += charset.charAt(Math.floor(Math.random() * charset.length)); }
  return s;
}

/* ===== (2) 제출 수집 / (5) 시험 등록 ===== */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // (5) 시험 등록 요청이면 등록 처리로 분기 (m.html)
    if (data && data.action === 'createReport') {
      return createReport(data);
    }

    // (7) '선생님의 한 마디' 저장 (t.html) → '제출결과' I열에 기록
    if (data && data.action === 'saveTeacherNote') {
      return saveTeacherNote(data);
    }

    // (8) 알려드립니다(공지) 입력·관리 (notice.html)
    if (data && data.action === 'addNotice')     { return addNotice(data); }
    if (data && data.action === 'setNoticeShow') { return setNoticeShow(data); }
    if (data && data.action === 'deleteNotice')  { return deleteNotice(data); }

    // (9) 도구별 배정 입력·삭제 (hwork_assign.html 등)
    if (data && data.action === 'addAssignment')    { return addAssignment(data); }
    if (data && data.action === 'deleteAssignment') { return deleteAssignment(data); }

    // (10) 지필고사 분석지 배정 관리 (analyses.html) — 지난 분석지에 학생 배정/해제
    if (data && data.action === 'setAnalysisAssign')    { return setAnalysisAssign(data); }
    if (data && data.action === 'deleteAnalysisAssign') { return deleteAnalysisAssign(data); }

    // (11) 리포트 완전 삭제 (analyses.html) — 보고서목록·문항·배정에서 모두 제거
    if (data && data.action === 'deleteReport')         { return deleteReport(data); }

    // (12) 슈퍼스타 별 — 깜짝 보너스 부여/삭제 (star.html)
    if (data && data.action === 'addStarBonus')    { return addStarBonus(data); }
    if (data && data.action === 'deleteStarBonus') { return deleteStarBonus(data); }
    if (data && data.action === 'exitDelete')      { return exitDelete(data); }
    if (data && data.action === 'addStudent')      { return addStudent(data); }
    if (data && data.action === 'updateStudent')   { return updateStudent(data); }

    // (12-1) 정규 시간표 (timetable.html) — 학생 반 이동/추가/빼기, 전체 교체(가져오기·재동기화)
    if (data && data.action === 'timetableMove')    { return timetableMove(data); }
    if (data && data.action === 'timetableAdd')     { return timetableAdd(data); }
    if (data && data.action === 'timetableRemove')  { return timetableRemove(data); }
    if (data && data.action === 'timetableOnceCancel') { return timetableOnceCancel(data); }
    if (data && data.action === 'timetableOnceEdit')   { return timetableOnceEdit(data); }
    if (data && data.action === 'attendSet')        { return attendSet(data); }
    if (data && data.action === 'timetableMoveClass') { return timetableMoveClass(data); }
    if (data && data.action === 'timetableAddClass')  { return timetableAddClass(data); }
    if (data && data.action === 'timetableDeleteClass') { return timetableDeleteClass(data); }
    if (data && data.action === 'timetableSaveAll') { return timetableSaveAll(data); }

    // (13) 공지 '확인했습니다' — 확인 1건당 별 1개 (s.html, 토큰으로 학생 확인)
    if (data && data.action === 'checkNotice')     { return checkNotice(data); }

    // (14) 숙제 검사 (hwcheck.html) — 한 학생의 주차 기록 저장 / 검사 항목 목록 변경 / 대책 완료 표시
    if (data && data.action === 'hwcheckSave')     { return hwcheckSave(data); }
    if (data && data.action === 'hwcheckItems')    { return hwcheckSetItems(data); }
    if (data && data.action === 'hwcheckPlanDone') { return hwcheckPlanDone(data); }

    // (2) 학생 제출 수집
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(TAB_RESULT);
    if (!sh) {
      sh = ss.insertSheet(TAB_RESULT);
      sh.appendRow(['제출일시','시험','학교','학년','이름','틀린문항수','틀린문항 · 반성','다음 시험 다짐','선생님의 한 마디','예상 점수','부모님 연락처']);
      sh.getRange(1,1,1,11).setFontWeight('bold').setBackground('#DDE5E1');
    }
    ensureHeader_(sh, 11, '부모님 연락처');   // K열 머리글 보장(기존 시트 호환)
    sh.appendRow([
      new Date(), data.title||'', data.school||'', data.grade||'',
      data.name||'', data.wrongCount||0, data.wrongText||'', data.vow||'', '', data.score||'',
      String(data.parentPhone||'')   // K: 부모님 연락처(010 제외 8자리) — 학생 매칭 키
    ]);
    dropExamIdx_();   // 새 제출이 별 집계·복기 표시에 바로 반영되게 색인 갱신
    return json({ result: 'success' });
  } catch (err) {
    return json({ result: 'error', message: String(err) });
  }
}

/* ===== (7) '선생님의 한 마디' 저장 ===== t.html
 * payload: { action:'saveTeacherNote', rowIndex, name, note }
 * '제출결과' 탭 rowIndex 행의 I열(9)에 note를 기록한다. 안전을 위해 그 행의
 * 이름(E열)이 전달된 name과 같을 때만 저장(목록 로드 후 행 변동 방지).
 */
var RESULT_NOTE_COL = 9;   // I열: 선생님의 한 마디

function saveTeacherNote(data) {
  try {
    var rowIndex = parseInt(data.rowIndex, 10);
    if (!rowIndex || rowIndex < 2) return json({ result:'error', message:'잘못된 행 번호입니다.' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(TAB_RESULT);
    if (!sh) return json({ result:'error', message:"'" + TAB_RESULT + "' 탭이 없습니다." });
    if (rowIndex > sh.getLastRow()) return json({ result:'error', message:'존재하지 않는 행입니다.' });

    // 행 검증: 이름(E열)이 일치해야 저장
    if (data.name) {
      var nameCell = String(sh.getRange(rowIndex, 5).getValue()).trim();
      if (nameCell !== String(data.name).trim()) {
        return json({ result:'error', message:'행 정보가 바뀌었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.' });
      }
    }
    sh.getRange(rowIndex, RESULT_NOTE_COL).setValue(String(data.note || ''));
    return json({ result:'success', rowIndex: rowIndex });
  } catch (err) {
    return json({ result:'error', message:String(err) });
  }
}

/* ===== (8) 학생 명단 + 알려드립니다(공지) 입력·관리 ===== notice.html / student-picker.js
 *  roster      : '학생정보'에서 이름·학교·학년만 반환(학생ID=비밀번호는 절대 노출 안 함). 재원 학생만.
 *  noticeList  : '공지' 탭 전체(관리용, 최신순). 행번호 포함.
 *  addNotice   : '공지' 탭에 한 줄 추가  [작성일, 대상유형, 대상, 제목, 내용, 게시]
 *  setNoticeShow / deleteNotice : 게시(노출/숨김) 토글 · 삭제
 *  쓰기·관리 작업은 pw === TEACHER_PW 필요.
 */
function getRoster() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var v = tabValues_(ss, TAB_STUDENTS);   // 60초 캐시 — 학생 등록·수정 시 즉시 갱신
  if (!v) return json({ result:'error', message:"'" + TAB_STUDENTS + "' 탭이 없습니다." });
  // 0학생ID(=비밀번호, 제외) 1이름 2학교 3학년 4담당교사 ... 10재원여부(K)
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var name = String(v[i][1] || '').trim();
    if (!name) continue;
    var enrolled = String(v[i][10] || '').trim();   // K: 재원여부
    if (/^(퇴원|n|no|off|x|중단|비재원)$/i.test(enrolled)) continue;   // 퇴원 등은 제외
    out.push({
      name: name,
      school: String(v[i][2] || '').trim(),
      grade:  String(v[i][3] || '').trim(),
      teacher:String(v[i][4] || '').trim()
    });
  }
  return json({ result:'success', students: out });
}

/** 학생 개인 페이지 링크 목록 (재원생의 이름·학교·학년·담당·접근코드).
 *  교사용 links.html 전용 — 접근코드가 포함되므로 반드시 pw 확인 뒤에만 호출된다. */
function getStudentLinks() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var v = tabValues_(ss, TAB_STUDENTS);   // 60초 캐시 — 숙제 검사 등에서 자주 불려 캐시 사용
  if (!v) return json({ result:'error', message:"'" + TAB_STUDENTS + "' 탭이 없습니다." });
  var codeCol = findHeaderCol_(v[0], '접근코드', STU_CODE_COL);
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var name = String(v[i][1] || '').trim();
    if (!name) continue;
    if (/^(퇴원|n|no|off|x|중단|비재원)$/i.test(String(v[i][10] || '').trim())) continue;
    out.push({
      name:   name,
      school: String(v[i][2] || '').trim(),
      grade:  String(v[i][3] || '').trim(),
      teacher:String(v[i][4] || '').trim(),
      memo:    String(v[i][5] || '').trim(),
      classA:  String(v[i][6] || '').trim(),
      classB:  String(v[i][7] || '').trim(),
      progress:String(v[i][8] || '').trim(),
      checkup: String(v[i][9] || '').trim(),
      code:   String(v[i][codeCol] || '').trim()   // 빈칸이면 assignAccessCodes() 미실행 학생
    });
  }
  return json({ result:'success', students: out });
}

/** 재원생 정보 수정 (superstar.html 슈스 링크 탭). 접근코드로 행을 찾아
 *  학교·학년·담당교사·메모·시간표(정규가/나·내신진도/확인)만 갱신 — 이름·8자리·재원여부는 건드리지 않음. */
function updateStudent(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result: 'error', message: 'unauthorized' });
  var code = String(data.code || '').trim();
  if (!code) return json({ result: 'error', message: '학생 식별 정보(접근코드)가 없습니다.' });
  var school = String(data.school || '').trim(), grade = String(data.grade || '').trim();
  if (!school || !grade) return json({ result: 'error', message: '학교와 학년은 비울 수 없어요.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_STUDENTS);
  if (!sh) return json({ result: 'error', message: "'" + TAB_STUDENTS + "' 탭이 없습니다." });
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return json({ result: 'error', message: '잠시 후 다시 시도해 주세요.' }); }
  try {
    var v = sh.getDataRange().getValues();
    var codeCol = findHeaderCol_(v[0], '접근코드', STU_CODE_COL);
    var row = -1;
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][codeCol] || '').trim() === code) { row = i + 1; break; }
    }
    if (row < 0) return json({ result: 'error', message: '학생을 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.' });
    // C학교 D학년 E담당교사 F메모 G정규가 H정규나 I내신진도 J내신확인 (이름·8자리·재원여부·접근코드는 유지)
    sh.getRange(row, 3, 1, 8).setValues([[
      school, grade,
      String(data.teacher || '').trim(), String(data.memo || '').trim(),
      String(data.classA || '').trim(), String(data.classB || '').trim(),
      String(data.progress || '').trim(), String(data.checkup || '').trim()
    ]]);
    dropTab_(TAB_STUDENTS);
    return json({ result: 'success' });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* ===== 정규 시간표 (timetable.html) =====
 * '정규시간표' 탭이 반 편성의 원본: A:반ID B:요일 C:시작 D:끝 E:위치 F:담당T G:반이름 H:학생명단(공백 구분)
 * 반이름 끝의 '가/나'에 따라 학생정보 G열(정규가)/H열(정규나)을 갱신한다.
 * 고3파이널·정리정독 등 단일 수업은 '정규가' 열 사용, '논술'은 학생정보에 반영하지 않는다. */
function ttBook_(v) { return (String(v || '').trim() === '내신') ? '내신' : '정규'; }
function ensureTimetableSheet_(ss, book) {
  var name = (ttBook_(book) === '내신') ? TAB_TIMETABLE_EXAM : TAB_TIMETABLE;
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(['반ID', '요일', '시작', '끝', '위치', '담당T', '반이름', '학생명단']);
  }
  return sh;
}
/** 시트가 시간을 날짜로 바꿔둔 경우까지 "5:30" 형태 문자열로 정규화 */
function ttTime_(v) {
  if (v && v.getTime) return Utilities.formatDate(v, 'Asia/Seoul', 'H:mm');
  return String(v == null ? '' : v).trim();
}
/** 반이름 → 학생정보 반영 종류: 'A'(정규가) / 'B'(정규나) / 'S'(단일→정규가) / ''(미반영) */
function ttKind_(cls) {
  var c = String(cls || '').trim();
  if (/논술/.test(c)) return '';
  if (/가$/.test(c)) return 'A';
  if (/나$/.test(c)) return 'B';
  return 'S';
}
function ensureTtLogSheet_(ss) {
  var sh = ss.getSheetByName(TAB_TT_LOG);
  if (!sh) {
    sh = ss.insertSheet(TAB_TT_LOG);
    sh.appendRow(['일시', '구분', '학생', 'from반ID', 'from반', 'to반ID', 'to반', '사유']);
  }
  return sh;
}
function ttLog_(ss, kind, student, fromId, fromCls, toId, toCls, reason, book) {
  ensureTtLogSheet_(ss).appendRow([new Date(), kind, student, fromId, fromCls, toId, toCls, String(reason || '').trim(), ttBook_(book)]);
}
function getTimetable(book) {
  book = ttBook_(book);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureTimetableSheet_(ss, book);
  var v = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < v.length; i++) {
    if (!String(v[i][0] || '').trim()) continue;
    out.push({
      id: String(v[i][0]).trim(), day: String(v[i][1] || '').trim(),
      start: ttTime_(v[i][2]), end: ttTime_(v[i][3]),
      loc: String(v[i][4] || '').trim(), teacher: String(v[i][5] || '').trim(),
      cls: String(v[i][6] || '').trim(),
      students: String(v[i][7] || '').trim().split(/\s+/).filter(String)
    });
  }
  // 최근 1회 이동 (표시 기간 내) — 시간표에 '1회' 표시용
  var once = [];
  var lsh = ss.getSheetByName(TAB_TT_LOG);
  if (lsh) {
    var lv = lsh.getDataRange().getValues();
    var cut = Date.now() - TT_ONCE_DAYS * 24 * 3600 * 1000;
    for (var j = 1; j < lv.length; j++) {
      if (String(lv[j][1] || '').trim() !== '1회') continue;
      if (ttBook_(lv[j][8]) !== book) continue;   // 기존 기록(9열 없음)은 '정규'로 취급
      var d = lv[j][0];
      var t = (d && d.getTime) ? d.getTime() : Date.parse(d);
      if (!t || t < cut) continue;
      once.push({ row: j + 1, date: fmtCellDate_ ? fmtCellDate_(d) : String(d),
        student: String(lv[j][2] || '').trim(),
        fromId: String(lv[j][3] || '').trim(), toId: String(lv[j][5] || '').trim(),
        reason: String(lv[j][7] || '').trim() });
    }
  }
  return json({ result:'success', classes: out, onceMoves: once });
}
/** 이동 기록 목록 (최신 100건). GET action=timetableLog&pw= */
function getTimetableLog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_TT_LOG);
  if (!sh) return json({ result:'success', log: [] });
  var v = sh.getDataRange().getValues();
  var out = [];
  for (var i = Math.max(1, v.length - 100); i < v.length; i++) {
    out.push({ row: i + 1, date: fmtCellDate_ ? fmtCellDate_(v[i][0]) : String(v[i][0]),
      kind: String(v[i][1] || '').trim(), student: String(v[i][2] || '').trim(),
      fromCls: String(v[i][4] || '').trim(), toCls: String(v[i][6] || '').trim(),
      fromId: String(v[i][3] || '').trim(), toId: String(v[i][5] || '').trim(),
      reason: String(v[i][7] || '').trim(), book: ttBook_(v[i][8]) });
  }
  out.reverse();
  return json({ result:'success', log: out });
}
/** 1회 이동 취소(기록 삭제). { pw, row, student } */
function timetableOnceCancel(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var row = parseInt(data.row, 10);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_TT_LOG);
  if (!sh || !row || row < 2 || row > sh.getLastRow()) return json({ result:'error', message:'기록을 찾을 수 없어요.' });
  var v = sh.getRange(row, 1, 1, 8).getValues()[0];
  if (String(v[1]).trim() !== '1회' || String(v[2]).trim() !== String(data.student || '').trim()) {
    return json({ result:'error', message:'기록이 달라졌어요. 새로고침 후 다시 시도해 주세요.' });
  }
  sh.deleteRow(row);
  return json({ result:'success' });
}
/** 학생 반 이동. { pw, student, fromId, toId, moveType:'perm'|'once', reason }
 *  영구(perm): 시간표 탭에서 옮기고 학생정보의 정규가/나 열도 갱신 + 기록.
 *  1회(once): 반 명단·학생정보는 그대로, 이동 기록만 남긴다(사유 필수). */
function timetableMove(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var name = String(data.student || '').trim();
  var fromId = String(data.fromId || '').trim(), toId = String(data.toId || '').trim();
  var moveType = (String(data.moveType || 'perm') === 'once') ? 'once' : 'perm';
  var reason = String(data.reason || '').trim();
  var book = ttBook_(data.book);
  if (!name || !fromId || !toId) return json({ result:'error', message:'이동 정보가 부족합니다.' });
  if (fromId === toId) return json({ result:'error', message:'같은 반입니다.' });
  if (moveType === 'once' && !reason) return json({ result:'error', message:'1회 이동은 사유를 적어주세요.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureTimetableSheet_(ss, book);
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return json({ result:'error', message:'잠시 후 다시 시도해 주세요.' }); }
  try {
    var v = sh.getDataRange().getValues();
    var fromRow = -1, toRow = -1;
    for (var i = 1; i < v.length; i++) {
      var id = String(v[i][0] || '').trim();
      if (id === fromId) fromRow = i;
      if (id === toId) toRow = i;
    }
    if (fromRow < 0 || toRow < 0) return json({ result:'error', message:'반을 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.' });
    var fromList = String(v[fromRow][7] || '').trim().split(/\s+/).filter(String);
    var toList   = String(v[toRow][7]  || '').trim().split(/\s+/).filter(String);
    var plain = name.replace(/\(.*\)$/, '');
    var idx = -1;
    for (var k = 0; k < fromList.length; k++) {
      if (fromList[k] === name || fromList[k].replace(/\(.*\)$/, '') === plain) { idx = k; break; }
    }
    if (idx < 0) return json({ result:'error', message:'이동할 학생이 원래 반에 없어요. 새로고침 후 다시 시도해 주세요.' });
    for (var k2 = 0; k2 < toList.length; k2++) {
      if (toList[k2].replace(/\(.*\)$/, '') === plain) return json({ result:'error', message:'이미 그 반에 있는 학생이에요.' });
    }

    // 1회 이동: 명단·학생정보는 그대로 두고 기록만 남긴다
    if (moveType === 'once') {
      ttLog_(ss, '1회', fromList[idx], fromId, String(v[fromRow][6] || ''), toId, String(v[toRow][6] || ''), reason, book);
      return json({ result:'success', moved: fromList[idx], once: true, rosterUpdated: false, rosterMsg: '' });
    }

    var moved = fromList.splice(idx, 1)[0];
    toList.push(moved);
    sh.getRange(fromRow + 1, 8).setValue(fromList.join(' '));
    sh.getRange(toRow + 1, 8).setValue(toList.join(' '));
    ttLog_(ss, '영구', moved, fromId, String(v[fromRow][6] || ''), toId, String(v[toRow][6] || ''), reason, book);

    // 학생정보(정규가/나) 반영 — 이동한 반의 종류에 따라
    var fk = ttKind_(v[fromRow][6]), tk = ttKind_(v[toRow][6]);
    if (book === '내신') { fk = ''; tk = ''; }   // 내신 시간표는 학생정보 정규가/나에 반영하지 않음
    var slot = String(v[toRow][1] || '').trim() + ttTime_(v[toRow][2]);   // 예: 토6:00
    var rosterUpdated = false, rosterMsg = '';
    if (tk) {
      var colOf = function (k) { return (k === 'B') ? 8 : 7; };   // G=7, H=8 (1-based)
      var ssh = ss.getSheetByName(TAB_STUDENTS);
      var sv = ssh ? ssh.getDataRange().getValues() : null;
      var rowN = -1, cnt = 0;
      if (sv) for (var s = 1; s < sv.length; s++) {
        if (String(sv[s][1] || '').trim() === plain) { rowN = s; cnt++; }
      }
      if (cnt === 1) {
        ssh.getRange(rowN + 1, colOf(tk)).setValue(slot);
        if (fk && colOf(fk) !== colOf(tk)) ssh.getRange(rowN + 1, colOf(fk)).setValue('');
        dropTab_(TAB_STUDENTS);
        rosterUpdated = true;
      } else {
        rosterMsg = (cnt === 0) ? '학생정보 명단에 없는 이름이라 리포트에는 반영되지 않았어요.'
                                : '같은 이름이 여러 명이라 리포트에는 반영되지 않았어요. 슈스 링크 탭에서 직접 확인해 주세요.';
      }
    } else {
      rosterMsg = (book === '내신') ? '' : '논술 수업은 리포트 시간표에 반영하지 않아요.';
    }
    return json({ result:'success', moved: moved, rosterUpdated: rosterUpdated, rosterMsg: rosterMsg });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
/** 학생정보의 정규가/나 열 갱신 (이름 유일 매칭일 때만). kind: 'A'/'B'/'S', slot 빈 문자열이면 비우기 */
function ttRosterSet_(ss, plainName, kind, slot) {
  if (!kind) return { updated: false, msg: '논술 수업은 리포트 시간표에 반영하지 않아요.' };
  var ssh = ss.getSheetByName(TAB_STUDENTS);
  if (!ssh) return { updated: false, msg: "'학생정보' 탭이 없습니다." };
  var sv = ssh.getDataRange().getValues();
  var rowN = -1, cnt = 0;
  for (var s = 1; s < sv.length; s++) {
    if (String(sv[s][1] || '').trim() === plainName) { rowN = s; cnt++; }
  }
  if (cnt !== 1) {
    return { updated: false, msg: (cnt === 0) ? '학생정보 명단에 없는 이름이라 리포트에는 반영되지 않았어요.'
                                              : '같은 이름이 여러 명이라 리포트에는 반영되지 않았어요. 슈스 링크 탭에서 직접 확인해 주세요.' };
  }
  ssh.getRange(rowN + 1, (kind === 'B') ? 8 : 7).setValue(slot);
  dropTab_(TAB_STUDENTS);
  return { updated: true, msg: '' };
}
/** 반에 학생 추가. { pw, student, toId } — 학생정보의 정규가/나 열도 갱신 */
function timetableAdd(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var name = String(data.student || '').trim().replace(/\s+/g, '');
  var toId = String(data.toId || '').trim();
  if (!name || !toId) return json({ result:'error', message:'학생 이름과 반이 필요합니다.' });
  var book = ttBook_(data.book);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureTimetableSheet_(ss, book);
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return json({ result:'error', message:'잠시 후 다시 시도해 주세요.' }); }
  try {
    var v = sh.getDataRange().getValues();
    var toRow = -1;
    for (var i = 1; i < v.length; i++) if (String(v[i][0] || '').trim() === toId) { toRow = i; break; }
    if (toRow < 0) return json({ result:'error', message:'반을 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.' });
    var toList = String(v[toRow][7] || '').trim().split(/\s+/).filter(String);
    var plain = name.replace(/\(.*\)$/, '');
    for (var k = 0; k < toList.length; k++) {
      if (toList[k].replace(/\(.*\)$/, '') === plain) return json({ result:'error', message:'이미 그 반에 있는 학생이에요.' });
    }
    toList.push(name);
    sh.getRange(toRow + 1, 8).setValue(toList.join(' '));
    var tk = (book === '내신') ? '' : ttKind_(v[toRow][6]);
    var slot = String(v[toRow][1] || '').trim() + ttTime_(v[toRow][2]);
    var r = (book === '내신') ? { updated:false, msg:'' } : ttRosterSet_(ss, plain, tk, slot);
    ttLog_(ss, '추가', name, '', '', toId, String(v[toRow][6] || ''), String(data.reason || ''), book);
    return json({ result:'success', added: name, rosterUpdated: r.updated, rosterMsg: r.msg });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
/** 반에서 학생 빼기. { pw, student, fromId } — 학생정보의 해당 열은 비운다 */
function timetableRemove(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var name = String(data.student || '').trim();
  var fromId = String(data.fromId || '').trim();
  if (!name || !fromId) return json({ result:'error', message:'학생 이름과 반이 필요합니다.' });
  var book = ttBook_(data.book);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureTimetableSheet_(ss, book);
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return json({ result:'error', message:'잠시 후 다시 시도해 주세요.' }); }
  try {
    var v = sh.getDataRange().getValues();
    var fromRow = -1;
    for (var i = 1; i < v.length; i++) if (String(v[i][0] || '').trim() === fromId) { fromRow = i; break; }
    if (fromRow < 0) return json({ result:'error', message:'반을 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.' });
    var fromList = String(v[fromRow][7] || '').trim().split(/\s+/).filter(String);
    var plain = name.replace(/\(.*\)$/, '');
    var idx = -1;
    for (var k = 0; k < fromList.length; k++) {
      if (fromList[k] === name || fromList[k].replace(/\(.*\)$/, '') === plain) { idx = k; break; }
    }
    if (idx < 0) return json({ result:'error', message:'그 반에 없는 학생이에요. 새로고침 후 다시 시도해 주세요.' });
    var removed = fromList.splice(idx, 1)[0];
    sh.getRange(fromRow + 1, 8).setValue(fromList.join(' '));
    var fk = (book === '내신') ? '' : ttKind_(v[fromRow][6]);
    var r = (book === '내신') ? { updated:false, msg:'' } : ttRosterSet_(ss, plain, fk, '');   // 해당 열 비우기
    ttLog_(ss, '빼기', removed, fromId, String(v[fromRow][6] || ''), '', '', String(data.reason || ''), book);
    return json({ result:'success', removed: removed, rosterUpdated: r.updated, rosterMsg: r.msg });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
/** 반 통째 이동(빈 자리로). { pw, book, classId, day, start, end, teacher, loc }
 *  반의 요일·시간·위치·담당을 바꾸고, 정규 시간표면 소속 학생 전원의 정규가/나 열도 새 시간으로 갱신. */
function timetableMoveClass(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var book = ttBook_(data.book);
  var classId = String(data.classId || '').trim();
  var newDay = String(data.day || '').trim();
  var newStart = String(data.start || '').trim(), newEnd = String(data.end || '').trim();
  var newTeacher = String(data.teacher || '').trim(), newLoc = String(data.loc || '').trim();
  if (!classId || !newDay || !newStart || !newEnd) return json({ result:'error', message:'이동 정보가 부족합니다.' });
  if ('월화수목금토일'.indexOf(newDay) < 0) return json({ result:'error', message:'요일이 올바르지 않아요.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureTimetableSheet_(ss, book);
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return json({ result:'error', message:'잠시 후 다시 시도해 주세요.' }); }
  try {
    var v = sh.getDataRange().getValues();
    var row = -1;
    for (var i = 1; i < v.length; i++) if (String(v[i][0] || '').trim() === classId) { row = i; break; }
    if (row < 0) return json({ result:'error', message:'반을 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.' });
    var oldLabel = String(v[row][6] || '') + ' (' + String(v[row][1] || '') + ttTime_(v[row][2]) + ')';
    var rg = sh.getRange(row + 1, 2, 1, 5);
    rg.setNumberFormat('@');
    rg.setValues([[newDay, newStart, newEnd, newLoc, newTeacher]]);
    // 소속 학생 전원 리포트 반영 (정규 + 가/나/단일만)
    var kind = (book === '내신') ? '' : ttKind_(v[row][6]);
    var updated = 0, skipped = [];
    if (kind) {
      var slot = newDay + newStart;
      var names = String(v[row][7] || '').trim().split(/\s+/).filter(String);
      for (var n = 0; n < names.length; n++) {
        var plain = names[n].replace(/\(.*\)$/, '');
        var r = ttRosterSet_(ss, plain, kind, slot);
        if (r.updated) updated++; else skipped.push(plain);
      }
    }
    ttLog_(ss, '반이동', '(반 전체 ' + String(v[row][7] || '').split(/\s+/).filter(String).length + '명)',
           classId, oldLabel, classId, String(v[row][6] || '') + ' (' + newDay + newStart + ')', String(data.reason || ''), book);
    return json({ result:'success', rosterUpdated: updated, rosterSkipped: skipped });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** 1회 이동 사유 수정. { pw, row, student, reason } */
function timetableOnceEdit(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var row = parseInt(data.row, 10);
  var reason = String(data.reason || '').trim();
  if (!reason) return json({ result:'error', message:'사유를 적어주세요.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_TT_LOG);
  if (!sh || !row || row < 2 || row > sh.getLastRow()) return json({ result:'error', message:'기록을 찾을 수 없어요.' });
  var v = sh.getRange(row, 1, 1, 8).getValues()[0];
  if (String(v[1]).trim() !== '1회' || String(v[2]).trim() !== String(data.student || '').trim()) {
    return json({ result:'error', message:'기록이 달라졌어요. 새로고침 후 다시 시도해 주세요.' });
  }
  sh.getRange(row, 8).setValue(reason);
  return json({ result:'success', reason: reason });
}
/** 반 추가. { pw, book, day, start, end, loc, teacher, cls } */
function timetableAddClass(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var book = ttBook_(data.book);
  var d = String(data.day || '').trim(), st = String(data.start || '').trim(), en = String(data.end || '').trim();
  var loc = String(data.loc || '').trim(), teacher = String(data.teacher || '').trim(), cls = String(data.cls || '').trim();
  if (!d || !st || !en || !cls) return json({ result:'error', message:'요일·시간·반이름을 입력해 주세요.' });
  if ('월화수목금토일'.indexOf(d) < 0) return json({ result:'error', message:'요일이 올바르지 않아요.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureTimetableSheet_(ss, book);
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return json({ result:'error', message:'잠시 후 다시 시도해 주세요.' }); }
  try {
    var v = sh.getDataRange().getValues();
    var maxN = 0;
    for (var i = 1; i < v.length; i++) {
      var m = String(v[i][0] || '').trim().match(/^r(\d+)$/);
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    }
    var id = 'r' + ('000' + (maxN + 1)).slice(-3);
    var rg = sh.getRange(sh.getLastRow() + 1, 1, 1, 8);
    rg.setNumberFormat('@');
    rg.setValues([[id, d, st, en, loc, teacher, cls, '']]);
    ttLog_(ss, '반추가', '(새 반)', '', '', id, cls + ' (' + d + st + ')', String(data.reason || ''), book);
    return json({ result:'success', id: id });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
/** 반 삭제(빈 반만). { pw, book, classId } */
function timetableDeleteClass(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var book = ttBook_(data.book);
  var classId = String(data.classId || '').trim();
  if (!classId) return json({ result:'error', message:'반 정보가 없습니다.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureTimetableSheet_(ss, book);
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return json({ result:'error', message:'잠시 후 다시 시도해 주세요.' }); }
  try {
    var v = sh.getDataRange().getValues();
    var row = -1;
    for (var i = 1; i < v.length; i++) if (String(v[i][0] || '').trim() === classId) { row = i; break; }
    if (row < 0) return json({ result:'error', message:'반을 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.' });
    var names = String(v[row][7] || '').trim().split(/\s+/).filter(String);
    if (names.length) return json({ result:'error', message:'학생이 남아 있는 반은 삭제할 수 없어요. 먼저 학생을 이동하거나 빼주세요. (' + names.length + '명)' });
    var label = String(v[row][6] || '') + ' (' + String(v[row][1] || '') + ttTime_(v[row][2]) + ')';
    sh.deleteRow(row + 1);
    ttLog_(ss, '반삭제', '(빈 반)', classId, label, '', '', String(data.reason || ''), book);
    return json({ result:'success' });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* ── 출석 체크 (오늘의 시간표) ── */
function ensureAttendSheet_(ss) {
  var sh = ss.getSheetByName(TAB_ATTEND);
  if (!sh) {
    sh = ss.insertSheet(TAB_ATTEND);
    sh.appendRow(['날짜', '시간표', '반ID', '학생', '상태', '메모', '기록일시']);
  }
  return sh;
}
/** 특정 날짜의 출석 기록. GET action=attendList&pw=&date=yyyy-MM-dd&book= */
function getAttendList(dateStr, book) {
  book = ttBook_(book);
  dateStr = String(dateStr || '').trim();
  if (!dateStr) return json({ result:'error', message:'날짜가 필요합니다.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_ATTEND);
  var out = [];
  if (sh) {
    var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      var d = v[i][0];
      var ds = (d && d.getTime) ? Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd') : String(d || '').trim();
      if (ds !== dateStr || ttBook_(v[i][1]) !== book) continue;
      out.push({ classId: String(v[i][2] || '').trim(), student: String(v[i][3] || '').trim(),
                 status: String(v[i][4] || '').trim(), memo: String(v[i][5] || '').trim() });
    }
  }
  return json({ result:'success', date: dateStr, attend: out });
}
/** 출석 기록/변경/삭제. { pw, book, date, classId, student, status(출석|지각|결석|''), memo }
 *  status ''(빈값)이면 기록 삭제. 지각은 메모 필수. */
function attendSet(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var book = ttBook_(data.book);
  var dateStr = String(data.date || '').trim();
  var classId = String(data.classId || '').trim();
  var student = String(data.student || '').trim();
  var status = String(data.status || '').trim();
  var memo = String(data.memo || '').trim();
  if (!dateStr || !classId || !student) return json({ result:'error', message:'날짜·반·학생 정보가 필요합니다.' });
  if (status && ['출석','지각','결석'].indexOf(status) < 0) return json({ result:'error', message:'상태는 출석/지각/결석 중 하나여야 해요.' });
  if (status === '지각' && !memo) return json({ result:'error', message:'지각은 메모를 적어주세요. (미리 연락 여부, 몇 분 지각 등)' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureAttendSheet_(ss);
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return json({ result:'error', message:'잠시 후 다시 시도해 주세요.' }); }
  try {
    var v = sh.getDataRange().getValues();
    var row = -1;
    for (var i = 1; i < v.length; i++) {
      var d = v[i][0];
      var ds = (d && d.getTime) ? Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd') : String(d || '').trim();
      if (ds === dateStr && ttBook_(v[i][1]) === book &&
          String(v[i][2] || '').trim() === classId && String(v[i][3] || '').trim() === student) { row = i + 1; break; }
    }
    if (!status) {
      if (row > 0) sh.deleteRow(row);
      return json({ result:'success', cleared: true });
    }
    if (row > 0) {
      sh.getRange(row, 5, 1, 3).setValues([[status, memo, new Date()]]);
    } else {
      var rg = sh.getRange(sh.getLastRow() + 1, 1, 1, 7);
      rg.setNumberFormats([['@','@','@','@','@','@','yyyy-mm-dd hh:mm']]);
      rg.setValues([[dateStr, book, classId, student, status, memo, new Date()]]);
    }
    return json({ result:'success', status: status });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
/** 전체 교체(최초 가져오기·재동기화용). { pw, rows:[[반ID,요일,시작,끝,위치,담당T,반이름,학생명단], ...] } */
function timetableSaveAll(data) {
  if (String(data.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var rows = data.rows || [];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureTimetableSheet_(ss, ttBook_(data.book));
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return json({ result:'error', message:'잠시 후 다시 시도해 주세요.' }); }
  try {
    sh.clearContents();
    var out = [['반ID', '요일', '시작', '끝', '위치', '담당T', '반이름', '학생명단']];
    for (var i = 0; i < rows.length; i++) {
      var r = (rows[i] || []).slice(0, 8).map(function (x) { return String(x == null ? '' : x); });
      while (r.length < 8) r.push('');
      out.push(r);
    }
    var rg = sh.getRange(1, 1, out.length, 8);
    rg.setNumberFormat('@');   // "5:30"이 날짜/시간으로 자동 변환되지 않게 텍스트로 저장
    rg.setValues(out);
    return json({ result:'success', saved: rows.length });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function ensureNoticeSheet_(ss) {
  var sh = ss.getSheetByName(TAB_NOTICE);
  if (!sh) {
    sh = ss.insertSheet(TAB_NOTICE);
    sh.appendRow(['작성일','대상유형','대상','제목','내용','게시']);
    sh.getRange(1,1,1,6).setFontWeight('bold').setBackground('#DDE5E1');
  }
  return sh;
}

function getNoticeList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_NOTICE);
  var notices = [];
  if (sh) {
    var v = sh.getDataRange().getValues();
    var H = v[0] || [];
    var cDate  = findHeaderCol_(H, '작성일',   0);
    var cType  = findHeaderCol_(H, '대상유형', 1);
    var cTarget= findHeaderCol_(H, '대상',     2);
    var cTitle = findHeaderCol_(H, '제목',     3);
    var cBody  = findHeaderCol_(H, '내용',     4);
    var cShow  = findHeaderCol_(H, '게시',     5);
    for (var i = 1; i < v.length; i++) {
      var row = v[i];
      var title  = String(row[cTitle]||'').trim();
      var body   = String(row[cBody]||'').trim();
      var target = String(row[cTarget]||'').trim();
      var type   = String(row[cType]||'').trim();
      if (!title && !body && !target && !type) continue;   // 빈 줄 건너뛰기
      var d = row[cDate], dateStr = '';
      if (d) {
        try { dateStr = (d instanceof Date) ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(d); }
        catch(e){ dateStr = String(d); }
      }
      var show = String(row[cShow]||'').trim();
      var hidden = /^(n|숨김|off|x)$/i.test(show);
      notices.push({
        rowIndex: i + 1, date: dateStr, type: type, target: target,
        title: title, body: body, hidden: hidden
      });
    }
  }
  notices.reverse();   // 최신이 위로
  return json({ result:'success', notices: notices });
}

function addNotice(data) {
  if (String(data.pw||'') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var type  = String(data.type||'').trim();
  var title = String(data.title||'').trim();
  if (!type) return json({ result:'error', message:'대상유형이 없습니다.' });
  if (!title && !String(data.body||'').trim()) return json({ result:'error', message:'제목 또는 내용을 입력하세요.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureNoticeSheet_(ss);
  var show = (data.hidden===true || data.hidden==='1') ? 'N' : '노출';
  sh.appendRow([ new Date(), type, String(data.target||'').trim(), title, String(data.body||''), show ]);
  dropTab_(TAB_NOTICE);
  return json({ result:'success' });
}

function setNoticeShow(data) {
  if (String(data.pw||'') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var rowIndex = parseInt(data.rowIndex, 10);
  if (!rowIndex || rowIndex < 2) return json({ result:'error', message:'잘못된 행입니다.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_NOTICE);
  if (!sh || rowIndex > sh.getLastRow()) return json({ result:'error', message:'존재하지 않는 행입니다.' });
  var H = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  var cShow = findHeaderCol_(H, '게시', 5);
  sh.getRange(rowIndex, cShow + 1).setValue((data.hidden===true || data.hidden==='1') ? 'N' : '노출');
  dropTab_(TAB_NOTICE);
  return json({ result:'success' });
}

function deleteNotice(data) {
  if (String(data.pw||'') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var rowIndex = parseInt(data.rowIndex, 10);
  if (!rowIndex || rowIndex < 2) return json({ result:'error', message:'잘못된 행입니다.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_NOTICE);
  if (!sh || rowIndex > sh.getLastRow()) return json({ result:'error', message:'존재하지 않는 행입니다.' });
  // 안전 검증: 제목이 일치할 때만 삭제(목록 로드 후 행 변동 방지)
  if (data.title) {
    var H = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    var cTitle = findHeaderCol_(H, '제목', 3);
    var cur = String(sh.getRange(rowIndex, cTitle + 1).getValue()).trim();
    if (cur !== String(data.title).trim()) return json({ result:'error', message:'목록이 변경되었습니다. 새로고침 후 다시 시도하세요.' });
  }
  sh.deleteRow(rowIndex);
  dropTab_(TAB_NOTICE);
  return json({ result:'success' });
}

/* ===== (9) 도구별 배정 ===== hwork_assign.html 등 (H WORK·클리닉·주말 공용)
 *  배정 탭: A작성일 B도구 C항목 D대상유형(전체/학년/개인/일부) E대상 F마감 G비고
 *  '항목'은 도구 내에서 대상을 특정하는 키 (예: H WORK = "강사 / 제목").
 *  쓰기·조회 모두 pw === TEACHER_PW 필요.
 */
function ensureAssignSheet_(ss) {
  var sh = ss.getSheetByName(TAB_ASSIGN);
  if (!sh) {
    sh = ss.insertSheet(TAB_ASSIGN);
    sh.appendRow(['작성일','도구','항목','대상유형','대상','마감','비고']);
    sh.getRange(1,1,1,7).setFontWeight('bold').setBackground('#DDE5E1');
  }
  return sh;
}

function getAssignList(tool, item) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_ASSIGN);
  var out = [];
  if (sh) {
    var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      var r = v[i];
      var t  = String(r[1]||'').trim();
      var it = String(r[2]||'').trim();
      var tg = String(r[4]||'').trim();
      if (!t && !it && !tg) continue;
      if (tool && t !== tool) continue;
      if (item && it !== item) continue;
      var d = r[0], ds = '';
      if (d) { try { ds = (d instanceof Date) ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(d); } catch(e){ ds = String(d); } }
      out.push({
        rowIndex: i+1, date: ds, tool: t, item: it,
        type: String(r[3]||'').trim(), target: tg,
        due: String(r[5]||'').trim(), memo: String(r[6]||'').trim()
      });
    }
  }
  out.reverse();
  return json({ result:'success', assignments: out });
}

function addAssignment(data) {
  if (String(data.pw||'') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var tool = String(data.tool||'').trim();
  var type = String(data.type||'').trim();
  if (!tool) return json({ result:'error', message:'도구가 없습니다.' });
  if (!type) return json({ result:'error', message:'대상유형이 없습니다.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureAssignSheet_(ss);
  sh.appendRow([ new Date(), tool, String(data.item||'').trim(), type, String(data.target||'').trim(), String(data.due||'').trim(), String(data.memo||'').trim() ]);
  dropTab_(TAB_ASSIGN);
  return json({ result:'success' });
}

function deleteAssignment(data) {
  if (String(data.pw||'') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var rowIndex = parseInt(data.rowIndex, 10);
  if (!rowIndex || rowIndex < 2) return json({ result:'error', message:'잘못된 행입니다.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_ASSIGN);
  if (!sh || rowIndex > sh.getLastRow()) return json({ result:'error', message:'존재하지 않는 행입니다.' });
  sh.deleteRow(rowIndex);
  dropTab_(TAB_ASSIGN);
  return json({ result:'success' });
}

/* ===== (5) 시험 등록 =====
 * m.html payload:
 *   { action:'createReport', id, title, scope, review:[문단...],
 *     questions:[{no, group, area(상위), detail(하위), type(객/서술), lv, txt(내용)} ...] }
 * 동작: 같은 ID가 있으면 보고서목록·문항에서 기존 행을 지우고 새로 기록(덮어쓰기).
 */
function createReport(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var id = String(data.id || '').trim();
    if (!id) return json({ result:'error', message:'시험 ID가 비어 있습니다.' });

    // 보고서목록 탭 (없으면 생성)
    var listSh = ss.getSheetByName(TAB_LIST);
    if (!listSh) { listSh = ss.insertSheet(TAB_LIST); listSh.appendRow(['ID','제목','총평','시험범위','학교','학년']); }
    ensureHeader_(listSh, 4, '시험범위');     // D열 머리글 보장
    ensureHeader_(listSh, 5, '학교');         // E열 머리글 보장(학생 개별 페이지 매칭)
    ensureHeader_(listSh, 6, '학년');         // F열 머리글 보장

    // 문항 탭 (없으면 생성)
    var itemSh = ss.getSheetByName(TAB_ITEMS);
    if (!itemSh) { itemSh = ss.insertSheet(TAB_ITEMS); itemSh.appendRow(['보고서ID','번호','영역','형식','난도','내용','세부유형','지문그룹','복수선택']); }
    ensureHeader_(itemSh, 7, '세부유형');     // G열 머리글 보장
    ensureHeader_(itemSh, 8, '지문그룹');     // H열 머리글 보장
    ensureHeader_(itemSh, 9, '복수선택');     // I열 머리글 보장(복수 선택 유형 Y/빈칸)

    // 같은 ID 덮어쓰기 (기존 행 제거)
    deleteRowsById_(listSh, 1, id);
    deleteRowsById_(itemSh, 1, id);

    // 총평: 문단 배열을 빈 줄로 이어 한 셀에 저장 (getReport 가 /\n\s*\n/ 로 다시 분리)
    var review = Array.isArray(data.review) ? data.review.join('\n\n') : String(data.review || '');
    var scope  = String(data.scope || '');
    listSh.appendRow([id, String(data.title || ''), review, scope, String(data.school || ''), String(data.grade || '')]);

    // 문항: 한 번에 기록  (A~H = 보고서ID·번호·영역·형식·난도·내용·세부유형·지문그룹)
    var qs = data.questions || [];
    if (qs.length) {
      var rows = qs.map(function(q){
        return [
          id, String(q.no||''), String(q.area||''), String(q.type||''),
          String(q.lv||''), String(q.txt||''), String(q.detail||''), String(q.group||''),
          (q.multi === true || q.multi === 'Y' || q.multi === 1) ? 'Y' : ''
        ];
      });
      itemSh.getRange(itemSh.getLastRow()+1, 1, rows.length, 9).setValues(rows);
    }

    // 학생 배정: '배정' 탭에 이 분석지(도구=지필고사 분석지, 항목=시험ID)의 대상 저장.
    // 같은 시험을 다시 등록하면 기존 배정을 지우고 새로 기록(덮어쓰기).
    var assignType = String(data.assignType || '').trim();
    if (assignType) {
      var asSh = ensureAssignSheet_(ss);
      deleteAssignByToolItem_(asSh, ANALYSIS_TOOL, id);
      asSh.appendRow([ new Date(), ANALYSIS_TOOL, id, assignType, String(data.assignTarget || '').trim(), '', '' ]);
      dropTab_(TAB_ASSIGN);
    }
    dropTab_(TAB_LIST); dropTab_(TAB_ITEMS);

    return json({ result:'success', id:id, count:qs.length });
  } catch (err) {
    return json({ result:'error', message:String(err) });
  }
}

/* ===== (10) 지필고사 분석지 배정 관리 ===== analyses.html
 *  setAnalysisAssign   : { pw, id, type, target } → '배정' 탭에 (도구=지필고사 분석지, 항목=id)
 *                        기존 배정을 지우고 새 대상(type/target)으로 저장. type이 비면 배정 해제.
 *  deleteAnalysisAssign: { pw, id } → 해당 분석지의 배정을 모두 제거(전 학생에게서 내림).
 */
function setAnalysisAssign(data) {
  if (String(data.pw||'') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var id = String(data.id||'').trim();
  if (!id) return json({ result:'error', message:'시험 ID가 없습니다.' });
  var type = String(data.type||'').trim();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureAssignSheet_(ss);
  deleteAssignByToolItem_(sh, ANALYSIS_TOOL, id);
  if (type) {
    sh.appendRow([ new Date(), ANALYSIS_TOOL, id, type, String(data.target||'').trim(), '', '' ]);
  }
  dropTab_(TAB_ASSIGN);
  return json({ result:'success', id:id });
}

function deleteAnalysisAssign(data) {
  if (String(data.pw||'') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var id = String(data.id||'').trim();
  if (!id) return json({ result:'error', message:'시험 ID가 없습니다.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_ASSIGN);
  if (sh) deleteAssignByToolItem_(sh, ANALYSIS_TOOL, id);
  dropTab_(TAB_ASSIGN);
  return json({ result:'success', id:id });
}

/* ===== (11) 리포트 완전 삭제 ===== analyses.html
 *  { pw, id } → '보고서목록'(리포트) + '문항' + '배정'(지필고사 분석지)에서 이 시험을 모두 제거.
 *  ※ '제출결과'(학생이 이미 낸 복기 기록)는 보존한다 — 실수 삭제 시 학생 기록까지 사라지지 않도록.
 */
function deleteReport(data) {
  if (String(data.pw||'') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var id = String(data.id||'').trim();
  if (!id) return json({ result:'error', message:'시험 ID가 없습니다.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var listSh = ss.getSheetByName(TAB_LIST);
  var itemSh = ss.getSheetByName(TAB_ITEMS);
  var asgSh  = ss.getSheetByName(TAB_ASSIGN);
  if (listSh) deleteRowsById_(listSh, 1, id);   // 보고서목록 A열=ID
  if (itemSh) deleteRowsById_(itemSh, 1, id);   // 문항 A열=보고서ID
  if (asgSh)  deleteAssignByToolItem_(asgSh, ANALYSIS_TOOL, id);   // 배정 제거
  dropTab_(TAB_LIST); dropTab_(TAB_ITEMS); dropTab_(TAB_ASSIGN);
  return json({ result:'success', id:id });
}

/** '배정' 탭에서 도구(B)+항목(C)이 일치하는 행을 모두 삭제(헤더 제외, 아래에서 위로). */
function deleteAssignByToolItem_(sheet, tool, item) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var vals = sheet.getRange(2, 1, last-1, 3).getValues();   // A작성일 B도구 C항목
  for (var r = vals.length-1; r >= 0; r--) {
    if (String(vals[r][1]).trim() === tool && String(vals[r][2]).trim() === item) { sheet.deleteRow(r+2); }
  }
}

/** col열(1-base) 머리글이 비어 있으면 label로 채운다. */
function ensureHeader_(sheet, col, label) {
  var cell = sheet.getRange(1, col);
  if (String(cell.getValue()).trim() === '') { cell.setValue(label); }
}

/** 지정한 열(col)의 값이 id와 같은 모든 행을 삭제(헤더 1행 제외). 아래에서 위로 삭제. */
function deleteRowsById_(sheet, col, id) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var vals = sheet.getRange(2, col, last-1, 1).getValues();
  for (var r = vals.length-1; r >= 0; r--) {
    if (String(vals[r][0]).trim() === id) { sheet.deleteRow(r+2); }
  }
}

/** 문항 내용(F열)에서 반복 유형을 추린다 — 2회 이상 반복분 빈도순(최대 40),
 *  반복이 하나도 없으면 상위 20개. '<보기>: …' 꼬리표는 떼고 집계. */
function getTxtPatterns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_ITEMS);
  var cnt = {};
  if (sh) {
    var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      var t = String(v[i][5] || '').split(/\n?\s*[<〈]\s*보기\s*[>〉]\s*:/)[0].trim();
      if (!t) continue;
      cnt[t] = (cnt[t] || 0) + 1;
    }
  }
  var out = Object.keys(cnt).map(function (t) { return { t: t, n: cnt[t] }; });
  out.sort(function (a, b) { return b.n - a.n || a.t.localeCompare(b.t, 'ko'); });
  var rep = out.filter(function (o) { return o.n >= 2; }).slice(0, 40);
  if (!rep.length) rep = out.slice(0, 20);
  return json({ result: 'success', patterns: rep.map(function (o) { return o.t; }) });
}

/** 복수 선택 유형 여부 판정 (Y/1/복수/○ 등은 true). */
function isMulti_(v) {
  return /^(y|yes|true|1|복수|○|o)/i.test(String(v == null ? '' : v).trim());
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
