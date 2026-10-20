/* 스타룸 그림 그리기 — 카탈로그·SVG 소재를 읽어 방을 그린다.
 * 소재 SVG는 색 칸(var(--sr-top/base/shade/line/hi))만 비워 두고, 여기서 고른 색으로 채운다.
 * 경로는 이 스크립트 위치 기준이라 GitHub Pages /shueguk-report/ 아래에서도 그대로 동작한다. */
(function () {
  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/[^/]*$/, '') : 'starroom/';
  })();
  var cache = {}, catP = null, seq = 0;

  function mix(hex, to, k) {
    var a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
    var r = Math.round(((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k);
    var g = Math.round(((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k);
    var bl = Math.round((a & 255) * (1 - k) + (b & 255) * k);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
  }
  // 기본 색 하나에서 다섯 칸을 만든다(그림 쪽은 칸 이름만 쓴다).
  function slots(base) {
    return {
      top: mix(base, '#FFFFFF', 0.42), base: base, shade: mix(base, '#B49A8A', 0.22),
      line: mix(base, '#6F5A4C', 0.38), hi: mix(base, '#FFFFFF', 0.75)
    };
  }
  function catalog() {
    if (!catP) catP = fetch(BASE + 'catalog.json').then(function (r) { return r.json(); });
    return catP;
  }
  function svgText(path) {
    if (!cache[path]) cache[path] = fetch(BASE + path).then(function (r) {
      if (!r.ok) throw new Error('소재를 불러오지 못했습니다: ' + path);
      return r.text();
    });
    return cache[path];
  }
  // 한 화면에 같은 그림을 여러 번 넣으면 id가 겹치므로 붙일 때마다 바꾼다.
  function uniq(text) {
    var n = ++seq;
    return text.replace(/\bid="([^"]+)"/g, 'id="$1-' + n + '"').replace(/url\(#([^)]+)\)/g, 'url(#$1-' + n + ')');
  }
  function itemOf(cat, kind) {
    for (var i = 0; i < cat.items.length; i++) if (cat.items[i].id === kind) return cat.items[i];
    return null;
  }
  // el 안에 아이템 하나를 그린다.
  function paint(el, kind, shape, color) {
    return catalog().then(function (cat) {
      var it = itemOf(cat, kind), sh = it && it.shapes[shape], c = cat.colors[color];
      if (!sh || !c) throw new Error('없는 아이템: ' + kind + '-' + shape + ' / ' + color);
      return svgText(sh.file).then(function (t) {
        var s = slots(c.base);
        el.innerHTML = uniq(t);
        var svg = el.querySelector('svg');
        svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.display = 'block'; svg.style.overflow = 'visible';
        ['top', 'base', 'shade', 'line', 'hi'].forEach(function (k) { el.style.setProperty('--sr-' + k, s[k]); });
        return el;
      });
    });
  }
  function spotPos(cat, spot, items) {
    var sp = cat.spots[spot];
    if (!sp) return null;
    if (sp.on) {
      var base = null;
      items.forEach(function (x) { if (x.kind === sp.on && cat.spots[x.spot] && !cat.spots[x.spot].on) base = x; });
      if (!base) return null;
      var b = cat.spots[base.spot], dy = (itemOf(cat, sp.on).surfaceDy || 0) * cat.itemScale;
      return { x: b.x, y: b.y + dy, z: b.y + 11 };
    }
    return { x: sp.x, y: sp.y, z: sp.layer === 'rug' ? -999 : sp.y };
  }
  // container 안에 방 + 놓인 아이템을 그린다. items = [{kind, shape, color, spot}]
  function room(container, items) {
    return catalog().then(function (cat) {
      return svgText('room.svg').then(function (t) {
        var K = cat.itemScale;
        container.style.position = 'relative';
        container.style.aspectRatio = '320 / 260';
        container.innerHTML = '<div class="sr-bg" style="position:absolute;inset:0">' + t + '</div>';
        var bg = container.querySelector('svg');
        bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('aria-hidden', 'true');
        var list = (items || []).map(function (x) { return { x: x, p: spotPos(cat, x.spot, items) }; })
          .filter(function (o) { return o.p; })
          .sort(function (a, b) { return a.p.z - b.p.z; });
        return Promise.all(list.map(function (o, i) {
          var d = document.createElement('div');
          d.className = 'sr-item';
          d.dataset.spot = o.x.spot;
          d.style.cssText = 'position:absolute;pointer-events:none;' +
            'left:' + ((o.p.x - 60 * K) / 320 * 100) + '%;top:' + ((o.p.y - 100 * K) / 260 * 100) + '%;' +
            'width:' + (120 * K / 320 * 100) + '%;height:' + (130 * K / 260 * 100) + '%;z-index:' + (i + 1);
          container.appendChild(d);
          return paint(d, o.x.kind, o.x.shape, o.x.color);
        }));
      });
    });
  }
  window.SRArt = { catalog: catalog, paint: paint, room: room, slots: slots, base: BASE };
})();
