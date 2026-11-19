-- 084: Shuefit 문학 — 독서와 같은 표·같은 화면(2026-11-19 원장님 "문학도 같은 틀로" → "화면 틀부터 먼저",
-- 묶는 단위 "작품 하나가 기본이고 지문에는 다른 작품이 섞여 있을 수 있어요").
-- 문학 작품(지문)·문항은 reading_passages·reading_items 에 그대로 담고 subject 로 가른다.
-- 지문에 여러 작품이 섞이면 reading_passages.data.works = [{title, author, genre}] (화면이 작품 꼬리표로 보인다), area = 갈래.
-- 문제지도 shufit_reading_papers 하나 — subject 를 더하고 열쇠 (subject, teacher, title) 를 더한다. 옛 열쇠 (teacher, title) 는
-- 배포 중인 옛 화면(on_conflict=teacher,title)이 깨지지 않게 남겨 둔다 — 그래서 한 선생님은 독서·문학에 같은 제목을 쓸 수 없다(화면이 막는다).
-- 다시 실행해도 안전하다. 권한·정책은 079·080 그대로(교사 전용, 공개 키 차단).

alter table public.reading_passages add column if not exists subject text not null default '독서';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'reading_passages_subject_check') then
    alter table public.reading_passages add constraint reading_passages_subject_check check (subject in ('독서','문학'));
  end if;
end $$;
create index if not exists reading_passages_subject_idx on public.reading_passages (subject, src desc, ord);

alter table public.shufit_reading_papers add column if not exists subject text not null default '독서';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'shufit_reading_papers_subject_check') then
    alter table public.shufit_reading_papers add constraint shufit_reading_papers_subject_check check (subject in ('독서','문학'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shufit_reading_papers_subject_teacher_title_key') then
    alter table public.shufit_reading_papers add constraint shufit_reading_papers_subject_teacher_title_key unique (subject, teacher, title);
  end if;
end $$;

comment on column public.reading_passages.subject is '독서 | 문학 — Shuefit 독서·문학 화면이 이 값으로 가른다(084).';
comment on column public.shufit_reading_papers.subject is '독서 | 문학 — 문제지가 어느 화면 것인지(084). 열쇠 = (subject, teacher, title).';
