# 작업 메모 (이수경국어 · 슈국)

## 브랜드
- 폰트: **고운 바탕(Gowun Batang) + 고운 돋움(Gowun Dodum)**
- 아이콘: 가는 라인 스트로크 SVG, 색상: 세이지 그린 계열
- **UI에 컬러 이모지 아이콘(🔍 ✏️ 등)을 사용하지 않는다** — 버튼·입력창·라벨의 아이콘은 라인 SVG 또는 텍스트만 사용 (사용자 확정 지침, 2026-08-14)
  - 예외: 만점(100%) 표시의 🏆 같은 성취 표시 이모지는 유지 (사용자 확정)

## 정규 시간표 시스템 (2026-08-14 구축)
- **교사 페이지**: `timetable.html` — 요일별 그리드(담당T×시간)로 반·학생 확인, 학생 이름 클릭→옮길 반 클릭으로 이동. 비밀번호는 백엔드 TEACHER_PW.
- **원본 데이터**: 리포트 스프레드시트의 **'정규시간표' 탭** (A:반ID B:요일 C:시작 D:끝 E:위치 F:담당T G:반이름 H:학생명단 공백구분)
- 학생 이동 시 백엔드(`timetableMove`)가 '학생정보' 탭의 정규가(G)/나(H) 열도 자동 갱신 → 학생 개별 페이지(s.html)·숙제 검사(hwcheck.html)에 즉시 반영.
  - 반이름 끝 '가'→정규가, '나'→정규나, 고3파이널·정리정독 등 단일 수업→정규가, '논술'은 학생정보 미반영.
- 구글시트 「★2026정규수업」은 슈의 참고용 원본 — **자동 동기화되지 않음**. 사용자가 "구글시트에서 시간표 다시 가져와줘" 하면: 시트 첫 탭을 읽어(병합셀 포함 파싱) `timetableSaveAll`로 전체 교체. (2026-08-14 세션에서 한 방법: clasp 로그인 → 백엔드에 임시 tmpDumpSheet 액션을 별도 배포로 추가해 시트 값+병합 읽기 → 파싱 → 임시 배포 삭제·코드 복구. 요일 헤더 행 2개(수목금/토일), 위치·담당T 행, 30분 시간축 구조.)

## 🚀 Apps Script(.gs) 재배포 방법 — 클로드(Claude)용 메모

이 계정(coke4497)의 Apps Script 백엔드는 **clasp**(구글 공식 CLI)로 명령줄에서 재배포할 수 있다.
사용자가 편집기에 복붙 후 수동 재배포할 필요 없이, 클로드가 `.gs`를 고치고 배포까지 한다.

**사용자는 비기술자다.** 지시는 아주 짧고 쉽게(“링크 클릭 → 허용 → 주소 붙여넣기” 수준)만 요청할 것.
사용자가 “앱스스크립트 배포해줘”라고 하면 아래 절차를 클로드가 알아서 수행한다.

### 전제
- 환경의 **네트워크 액세스 = 신뢰됨**이어야 googleapis 접속 가능(현재 OK).
- 이 환경엔 안전한 비밀 저장소가 없다(환경변수 칸은 공개됨). **토큰을 저장소/환경변수에 절대 넣지 말 것.** → 세션마다 아래 로그인 1회.

### 1) 설치
```bash
npm i -g @google/clasp   # 이미 있으면 생략
```

### 2) 로그인 (브라우저 필요 — 사용자 1분)
```bash
rm -f /tmp/co /tmp/cf; mkfifo /tmp/cf
( sleep 1800 > /tmp/cf ) &                                   # fifo write-end 유지
setsid bash -c 'clasp login --no-localhost < /tmp/cf > /tmp/co 2>&1' &
sleep 9; cat /tmp/co                                         # accounts.google.com URL 출력
```
- 출력된 **`https://accounts.google.com/...` URL**을 사용자에게 전달 → 사용자: **coke4497 계정으로** 열기 → 모두 **허용** → 리다이렉트된 **`http://localhost:8888/?...code=...` 주소 전체**를 복사해 전달.
- 받은 URL을 fifo로 전달해 완료:
```bash
printf '%s\n' '<사용자가-준-localhost-주소-전체>' > /tmp/cf
sleep 4; cat /tmp/co            # "Authorization successful" / ~/.clasprc.json 생성 확인
```
- 확인: `~/.clasprc.json`에 `tokens.default.refresh_token` 있으면 성공.

### 3) 배포 (프로젝트별)
```bash
mkdir -p /tmp/proj && cd /tmp/proj
printf '{"scriptId":"<SCRIPT_ID>"}' > .clasp.json
clasp pull -f                        # 현재 코드+appsscript.json 내려받기
cp <저장소의-최신-.gs> ./Code.gs     # pull 로 받은 코드 파일명에 맞춰 교체
clasp push -f
clasp deployments                    # 배포 목록 확인
clasp deploy -i <DEPLOYMENT_ID>      # 기존 배포 새 버전(= exec 주소 그대로 유지)
```
- **DEPLOYMENT_ID** = 웹앱 주소 `/macros/s/`**`<이 부분>`**`/exec` 문자열(아래 표).
- **SCRIPT_ID**는 아직 미확보 → 처음 한 번 사용자에게 요청: “Apps Script 편집기 → ⚙️프로젝트 설정 → **스크립트 ID** 복사해서 알려주세요.” 알게 되면 아래 표에 채워 넣고 커밋해 둘 것.

### 프로젝트별 정보
| 프로젝트 | 저장소의 코드 파일 | DEPLOYMENT_ID (exec의 AKfycb… 부분) | SCRIPT_ID |
|---|---|---|---|
| OMR 채점 | `shuegukweekendtest/omr_code.gs` | `AKfycbyUHMdCH_u35Oeu6lEmx3yOYscoKLwEB8TC0QHGBOaCXZ4rbAnkMpP9_Na4l3QLOajGPA` | `1xfBA8bK-eBdosawcefdMOGm3dS3EC4oztM3q2rCQP_S3G41iXs54nEeG` |
| 주말 신청 | `shuegukweekendtest/signup_code.gs` | `AKfycbzdqac0xTnCaOo_t_2swJQqdfxjiA14sTo-ThTV8VvwcwaTucM1MQGeJfMfV4lNLM75` | `16G_RAaxC_g3LR5LwEjTgbqrKCaRS-FXa1FFWryVSRhyLEaOaHoz9Uzgp` |
| 리포트/공지 | `shueguk-report/backend-createReport.gs` | `AKfycbzhCncBwn-JlqXARC3wfrWUCuNHzlNK2df0bdhx-w78Xr8mzYUcIYZOJdRi9N4bHtsb` | `13qQ2fq-k8s_EAAhKjxEMN9GR_DpRp1VZDDV4SWGJS3DBVBgdM9hps2uP` |
| 어휘 | `shueguk-voca/apps-script/Code.gs` | `AKfycbxW4aXPUq9Iu3VtnjHuInUxhG6dPaNIYawDRWTYEjvEIsv4kjEceXDb_y9OX5Lx3-9e` | `1Q4Jrt1wVymBfWBb18_hUno4xI5VUD5NH2bLvZOtbEzCObBRQk5zjbhZe` |
| H WORK | `shueguk-h-work/apps-script/Code.gs` | `AKfycbyrc0j6EmVLrlfZeSchetAcEzWPEFAEV1RHStr6ZTJPDJeH6pcvRDemfWU64puojmSDPg` | `1bYZrb9ACZ-QAfsEjcpdL94rVbw_Y9dskaL1vkCJniVUGSGwHZ8U2VG1G` |

> 참고: 토큰은 세션마다 새로 로그인해 얻는다(저장 안 함). refresh_token 재사용은 안전한 비밀 저장소가 생기면 그때 도입.
