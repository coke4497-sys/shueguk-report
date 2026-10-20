#!/usr/bin/env node
// 스타룸 소재 검사 — starroom/ART-GUIDE.md 의 규칙을 기계로 확인한다.
// 사용: node tools/starroom-art-check.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'starroom');
const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog.json'), 'utf8'));
const SLOTS = ['top', 'base', 'shade', 'line', 'hi'];
// 색 칸 밖에서 쓸 수 있는 고정 색(장식·빛·그림자). 늘리려면 ART-GUIDE.md 와 함께.
const DECO = ['#FFFFFF', '#FFF1C2', '#FFF4CF', '#FFF6E2', '#FFF6DA', '#FFE29A', '#FFD978', '#F4C76A',
  '#F8E7BF', '#D3E3F2', '#F4D3D6', '#F6D3D5', '#F6C9CC', '#CFE2D6', '#E9C9A6', '#9CC2A4', '#7A6450'];
const ROOM_DECO = DECO.concat(['#CFE4F5', '#F8E9DD', '#FFF7DE', '#D9C9B6', '#CADFF2', '#BBD5C5']);
const BAN = [/<script/i, /<image/i, /<text/i, /<foreignObject/i, /href\s*=/i, /xlink:/i, /<animate/i, /on[a-z]+\s*=/i, /url\((?!#)/i, /@import/i];

let errors = 0;
function bad(file, msg) { errors++; console.log('✗ ' + file + ': ' + msg); }

function colorsIn(text) {
  const out = [];
  const re = /(fill|stroke|stop-color)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) out.push(m[2].trim());
  return out;
}

function checkFile(rel, opts) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return bad(rel, '파일이 없습니다');
  const t = fs.readFileSync(file, 'utf8');
  if (t.length > 20000) bad(rel, '20KB를 넘습니다(' + t.length + '바이트)');
  const vb = (t.match(/<svg[^>]*viewBox="([^"]+)"/) || [])[1];
  if (vb !== opts.viewBox) bad(rel, 'viewBox가 "' + opts.viewBox + '"가 아닙니다(' + vb + ')');
  BAN.forEach(function (re) { if (re.test(t)) bad(rel, '쓰면 안 되는 요소/속성: ' + re); });
  if (/<style/i.test(t) && !opts.allowStyle) bad(rel, '<style>은 방 배경에서만 씁니다');
  colorsIn(t).forEach(function (c) {
    if (c === 'none' || /^url\(#/.test(c)) return;
    const v = c.match(/^var\(--sr-([a-z-]+)(?:,\s*(#[0-9A-Fa-f]{6}))?\)$/);
    if (v) {
      if (opts.room ? !v[2] : SLOTS.indexOf(v[1]) < 0) bad(rel, '알 수 없는 색 칸: ' + c);
      return;
    }
    if (opts.deco.indexOf(c.toUpperCase()) < 0) bad(rel, '허용 목록에 없는 색: ' + c);
  });
  if (!opts.room) {
    if (!/var\(--sr-base\)/.test(t)) bad(rel, 'var(--sr-base) 칸을 쓰지 않았습니다(색이 안 바뀝니다)');
    if (/stroke="#(?:0|1|2|3)[0-9A-F]{5}"/i.test(t)) bad(rel, '진한 외곽선이 있습니다');
  }
}

cat.items.forEach(function (it) {
  Object.keys(it.shapes).forEach(function (sh) {
    const f = it.shapes[sh].file;
    if (f !== 'items/' + it.id + '-' + sh + '.svg') bad(f, '파일 이름은 items/<아이템>-<모양>.svg 입니다');
    checkFile(f, { viewBox: cat.itemViewBox, deco: DECO });
  });
});
checkFile('room.svg', { viewBox: cat.roomViewBox, deco: ROOM_DECO, room: true, allowStyle: true });

const n = cat.items.reduce(function (a, it) { return a + Object.keys(it.shapes).length; }, 0);
if (errors) { console.log('\n소재 검사 실패 ' + errors + '건'); process.exit(1); }
console.log('✓ 소재 검사 통과 — 아이템 ' + n + '개 · 방 배경 1개');
