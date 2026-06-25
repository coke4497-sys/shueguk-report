/**
 * ============================================================
 *  SHUEGUK REPORT · 시험 등록(createReport) 백엔드
 * ============================================================
 *  m.html(시험 등록 페이지)이 보내는 요청을 받아
 *  구글시트에 시험 1건을 저장하는 코드입니다.
 *
 *  ▷ 적용 방법
 *   1) 시트에서  확장 프로그램 > Apps Script  열기
 *   2) 아래 createReport / shFindByHeader_ 두 함수를 코드 맨 아래에 붙여넣기
 *   3) 기존 doPost(e) 함수 맨 위에 아래 3줄을 추가:
 *
 *        function doPost(e){
 *          var _d = JSON.parse(e.postData.contents);
 *          if(_d && _d.action === 'createReport') return createReport(_d);
 *          // ...(기존 학생 제출 코드는 그대로 둡니다)...
 *        }
 *
 *   4) 배포 > 배포 관리 > (연필) > 새 버전  으로 다시 배포
 *
 *  ※ 탭 구조 (이미 만들어져 있다면 그대로 사용됩니다)
 *     · 보고서목록 :  ID | 제목 | 총평
 *     · 문항       :  보고서ID | 번호 | 영역 | 유형 | 난도 | 내용
 * ============================================================
 */

function createReport(data){
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1) 보고서목록 탭 찾기 (이름 → 헤더 순서로 탐색, 없으면 생성)
    var listSh = ss.getSheetByName('보고서목록')
              || shFindByHeader_(ss, ['ID','제목','총평']);
    if(!listSh){
      listSh = ss.insertSheet('보고서목록');
      listSh.appendRow(['ID','제목','총평']);
    }

    // 2) 문항 탭 찾기
    var qSh = ss.getSheetByName('문항')
           || shFindByHeader_(ss, ['보고서ID','번호','영역','유형','난도','내용']);
    if(!qSh){
      qSh = ss.insertSheet('문항');
      qSh.appendRow(['보고서ID','번호','영역','유형','난도','내용']);
    }

    var id = String(data.id || '').trim();
    if(!id){ return _json({result:'error', message:'id가 비어 있습니다.'}); }

    // 3) 같은 ID가 이미 있으면 덮어쓰기(기존 행 삭제 후 재등록)
    deleteRowsById_(listSh, 1, id);   // 보고서목록: 1열(ID) 기준
    deleteRowsById_(qSh,    1, id);   // 문항: 1열(보고서ID) 기준

    // 4) 총평: 문단 배열을 빈 줄로 이어 한 셀에 저장
    var review = Array.isArray(data.review) ? data.review.join('\n\n') : String(data.review || '');

    // 5) 보고서목록에 1행 추가
    listSh.appendRow([id, String(data.title || ''), review]);

    // 6) 문항 탭에 문항 수만큼 행 추가 (한 번에 기록)
    var qs = data.questions || [];
    if(qs.length){
      var rows = qs.map(function(q){
        return [id, String(q.no||''), String(q.area||''), String(q.type||''), String(q.lv||''), String(q.txt||'')];
      });
      qSh.getRange(qSh.getLastRow()+1, 1, rows.length, 6).setValues(rows);
    }

    return _json({result:'success', id:id, count:qs.length});
  } catch(err){
    return _json({result:'error', message:String(err)});
  }
}

/** 첫 행(헤더)이 주어진 컬럼들을 포함하는 시트를 찾습니다. */
function shFindByHeader_(ss, header){
  var shts = ss.getSheets();
  for(var i=0;i<shts.length;i++){
    var lastCol = shts[i].getLastColumn();
    if(lastCol < header.length) continue;
    var row = shts[i].getRange(1,1,1,lastCol).getValues()[0].map(function(c){ return String(c).trim(); });
    var ok = header.every(function(h){ return row.indexOf(h) !== -1; });
    if(ok) return shts[i];
  }
  return null;
}

/** 지정한 열의 값이 id와 같은 모든 행을 삭제(헤더 1행 제외). 아래에서 위로 삭제. */
function deleteRowsById_(sheet, col, id){
  var last = sheet.getLastRow();
  if(last < 2) return;
  var vals = sheet.getRange(2, col, last-1, 1).getValues();
  for(var r = vals.length-1; r >= 0; r--){
    if(String(vals[r][0]).trim() === id){ sheet.deleteRow(r+2); }
  }
}

function _json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}
