-- 018: 학생 연락처 (2026-08-26 사용자 요청)
-- 학생(필수)·학부모1(필수)·학부모2(주로 생략) 전체 번호를 학생정보에 저장한다.
-- 원본은 수파베이스(시트 '학생정보'에는 이 열이 없다 — 기존 8자리 열만 유지).
-- 신입 등록·슈스 링크 [수정]에서 기록·수정. student_bundle(학생 화면)에는 노출되지 않는다
-- ('me'가 열을 골라 담는 구조라 새 열은 자동으로 빠짐).
alter table public.students
  add column if not exists phone_student text not null default '',
  add column if not exists phone_parent1 text not null default '',
  add column if not exists phone_parent2 text not null default '';
