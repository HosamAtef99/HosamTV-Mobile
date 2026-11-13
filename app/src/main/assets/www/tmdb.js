/* Hosam TV — TMDB rows ("الأكثر رواجًا", genres, Arabic/Turkish/Korean…) filtered to what exists on the
   user's IPTV server. Plain ES5 (TV runs Chrome 53). Matching is by normalised title (+ year when known)
   against the saved search index rows: [type 0=movie|1=series, id, name, icon, ext, rating, added]. */
(function () {
'use strict';
var T = window.TMDB = { key: '__TMDB_KEY__' === '__' + 'TMDB_KEY__' ? '' : '__TMDB_KEY__' };
var API = 'https://api.themoviedb.org/3/';
var DAY = 24 * 3600 * 1000;

T.rows = function (type) {
  var mv = type === 'movie';
  var base = mv ? 'discover/movie' : 'discover/tv';
  var list = [
    { title: 'الأكثر رواجًا هذا الأسبوع', path: mv ? 'trending/movie/week' : 'trending/tv/week', pages: 3 },
    { title: 'الأكثر شهرة', path: mv ? 'movie/popular' : 'tv/popular', pages: 3 },
    { title: 'الأعلى تقييمًا', path: mv ? 'movie/top_rated' : 'tv/top_rated', pages: 4 },
    { title: mv ? 'عربي' : 'مسلسلات عربي', path: base, q: 'with_original_language=ar&sort_by=popularity.desc', pages: 4 }
  ];
  if (!mv) {
    list.push({ title: 'تركي', path: base, q: 'with_original_language=tr&sort_by=popularity.desc', pages: 3 });
    list.push({ title: 'كوري', path: base, q: 'with_original_language=ko&sort_by=popularity.desc', pages: 3 });
  }
  var G = mv
    ? [[28, 'أكشن'], [35, 'كوميدي'], [18, 'دراما'], [27, 'رعب'], [53, 'إثارة'], [80, 'جريمة'], [878, 'خيال علمي'],
       [12, 'مغامرة'], [16, 'رسوم متحركة'], [10751, 'عائلي'], [10749, 'رومانسي'], [14, 'فانتازيا'], [99, 'وثائقي']]
    : [[18, 'دراما'], [35, 'كوميدي'], [80, 'جريمة'], [10759, 'أكشن ومغامرة'], [9648, 'غموض'],
       [10765, 'خيال علمي وفانتازيا'], [16, 'رسوم متحركة'], [10751, 'عائلي'], [99, 'وثائقي']];
  G.forEach(function (g) { list.push({ title: g[1], path: base, q: 'with_genres=' + g[0] + '&sort_by=popularity.desc&vote_count.gte=50', pages: 3 }); });
  return list;
};

function get(url) {
  return new Promise(function (res, rej) {
    var x = new XMLHttpRequest();
    var bearer = T.key.length > 40;
    x.open('GET', url + (bearer ? '' : (url.indexOf('?') < 0 ? '?' : '&') + 'api_key=' + encodeURIComponent(T.key)), true);
    if (bearer) x.setRequestHeader('Authorization', 'Bearer ' + T.key);
    x.timeout = 20000;
    x.onload = function () {
      if (x.status === 401) return rej(new Error('مفتاح TMDB مش شغال'));
      if (x.status < 200 || x.status >= 300) return rej(new Error('TMDB HTTP ' + x.status));
      try { res(JSON.parse(x.responseText)); } catch (e) { rej(e); }
    };
    x.onerror = function () { rej(new Error('مقدرتش أوصل لـ TMDB')); };
    x.ontimeout = function () { rej(new Error('TMDB اتأخر')); };
    x.send();
  });
}
// one TMDB list (several pages) → [[title, original_title, year], …], cached on the device for a day
function fetchList(def) {
  var ck = 'tmdb1:' + def.path + '?' + (def.q || '');
  try { var c = JSON.parse(localStorage.getItem(ck) || 'null'); if (c && Date.now() - c.ts < DAY) return Promise.resolve(c.r); } catch (e) {}
  var out = [], p = Promise.resolve();
  for (var i = 1; i <= def.pages; i++) (function (pg) {
    p = p.then(function () {
      return get(API + def.path + '?language=en-US&page=' + pg + (def.q ? '&' + def.q : '')).then(function (d) {
        (d.results || []).forEach(function (m) {
          out.push([m.title || m.name || '', m.original_title || m.original_name || '',
            String(m.release_date || m.first_air_date || '').slice(0, 4)]);
        });
      });
    });
  })(i);
  return p.then(function () {
    try { localStorage.setItem(ck, JSON.stringify({ ts: Date.now(), r: out })); } catch (e) {}
    return out;
  });
}

// title normalisation shared by server names and TMDB titles
var STOP = /\b(4k|uhd|fhd|hd|sd|1080p|720p|480p|hdr|web-?dl|bluray|multi|dubbed|subbed|مدبلج|مترجم|مترجمة|كامل)\b/gi;
function normTitle(s) {
  return String(s || '').toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/^[a-z]{2,3}\s*[|:-]\s+/i, ' ')                  // "EN - ", "AR | " prefixes
    .replace(STOP, ' ')
    .replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/&/g, ' and ').replace(/['’`]/g, '')
    .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x660); })
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/ (19|20)\d{2}$/, '')                           // trailing year
    .replace(/^(the|a|an) /, '');
}
function yearOf(name) {
  var m = String(name || '').match(/(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/g);
  return m ? m[m.length - 1].replace(/[^0-9]/g, '') : '';
}
var maps = {};
function buildMap(rows, type) {
  var t = type === 'movie' ? 0 : 1, byTY = {}, byT = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r[0] !== t) continue;
    var n = normTitle(r[2]);
    if (!n) continue;
    var y = yearOf(r[2]);
    if (y) { if (!byTY[n + '|' + y]) byTY[n + '|' + y] = r; }
    if (!byT[n]) byT[n] = r;
  }
  return { byTY: byTY, byT: byT, size: rows.length };
}
// returns server rows for one TMDB row definition, in TMDB order
T.load = function (def, type, rows) {
  var key = type + rows.length;
  if (!maps[key]) maps[key] = buildMap(rows, type);
  var mp = maps[key];
  return fetchList(def).then(function (list) {
    var out = [], seen = {};
    list.forEach(function (m) {
      var hit = null, names = [m[0], m[1]];
      for (var j = 0; j < names.length && !hit; j++) {
        var n = normTitle(names[j]);
        if (!n) continue;
        hit = (m[2] && mp.byTY[n + '|' + m[2]]) || mp.byT[n] || null;
      }
      if (hit && !seen[hit[1]]) { seen[hit[1]] = 1; out.push(hit); }
    });
    return out;
  });
};
T.ready = function () { return !!T.key; };
T._norm = normTitle;
})();
