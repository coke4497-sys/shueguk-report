/**
 * SHUEGUK 시험 복기 — 통합 Apps Script 웹앱 v4 (읽기 + 제출 수집 + 제출결과 조회 + 시험 등록)
 *
 * v3에서 (5) '시험 등록'을 추가한 버전입니다.
 *  (1) 보고서 읽기   : 학생이 ?id=서정고3화작 로 접속 → 총평·문항 데이터를 JSON으로 반환
 *  (2) 제출 수집     : 학생이 '선생님께 제출' → '제출결과' 탭에 한 행씩 저장
 *  (3) 제출결과 조회 : 선생님이 ?results=서정고3화작 → 제출 학생 목록 반환
 *  (4) 보고서 목록   : ?list=1 → 등록된 시험 목록 반환 (드롭다운 채우기)
 *  (5) 시험 등록     : m.html 에서 POST(action:createReport) → '보고서목록'·'문항' 탭에 저장  ★신규
 *
 * ───────────────────────────────────────────────────────────────
 * [시트 탭]
 *  ① 보고서목록   열: ID | 제목 | 총평
 *  ② 문항         열: 보고서ID | 번호 | 영역 | 유형 | 난도 | 내용
 *  ③ 제출결과     열: 제출일시 | 시험 | 학교 | 학년 | 이름 | 틀린문항수 | 틀린문항·반성 | 다음시험다짐 | 선생님의한마디 | 예상점수
 *
 * [업데이트 방법] 기존 Apps Script 코드를 전부 지우고 이 코드로 교체 → 저장
 *   → 배포 → 배포 관리 → 기존 배포 옆 연필(편집) → 버전을 '새 버전'으로 → 배포
 *   (이렇게 해야 같은 URL이 유지됩니다. '새 배포'로 하면 URL이 바뀌니 주의)
 * ───────────────────────────────────────────────────────────────
 */

var TAB_LIST   = '보고서목록';
var TAB_ITEMS  = '문항';
var TAB_RESULT = '제출결과';

function doGet(e) {
  var p = (e && e.parameter) ? e.parameter : {};

  // (4) 선생님 화면: 보고서 목록 전체 조회 (드롭다운 채우기용)
  if (p.list) {
    return getList();
  }

  // (3) 선생님 화면: 제출결과 조회
  if (p.results) {
    return getResults(String(p.results).trim());
  }

  // (1) 학생 화면: 보고서 읽기
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
  var title = '', review = '';
  if (listSh) {
    var lv = listSh.getDataRange().getValues();
    for (var i = 1; i < lv.length; i++) {
      if (String(lv[i][0]).trim() === id) {
        title  = String(lv[i][1] || '');
        review = String(lv[i][2] || '');
        break;
      }
    }
  }
  if (!title && !review) {
    return json({ result: 'error', message: "'" + id + "' 보고서를 찾을 수 없습니다." });
  }
  var itemSh = ss.getSheetByName(TAB_ITEMS);
  var questions = [];
  if (itemSh) {
    var iv = itemSh.getDataRange().getValues();
    for (var j = 1; j < iv.length; j++) {
      if (String(iv[j][0]).trim() === id) {
        questions.push({
          no: String(iv[j][1]||''), area: String(iv[j][2]||''),
          type: String(iv[j][3]||''), lv: String(iv[j][4]||'').trim(),
          txt: String(iv[j][5]||'')
        });
      }
    }
  }
  var reviewArr = review.split(/\n\s*\n/).map(function(s){return s.trim();}).filter(Boolean);
  return json({ result:'success', title:title, review:reviewArr, questions:questions });
}

/* ===== (3) 제출결과 조회 ===== */
function getResults(reportId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_RESULT);
  if (!sh) return json({ result:'success', students: [] });

  // reportId 가 ID(예: 서정고3화작)일 경우, 보고서목록에서 그 제목도 찾아둔다.
  // 제출결과의 '시험' 칸에는 제목(예: 26-1-중간-서정고3-화법과 작문)이 저장되므로,
  // ID와 제목 둘 중 무엇으로 와도 매칭되게 한다.
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
  // 헤더: 0제출일시 1시험 2학교 3학년 4이름 5틀린문항수 6틀린문항·반성 7다짐 8선생님의한마디 9예상점수
  var students = [];
  for (var i = 1; i < v.length; i++) {
    var row = v[i];
    if (!row[4]) continue;                          // 이름 없으면 skip
    var examVal = String(row[1]).trim();
    // reportId 가 지정되면: 시험값이 ID와 같거나 제목과 같으면 통과. 아니면(ALL/빈값) 전부.
    if (reportId && reportId !== 'ALL') {
      if (examVal !== reportId && examVal !== matchTitle) continue;
    }
    students.push({
      rowIndex: i + 1,                              // 시트 실제 행 번호
      submittedAt: row[0] ? Utilities.formatDate(new Date(row[0]), 'GMT+9', 'yyyy-MM-dd HH:mm') : '',
      title: String(row[1]||''),
      school: String(row[2]||''),
      grade: String(row[3]||''),
      name: String(row[4]||''),
      wrongCount: row[5] || 0,
      wrongText: String(row[6]||''),
      vow: String(row[7]||''),
      teacherNote: String(row[8]||''),             // 선생님의 한 마디
      score: String(row[9]||'')                      // 예상 점수 (J열)
    });
  }
  return json({ result:'success', students: students });
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
      sh.appendRow(['제출일시','시험','학교','학년','이름','틀린문항수','틀린문항 · 반성','다음 시험 다짐','선생님의 한 마디','예상 점수']);
      sh.getRange(1,1,1,10).setFontWeight('bold').setBackground('#DDE5E1');
    }
    sh.appendRow([
      new Date(), data.title||'', data.school||'', data.grade||'',
      data.name||'', data.wrongCount||0, data.wrongText||'', data.vow||'', '', data.score||''
    ]);
    return json({ result: 'success' });
  } catch (err) {
    return json({ result: 'error', message: String(err) });
  }
}

/* ===== (5) 시험 등록 =====
 * m.html 이 보내는 payload:
 *   { action:'createReport', id, title, review:[문단...], questions:[{no,area,type,lv,txt}...] }
 * 동작: 같은 ID가 있으면 보고서목록·문항에서 기존 행을 지우고 새로 기록(덮어쓰기).
 */
function createReport(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var id = String(data.id || '').trim();
    if (!id) return json({ result:'error', message:'시험 ID가 비어 있습니다.' });

    // 보고서목록 탭 (없으면 생성)
    var listSh = ss.getSheetByName(TAB_LIST);
    if (!listSh) { listSh = ss.insertSheet(TAB_LIST); listSh.appendRow(['ID','제목','총평']); }

    // 문항 탭 (없으면 생성)
    var itemSh = ss.getSheetByName(TAB_ITEMS);
    if (!itemSh) { itemSh = ss.insertSheet(TAB_ITEMS); itemSh.appendRow(['보고서ID','번호','영역','유형','난도','내용']); }

    // 같은 ID 덮어쓰기 (기존 행 제거)
    deleteRowsById_(listSh, 1, id);   // 보고서목록: 1열(ID)
    deleteRowsById_(itemSh, 1, id);   // 문항: 1열(보고서ID)

    // 총평: 문단 배열을 빈 줄로 이어 한 셀에 저장 (getReport 가 /\n\s*\n/ 로 다시 분리)
    var review = Array.isArray(data.review) ? data.review.join('\n\n') : String(data.review || '');
    listSh.appendRow([id, String(data.title || ''), review]);

    // 문항: 한 번에 기록
    var qs = data.questions || [];
    if (qs.length) {
      var rows = qs.map(function(q){
        return [id, String(q.no||''), String(q.area||''), String(q.type||''), String(q.lv||''), String(q.txt||'')];
      });
      itemSh.getRange(itemSh.getLastRow()+1, 1, rows.length, 6).setValues(rows);
    }

    return json({ result:'success', id:id, count:qs.length });
  } catch (err) {
    return json({ result:'error', message:String(err) });
  }
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
