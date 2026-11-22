-- 066: H WORK 화면 이탈 기록 (2026-11-12 원장님 "H WORK 하는 동안 휴대폰의 다른 알림이 안 뜨도록" →
-- 웹페이지는 알림을 막을 수 없어 ① 시작 전 방해 금지 모드 안내 ② 푸는 동안 다른 앱으로 넘어가거나
-- 화면을 끈 횟수·시간을 기록(막지는 않음)으로 정함.
-- hwork_submissions.away_n(횟수)·away_sec(초) + hwork_submit 이 p.away {n, sec} 를 받아 저장한다(064 본문 그대로 + 두 값).
-- 064 를 다시 돌리면 이 함수가 옛 본문으로 돌아가니 그 뒤 066 도 다시 돌릴 것.

alter table public.hwork_submissions add column if not exists away_n integer not null default 0;
alter table public.hwork_submissions add column if not exists away_sec integer not null default 0;

create or replace function public.hwork_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t text := coalesce(p->>'teacher',''); c text := coalesce(p->>'code','');
        hw record; d text; r jsonb; v_id bigint; v_key text; v_an int := 0; v_as int := 0;
        ts_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
begin
  select * into hw from hwork_homeworks where teacher = t and code = c limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'H WORK을 찾을 수 없습니다: ' || t || ' / ' || c);
  end if;
  d := hwork_due_(hw.due);
  if hwork_closed_(d) then
    return jsonb_build_object('ok', false, 'error', '마감된 과제입니다 (마감 ' || d || '). 선생님께 문의해 주세요.');
  end if;
  if hw.data is null or hw.data = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', '정답 데이터(C칸)가 비어 있습니다.');
  end if;
  r := hwork_grade_(hw.data, coalesce(p->'answers','{}'::jsonb));
  -- 화면 이탈(다른 앱·화면 끔) 횟수·초 — 화면이 센 값, 이상한 값은 0·상한으로
  if coalesce(p->'away'->>'n','') ~ '^\d{1,6}$' then v_an := least((p->'away'->>'n')::int, 9999); end if;
  if coalesce(p->'away'->>'sec','') ~ '^\d{1,9}$' then v_as := least((p->'away'->>'sec')::int, 86400); end if;
  v_key := replace(gen_random_uuid()::text, '-', '');
  insert into hwork_submissions (ts,teacher,code,school,grade,name,got,total,answers,detail,questions,retry_key,away_n,away_sec)
  values (ts_now, t, c, coalesce(p->>'school',''), coalesce(p->>'grade',''), coalesce(p->>'name',''),
          (r->>'got')::int, (r->>'total')::int,
          coalesce(p->'answers','{}'::jsonb), r->'detail', coalesce(p->'questions','{}'::jsonb), v_key, v_an, v_as)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'key', v_key,
    'result', jsonb_set(r, '{detail}', hwork_hide_wrong_(r->'detail')),
    'student', jsonb_build_object('teacher', t, 'code', c, 'school', coalesce(p->>'school',''),
                                  'grade', coalesce(p->>'grade',''), 'name', coalesce(p->>'name','')));
end $$;

revoke all on function public.hwork_submit(jsonb) from public;
grant execute on function public.hwork_submit(jsonb) to anon, authenticated;
