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

// 설정 탭 — 학생 페이지 기능 켜고/끄기 (A:항목 | B:값). 예: '어휘 테스트' | '중단'
var TAB_CONFIG = '설정';
var TEACHER_PW = 'sh';   // 티쳐스 페이지에서 어휘 켜기/끄기 할 때 쓰는 비밀번호 (원하면 변경)

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
    setConfig_(SpreadsheetApp.getActiveSpreadsheet(), '어휘 테스트', vopen ? '열림' : '중단');
    return json({ result:'success', open: vopen });
  }
  // 열린 어휘 주차 지정 (비밀번호 필요) — '설정' 탭에 주차 번호 기록
  if (p.action === 'setVocaWeek') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    var wset = parseInt(p.w, 10);
    if (!(wset >= 1)) return json({ result:'error', message:'bad week' });
    setConfig_(SpreadsheetApp.getActiveSpreadsheet(), '어휘 주차', String(wset));
    return json({ result:'success', week: wset });
  }
  // 학생 명단(roster) — 티쳐스 공지·선택 위젯용. 민감정보(학생ID=비밀번호)는 제외.
  if (p.action === 'roster')     { return getRoster(); }
  // 공지 목록(관리용) — 비밀번호 필요
  if (p.action === 'noticeList') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    return getNoticeList();
  }
  // 배정 목록(도구별) — 비밀번호 필요. ?action=assignList&tool=H WORK[&item=...]
  if (p.action === 'assignList') {
    if (String(p.pw || '') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
    return getAssignList(p.tool ? String(p.tool).trim() : '', p.item ? String(p.item).trim() : '');
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
  var byPhone = {}, byName = {};
  var stSh = ss.getSheetByName(TAB_STUDENTS);
  if (stSh) {
    var stv = stSh.getDataRange().getValues();
    var codeColR = findHeaderCol_(stv[0], '접근코드', STU_CODE_COL);
    for (var s = 1; s < stv.length; s++) {
      var sId = String(stv[s][0] || '').trim();
      var sNm = String(stv[s][1] || '').trim();
      var code = String(stv[s][codeColR] || '').trim();
      if (sId) byPhone[sId] = { code: code, id: sId };
      if (sNm && !byName[sNm]) byName[sNm] = { code: code, id: sId };   // 동명이인은 첫 행만
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
    var roster = (phone && byPhone[phone]) ? byPhone[phone] : (byName[nm] || null);
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
  var stSh = ss.getSheetByName(TAB_STUDENTS);
  if (!stSh) return json({ result:'error', message:"'" + TAB_STUDENTS + "' 탭이 없습니다." });
  var sv = stSh.getDataRange().getValues();
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

  // 비밀번호 검증: 입력값이 학생ID(부모님 8자리)와 일치해야 성적 공개
  var pwTried = pw !== '';
  var authed  = pwTried && pw === sid;

  var resp = { result:'success', info: info, authed: authed, pwTried: pwTried };
  // 알려드립니다: 이 학생에게 해당하는 공지(비밀번호 없이 key만으로 표시)
  resp.notices = collectNotices_(ss, info, key);
  // 배정된 H WORK: 이 학생에게 배정된 과제만 (학생 개인 페이지용)
  resp.homework = collectAssignments_(ss, info, key, 'H WORK');
  // 지필고사 분석지: 배정(전체/학년/개인/일부) 또는 학교·학년 일치 시험만(최신순). done=복기 제출 여부
  resp.analyses = collectAnalyses_(ss, info, key);
  // 클리닉 신청: 이 학생(토큰)의 최근 신청 내역(없거나 실패 시 null)
  resp.clinic = collectClinic_(key);
  // 어휘 테스트 켜짐/꺼짐 (설정 탭의 '어휘 테스트' 값. 기본 열림)
  resp.vocaOpen = configOpen_(ss, '어휘 테스트', true);
  // 어휘 주차: 교사가 연 주차(없으면 null → 학생 카드 준비 중)
  var vwk = configVal_(ss, '어휘 주차', '');
  resp.vocaWeek = vwk ? parseInt(vwk, 10) : null;
  if (authed) {
    var exams = collectExams_(ss, sid, info.name, siblingShared);
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
    resp.examCount = countExams_(ss, sid, info.name, siblingShared);   // 잠금 상태에선 개수만 안내
  }
  return json(resp);
}

/** '보고서목록'+'문항'을 한 번에 읽어 제목/ID로 조회 가능한 인덱스 생성. */
function getReportsIndex_(ss) {
  var byId = {}, byTitle = {};
  var listSh = ss.getSheetByName(TAB_LIST);
  if (listSh) {
    var lv = listSh.getDataRange().getValues();
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
  var itemSh = ss.getSheetByName(TAB_ITEMS);
  if (itemSh) {
    var iv = itemSh.getDataRange().getValues();
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

/** 제출결과에서 이 학생의 시험 기록을 모은다(최신순).
 *  기본: 부모님번호 매칭(옛 기록은 이름 보조). 단 strictName=true(형제가 같은 번호 공유)면
 *  번호가 같아도 이름까지 일치해야 인정 → 형제 성적이 섞이지 않는다. */
function collectExams_(ss, sid, name, strictName) {
  var exams = [];
  var rSh = ss.getSheetByName(TAB_RESULT);
  if (rSh) {
    var rv = rSh.getDataRange().getValues();
    // 0제출일시 1시험 2학교 3학년 4이름 5틀린문항수 6틀린문항·반성 7다짐 8선생님의한마디 9예상점수 10부모님연락처
    for (var j = 1; j < rv.length; j++) {
      var row = rv[j];
      if (!row[4]) continue;
      var phone = String(row[10] || '').trim();
      var nm    = String(row[4]  || '').trim();
      var match;
      if (strictName) {
        // 같은 번호를 형제가 공유 → 번호+이름이 모두 같아야(옛 기록처럼 번호 없으면 이름으로) 인정
        match = phone ? (phone === sid && nm === name) : (nm === name);
      } else {
        match = (phone && phone === sid) || (!phone && nm === name);
      }
      if (!match) continue;
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

function countExams_(ss, sid, name, strictName) {
  return collectExams_(ss, sid, name, strictName).length;
}

/* ===== 알려드립니다(공지) =====
 *  '공지' 탭에서 이 학생에게 해당하는 공지만 골라 최신순으로 반환.
 *  열(헤더로 찾고, 없으면 A~F 고정): A작성일 B대상유형 C대상 D제목 E내용 F게시
 *  대상유형:  전체 → 모든 학생 / 학년 → C열 학년과 일치 / 개인·일부 → C열 명단(이름·ID·접근코드)에 포함
 *  게시: 'N'·'숨김'·'off'·'x'면 숨김, 그 외(빈칸 포함)는 노출
 */
function collectNotices_(ss, info, key) {
  var sh = ss.getSheetByName(TAB_NOTICE);
  if (!sh) return [];
  var v = sh.getDataRange().getValues();
  if (v.length < 2) return [];

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
  return out;
}

/* ===== 배정된 항목(도구별) 조회 ===== 학생 개인 페이지(s.html)
 *  '배정' 탭에서 이 학생에게 해당하는 항목만(공지와 동일한 noticeMatches_ 규칙) 최신순 반환.
 *  열: A작성일 B도구 C항목 D대상유형 E대상 F마감 G비고.  항목 "강사 / 제목" → teacher·code로 분리.
 */
function collectAssignments_(ss, info, key, tool) {
  var sh = ss.getSheetByName(TAB_ASSIGN);
  if (!sh) return [];
  var v = sh.getDataRange().getValues();
  if (v.length < 2) return [];

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

  // 학년: 학생의 학년 또는 '학교+학년'이 대상 토큰과 일치/포함
  if (type.indexOf('학년') >= 0) {
    var g  = stu.grade.replace(/\s+/g, '');
    var sg = (stu.school + stu.grade).replace(/\s+/g, '');
    return tokens.some(function(t){
      var tt = t.replace(/\s+/g, '');
      return !!tt && (tt === g || sg.indexOf(tt) >= 0 || g.indexOf(tt) >= 0);
    });
  }

  // 개인 · 일부 (그 외 유형 포함): 이름·ID·접근코드 중 하나라도 일치하면 노출
  return tokens.some(function(t){
    return t === stu.name || t === stu.sid || t === stu.code;
  });
}

/* ===== 클리닉 신청 조회 =====
 *  별도 스프레드시트(CLINIC_SHEET_ID)의 '응답' 탭에서 이 학생(토큰)의 신청을 찾아
 *  최근 신청 1건과 총 신청 수를 반환. '토큰' 열이 아직 없으면(클리닉 미배포) null.
 *  같은 제출시각+시간대는 한 '신청'으로 묶고, 요청 줄 수를 센다.
 */
function collectClinic_(token) {
  token = String(token || '').trim();
  if (!token) return null;
  var sh;
  try { sh = SpreadsheetApp.openById(CLINIC_SHEET_ID).getSheetByName(CLINIC_TAB); }
  catch (e) { return null; }     // 권한·접근 실패 시 조용히 건너뜀(학생 페이지는 정상 동작)
  if (!sh) return null;

  var v = sh.getDataRange().getValues();
  if (v.length < 2) return null;
  var H = v[0];
  var iTok  = H.indexOf('토큰');
  if (iTok < 0) return null;     // 클리닉에 토큰 열이 아직 없음 → 표시 안 함
  var iDate = H.indexOf('제출시각');
  var iTime = H.indexOf('클리닉시간');

  var apps = {};   // key: 제출시각|시간 → { date, time, count }
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][iTok] || '').trim() !== token) continue;
    var date = String(v[i][iDate] || '').trim();
    var time = String(v[i][iTime] || '').trim();
    var k = date + '|' + time;
    if (!apps[k]) apps[k] = { date: date, time: time, count: 0 };
    apps[k].count++;
  }
  var list = Object.keys(apps).map(function (k) { return apps[k]; });
  if (!list.length) return null;
  list.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });

  return { latest: list[0], total: list.length };
}

/* ===== 지필고사 분석지(학생 개별 페이지) =====
 *  교사가 '배정'한 학생에게만 해당 분석지를 최신순으로 반환.
 *  배정은 '배정' 탭(도구=지필고사 분석지, 항목=시험ID)에 기록되며, 공지와 동일한
 *  noticeMatches_ 규칙(전체/학년/개인/일부)으로 이 학생 해당 여부를 판단한다.
 *  (학교+학년 자동배정은 선택과목 차이로 오배정 위험이 있어 사용하지 않는다.)
 *  각 시험에 done(이 학생이 이미 복기를 제출했는지)을 표시 → '복기 입력하기'/'입력 완료' 구분.
 */
function collectAnalyses_(ss, info, key) {
  var aSh = ss.getSheetByName(TAB_ASSIGN);
  if (!aSh) return [];
  var av = aSh.getDataRange().getValues();
  if (av.length < 2) return [];

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
  var listSh = ss.getSheetByName(TAB_LIST);
  if (listSh) {
    var lv = listSh.getDataRange().getValues();
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
  var listSh = ss.getSheetByName(TAB_LIST);
  if (!listSh) return order;
  var lv = listSh.getDataRange().getValues();
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
  var sh = ss.getSheetByName(TAB_RESULT);
  if (!sh) return set;
  var sid  = String(info.id   || '').trim();
  var name = String(info.name || '').trim();
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    var row = v[i];
    if (!row[4]) continue;
    var phone = String(row[10] || '').trim();
    var nm    = String(row[4]  || '').trim();
    var match = (phone && phone === sid) || (nm && nm === name);
    if (!match) continue;
    var t = String(row[1] || '').trim();   // 시험명(=제목 또는 ID)
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

/** 학교명 느슨한 일치: 공백 제거 후 완전 일치 또는 한쪽이 다른 쪽을 포함(예: "화정고"↔"화정고등학교"). */
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

/** '설정' 탭에서 label 항목(A열)의 값(B열) 원문을 반환(없으면 dflt). */
function configVal_(ss, label, dflt) {
  var sh = ss.getSheetByName(TAB_CONFIG);
  if (!sh) return dflt;
  var v = sh.getDataRange().getValues();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0] || '').trim() === label) return String(v[i][1] || '').trim();
  }
  return dflt;
}

/** '설정' 탭에서 label 항목(A열)의 값(B열)을 보고 켜짐/꺼짐 판단.
 *  값이 중단·off·n·no·x·0·닫힘·꺼짐이면 false(끄기), 그 외/빈칸/항목없음은 dflt. */
function configOpen_(ss, label, dflt) {
  var sh = ss.getSheetByName(TAB_CONFIG);
  if (!sh) return dflt;
  var v = sh.getDataRange().getValues();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0] || '').trim() === label) {
      var s = String(v[i][1] || '').trim().toLowerCase();
      if (s === '') return dflt;
      return !(s === '중단' || s === 'off' || s === 'n' || s === 'no' || s === 'x' || s === '0' || s === '닫힘' || s === '꺼짐');
    }
  }
  return dflt;
}

/** '설정' 탭에 label(A열) 항목의 값(B열)을 기록(없으면 행 추가). */
function setConfig_(ss, label, value) {
  var sh = ss.getSheetByName(TAB_CONFIG);
  if (!sh) { sh = ss.insertSheet(TAB_CONFIG); sh.appendRow(['항목', '값']); sh.getRange(1,1,1,2).setFontWeight('bold'); }
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0] || '').trim() === label) { sh.getRange(i+1, 2).setValue(value); return; }
  }
  sh.appendRow([label, value]);
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
  var sh = ss.getSheetByName(TAB_STUDENTS);
  if (!sh) return json({ result:'error', message:"'" + TAB_STUDENTS + "' 탭이 없습니다." });
  var v = sh.getDataRange().getValues();
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
    }

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
  return json({ result:'success', id:id });
}

function deleteAnalysisAssign(data) {
  if (String(data.pw||'') !== TEACHER_PW) return json({ result:'error', message:'unauthorized' });
  var id = String(data.id||'').trim();
  if (!id) return json({ result:'error', message:'시험 ID가 없습니다.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_ASSIGN);
  if (sh) deleteAssignByToolItem_(sh, ANALYSIS_TOOL, id);
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

/** 복수 선택 유형 여부 판정 (Y/1/복수/○ 등은 true). */
function isMulti_(v) {
  return /^(y|yes|true|1|복수|○|o)/i.test(String(v == null ? '' : v).trim());
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
