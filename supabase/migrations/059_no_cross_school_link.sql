-- 059: 학교가 다른 학생의 기록을 잇지 않는다 (2026-10-24 원장님 "학교가 다른 데이터를 연결하지 마세요. 절대")
-- 출석 기록 이름 → 학생 대조(ch_who_ — attendance_history·class_history가 쓴다)에서
--  ① 등록 전 표기('이예준(입학예정)')는 아무 학생과도 잇지 않는다 — 끝의 A 대조로 화수고2 이예준A와 이어졌다
--  ② 앞 괄호 학교('(화정)심지후')가 있으면 그 학교 학생만 — 맞는 학생이 없으면 잇지 않는다(039는 그대로 두었다)
-- 039 본문에서 이 두 가지만 바꿨다. 다시 실행해도 안전.
create or replace function public.ch_who_(tok text)
returns bigint language plpgsql stable set search_path = public as $$
declare p text := public.ch_plain_(tok);
        sch text := coalesce(substring(coalesce(tok,'') from '^\s*\(([^)]*)\)'), '');
        ids bigint[];
begin
  if p = '' then return null; end if;
  if coalesce(tok,'') ~ '\(([^()]*(입학|예비|미정|입테|상담|체험)[^()]*)\)\s*$' then return null; end if;
  select array_agg(id) into ids from public.students s
   where s.name = p and btrim(coalesce(s.enrolled,'')) !~* '^(퇴원|n|no|off|x|중단|비재원)$';
  if ids is null and right(p, 1) = 'A' then
    select array_agg(id) into ids from public.students s
     where s.name = left(p, -1) and btrim(coalesce(s.enrolled,'')) !~* '^(퇴원|n|no|off|x|중단|비재원)$';
  end if;
  if ids is null then
    select array_agg(id) into ids from public.students s
     where s.name = p || 'A' and btrim(coalesce(s.enrolled,'')) !~* '^(퇴원|n|no|off|x|중단|비재원)$';
  end if;
  if ids is null then return null; end if;
  if sch <> '' then
    select array_agg(id) into ids from public.students s
     where s.id = any(ids) and s.school like sch || '%';
    if ids is null then return null; end if;
  end if;
  if array_length(ids, 1) = 1 then return ids[1]; end if;
  return null;
end $$;
revoke all on function public.ch_who_(text) from public;
