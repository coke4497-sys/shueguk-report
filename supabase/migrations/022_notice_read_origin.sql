-- 022: 공지 확인(별 +1) — 수파베이스가 원본 (2026-08-26)
-- 학생 페이지의 공지 [확인했습니다 ⭐] 버튼(checkNotice)을 1:1로 옮긴 SECURITY DEFINER 함수.
-- 판정(이 학생에게 실제로 보이는 공지인지 — 임의 키로 별을 쌓는 것 방지, 중복 확인 차단)까지
-- 백엔드 checkNotice·collectNotices_와 동일. 공지 자체(notices)·별 보너스(star_bonus)·설정의
-- 원본은 여전히 리포트 시트 — 교사 저장이 백엔드 먼저 + 미러 갱신(종전 그대로).
--   · notice_read_submit(p{key|student, noticeKey}) → {result:'success', already} / {result:'error', message}

-- 학년 숫자 추출 (s.html gradeDigit 1:1 — 'n학년' → n, '고n' → n, 아니면 마지막 1~3 숫자)
create or replace function public.notice_grade_digit_(s text)
returns text language plpgsql immutable set search_path = public as $$
declare t text := regexp_replace(coalesce(s,''), '\s+', '', 'g'); m text[];
begin
  m := regexp_match(t, '([1-3])학년'); if m is not null then return m[1]; end if;
  m := regexp_match(t, '고([1-3])');   if m is not null then return m[1]; end if;
  m := regexp_match(reverse(t), '[1-3]');
  return coalesce(m[1], '');
end $$;

-- 학년 표준화 (s.html normGrade 1:1 — '고1'/'중3' 형태, 못 읽으면 '')
create or replace function public.notice_norm_grade_(s text)
returns text language plpgsql immutable set search_path = public as $$
declare t text := trim(coalesce(s,'')); lv text; m text[];
begin
  if t = '' then return ''; end if;
  lv := case when t like '%고%' then '고' when t like '%중%' then '중' when t like '%초%' then '초' else '' end;
  if lv = '' then return ''; end if;
  m := regexp_match(t, '([1-6])\s*학년');
  if m is null then m := regexp_match(t, '(?:고|중|초)\s*([1-6])'); end if;
  return case when m is null then '' else lv || m[1] end;
end $$;

-- 공지·배정 대상 판정 (s.html noticeMatches 1:1). 학교 느슨 비교는 clinic_school_loose_(같은 규칙) 재사용.
create or replace function public.notice_matches_(typ text, tgt text, nm text, sc text, gr text, sid text, code text)
returns boolean language plpgsql stable set search_path = public as $$
declare typ2 text := trim(coalesce(typ,'')); tgt2 text := trim(coalesce(tgt,''));
        toks text[]; t text; g text; sg text; gd text; ng text; lv_s text;
        gtoks text[]; tt text; td text; lv_t text; parts text[];
begin
  if typ2 like '%전체%' then return true; end if;
  if typ2 = '' and tgt2 = '' then return true; end if;
  toks := array(select x from unnest(regexp_split_to_array(tgt2, E'[,\n;/·\\s]+')) x where trim(x) <> '');
  if array_length(toks,1) is null then return false; end if;
  if typ2 like '%학년%' then
    g := regexp_replace(coalesce(gr,''), '\s+', '', 'g');
    sg := regexp_replace(coalesce(sc,'') || coalesce(gr,''), '\s+', '', 'g');
    gd := notice_grade_digit_(gr);
    ng := notice_norm_grade_(gr);
    lv_s := case when g like '%중%' then '중' when g like '%고%' then '고' else '' end;
    gtoks := array(select trim(x) from unnest(regexp_split_to_array(tgt2, E'[,\n;/·]+')) x where trim(x) <> '');
    foreach t in array gtoks loop
      tt := regexp_replace(t, '\s+', '', 'g');
      if tt = '' then continue; end if;
      td := notice_grade_digit_(tt);
      if td <> '' and gd <> '' and td <> gd then continue; end if;
      lv_t := case when tt like '%중%' then '중' when tt like '%고%' then '고' else '' end;
      if lv_t <> '' and lv_s <> '' and lv_t <> lv_s then continue; end if;
      if ng <> '' and notice_norm_grade_(tt) = ng then return true; end if;
      if tt = g or position(tt in sg) > 0 or (g <> '' and position(tt in g) > 0) then return true; end if;
    end loop;
    return false;
  end if;
  foreach t in array toks loop
    if position('|' in t) > 0 then
      parts := string_to_array(t, '|');
      if trim(coalesce(parts[1],'')) = '' or trim(coalesce(parts[1],'')) <> coalesce(nm,'') then continue; end if;
      if trim(coalesce(parts[2],'')) <> '' and coalesce(sc,'') <> ''
         and not clinic_school_loose_(trim(parts[2]), sc) then continue; end if;
      if trim(coalesce(parts[3],'')) <> '' and coalesce(gr,'') <> ''
         and regexp_replace(trim(parts[3]), '\s+', '', 'g') <> regexp_replace(gr, '\s+', '', 'g') then continue; end if;
      return true;
    elsif t = coalesce(nm,'') or (coalesce(sid,'') <> '' and t = sid) or (coalesce(code,'') <> '' and t = code) then
      return true;
    end if;
  end loop;
  return false;
end $$;

create or replace function public.notice_read_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text := trim(coalesce(p->>'key',''));
        sid_in text := trim(coalesce(p->>'student',''));
        nkey text := trim(coalesce(p->>'noticeKey',''));
        st record; v_sid text; v_nm text; v_sc text; v_gr text; v_code text;
        n_ok boolean; uniq boolean; dup boolean;
begin
  if (k = '' and sid_in = '') or nkey = '' then
    return jsonb_build_object('result','error','message','요청 정보가 부족합니다.');
  end if;
  if k <> '' then
    select * into st from students where trim(code) = k order by seq limit 1;
  else
    select * into st from students
     where regexp_replace(trim(student_id), '^''', '') = sid_in order by seq limit 1;
  end if;
  if not found then
    return jsonb_build_object('result','error','message','학생을 확인할 수 없습니다.');
  end if;
  v_sid := regexp_replace(trim(st.student_id), '^''', '');
  v_nm := trim(st.name); v_sc := trim(st.school); v_gr := trim(st.grade); v_code := trim(st.code);
  -- 이 학생에게 실제로 보이는 공지인지 확인 (백엔드 collectNotices_ 규칙)
  select exists (
    select 1 from notices n
    where not n.hidden
      and (trim(n.title) <> '' or trim(n.body) <> '')
      and (trim(coalesce(n.date,'')) || '|' || trim(n.title)) = nkey
      and notice_matches_(n.type, n.target, v_nm, v_sc, v_gr, v_sid, v_code)
  ) into n_ok;
  if not n_ok then
    return jsonb_build_object('result','error','message','해당 공지를 찾을 수 없습니다.');
  end if;
  -- 중복 확인 차단 (백엔드 readNoticeChecks_ 규칙 — 잠금으로 동시 클릭도 1회만)
  perform pg_advisory_xact_lock(hashtext('notice_read:' || v_nm || '|' || nkey));
  select count(*) = 1 into uniq from students where trim(name) = v_nm;
  select exists (
    select 1 from notice_reads r
    where trim(r.notice_key) = nkey
      and ( ( regexp_replace(trim(r.student_id), '^''', '') <> ''
              and v_sid <> ''
              and regexp_replace(trim(r.student_id), '^''', '') = v_sid
              and (trim(r.name) = '' or trim(r.name) = v_nm) )
         or ( regexp_replace(trim(r.student_id), '^''', '') = ''
              and trim(r.name) = v_nm
              and (uniq or trim(r.school) = '' or v_sc = ''
                   or clinic_school_loose_(trim(r.school), v_sc)) ) )
  ) into dup;
  if dup then return jsonb_build_object('result','success','already',true); end if;
  insert into notice_reads (at, student_id, name, school, notice_key)
  values (now(), v_sid, v_nm, v_sc, nkey);
  return jsonb_build_object('result','success','already',false);
end $$;

-- ── 권한: 학생 페이지(공개 키)는 제출 함수만 부를 수 있다 ─────────
revoke all on function public.notice_grade_digit_(text) from public;
revoke all on function public.notice_norm_grade_(text) from public;
revoke all on function public.notice_matches_(text, text, text, text, text, text, text) from public;
revoke all on function public.notice_read_submit(jsonb) from public;
grant execute on function public.notice_read_submit(jsonb) to anon, authenticated;
