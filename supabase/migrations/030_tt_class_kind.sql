-- 030: '이 주만' 반의 수업 종류 (2026-09-20 사용자 요청 — 주차별에서 새로 만드는 반이
--      직전보강 수업임을 알리는 표시. 오늘·주차별 카드에 빨간 동그라미 '직'으로 표시)
-- 값: '' (보통 수업) / '직보' (직전보강). 나중에 다른 종류를 더할 수 있게 자유 문자열.
-- 시트 사본에는 이 열이 없다 — '이 주만' 반(w*) 자체가 시트에 없으므로 차이 없음.
alter table tt_classes add column if not exists kind text not null default '';
comment on column tt_classes.kind is '수업 종류 — 빈 값=보통, 직보=직전보강 (주로 이 주만 반)';
