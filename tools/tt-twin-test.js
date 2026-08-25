/* 정규↔내신 짝 반(중3·고3) 동기화 검증 — 실행: node tools/tt-twin-test.js */
const S=require('./tt-twin-stub.js');
const {SHEETS, mkSheet, J, fns}=S;
const HDR=['반ID','요일','시작','끝','위치','담당T','반이름','학생명단'];
function reset(){
  for(const k of Object.keys(SHEETS)) delete SHEETS[k];
  mkSheet('정규시간표',[HDR,
    ['r009','목','5:30','8:30','본원','슈','고3파이널A','김지윤 전민성 허민'],
    ['r046','일','11:00','2:00','본원','슈','고3파이널E','김은수 최희재'],
    ['r023','금','8:00','10:00','정리정독','은지','정리정독 중3','채다미 이서린'],
    ['r084','토','4:30','6:30','본원','선주','정리정독 중3','홍창의'],
    ['r085','토','4:30','6:30','본원','승연','정리정독 중3','박지민'],
    ['r006','수','5:30','7:00','화정센터','현지','고1 가','고1학생'],
    ['r026','수','8:30','10:00','화정센터','현지','고1 나','양지우A']]);
  mkSheet('내신시간표',[HDR,
    ['n015','목','5:30','8:30','본원','슈','고3파이널A','김지윤 전민성 허민'],
    ['n081','일','11:00','2:00','본원','슈','고3파이널E','김은수 최희재'],
    ['n035','금','8:00','10:00','본원','선주','정리정독 중3','채다미 이서린'],
    ['n067','토','4:30','6:30','본원','선주','정리정독 중3','홍창의(8/8부터)'],
    ['n068','토','4:30','6:30','본원','승연','정리정독 중3','박지민'],
    ['n012','수','8:30','10:00','화정센터','현지','고1 확인','양지우A']]);
  mkSheet('시간표이동기록',[['일시','구분','학생','from반ID','from반','to반ID','to반','사유','시간표','적용일']]);
  mkSheet('출석기록',[['날짜','시간표','반ID','학생','상태','메모','기록일시'],
    ['2026-08-20','정규','r009','전민성','출석','',new Date()],
    ['2026-08-27','내신','n015','전민성','출석','',new Date()],
    ['2026-08-22','내신','n067','홍창의(8/8부터)','지각','5분',new Date()]]);
  mkSheet('학생정보',[['학생ID','이름','학교','학년','담당','메모','정규가','정규나'],
    ['1','전민성','화정고','고3','슈','','목5:30',''],
    ['2','양지우A','백양고','고1','현지','','','수8:30']]);
}
function roster(sheet,id){ const r=SHEETS[sheet].find(x=>x[0]===id); return r?String(r[7]||'').trim():'(없음)'; }
function meta(sheet,id){ const r=SHEETS[sheet].find(x=>x[0]===id); return r?r.slice(1,6).join('|'):'(없음)'; }
let fail=0;
function eq(label,got,want){ const ok=got===want; if(!ok)fail++; console.log((ok?'  ok  ':'  FAIL')+'  '+label+'  → '+JSON.stringify(got)+(ok?'':' (기대: '+JSON.stringify(want)+')')); }

console.log('1) 영구 이동 — 정규에서 옮기면 내신도 따라온다');
reset();
let r=J(fns.timetableMove({pw:'sh',book:'정규',student:'전민성',fromId:'r009',toId:'r046',moveType:'perm'}));
eq('결과',r.result,'success'); eq('twinBook',r.twinBook,'내신');
eq('정규 r009',roster('정규시간표','r009'),'김지윤 허민');
eq('정규 r046',roster('정규시간표','r046'),'김은수 최희재 전민성');
eq('내신 n015',roster('내신시간표','n015'),'김지윤 허민');
eq('내신 n081',roster('내신시간표','n081'),'김은수 최희재 전민성');

console.log('2) 반대 방향 — 내신에서 옮기면 정규도 따라온다');
reset();
r=J(fns.timetableMove({pw:'sh',book:'내신',student:'전민성',fromId:'n015',toId:'n081',moveType:'perm'}));
eq('twinBook',r.twinBook,'정규');
eq('정규 r009',roster('정규시간표','r009'),'김지윤 허민');
eq('정규 r046',roster('정규시간표','r046'),'김은수 최희재 전민성');
// 짝이 정규면 그 학생의 리포트 시간(학생정보 정규가)도 새 반 시간으로 따라가야 한다
eq('학생정보 전민성 정규가',SHEETS['학생정보'].find(x=>x[1]==='전민성')[6],'일11:00');

console.log('3) 짝이 없는 반(고1)은 건드리지 않는다');
reset();
r=J(fns.timetableRemove({pw:'sh',book:'정규',student:'양지우A',fromId:'r026'}));
eq('결과',r.result,'success'); eq('twinBook',r.twinBook||'','');
eq('내신 n012 그대로',roster('내신시간표','n012'),'양지우A');

console.log('4) 추가·빼기도 짝 반에 함께');
reset();
r=J(fns.timetableAdd({pw:'sh',book:'정규',student:'새친구',toId:'r023'}));
eq('정규 r023',roster('정규시간표','r023'),'채다미 이서린 새친구');
eq('내신 n035',roster('내신시간표','n035'),'채다미 이서린 새친구');
r=J(fns.timetableRemove({pw:'sh',book:'정규',student:'이서린',fromId:'r023'}));
eq('정규 r023',roster('정규시간표','r023'),'채다미 새친구');
eq('내신 n035',roster('내신시간표','n035'),'채다미 새친구');

console.log('5) 병렬 반(토4:30 정리정독 중3 둘) — 담당T로 가려낸다');
reset();
r=J(fns.timetableRemove({pw:'sh',book:'정규',student:'홍창의',fromId:'r084'}));
eq('내신 n067(선주)',roster('내신시간표','n067'),'');
eq('내신 n068(승연) 그대로',roster('내신시간표','n068'),'박지민');

console.log('6) 표기 수정 — 짝 반 표기가 어긋나 있어도 맞춰 준다 + 출석 기록도');
reset();
r=J(fns.timetableRenameStudent({pw:'sh',book:'정규',from:'홍창의',to:'홍창의(8/25부터)'}));
eq('결과',r.result,'success'); eq('twinBook',r.twinBook,'내신');
eq('정규 r084',roster('정규시간표','r084'),'홍창의(8/25부터)');
eq('내신 n067',roster('내신시간표','n067'),'홍창의(8/25부터)');
eq('내신 출석 기록',SHEETS['출석기록'].find(x=>x[2]==='n067')[3],'홍창의(8/25부터)');

console.log('7) 반 통째 이동 — 짝 반 시간도 함께, 위치·담당T는 각자 유지');
reset();
r=J(fns.timetableMoveClass({pw:'sh',book:'정규',classId:'r023',day:'토',start:'9:00',end:'11:00',teacher:'은지',loc:'정리정독'}));
eq('결과',r.result,'success'); eq('twinBook',r.twinBook,'내신');
eq('정규 r023',meta('정규시간표','r023'),'토|9:00|11:00|정리정독|은지');
eq('내신 n035',meta('내신시간표','n035'),'토|9:00|11:00|본원|선주');

console.log('8) 1회 이동은 짝 반을 건드리지 않는다(그 주 시간표에서만 쓰는 기록)');
reset();
r=J(fns.timetableMove({pw:'sh',book:'정규',student:'전민성',fromId:'r009',toId:'r046',moveType:'once',reason:'가족 행사',date:'2026-08-20'}));
eq('결과',r.result,'success');
eq('정규 r009 그대로',roster('정규시간표','r009'),'김지윤 전민성 허민');
eq('내신 n015 그대로',roster('내신시간표','n015'),'김지윤 전민성 허민');

console.log(fail? '\n실패 '+fail+'건' : '\n전부 통과');
process.exit(fail?1:0);
