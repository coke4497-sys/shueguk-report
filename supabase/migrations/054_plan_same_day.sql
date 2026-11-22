-- 054: 27 예상 반 신청 — 가·나 수업은 같은 요일에 둘 수 없다 (2026-10-17 원장님 "정원 9명, 가나 수업은 동일한 요일 선택 안됨")
-- 053의 plan_pick은 같은 요일이면서 시작 시간이 120분 안일 때만 막았다(토 11:00 가 + 토 4:30 나는 통과했다).
-- 이제 같은 요일이면 시간과 상관없이 'clash'로 거절한다. 정원(cap, 기본 9) 판정은 그대로.
-- 053 다음에 실행한다. 다시 실행해도 안전하다.

create or replace function public.plan_pick(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.students%rowtype;
        cfg public.tt_plan_config%rowtype;
        r public.tt_plan_students%rowtype;
        v_plan text := coalesce(nullif(btrim(p->>'plan'), ''), '2027');
        v_part text := btrim(coalesce(p->>'part', ''));
        v_cls text := btrim(coalesce(p->>'cls', ''));
        c jsonb; o jsonb;
        v_other text; v_from text; n int;
begin
  me := public.review_me_(p);
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  if v_part not in ('가', '나') then return jsonb_build_object('ok', false, 'error', 'bad_part'); end if;
  perform pg_advisory_xact_lock(hashtext('tt_plan:' || v_plan));
  select * into cfg from public.tt_plan_config where plan = v_plan;
  if cfg.plan is null or not cfg.open then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  r := public.plan_row_(v_plan, btrim(coalesce(me.name, '')), btrim(coalesce(me.school, '')));
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'not_in_plan'); end if;
  v_from := case when v_part = '가' then r.ga else r.na end;
  v_other := case when v_part = '가' then r.na else r.ga end;
  if v_cls = '' then
    if v_part = '가' then return jsonb_build_object('ok', false, 'error', 'ga_required'); end if;
  else
    select x into c from jsonb_array_elements(cfg.classes) x where x->>'id' = v_cls limit 1;
    if c is null or c->>'part' <> v_part then return jsonb_build_object('ok', false, 'error', 'bad_class'); end if;
    if v_cls <> v_from then
      select count(*) into n from public.tt_plan_students s
       where s.plan = v_plan and not s.excluded and s.id <> r.id
         and (case when v_part = '가' then s.ga else s.na end) = v_cls;
      if n >= cfg.cap then return jsonb_build_object('ok', false, 'error', 'full'); end if;
    end if;
    if v_other <> '' then
      select x into o from jsonb_array_elements(cfg.classes) x where x->>'id' = v_other limit 1;
      if o is not null and o->>'day' = c->>'day' then
        return jsonb_build_object('ok', false, 'error', 'clash');
      end if;
    end if;
  end if;
  if v_cls is distinct from v_from then
    if v_part = '가' then
      update public.tt_plan_students set ga = v_cls, author = '학생 신청', updated_at = now() where id = r.id;
    else
      update public.tt_plan_students set na = v_cls, author = '학생 신청', updated_at = now() where id = r.id;
    end if;
    insert into public.tt_plan_log(plan, student, part, from_cls, to_cls, by)
    values (v_plan, r.student, v_part, coalesce(v_from, ''), v_cls, '학생 신청');
  end if;
  return public.plan_view(p);
end $$;

grant execute on function public.plan_pick(jsonb) to anon, authenticated;
