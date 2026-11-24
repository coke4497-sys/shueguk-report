#!/usr/bin/env python3
"""H WORK 질문 답장 초안 — 클로슈 순찰용 (2026-11-24 원장님 "질문에 대한 답을 자동으로 클로슈가 … 답장을 전송하기 전 제가 한번 확인").

  python3 tools/hwork_qa_draft.py feed [--days 30] > feed.json
      답장을 기다리는 학생 질문(그 문항의 마지막 글이 학생, 그 뒤 [잘 고쳤습니다] 없음, 그 글에 쓴 초안 없음)마다
      문제·지문·정답·해설·학생 답·오답하기 기록·대화 + 원장님 답장 예시를 묶어 낸다. 없으면 {"items": []}.
  python3 tools/hwork_qa_draft.py put drafts.json
      drafts.json = [{"sub_id", "q", "after_id", "kind": "초안"|"확인 필요", "body", "note"}] → 표 hwork_qa_drafts(리포트 092).
      학생에게는 가지 않는다 — 선생님이 채점·질문 확인 화면(H WORK hwork_result.html)에서 고쳐 [답장 보내기]를 눌러야 간다.
  python3 tools/hwork_qa_draft.py list
      아직 쓰지 않은 초안.

로그인은 tools/reading_load.py(클로슈 전용 계정 — 환경 비밀값 CLOSHU_TOKEN)를 그대로 쓴다.
"""
import html as H
import json
import os
import re
import sys
import urllib.parse as U
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import reading_load as R  # noqa: E402

KST = timezone(timedelta(hours=9))


def plain(h):
    t = re.sub(r'<br\s*/?>|</p>|</div>|</li>|</tr>', '\n', str(h or ''), flags=re.I)
    t = H.unescape(re.sub(r'<[^>]+>', ' ', t))
    t = re.sub(r'[ \t ]+', ' ', t)
    return re.sub(r'\n\s*\n+', '\n', t).strip()


def q_in(vals):
    return 'in.(' + ','.join('"' + str(v).replace('"', '') + '"' for v in vals) + ')'


def kst(ts):
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00')).astimezone(KST).strftime('%Y-%m-%d %H:%M')
    except Exception:
        return str(ts or '')


def get_all(path):
    out, off = [], 0
    while True:
        rows = R.rest('GET', path + ('&' if '?' in path else '?') + 'limit=1000&offset=%d' % off) or []
        out += rows
        if len(rows) < 1000:
            return out
        off += 1000


def question_of(sub, q, cache):
    """그 과제 n번의 문제·지문·정답·해설(있는 만큼)."""
    key = (sub['teacher'], sub['code'])
    if key not in cache:
        hw = R.rest('GET', '/hwork_homeworks?select=data&teacher=eq.%s&code=eq.%s&limit=1'
                    % (U.quote(sub['teacher']), U.quote(sub['code']))) or []
        d = (hw[0]['data'] if hw else {}) or {}
        info = {'items': d.get('items') or {}, 'bank': d.get('bank') or {}, 'src': {}, 'gb': {}, 'pas': {}}
        if info['bank']:
            ids = sorted({int(v) for v in info['bank'].values() if str(v).isdigit()})
            if ids:
                for g in R.rest('GET', '/gbank_items?select=id,html,pid,ans,good,bad,area,lvl,src&id=in.(%s)'
                                % ','.join(map(str, ids))) or []:
                    info['gb'][g['id']] = g
                pids = {g['pid'] for g in info['gb'].values() if g.get('pid')}
                if pids:
                    for p in R.rest('GET', '/gbank_passages?select=pid,html&pid=' + U.quote(q_in(pids))) or []:
                        info['pas'][p['pid']] = p['html']
        else:
            rows = R.rest('GET', '/hwork_src_items?select=no,html,pid,ans,type,expl,wrong,err&code=eq.'
                          + U.quote(sub['code'])) or []
            for x in rows:
                info['src'][str(x['no'])] = x
            pids = {x['pid'] for x in rows if x.get('pid')}
            if pids:
                for p in R.rest('GET', '/hwork_src_passages?select=pid,html&pid=' + U.quote(q_in(pids))) or []:
                    info['pas'][p['pid']] = p['html']
        cache[key] = info
    info = cache[key]
    it = info['items'].get(str(q)) or {}
    out = {'type': it.get('type', ''), 'answer_key': it.get('ans', ''), 'source': ''}
    gid = info['bank'].get(str(q))
    if gid is not None and int(gid) in info['gb']:
        g = info['gb'][int(gid)]
        out.update(source='문법 문항 은행 %s (%s·%s · %s)' % (g['id'], g.get('area', ''), g.get('lvl', ''), g.get('src', '')),
                   question=plain(g['html']), passage=plain(info['pas'].get(g.get('pid'), '')),
                   answer=str(g.get('ans', '')), explanation=plain(g.get('good')),
                   wrong_explanations=[plain(b) for b in (g.get('bad') or [])])
    elif str(q) in info['src']:
        x = info['src'][str(q)]
        out.update(source='교재 원문(hwork_src_items)', question=plain(x['html']),
                   passage=plain(info['pas'].get(x.get('pid'), '')), answer=x.get('ans', ''),
                   explanation=x.get('expl') or '', wrong_explanations=[x['wrong']] if x.get('wrong') else [],
                   marked_error=bool(x.get('err')))
    else:
        out.update(question='', passage='', answer=str(it.get('ans', '')), explanation='',
                   note='문제 원문이 DB 에 없는 과제 — 학생 질문·정답만으로 답한다(지어내지 말 것).')
    return out


def style_examples(n=4):
    rows = R.rest('GET', '/hwork_qa?select=name,body,at&who=eq.%s&order=id.desc&limit=80' % U.quote('선생님')) or []
    ex = [r for r in rows if len(r['body'] or '') >= 250 and '수업 시간에 직접 설명' not in r['body']]
    return [{'name': r['name'], 'at': kst(r['at']), 'body': r['body']} for r in ex[:n]]


def feed(days=30):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    qa = get_all('/hwork_qa?select=id,sub_id,q,who,name,body,mine,at&at=gte.%s&order=id' % U.quote(since))
    by = {}
    for m in qa:
        by.setdefault((m['sub_id'], str(m['q'])), []).append(m)
    wait = {k: v for k, v in by.items() if v[-1]['who'] == '학생'}
    if not wait:
        return {'items': []}
    subs = {}
    sids = sorted({k[0] for k in wait})
    for i in range(0, len(sids), 100):
        for s in R.rest('GET', '/hwork_submissions?select=id,name,school,grade,teacher,code,detail,review,checked&id=in.(%s)'
                        % ','.join(map(str, sids[i:i + 100]))) or []:
            subs[s['id']] = s
    done = set()
    try:
        for d in get_all('/hwork_qa_drafts?select=sub_id,q,after_id&sub_id=in.(%s)' % ','.join(map(str, sids))):
            done.add((d['sub_id'], str(d['q']), d['after_id']))
    except Exception as e:  # 092 전
        raise SystemExit('hwork_qa_drafts 표가 없습니다(리포트 마이그레이션 092 적용 전): %s' % e)
    cache, items = {}, []
    for (sid, q), msgs in sorted(wait.items(), key=lambda kv: kv[1][-1]['id']):
        last = msgs[-1]
        s = subs.get(sid)
        if not s or (sid, q, last['id']) in done:
            continue
        chk = ((s.get('checked') or {}).get(q) or {}).get('at')
        if chk and chk >= kst(last['at']):
            continue
        det = (s.get('detail') or {}).get(q) or {}
        rv = (s.get('review') or {}).get(q) or {}
        items.append({
            'sub_id': sid, 'q': q, 'after_id': last['id'],
            'student': {'name': s['name'], 'school': s['school'], 'grade': s['grade']},
            'teacher': s['teacher'], 'homework': s['code'],
            'first_answer': {'mine': det.get('mine'), 'ok': det.get('ok'), 'key': det.get('ans')},
            'retry': {'tries': rv.get('tries') or [], 'cleared_at': rv.get('cleared_at'), 'help': rv.get('help')},
            'thread': [{'who': m['who'], 'name': m['name'], 'at': kst(m['at']), 'body': m['body'], 'mine_then': m.get('mine') or ''}
                       for m in msgs],
            'item': question_of(s, q, cache),
        })
    return {'items': items, 'style_examples': style_examples() if items else []}


def put(path):
    rows = json.load(open(path, encoding='utf-8'))
    out = []
    for r in rows:
        kind = r.get('kind') or '초안'
        if kind not in ('초안', '확인 필요'):
            raise SystemExit('kind 는 초안 / 확인 필요: %r' % kind)
        body = str(r.get('body') or '').strip()
        if not body or len(body) > 5000:
            raise SystemExit('body 가 비었거나 5000자를 넘습니다: %s %s' % (r.get('sub_id'), r.get('q')))
        if '—' in body:
            raise SystemExit('긴 가로줄(—)은 쓰지 않습니다(작업 메모 총평 규칙): %s %s' % (r.get('sub_id'), r.get('q')))
        out.append({'sub_id': int(r['sub_id']), 'q': str(r['q']), 'after_id': int(r['after_id']), 'kind': kind,
                    'body': body, 'note': str(r.get('note') or '')[:1000], 'made_by': '클로슈'})
    if out:
        R.rest('POST', '/hwork_qa_drafts?on_conflict=sub_id,q,after_id', out,
               prefer='resolution=ignore-duplicates,return=minimal')
    print('초안 %d개를 올렸습니다.' % len(out))


def lst():
    rows = R.rest('GET', '/hwork_qa_drafts?select=id,sub_id,q,after_id,kind,created_at&used_at=is.null&dismissed_at=is.null&order=id') or []
    for r in rows:
        print(r['id'], r['sub_id'], r['q'] + '번', r['kind'], kst(r['created_at']))
    print('%d개' % len(rows))


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a or a[0] not in ('feed', 'put', 'list'):
        print(__doc__)
        sys.exit(1)
    if a[0] == 'feed':
        days = int(a[a.index('--days') + 1]) if '--days' in a else 30
        print(json.dumps(feed(days), ensure_ascii=False, indent=1))
    elif a[0] == 'put':
        put(a[1])
    else:
        lst()
