-- 086: Shuefit 지문 검수 — 선생님이 올린 자료는 '검수 중'으로 들어가고 원장님이 [검수 완료]를 눌러야 출제에 쓴다
-- (2026-11-19 원장님 — 다른 선생님도 문항을 올림, 검수는 원장님만).
-- reading_passages.review = '검수 중' | '완료'(기본 — 지금까지 올린 지문은 모두 완료), uploaded_by(올린 사람), reviewed_by·reviewed_at.
-- 화면이 원장님(admin) 아니면 '검수 중' 지문을 숨긴다. 다시 실행해도 안전하다. 권한·정책은 079 그대로.
alter table public.reading_passages add column if not exists review text not null default '완료';
alter table public.reading_passages add column if not exists uploaded_by text not null default '';
alter table public.reading_passages add column if not exists reviewed_by text not null default '';
alter table public.reading_passages add column if not exists reviewed_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'reading_passages_review_check') then
    alter table public.reading_passages add constraint reading_passages_review_check check (review in ('검수 중','완료'));
  end if;
end $$;
comment on column public.reading_passages.review is '검수 중 | 완료 — 검수 중이면 원장님 화면에만 보인다(086).';
