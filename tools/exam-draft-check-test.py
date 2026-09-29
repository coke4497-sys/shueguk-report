#!/usr/bin/env python3
"""tools/exam_draft.py 의 초안 형식 검사(validate) 검증 — 네트워크 없이.  python3 tools/exam-draft-check-test.py"""
import copy
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from exam_draft import validate  # noqa: E402

GOOD = {
    'text': '1. …', 'scope': '천재(정) 1~3단원', 'answers': [{'no': '1', 'ans': '③'}],
    'review': ['## 출제 경향', '- 문학 비중이 컸습니다.'], 'notes': [],
    'questions': [
        {'no': '1', 'group': '', 'area': '화법', 'detail': '', 'type': '객관식', 'lv': '중', 'txt': '말하기 방식의 특징', 'multi': False},
        {'no': '2', 'group': '(가) 현대시', 'area': '문학', 'detail': '현대시', 'type': '객관식', 'lv': '상', 'txt': '표현상의 특징과 그 효과'},
        {'no': '3', 'group': '(가) 현대시', 'area': '문학', 'detail': '현대시', 'type': '서술형', 'lv': '최상', 'txt': '<보기>를 바탕으로 지문 이해\n<보기>: 작가 연보'},
    ],
}
passed = failed = 0


def case(name, mut, want):
    global passed, failed
    d = copy.deepcopy(GOOD)
    mut(d)
    errs = validate(d)
    hit = any(want in e for e in errs) if want else not errs
    if hit:
        passed += 1
    else:
        failed += 1
        print('✗', name, errs)


case('정상', lambda d: None, None)
case('영역 없음', lambda d: d['questions'][0].update(area='비문학'), '영역')
case('세부유형 목록 밖', lambda d: d['questions'][1].update(detail='시'), '세부유형')
case('세부유형 비어 있음', lambda d: d['questions'][1].update(detail=''), '세부유형이 비어')
case('난이도', lambda d: d['questions'][0].update(lv='하'), '난이도')
case('형식', lambda d: d['questions'][0].update(type='단답'), '형식')
case('번호 중복', lambda d: d['questions'][2].update(no='2'), '두 번')
case('내용 비어 있음', lambda d: d['questions'][0].update(txt=' '), '내용이 비어')
case('묶음 안 영역 다름', lambda d: d['questions'][2].update(area='독서', detail='인문'), '묶음')
case('묶음 떨어짐', lambda d: d['questions'].append(dict(d['questions'][1], no='4')) or d['questions'].insert(3, dict(d['questions'][0], no='9')), '떨어져')
case('문항 없음', lambda d: d.update(questions=[]), 'questions')
case('총평 빈 문단', lambda d: d.update(review=['']), 'review')
case('정답 형식', lambda d: d.update(answers=[{'no': '1'}]), 'answers')
case('목록 밖 문항 내용', lambda d: d['questions'][0].update(txt='화자의 태도 서술하기'), '드롭다운 목록')
case('<보기> 꼬리표 잘못', lambda d: d['questions'][0].update(txt='말하기 방식의 특징\n<보기>: 자료'), '꼬리표')
print('통과 %d · 실패 %d' % (passed, failed))
sys.exit(1 if failed else 0)
