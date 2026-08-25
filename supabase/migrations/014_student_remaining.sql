-- ============================================================
-- 3단계 ②-보완(2026-08-25): 학생 페이지에 남아 있던 표 접근 둘
--
-- s.html 을 함수 하나로 바꾼 뒤에도 두 군데가 표를 직접 건드리고 있었다:
--   · 공지 확인 기록(notice_reads) 넣기   → mirror_notice_read
--   · 슈퍼스타 TOP 30 읽기(star_ranking)  → star_top30
-- 둘 다 옮겨야 공개 키에서 표 권한을 회수할 수 있다.
--
-- star_ranking 은 원래 '학생 브라우저가 전교생 기록을 내려받지 않게' 만든 캐시 표라
-- 공개해도 되는 항목만 들어 있다(이름·학교·학년·별 수). 함수도 그 30줄만 돌려준다.
-- ============================================================

create or replace function public.mirror_notice_read(p jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notice_reads (at, student_id, name, school, notice_key)
  values (
    coalesce((p->>'at')::timestamptz, now()),
    coalesce(p->>'student_id',''), coalesce(p->>'name',''),
    coalesce(p->>'school',''), coalesce(p->>'notice_key',''));
$$;

create or replace function public.star_top30()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'rank', rank, 'name', name, 'school', school, 'grade', grade,
      'total', total, 'updated_at', updated_at) order by rank), '[]'::jsonb)
  from (select * from public.star_ranking order by rank limit 30) t;
$$;

revoke all on function public.mirror_notice_read(jsonb) from public;
revoke all on function public.star_top30() from public;
grant execute on function public.mirror_notice_read(jsonb) to anon, authenticated;
grant execute on function public.star_top30() to anon, authenticated;
