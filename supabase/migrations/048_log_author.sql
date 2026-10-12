-- 048: 시간표 이동·출석 기록에 '작성자' 칸 (2026-10-12 원장님 "작성자 칸을 더해 누가 이동했는지 알 수 있게")
-- 10/10 양준겸 반 이동(일 6:00 반으로 잘못 감)을 누가 했는지 기록에 남아 있지 않았다.
-- 슈국 스케쥴은 공용 교사 계정 하나로 쓰므로 auth.uid()로는 사람을 가릴 수 없다 — 화면이 허브 개인 로그인
-- 이름(teacher-name.js, 없으면 이 기기에 적어 둔 이름)을 author에 실어 보낸다. 빈 값 = 로그인하지 않고 쓴 기록.
-- 시트 사본('시간표이동기록'·'출석기록')에는 이 칸이 없다 — 원본(수파베이스)에만 남는다.

alter table public.tt_log     add column if not exists author text not null default '';
alter table public.attendance add column if not exists author text not null default '';
