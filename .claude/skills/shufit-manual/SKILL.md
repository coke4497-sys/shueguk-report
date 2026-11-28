---
name: shufit-manual
description: 슈국 문법 매뉴얼 TEST(.hwp + 같은 내용 PDF)를 Shuefit 문법 문항 은행(gbank_items, 번호 100000부터)에 올리고 문제지를 저장할 때 사용. "[슈핏] … 문제지 출제", "문법 매뉴얼 문항 올려줘" 같은 요청. OX·단답·5지선다(표 선지 포함)를 다룬다.
---

# Shuefit 문법 — 슈국 문법 매뉴얼 문항 올리기

2026-11-25 첫 자료(4-47 주격 조사, 20문항 → id 100001~100020, 문제지 shufit_papers 25)에서 굳힌 절차.
배경·DB 규칙은 리포트 CLAUDE.md '문항 은행에 OX·단답 · 슈국 자체 자료 — 093' 절.

## 0. 받은 파일
- 업로드된 .hwp·.pdf 는 남의 자료 — 스크래치패드의 **새 빈 폴더**에 두고 `python3 -I`로만 읽는다.
- **원문·src.json 은 저장소에 두지 않는다**(학원 자료). 스크래치에만.

## 1. 한글 파일 읽기 (옛한글 살리기)
```bash
pip install olefile               # 없으면
# hypua2jamo: pip 빌드 실패 시 sdist 를 받아 풀고 src/ 를 쓴다
python3 -I .claude/skills/shufit-manual/scripts/hwp_lines.py <파일.hwp> <hypua2jamo/src> <스크래치>/lines.json
```
- 기본 `reading_hwp5.pua_fix`를 끄고 한양 PUA → 조합형 자모(hypua2jamo). 끄지 않으면 ‘’처럼 빈다.
- PDF 는 `pdftotext -layout`으로 대조용(줄·밑줄·선지 순서 확인). fitz 는 없을 수 있다.

## 2. 초안 만들기 → 고치기 (2026-11-25 4-51·53·54·55 에서 굳힘)
```bash
python3 -I .claude/skills/shufit-manual/scripts/draft.py <스크래치>/lines.json <스크래치>/d.json   # 문항 초안
# 스크래치에 s<번호>.py: from mk import mk; mk(d.json, src.json, meta, 고침표 P, 고친 기록 F)
#   P = {문항 번호: {'rep': [(옛 글, 새 글)…], 'box': HTML, 'box2': …, 'stem'/'answer'/'opts'/'head'/'rows': …}}
```
- mk.py 가 〈보기〉 꺾쇠(‘<보기>’ → ‘〈보기〉’)와 밑줄 ‘않은’ → `<b><u>않은</u></b>`을 맞춘다.
- **한글 파일에서 빠지는 것 — PDF 를 그림으로 봐야 한다**(`pdftoppm -r 120 -png`): 보기 상자 안의 표(4-51 14번), 줄바꿈이 섞인 〈보기〉(초안은 줄마다 `<p>` — `<br>`로 다시 묶을 것), 빈칸 □·( ㉠ ) 자리, 표 첫 칸에 머리가 없는 표(4-55 18번 — rows 가 밀림).
- 정답 줄이 ‘[이감]’으로 된 파일도 있다(4-53). draft.py 가 둘 다 읽는다.
- PDF 글자 층에는 옛한글이 빠진다(4-49). 한글 파일이 없으면 원장님께 한글 파일을 부탁한다.
- **본문 쪽 [정답] 줄은 중간에 잘려 있을 수 있다** — 같은 내용이 답 상자 사본(lvl 2, ‘¶’로 시작)에 온전히 있으니 draft.py 가 더 긴 쪽을 쓴다. 해설이 잘려 보이면 보충하기 전에 사본부터 볼 것.
- 자주 나온 원문 문제: 선지·해설의 형태 불일치(‘-ᄉᆞᇦ-’/‘-ᅀᆞᇦ-’), 정답이 둘이 되는 선지, 같은 선지 두 개(고치지 말고 원장님께).
- **번호 = 장 번호로 칸 나누기**: id_from = 100000 + 100 × (장 − 47) + 1 (4-47 → 100001, 4-51 → 100401, 4-55 → 100801). 나중에 빠진 장을 넣어도 차례가 맞다.

## 2-1. src.json 모양
```json
{"set":"슈국 매뉴얼","src":"슈국 문법 매뉴얼 4-47 · 주격 조사","area":"국어사","lvl":"기본",
 "kind":"슈국","year":"2026","id_from":100001,"fixes":["고친 오타 기록…"],
 "items":[
  {"no":1,"type":"ox","stem":"…","answer":"X","good":"해설"},
  {"no":11,"type":"choice5","stem":"… <b><u>않은</u></b> 것은?","ans":3,"opts":["…×5"],"good":"정답 해설","bad":["① …","② …"]},
  {"no":12,"type":"short","stem":"…쓰시오.","box":"<p class=\"ctr\">밤, 새, 쇼[소]</p>","answer":"바미, 새, ᄉᆈ","good":"…"},
  {"no":18,"type":"choice5","stem":"…","ans":4,"box":"<p>…</p>","head":["㉮","㉯","㉰"],"rows":[["…","…","…"]×5],"good":"…"}
 ]}
```
- 글은 HTML(`<u>`·`<b>`). 옛한글은 그대로 적으면 도구가 `<span class="oh">`로 감싼다. 〈보기〉가 둘이면 `box2`.
- **id_from**: 이미 쓴 번호 다음부터 — `select max(id) from gbank_items where id >= 100000` 확인. 자료마다 src 가 달라야 한다(put 이 같은 src 의 빠진 번호를 숨김).
- **영역(area)·난도(lvl)**: 은행 12영역·기본/실력/심화 중. 중세·근대 국어는 '국어사'.
- **오타는 명백한 것만 고치고 fixes 에 적는다** — 정답이 둘이 되거나 해설·선지가 어긋나는 곳(4-47의 20번 ③ 솔의→술위 등). 판단이 필요한 것은 원장님께 묻는다.
- 문항마다 정답·해설 대조: 5지선다는 정답이 하나인지, OX 해설이 정답과 같은 방향인지, 단답 답이 해설과 같은지.

## 3. 만들기 → 올리기
```bash
cd /home/user/shueguk-report
python3 -I tools/gbank_manual.py build <스크래치>/src.json <스크래치>/out.json   # 검사 포함
python3 -I tools/gbank_manual.py put <스크래치>/out.json                         # 클로슈 계정(CLOSHU_TOKEN)
```
- `put` = 같은 id 덮어씀 + 같은 src 의 빠진 번호 숨김. 모의고사 도구(gbank_load.py)는 100000 아래만 건드린다.
- 확인(관리 API, api.supabase.com — 프록시가 인증, 401이면 request_credential):
  `select id, qtype, ans, answer, src from gbank_items where id between <from> and <to> order by id`

## 4. 문제지 저장 (원장님이 '문제지 출제'를 원하면)
- 여러 세트면 관리 API 한 번에: `insert into shufit_papers (teacher,title,ids,author,school) … on conflict (teacher,title) do nothing`.
- `shufit_papers`에 한 줄: teacher(원장님이면 '이수경')·title(그날 다른 문제지와 같은 꼴 — 예 `[1125]Shuefit 문법: 중세 국어 주격 조사 (20)`)·ids(문항 순서)·print_date·school(모르면 '').
- 같은 teacher·title 이 있으면 덮어쓸지 먼저 묻는다.
- 그러면 허브 Shuefit 문법 → [내 문제지함]에서 바로 인쇄·H WORK 출제가 된다(OX → ox, 단답 → essay 예시 답 비교 — 옛한글은 휴대폰으로 칠 수 없어 채점하지 않음).

## 5. 확인·보고
- 화면 검사: 허브 `LC_ALL=C.UTF-8 NODE_PATH=$(npm root -g) node tools/shufit-qtype-e2e.js`(구조를 바꿨을 때만).
- 원장님께: 문항 수(종류별)·문제지 이름·고친 오타 목록·확인이 필요한 곳을 쉬운 말로(하십시오체 70·해요체 30).
