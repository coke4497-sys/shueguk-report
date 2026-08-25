/* Apps Script 흉내 — 정규↔내신 짝 반(중3·고3) 동기화 검증용 스텁.
 * 실행: node tools/tt-twin-test.js   (통과하면 '전부 통과')
 * 시트를 쓰지 않고 backend-createReport.gs를 그대로 불러 실제 동작을 확인한다. */
const fs=require('fs');
const SHEETS={};
function mkSheet(name, rows){ SHEETS[name]=rows.map(r=>r.slice()); }
function pad(rows){ const w=Math.max(...rows.map(r=>r.length)); return rows.map(r=>{const c=r.slice(); while(c.length<w)c.push(''); return c;}); }
class Range{
  constructor(sh,r,c,nr,nc){ this.sh=sh; this.r=r; this.c=c; this.nr=nr; this.nc=nc; }
  setNumberFormat(){return this;} setNumberFormats(){return this;}
  setValue(v){ this.setValues([[v]]); return this; }
  setValues(vals){ const rows=SHEETS[this.sh];
    for(let i=0;i<this.nr;i++){ const row=rows[this.r-1+i]||(rows[this.r-1+i]=[]);
      for(let j=0;j<this.nc;j++){ while(row.length<this.c-1+j) row.push(''); row[this.c-1+j]=vals[i][j]; } }
    return this; }
  getValues(){ const rows=SHEETS[this.sh]; const out=[];
    for(let i=0;i<this.nr;i++){ const row=rows[this.r-1+i]||[]; const o=[];
      for(let j=0;j<this.nc;j++) o.push(row[this.c-1+j]===undefined?'':row[this.c-1+j]); out.push(o); }
    return out; }
}
class Sheet{
  constructor(n){ this.n=n; }
  getDataRange(){ const rows=pad(SHEETS[this.n]); SHEETS[this.n]=rows; return new Range(this.n,1,1,rows.length,rows[0].length); }
  getRange(r,c,nr,nc){ return new Range(this.n,r,c,nr===undefined?1:nr,nc===undefined?1:nc); }
  getLastRow(){ return SHEETS[this.n].length; }
  getLastColumn(){ return Math.max(...SHEETS[this.n].map(r=>r.length)); }
  appendRow(r){ SHEETS[this.n].push(r.slice()); }
  deleteRow(r){ SHEETS[this.n].splice(r-1,1); }
  insertSheet(){ }
}
global.SpreadsheetApp={ getActiveSpreadsheet:()=>({
  getSheetByName:(n)=>SHEETS[n]?new Sheet(n):null,
  insertSheet:(n)=>{ SHEETS[n]=[]; return new Sheet(n); } }) };
global.LockService={ getScriptLock:()=>({ waitLock(){}, releaseLock(){} }) };
global.CacheService={ getScriptCache:()=>({ get:()=>null, put(){}, remove(){}, removeAll(){} }) };
global.Utilities={ formatDate:(d,tz,f)=>{ const p=n=>String(n).padStart(2,'0');
  if(f==='yyyy-MM-dd') return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
  return d.getHours()+':'+p(d.getMinutes()); }, gzip:()=>({}), base64Encode:()=>'' };
global.ContentService={ createTextOutput:(t)=>({ setMimeType:()=>({ __t:t }) }), MimeType:{JSON:'json'} };
global.PropertiesService={ getScriptProperties:()=>({ getProperty:()=>null, setProperty(){} }) };
global.UrlFetchApp={ fetch:()=>({ getResponseCode:()=>200, getContentText:()=>'' }) };
global.Session={ getScriptTimeZone:()=>'Asia/Seoul' };
global.MailApp={ sendEmail(){} };
global.HtmlService={ createHtmlOutput:()=>({}) };
let src=fs.readFileSync(__dirname+'/../backend-createReport.gs','utf8');
eval(src);
function J(r){ return JSON.parse(r.__t !== undefined ? r.__t : r); }
module.exports={ SHEETS, mkSheet, J, get fns(){ return { timetableMove, timetableAdd, timetableRemove, timetableRenameStudent, timetableMoveClass, TEACHER_PW }; } };
