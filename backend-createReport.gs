/**
 * SHUEGUK 시험 복기 — 통합 Apps Script 웹앱 v5
 *  (읽기 + 제출 수집 + 제출결과 조회 + 시험 등록 / 시험범위·세부유형·지문그룹 지원)
 *
 *  (1) 보고서 읽기   : ?id=서정고3화작 → 제목·시험범위·총평·문항(영역·세부유형·형식·난도·내용·지문그룹) 반환
 *  (2) 제출 수집     : 학생 '선생님께 제출' → '제출결과' 탭에 한 행씩 저장
 *  (3) 제출결과 조회 : ?results=서정고3화작 → 제출 학생 목록 반환
 *  (4) 보고서 목록   : ?list=1 → 등록된 시험 목록 반환
 *  (5) 시험 등록     : m.html POST(action:createReport) → '보고서목록'·'문항' 탭에 저장
 *  (6) 학생 개별페이지: ?student=71514497 → '학생정보'+'제출결과'를 부모님 8자리로 매칭해 반환 (s.html)
 *
 * ───────────────────────────────────────────────────────────────
 * [시트 탭 / 열]  ※ v4에서 새 열을 "뒤에 추가"만 했으므로 기존 시험도 그대로 동작합니다.
 *  ① 보고서목록   A:ID | B:제목 | C:총평 | D:시험범위                                  ★D 신규
 *  ② 문항         A:보고서ID | B:번호 | C:영역(상위) | D:형식(객/서술) | E:난도 | F:내용 | G:세부유형(하위) | H:지문그룹   ★G·H 신규
 *  ③ 제출결과     제출일시 | 시험 | 학교 | 학년 | 이름 | 틀린문항수 | 틀린문항·반성 | 다음시험다짐 | 선생님의한마디 | 예상점수 | 부모님연락처   ★K 신규(010 제외 8자리 · 학생 매칭 키)
 *  ④ 학생정보     A:학생ID(부모님8자리) | B:이름 | C:학교 | D:학년 | E:담당교사 | F:메모 | G:정규가 | H:정규나 | I:내신진도 | J:내신확인 | K:재원여부   ★신규 탭
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

function doGet(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  if (p.list)    { return getList(); }
  if (p.results) { return getResults(String(p.results).trim()); }
  if (p.student) { return getStudent(String(p.student).trim()); }   // ?student=27927388 → 학생 개별 페이지용
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
      reports.push({ id: id, title: String(v[i][1]||'').trim() });
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
          group:  String(iv[j][7]||'')           // H: 지문그룹
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
      parentPhone: String(row[10]||'')   // K: 부모님 연락처(010 제외 8자리)
    });
  }
  return json({ result:'success', students: students });
}

/* ===== (6) 학생 개별 페이지 ===== s.html?id=학생ID(=부모님 8자리)
 *  '학생정보' 탭에서 기본정보를 찾고, '제출결과'에서 그 학생의 모든 시험 기록을 모은다.
 *  매칭: 제출결과 K열(부모님번호) === 학생ID. 단, 번호 칸이 생기기 전의 옛 기록은
 *        번호가 비어 있으므로 이름이 같으면 보조 매칭한다.
 */
function getStudent(studentId) {
  if (!studentId) return json({ result:'error', message:'학생 ID가 없습니다.' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // (a) 학생정보에서 기본정보
  var stSh = ss.getSheetByName(TAB_STUDENTS);
  if (!stSh) return json({ result:'error', message:"'" + TAB_STUDENTS + "' 탭이 없습니다." });
  var sv = stSh.getDataRange().getValues();
  var info = null;
  // 0학생ID 1이름 2학교 3학년 4담당교사 5메모 6정규가 7정규나 8내신진도 9내신확인 10재원여부
  for (var i = 1; i < sv.length; i++) {
    if (String(sv[i][0]).trim() === studentId) {
      info = {
        id:        studentId,
        name:      String(sv[i][1] || '').trim(),
        school:    String(sv[i][2] || ''),
        grade:     String(sv[i][3] || ''),
        teacher:   String(sv[i][4] || ''),
        memo:      String(sv[i][5] || ''),
        classA:    String(sv[i][6] || ''),
        classB:    String(sv[i][7] || ''),
        progress:  String(sv[i][8] || ''),
        checkup:   String(sv[i][9] || ''),
        enrolled:  String(sv[i][10] || '')
      };
      break;
    }
  }
  if (!info) return json({ result:'error', message:"학생을 찾을 수 없습니다. (ID: " + studentId + ")" });

  // (b) 제출결과에서 이 학생의 시험 기록
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
      var match = (phone && phone === studentId) || (!phone && nm === info.name);
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
  // 최신 제출이 위로
  exams.sort(function(a, b){ return a.submittedAt < b.submittedAt ? 1 : (a.submittedAt > b.submittedAt ? -1 : 0); });

  return json({ result:'success', info: info, exams: exams });
}

/* ===== (2) 제출 수집 / (5) 시험 등록 ===== */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // (5) 시험 등록 요청이면 등록 처리로 분기 (m.html)
    if (data && data.action === 'createReport') {
      return createReport(data);
    }

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
    if (!listSh) { listSh = ss.insertSheet(TAB_LIST); listSh.appendRow(['ID','제목','총평','시험범위']); }
    ensureHeader_(listSh, 4, '시험범위');     // D열 머리글 보장

    // 문항 탭 (없으면 생성)
    var itemSh = ss.getSheetByName(TAB_ITEMS);
    if (!itemSh) { itemSh = ss.insertSheet(TAB_ITEMS); itemSh.appendRow(['보고서ID','번호','영역','형식','난도','내용','세부유형','지문그룹']); }
    ensureHeader_(itemSh, 7, '세부유형');     // G열 머리글 보장
    ensureHeader_(itemSh, 8, '지문그룹');     // H열 머리글 보장

    // 같은 ID 덮어쓰기 (기존 행 제거)
    deleteRowsById_(listSh, 1, id);
    deleteRowsById_(itemSh, 1, id);

    // 총평: 문단 배열을 빈 줄로 이어 한 셀에 저장 (getReport 가 /\n\s*\n/ 로 다시 분리)
    var review = Array.isArray(data.review) ? data.review.join('\n\n') : String(data.review || '');
    var scope  = String(data.scope || '');
    listSh.appendRow([id, String(data.title || ''), review, scope]);

    // 문항: 한 번에 기록  (A~H = 보고서ID·번호·영역·형식·난도·내용·세부유형·지문그룹)
    var qs = data.questions || [];
    if (qs.length) {
      var rows = qs.map(function(q){
        return [
          id, String(q.no||''), String(q.area||''), String(q.type||''),
          String(q.lv||''), String(q.txt||''), String(q.detail||''), String(q.group||'')
        ];
      });
      itemSh.getRange(itemSh.getLastRow()+1, 1, rows.length, 8).setValues(rows);
    }

    return json({ result:'success', id:id, count:qs.length });
  } catch (err) {
    return json({ result:'error', message:String(err) });
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

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
