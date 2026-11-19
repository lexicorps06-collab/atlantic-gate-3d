/* Atlantic Gate — original 3D port scene.
   Plain WebGL2, no libraries: modelled RTG crane, container stacks, semi-truck,
   quay, sea and distant port; soft sun shadows, height-field ambient occlusion,
   GGX reflections, ACES tone mapping. Usage:
     var s = AGScene(canvas); s.render(t)   // t = animation progress 0..1
*/
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ math */
  function m4() { var m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
  function mul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  function T(x, y, z) { var m = m4(); m[12] = x; m[13] = y; m[14] = z; return m; }
  function S(x, y, z) { var m = m4(); m[0] = x; m[5] = y; m[10] = z; return m; }
  function RX(a) { var m = m4(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
  function RY(a) { var m = m4(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
  function RZ(a) { var m = m4(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
  function chain() { var m = m4(); for (var i = 0; i < arguments.length; i++) m = mul(m, arguments[i]); return m; }
  function persp(fovy, asp, n, f) {
    var t = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f); return m;
  }
  function ortho(l, r, b, t, n, f) {
    var m = m4();
    m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
    m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); return m;
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function lookAt(e, c, up) {
    var z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x), m = m4();
    m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
    m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
    m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
    m[12] = -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]);
    m[13] = -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]);
    m[14] = -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]);
    return m;
  }
  function xf(m, p, w) {
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12] * w,
            m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13] * w,
            m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14] * w];
  }
  function srgb(h) {
    var n = parseInt(h.slice(1), 16);
    return [Math.pow(((n >> 16) & 255) / 255, 2.2), Math.pow(((n >> 8) & 255) / 255, 2.2), Math.pow((n & 255) / 255, 2.2)];
  }
  var clamp = function (x, a, b) { return Math.min(b, Math.max(a, x)); };
  var smooth = function (a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  /* -------------------------------------------------------------- geometry */
  // Every primitive keeps its own local position + normal (for procedural detail).
  function G() { return { p: [], n: [], l: [], o: [] }; }
  function pushV(g, p, n, l, o) { g.p.push(p[0], p[1], p[2]); g.n.push(n[0], n[1], n[2]); g.l.push(l[0], l[1], l[2]); g.o.push(o[0], o[1], o[2]); }

  // Box with rounded edges (bevel radius r). Size w,h,d centred at origin.
  function rbox(w, h, d, r, seg) {
    seg = seg || 3; r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    var g = G(), H = [w / 2, h / 2, d / 2];
    function samples(hh) {
      var s = [-hh];
      if (r > 0) { for (var k = 1; k <= seg; k++) s.push(-hh + r * (1 - Math.cos(k / seg * Math.PI / 2))); }
      s.push(hh - r); if (r > 0) { for (k = seg - 1; k >= 1; k--) s.push(hh - r * (1 - Math.cos(k / seg * Math.PI / 2))); }
      s.push(hh);
      var u = []; s.forEach(function (v) { if (!u.length || Math.abs(v - u[u.length - 1]) > 1e-6) u.push(v); });
      return u;
    }
    var faces = [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]];
    faces.forEach(function (f) {
      var ax = f[0], a1 = f[1], a2 = f[2], sg = f[3];
      var U = samples(H[a1]), V = samples(H[a2]);
      var grid = [];
      for (var i = 0; i < U.length; i++) for (var j = 0; j < V.length; j++) {
        var q = [0, 0, 0]; q[ax] = sg * H[ax]; q[a1] = U[i]; q[a2] = V[j];
        var inn = [clamp(q[0], -(H[0] - r), H[0] - r), clamp(q[1], -(H[1] - r), H[1] - r), clamp(q[2], -(H[2] - r), H[2] - r)];
        var dn = sub(q, inn), L = Math.hypot(dn[0], dn[1], dn[2]);
        var nn; if (L < 1e-6) { nn = [0, 0, 0]; nn[ax] = sg; } else nn = [dn[0] / L, dn[1] / L, dn[2] / L];
        var pp = r > 0 ? [inn[0] + nn[0] * r, inn[1] + nn[1] * r, inn[2] + nn[2] * r] : q;
        var fo = [0, 0, 0]; fo[ax] = sg;
        grid.push([pp, nn, fo]);
      }
      var nv = V.length;
      for (i = 0; i < U.length - 1; i++) for (j = 0; j < nv - 1; j++) {
        var A = grid[i * nv + j], B = grid[(i + 1) * nv + j], C = grid[(i + 1) * nv + j + 1], D = grid[i * nv + j + 1];
        // keep counter-clockwise winding seen from outside
        var e1 = sub(B[0], A[0]), e2 = sub(C[0], A[0]), cr = cross(e1, e2), out = cr[0] * A[1][0] + cr[1] * A[1][1] + cr[2] * A[1][2];
        var tri = out >= 0 ? [A, B, C, A, C, D] : [A, C, B, A, D, C];
        tri.forEach(function (v) { pushV(g, v[0], v[1], v[0], v[2]); });
      }
    });
    return g;
  }
  // Cylinder along local Y.
  function cyl(rad, h, segs, caps) {
    segs = segs || 28; var g = G(), y0 = -h / 2, y1 = h / 2;
    for (var i = 0; i < segs; i++) {
      var a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2;
      var c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      var p00 = [c0 * rad, y0, s0 * rad], p10 = [c1 * rad, y0, s1 * rad], p01 = [c0 * rad, y1, s0 * rad], p11 = [c1 * rad, y1, s1 * rad];
      var n0 = [c0, 0, s0], n1 = [c1, 0, s1];
      [[p00, n0], [p11, n1], [p10, n1], [p00, n0], [p01, n0], [p11, n1]].forEach(function (v) { pushV(g, v[0], v[1], v[0], v[1]); });
      if (caps !== false) {
        pushV(g, [0, y1, 0], [0, 1, 0], [0, y1, 0], [0, 1, 0]); pushV(g, p11, [0, 1, 0], p11, [0, 1, 0]); pushV(g, p01, [0, 1, 0], p01, [0, 1, 0]);
        pushV(g, [0, y0, 0], [0, -1, 0], [0, y0, 0], [0, -1, 0]); pushV(g, p00, [0, -1, 0], p00, [0, -1, 0]); pushV(g, p10, [0, -1, 0], p10, [0, -1, 0]);
      }
    }
    return g;
  }
  // Tyre: rounded torus-like ring (outer radius R, width w) along local X axis.
  function tyre(R, w, segs) {
    segs = segs || 36; var g = G(), ring = 10, tube = w / 2, rr = R - tube;
    for (var i = 0; i < segs; i++) for (var j = 0; j < ring; j++) {
      var pts = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(function (ij) {
        var a = ij[0] / segs * Math.PI * 2, b = ij[1] / ring * Math.PI * 2;
        var sq = 0.78; // squash the tube into a tyre profile
        var cb = Math.cos(b), sb = Math.sin(b);
        var radial = rr + tube * Math.sign(cb) * Math.pow(Math.abs(cb), sq), ax = tube * 1.0 * Math.sign(sb) * Math.pow(Math.abs(sb), sq);
        var p = [ax, Math.cos(a) * radial, Math.sin(a) * radial];
        var n = norm([sb, Math.cos(a) * cb, Math.sin(a) * cb]);
        return [p, n];
      });
      [pts[0], pts[2], pts[1], pts[0], pts[3], pts[2]].forEach(function (v) { pushV(g, v[0], v[1], v[0], v[1]); });
    }
    return g;
  }
  function bake(g, M) {
    var o = G();
    for (var i = 0; i < g.p.length; i += 3) {
      var p = xf(M, [g.p[i], g.p[i + 1], g.p[i + 2]], 1), n = norm(xf(M, [g.n[i], g.n[i + 1], g.n[i + 2]], 0));
      pushV(o, p, n, [g.l[i], g.l[i + 1], g.l[i + 2]], [g.o[i], g.o[i + 1], g.o[i + 2]]);
    }
    return o;
  }

  /* ------------------------------------------------------------- materials */
  // type: 0 paint, 1 container, 2 ground, 3 rubber, 4 glass, 5 emissive, 6 sign, 7 sea, 8 rim/chrome
  function mat(hex, rough, metal, type, extra) {
    return { c: srgb(hex), r: rough, m: metal, t: type || 0, x: extra || [0, 0, 0, 0], e: [0, 0, 0] };
  }
  var PAL = {
    craneOrange: mat('#E9781F', 0.42, 0.15),
    craneDark: mat('#2A2F36', 0.55, 0.4),
    steel: mat('#8C939B', 0.35, 0.85),
    white: mat('#EEEBE4', 0.4, 0.0),
    glass: mat('#1C2836', 0.08, 0.0, 4),
    rubber: mat('#17181A', 0.85, 0.0, 3),
    chrome: mat('#D5D9DE', 0.18, 1.0, 8),
    cabNavy: mat('#14305A', 0.28, 0.25),
    cabStripe: mat('#F28C28', 0.35, 0.1),
    chassis: mat('#1E2126', 0.6, 0.35),
    lamp: (function () { var m = mat('#FFF4D6', 0.3, 0, 5); m.e = [2.4, 2.1, 1.6]; return m; })(),
    tail: (function () { var m = mat('#D8241C', 0.3, 0, 5); m.e = [1.8, 0.12, 0.08]; return m; })(),
    ground: mat('#99938A', 0.9, 0.0, 2),
    quay: mat('#B8B1A5', 0.85, 0.0, 0),
    sea: mat('#2D5F7A', 0.06, 0.0, 7),
    hull: mat('#2B3A4A', 0.55, 0.2),
    hullRed: mat('#8E2B22', 0.6, 0.1),
    farCrane: mat('#C9592A', 0.6, 0.1),
    sign: mat('#0B1F33', 0.4, 0.0, 6),
    yellow: mat('#F2B31B', 0.45, 0.1)
  };
  function containerMat(hex, logo) { return mat(hex, 0.5, 0.25, 1, [logo ? 1 : 0, 0, 0, 0]); }
  var CONT = {
    navy: containerMat('#173A63', true), navy2: containerMat('#143152', false),
    orange: containerMat('#D9652A', false), white: containerMat('#E2DFD8', false),
    teal: containerMat('#2E6E73', false), maroon: containerMat('#7B2E28', false),
    grey: containerMat('#7D858C', false), sand: containerMat('#C9A66B', false)
  };

  /* ----------------------------------------------------------------- scene */
  function Node(name) { return { name: name, M: m4(), parts: {} }; }
  var nodes = {}, order = [];
  function node(name) { if (!nodes[name]) { nodes[name] = Node(name); order.push(name); } return nodes[name]; }
  function add(nodeName, g, material, M) {
    var n = node(nodeName), key = JSON.stringify([material.c, material.r, material.m, material.t, material.x, material.e]);
    if (!n.parts[key]) n.parts[key] = { mat: material, g: G() };
    var b = M ? bake(g, M) : g, d = n.parts[key].g;
    Array.prototype.push.apply(d.p, b.p); Array.prototype.push.apply(d.n, b.n); Array.prototype.push.apply(d.l, b.l); Array.prototype.push.apply(d.o, b.o);
  }
  function boxAt(nodeName, material, cx, cy, cz, w, h, d, r, rot) {
    add(nodeName, rbox(w, h, d, r === undefined ? 0.04 : r, r === 0 ? 1 : 2), material, rot ? chain(T(cx, cy, cz), rot) : T(cx, cy, cz));
  }
  function beam(nodeName, material, a, b, w, h) { // square beam from a to b
    var d = sub(b, a), L = Math.hypot(d[0], d[1], d[2]), dir = norm(d);
    var up = Math.abs(dir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
    var x = norm(cross(up, dir)), y = cross(dir, x), M = m4();
    M[0] = x[0]; M[1] = x[1]; M[2] = x[2]; M[4] = y[0]; M[5] = y[1]; M[6] = y[2]; M[8] = dir[0]; M[9] = dir[1]; M[10] = dir[2];
    M[12] = (a[0] + b[0]) / 2; M[13] = (a[1] + b[1]) / 2; M[14] = (a[2] + b[2]) / 2;
    add(nodeName, rbox(w, h || w, L, Math.min(w, h || w) * 0.12, 2), material, M);
  }

  // --- container (length along Z). Box body + frame rails + corner castings.
  var CH = 2.59, CW = 2.44;
  function container(nodeName, cm, cx, cy, cz, len) {
    len = len || 12.19;
    add(nodeName, rbox(CW - 0.06, CH - 0.06, len - 0.06, 0.03, 2), cm, T(cx, cy, cz));
    var rail = mat('#000000', 0.6, 0.3); rail.c = cm.c.map(function (v) { return v * 0.62; });
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sy) {
        boxAt(nodeName, rail, cx + sx * (CW / 2 - 0.05), cy + sy * (CH / 2 - 0.07), cz, 0.12, 0.16, len - 0.02, 0.02);
        [-1, 1].forEach(function (sz) {
          boxAt(nodeName, PAL.craneDark, cx + sx * (CW / 2 - 0.09), cy + sy * (CH / 2 - 0.06), cz + sz * (len / 2 - 0.09), 0.19, 0.13, 0.19, 0.02);
        });
      });
      [-1, 1].forEach(function (sz) { boxAt(nodeName, rail, cx + sx * (CW / 2 - 0.06), cy, cz + sz * (len / 2 - 0.06), 0.13, CH - 0.2, 0.13, 0.02); });
    });
  }

  // --- RTG crane: span along X, gantry legs at z = ±7.6
  var SPAN = 19.4, LZ = 7.6, TOPY = 18.2;
  function buildCrane() {
    var N = 'crane', o = PAL.craneOrange, dk = PAL.craneDark;
    [-1, 1].forEach(function (sx) {
      var x = sx * SPAN / 2;
      // sill beam + tyre bogies
      boxAt(N, o, x, 1.55, 0, 1.3, 1.1, LZ * 2 + 2.6, 0.08);
      [-1, 1].forEach(function (sz) {
        var z = sz * (LZ + 0.5);
        boxAt(N, dk, x, 0.95, z, 1.5, 0.7, 2.6, 0.06);
        [-0.7, 0.7].forEach(function (dz) {
          add(N, tyre(0.62, 0.55), PAL.rubber, chain(T(x, 0.62, z + dz)));
          add(N, cyl(0.34, 0.6, 20), PAL.steel, chain(T(x, 0.62, z + dz), RZ(Math.PI / 2)));
        });
        // legs (slightly tapered pair look via two beams)
        beam(N, o, [x, 2.1, sz * LZ], [x, TOPY - 0.8, sz * LZ], 1.05);
        // knee braces
        beam(N, o, [x, TOPY - 4.5, sz * LZ], [x - sx * 2.6, TOPY - 0.9, sz * LZ], 0.42);
      });
      // side diagonal truss between legs
      beam(N, o, [x, 3.2, -LZ], [x, TOPY - 2.2, LZ], 0.45);
      beam(N, o, [x, 3.2, LZ], [x, TOPY - 2.2, -LZ], 0.45);
      beam(N, o, [x, 9.6, -LZ], [x, 9.6, LZ], 0.5);
      // top longitudinal beam
      boxAt(N, o, x, TOPY - 0.3, 0, 1.25, 1.25, LZ * 2 + 1.3, 0.08);
    });
    // trolley girders across the span
    [-1, 1].forEach(function (sz) {
      boxAt(N, o, 0, TOPY, sz * LZ, SPAN + 1.4, 1.7, 1.15, 0.08);
      boxAt(N, PAL.steel, 0, TOPY + 0.9, sz * LZ, SPAN, 0.12, 0.25, 0.02); // rail
      // handrail
      boxAt(N, PAL.yellow, 0, TOPY + 1.6, sz * (LZ + 0.55), SPAN + 1.2, 0.06, 0.06, 0.02);
      for (var i = -9; i <= 9; i += 1.5) boxAt(N, PAL.yellow, i, TOPY + 1.25, sz * (LZ + 0.55), 0.05, 0.7, 0.05, 0.01);
    });
    // branded sign panel on the front girder
    boxAt(N, PAL.sign, 0, TOPY + 0.05, LZ + 0.62, 11.0, 1.35, 0.12, 0.03);
    // machinery house on the right end
    boxAt(N, PAL.white, SPAN / 2 - 0.4, TOPY + 2.0, 0, 3.0, 2.3, 5.5, 0.12);
    boxAt(N, dk, SPAN / 2 - 0.4, TOPY + 3.2, 0, 3.2, 0.15, 5.8, 0.04);
    // light masts on top corners
    [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sz) {
      boxAt(N, dk, sx * (SPAN / 2), TOPY + 1.5, sz * LZ, 0.18, 1.6, 0.18, 0.02);
      boxAt(N, PAL.lamp, sx * (SPAN / 2), TOPY + 2.35, sz * LZ, 0.5, 0.18, 0.35, 0.03);
    }); });
  }
  function buildTrolley() {
    var N = 'trolley', o = PAL.craneOrange, dk = PAL.craneDark;
    boxAt(N, o, 0, TOPY + 1.4, 0, 3.4, 1.0, LZ * 2 + 1.4, 0.08);
    boxAt(N, dk, 0, TOPY + 2.15, 0, 2.6, 0.7, 4.4, 0.08);
    [-1, 1].forEach(function (sz) { [-1, 1].forEach(function (sx) {
      add(N, cyl(0.32, 0.25, 18), PAL.steel, chain(T(sx * 1.1, TOPY + 1.05, sz * LZ), RZ(Math.PI / 2)));
    }); });
    // operator cab hanging under the trolley
    boxAt(N, dk, 1.9, TOPY - 0.2, LZ - 1.2, 0.25, 2.2, 0.25, 0.03);
    boxAt(N, PAL.white, 2.4, TOPY - 2.0, LZ - 1.2, 2.0, 2.2, 2.3, 0.18);
    boxAt(N, PAL.glass, 2.4, TOPY - 2.0, LZ - 1.2 + 1.16, 1.7, 1.4, 0.04, 0.02);
    boxAt(N, PAL.glass, 3.41, TOPY - 2.0, LZ - 1.2, 0.04, 1.4, 1.9, 0.02);
    boxAt(N, PAL.glass, 2.4, TOPY - 3.12, LZ - 1.2, 1.6, 0.04, 1.8, 0.02);
  }
  function buildSpreader() {
    var N = 'spreader', y = 'yellow', dk = PAL.craneDark;
    boxAt(N, PAL.yellow, 0, 0.35, 0, 0.7, 0.5, 12.0, 0.06);
    boxAt(N, PAL.yellow, 0, 0.35, 0, 2.3, 0.42, 0.8, 0.05);
    [-1, 1].forEach(function (sz) {
      boxAt(N, PAL.yellow, 0, 0.35, sz * 5.9, 2.4, 0.45, 0.5, 0.05);
      [-1, 1].forEach(function (sx) { boxAt(N, dk, sx * 1.05, 0.02, sz * 5.92, 0.3, 0.3, 0.3, 0.03); });
    });
    boxAt(N, dk, 0, 0.95, 0, 1.8, 0.7, 2.4, 0.08);   // headblock
    [-1, 1].forEach(function (sz) { [-1, 1].forEach(function (sx) {
      add(N, cyl(0.12, 0.3, 14), PAL.steel, chain(T(sx * 0.7, 1.4, sz * 0.9), RZ(Math.PI / 2)));
    }); });
  }
  function buildCables() { // unit-length cables along Y (scaled per frame)
    [-1, 1].forEach(function (sz) { [-1, 1].forEach(function (sx) {
      add('cables', cyl(0.035, 1, 8, false), PAL.craneDark, T(sx * 0.7, -0.5, sz * 0.9));
    }); });
  }

  // --- truck (prime mover + skeletal trailer), driving along +Z
  function wheelSet(N, x, y, z, dual) {
    var R = 0.52;
    var offs = dual ? [-0.14, 0.14] : [0];
    offs.forEach(function (o) { add(N, tyre(R, 0.3), PAL.rubber, T(x + o * Math.sign(x), y, z)); });
    var ox = x + Math.sign(x) * (dual ? 0.3 : 0.16);
    add(N, cyl(0.3, 0.06, 22), PAL.chrome, chain(T(ox, y, z), RZ(Math.PI / 2)));
    add(N, cyl(0.12, 0.1, 16), PAL.craneDark, chain(T(ox + Math.sign(x) * 0.05, y, z), RZ(Math.PI / 2)));
  }
  function buildTruck() {
    var N = 'truck', nv = PAL.cabNavy;
    var cz = 4.6; // cab centre z (front of truck at ~ +5.8)
    // chassis rails
    boxAt(N, PAL.chassis, -0.45, 0.95, 0.6, 0.22, 0.34, 9.6, 0.03);
    boxAt(N, PAL.chassis, 0.45, 0.95, 0.6, 0.22, 0.34, 9.6, 0.03);
    // cab body
    boxAt(N, nv, 0, 2.55, cz, 2.5, 2.55, 2.25, 0.22);
    boxAt(N, nv, 0, 4.0, cz - 0.15, 2.42, 0.55, 2.0, 0.25);       // high roof
    boxAt(N, nv, 0, 4.55, cz - 0.6, 2.3, 0.6, 1.1, 0.25, RX(-0.25)); // roof fairing
    boxAt(N, PAL.glass, 0, 3.05, cz + 1.12, 2.15, 1.05, 0.06, 0.04, RX(-0.07)); // windscreen
    [-1, 1].forEach(function (sx) {
      boxAt(N, PAL.glass, sx * 1.255, 3.05, cz + 0.35, 0.04, 0.85, 1.1, 0.03);
      boxAt(N, PAL.cabStripe, sx * 1.255, 1.95, cz, 0.03, 0.18, 2.05, 0.01);
      boxAt(N, PAL.craneDark, sx * 1.42, 3.25, cz + 1.05, 0.08, 0.6, 0.12, 0.03); // mirror arm
      boxAt(N, PAL.craneDark, sx * 1.5, 3.1, cz + 1.12, 0.14, 0.55, 0.22, 0.05);  // mirror
      boxAt(N, PAL.chassis, sx * 0.95, 1.05, cz - 1.9, 0.6, 0.55, 1.6, 0.25);     // fuel tank
      boxAt(N, PAL.chrome, sx * 0.95, 1.05, cz - 1.9, 0.62, 0.08, 1.62, 0.02);
      boxAt(N, PAL.chassis, sx * 1.15, 1.25, cz + 0.05, 0.3, 0.55, 1.4, 0.12);    // steps
      boxAt(N, PAL.lamp, sx * 0.9, 1.55, cz + 1.13, 0.5, 0.18, 0.05, 0.03);      // headlights
      boxAt(N, PAL.craneDark, sx * 1.2, 0.95, cz + 0.05, 0.25, 0.55, 1.35, 0.15);  // front mudguard
      add(N, cyl(0.09, 2.2, 14), PAL.chrome, T(sx * 1.05, 3.6, cz - 1.25));        // exhaust stacks
    });
    boxAt(N, PAL.chrome, 0, 1.95, cz + 1.12, 1.7, 0.7, 0.06, 0.03);   // grille
    for (var gy = 1.7; gy <= 2.21; gy += 0.13) boxAt(N, PAL.craneDark, 0, gy, cz + 1.16, 1.6, 0.05, 0.03, 0.01);
    boxAt(N, PAL.craneDark, 0, 1.2, cz + 1.15, 2.4, 0.38, 0.25, 0.08); // bumper
    // fifth wheel
    boxAt(N, PAL.craneDark, 0, 1.3, -1.8, 1.9, 0.18, 1.7, 0.08);
    // wheels: steer axle + two drive axles
    [-1, 1].forEach(function (sx) {
      wheelSet(N, sx * 1.05, 0.52, cz + 0.05, false);
      wheelSet(N, sx * 0.86, 0.52, -1.25, true);
      wheelSet(N, sx * 0.86, 0.52, -2.6, true);
      boxAt(N, PAL.chassis, sx * 1.1, 1.18, -1.92, 0.35, 0.08, 2.4, 0.03);
    });
  }
  var TRAILER_Z = -8.3; // trailer centre (relative to truck); container sits on it
  function buildTrailer() {
    var N = 'truck', z0 = TRAILER_Z;
    [-0.5, 0.5].forEach(function (sx) { boxAt(N, PAL.chassis, sx, 1.33, z0, 0.2, 0.42, 12.4, 0.03); });
    for (var k = -6; k <= 6; k += 2) boxAt(N, PAL.chassis, 0, 1.5, z0 + k, 2.42, 0.14, 0.18, 0.02);
    boxAt(N, PAL.chassis, 0, 1.5, z0 + 6.1, 2.44, 0.2, 0.3, 0.03);
    boxAt(N, PAL.chassis, 0, 1.5, z0 - 6.1, 2.44, 0.2, 0.3, 0.03);
    [-1, 1].forEach(function (sx) {
      boxAt(N, PAL.craneDark, sx * 1.0, 0.75, z0 + 3.0, 0.12, 1.1, 0.12, 0.02); // landing legs
      [-3.4, -4.75, -6.1].forEach(function (az) { wheelSet(N, sx * 0.86, 0.52, z0 + az + 1.25, true); });
      boxAt(N, PAL.craneDark, sx * 1.12, 1.25, z0 - 3.75, 0.3, 0.08, 4.3, 0.03);
      boxAt(N, PAL.tail, sx * 0.95, 1.2, z0 - 6.28, 0.35, 0.16, 0.05, 0.02);
    });
  }

  // --- port yard, stacks and backdrop
  function buildYard() {
    var N = 'static';
    add(N, rbox(400, 0.4, 150, 0, 1), PAL.ground, T(0, -0.2, 10));          // yard slab
    add(N, rbox(400, 1.6, 2.0, 0.05, 2), PAL.quay, T(0, -0.6, -66));          // quay edge
    add(N, rbox(900, 0.2, 700, 0, 1), PAL.sea, T(0, -1.4, -420));              // sea
    var cols = [CONT.orange, CONT.white, CONT.teal, CONT.navy2, CONT.maroon, CONT.grey, CONT.sand, CONT.navy];
    function stack(x0, z0, rows, bays, tiers, seed) {
      var s = seed;
      function rnd() { s = (s * 9301 + 49297) % 233280; return s / 233280; }
      for (var r = 0; r < rows; r++) for (var b = 0; b < bays; b++) {
        var h = Math.max(1, Math.round(tiers - rnd() * 2.2));
        for (var t = 0; t < h; t++) container(N, cols[Math.floor(rnd() * cols.length)], x0 + r * (CW + 0.32), CH / 2 + t * CH, z0 + b * 13.0);
      }
    }
    // the block under the crane (the pick container is added separately)
    var blk = [[CONT.white, CONT.teal, CONT.orange], [CONT.grey, CONT.sand], [CONT.maroon, CONT.white, CONT.teal]];
    blk.forEach(function (col, r) { col.forEach(function (c, t) { container(N, c, -7.6 + r * (CW + 0.32), CH / 2 + t * CH, 0); }); });
    // neighbouring blocks for depth
    stack(-7.6, -14, 3, 2, 4, 3);
    stack(-27, -22, 4, 2, 4, 7);
    stack(-40, -40, 4, 2, 3, 5);
    stack(14, -36, 4, 2, 4, 9);
    stack(24, -12, 3, 3, 3, 13);
    // lane markings handled in the ground shader; kerbs + bollards near quay
    for (var x = -60; x <= 60; x += 9) add(N, cyl(0.22, 0.6, 12), PAL.craneDark, T(x, 0.3, -64.7));
    // light masts
    [[-34, -34], [32, -30], [-8, -44]].forEach(function (p) {
      add(N, cyl(0.22, 26, 12), PAL.steel, T(p[0], 13, p[1]));
      boxAt(N, PAL.craneDark, p[0], 26.2, p[1], 2.4, 0.4, 0.8, 0.05);
      boxAt(N, PAL.lamp, p[0], 25.95, p[1] + 0.2, 2.2, 0.08, 0.5, 0.02);
    });
    // distant ship-to-shore cranes on the quay
    [-70, -38, 30, 64].forEach(function (x, i) {
      var z = -60, F = PAL.farCrane;
      [-1, 1].forEach(function (s) { beam(N, F, [x - 6, 0, z + s * 6], [x - 6, 36, z + s * 6], 1.6); beam(N, F, [x + 6, 0, z + s * 6], [x + 6, 36, z + s * 6], 1.6); });
      boxAt(N, F, x, 37, z, 2.2, 2.2, 70, 0.1);
      boxAt(N, F, x, 37, z - 18, 14, 1.6, 1.6, 0.1);
      boxAt(N, PAL.white, x, 40, z - 2, 7, 4, 9, 0.2);
      beam(N, F, [x, 37, z - 20], [x, 55, z - 4], 1.0);
      beam(N, F, [x, 55, z - 4], [x, 37, z + 30], 0.6);
    });
    // container ship at berth
    var sz = -86;
    add(N, rbox(190, 14, 32, 2.5, 3), PAL.hull, T(10, 4, sz));
    add(N, rbox(190.4, 4, 32.4, 1.5, 3), PAL.hullRed, T(10, -2.2, sz));
    boxAt(N, PAL.white, 82, 19, sz, 12, 18, 26, 0.4);
    boxAt(N, PAL.glass, 82, 26, sz + 13.1, 11, 2, 0.2, 0.05);
    for (var bx = -70; bx < 70; bx += 13.2) {
      var hh = 3 + ((bx * 7) % 3 + 3) % 3;
      for (var ty = 0; ty < hh; ty++) for (var row = -2; row <= 2; row++) {
        var c = cols[Math.abs(Math.floor(bx * 3 + ty * 5 + row * 7)) % cols.length];
        add(N, rbox(12.1, CH - 0.05, CW * 1.0, 0.03, 1), c, T(bx + 6, 11 + CH / 2 + ty * CH, sz + row * (CW + 0.2)));
      }
    }
  }

  /* ------------------------------------------------------------- shaders */
  var VS = '#version 300 es\n' +
    'layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec3 aL; layout(location=3) in vec3 aO;\n' +
    'uniform mat4 uVP, uM; out vec3 vW, vN, vL, vO;\n' +
    'void main(){ vec4 w = uM*vec4(aP,1.); vW=w.xyz; vN=mat3(uM)*aN; vL=aL; vO=aO; gl_Position=uVP*w; }';
  var VS_DEPTH = '#version 300 es\nlayout(location=0) in vec3 aP; uniform mat4 uVP, uM; void main(){ gl_Position=uVP*uM*vec4(aP,1.); }';
  var FS_DEPTH = '#version 300 es\nprecision mediump float; out vec4 o; void main(){ o=vec4(1.); }';
  var COMMON =
    'uniform vec3 uSunDir, uSunCol, uSkyTop, uSkyHor, uGndCol;\n' +
    'vec3 sky(vec3 d){ float h=clamp(d.y,0.,1.); vec3 c=mix(uSkyHor,uSkyTop,pow(h,0.55));\n' +
    '  float s=max(dot(d,uSunDir),0.); c+=uSunCol*0.12*pow(s,8.)+uSunCol*0.6*pow(s,600.);\n' +
    '  if(d.y<0.) c=mix(uSkyHor, uGndCol, clamp(-d.y*4.,0.,1.)); return c; }\n' +
    'vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }\n';
  var FS = '#version 300 es\nprecision highp float;\n' +
    'in vec3 vW, vN, vL, vO; out vec4 o;\n' +
    'uniform vec3 uCam, uColor, uEmit; uniform float uRough, uMetal; uniform int uType; uniform vec4 uX;\n' +
    'uniform sampler2D uShadow, uHeight, uLogo; uniform mat4 uSVP; uniform vec4 uHR; uniform float uFog;\n' + COMMON +
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }\n' +
    'float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);\n' +
    '  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }\n' +
    'float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=.5; } return s; }\n' +
    'const vec2 PD[16]=vec2[16](vec2(-.94,-.40),vec2(.95,-.77),vec2(-.09,-.93),vec2(.34,.29),vec2(-.92,.46),vec2(-.82,.15),vec2(-.38,.28),vec2(-.20,.75),\n' +
    '  vec2(.44,-.32),vec2(-.24,-.81),vec2(.80,.56),vec2(.17,-.42),vec2(.69,-.08),vec2(.15,.97),vec2(-.54,-.13),vec2(.53,.79));\n' +
    'float shadow(vec3 p, vec3 n){ vec4 s=uSVP*vec4(p+n*0.06,1.); vec3 q=s.xyz/s.w*.5+.5;\n' +
    '  if(q.x<0.||q.x>1.||q.y<0.||q.y>1.) return 1.; float sh=0.; float rad=1.6/4096.*1.6;\n' +
    '  float ang=hash(p.xz*31.)*6.283; mat2 R=mat2(cos(ang),sin(ang),-sin(ang),cos(ang));\n' +
    '  for(int i=0;i<16;i++){ float d=texture(uShadow,q.xy+R*PD[i]*rad).r; sh+= (q.z-0.0006>d)?0.:1.; } return sh/16.; }\n' +
    'float hAt(vec2 xz){ vec2 uv=vec2((xz.x-uHR.x)/uHR.z, 1.-(xz.y-uHR.y)/uHR.z); if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) return 0.; return (1.-texture(uHeight,uv).r)*uHR.w; }\n' +
    'float hao(vec3 p, vec3 n){ float occ=0.; vec2 base=p.xz+n.xz*0.35; float ang=hash(p.xz*17.)*6.283;\n' +
    '  for(int i=0;i<12;i++){ float a=ang+float(i)*2.399; float r=0.45+float(i)*0.32; vec2 dir=vec2(cos(a),sin(a));\n' +
    '    float w=mix(1.,max(0.,dot(dir,normalize(n.xz+1e-4))) ,clamp(1.-abs(n.y),0.,1.));\n' +
    '    float d=hAt(base+dir*r)-p.y; occ+=clamp(d/(r*1.6),0.,1.)*w; }\n' +
    '  return 1.-clamp(occ/12.*1.25,0.,.82); }\n' +
    'float D_GGX(float NdH,float a){ float a2=a*a; float d=NdH*NdH*(a2-1.)+1.; return a2/(3.14159*d*d); }\n' +
    'void main(){\n' +
    '  vec3 N=normalize(vN); vec3 base=uColor; float rough=uRough, metal=uMetal; vec3 emit=uEmit; float spec=1.;\n' +
    '  if(uType==1){ // shipping container: corrugation, doors, logo, wear\n' +
    '    vec3 ao=vO; vec3 l=vL;\n' +
    '    if(abs(ao.x)>.5){ float ph=l.z*6.2832/0.305; N=normalize(N+vec3(0.,0.,sin(ph)*0.42)); base*=0.94+0.06*cos(ph);\n' +
    '      if(uX.x>.5){ vec2 uv=vec2((ao.x>0.? -l.z : l.z)/9.6+.5, .5-(l.y-.25)/1.3); if(uv.x>0.&&uv.x<1.&&uv.y>0.&&uv.y<1.){ vec4 t=texture(uLogo,uv); base=mix(base,vec3(.92,.9,.86),t.a); rough=mix(rough,.6,t.a);} } }\n' +
    '    else if(abs(ao.y)>.5){ float ph=l.z*6.2832/0.35; N=normalize(N+vec3(0.,0.,sin(ph)*0.2)); }\n' +
    '    else { float bx=abs(l.x); float bar=smoothstep(.03,.0,abs(bx-.38))+smoothstep(.03,.0,abs(bx-.92)); float seam=smoothstep(.02,0.,bx);\n' +
    '      base*=1.-0.35*max(bar,seam); N=normalize(N+vec3(sign(l.x)*bar*0.3,0.,0.)); metal=mix(metal,.8,bar); }\n' +
    '    float wear=fbm(l.xz*1.3+l.y*.7)*smoothstep(-1.3,-.3,-l.y)*0.; base*=0.9+0.1*fbm(vec2(l.z*.6,l.y*2.)); }\n' +
    '  if(uType==2){ // yard concrete + lane paint\n' +
    '    vec2 p=vW.xz; float n=fbm(p*.35)*.5+fbm(p*3.1)*.5; base*=0.86+0.22*n;\n' +
    '    float slab=smoothstep(.04,0.,abs(fract(p.x/6.)-.5)*6.-2.96)+smoothstep(.04,0.,abs(fract(p.y/6.)-.5)*6.-2.96); base*=1.-0.12*clamp(slab,0.,1.);\n' +
    '    float lane=smoothstep(.09,.06,abs(p.x-3.7))+smoothstep(.09,.06,abs(p.x-8.9)); vec3 yel=vec3(.85,.62,.08);\n' +
    '    float dash=step(.5,fract(p.y/4.))*smoothstep(.07,.05,abs(p.x-6.3)); vec3 wht=vec3(.8,.79,.76);\n' +
    '    float kerb=smoothstep(.12,.09,abs(p.y+63.4)); base=mix(base,yel,clamp(lane+kerb,0.,1.)*0.9); base=mix(base,wht,dash*.85);\n' +
    '    float box=smoothstep(.07,.05,abs(abs(p.x+4.95)-4.25))*step(abs(p.y),6.4)+smoothstep(.07,.05,abs(abs(p.y)-6.4))*step(abs(p.x+4.95),4.25); base=mix(base,wht,clamp(box,0.,1.)*.7);\n' +
    '    rough=0.9-0.25*clamp(lane+dash,0.,1.); }\n' +
    '  if(uType==3){ float tr=step(.5,fract(atan(vL.y,vL.z)*9.55)); base*=0.85+0.15*tr; rough=.9; }\n' +
    '  if(uType==6){ vec2 uv=vec2(vL.x/11.+.5, .5-vL.y/1.35); if(vO.z>.5){ vec4 t=texture(uLogo,uv); base=mix(base,vec3(.96,.94,.9),t.a); } }\n' +
    '  if(uType==7){ vec2 p=vW.xz; float w=fbm(p*.08+vec2(0.,0.))*.6+fbm(p*.6)*.4; N=normalize(vec3((w-.5)*.12,1.,(fbm(p*.6+7.)-.5)*.12)); }\n' +
    '  vec3 V=normalize(uCam-vW); if(dot(N,V)<0.&&uType!=7) N=normalize(N+V*0.2);\n' +
    '  vec3 L=uSunDir, H=normalize(L+V); float NdL=max(dot(N,L),0.), NdV=max(dot(N,V),1e-3), NdH=max(dot(N,H),0.);\n' +
    '  float sh=NdL>0.?shadow(vW,normalize(vN)):0.; float occ=hao(vW,N);\n' +
    '  vec3 F0=mix(vec3(.04),base,metal); vec3 F=F0+(1.-F0)*pow(1.-max(dot(H,V),0.),5.);\n' +
    '  float a=max(rough*rough,.03); float k=(rough+1.)*(rough+1.)/8.; float Gv=NdV/(NdV*(1.-k)+k), Gl=NdL/(NdL*(1.-k)+k);\n' +
    '  vec3 specD=D_GGX(NdH,a)*Gv*Gl*F/max(4.*NdV*NdL,1e-3);\n' +
    '  vec3 kd=(1.-F)*(1.-metal);\n' +
    '  vec3 col=(kd*base+specD*spec)*uSunCol*NdL*sh;\n' +
    '  vec3 amb=mix(uGndCol*0.9, sky(normalize(N+vec3(0.,.35,0.))), N.y*.5+.5);\n' +
    '  col+=kd*base*amb*occ*0.62;\n' +
    '  vec3 R=reflect(-V,N); vec3 Fr=F0+(max(vec3(1.-rough),F0)-F0)*pow(1.-NdV,5.);\n' +
    '  vec3 env=sky(normalize(mix(R,N,rough*rough))); if(R.y<0.) env=mix(env,uGndCol*.6,clamp(-R.y*3.,0.,1.));\n' +
    '  col+=env*Fr*occ*(1.-rough*0.75)*(uType==4?1.4:1.);\n' +
    '  if(uType==7){ float fr=.02+.98*pow(1.-NdV,5.); col=mix(base*amb*.55, sky(R), clamp(fr+.08,0.,1.)) + uSunCol*pow(max(dot(R,L),0.),400.)*3.*sh; }\n' +
    '  col+=emit;\n' +
    '  float dist=length(uCam-vW); float fog=1.-exp(-max(dist-60.,0.)*uFog); vec3 fc=sky(normalize(vW-uCam)*vec3(1.,.3,1.)+vec3(0.,.02,0.));\n' +
    '  col=mix(col,fc,clamp(fog,0.,.92));\n' +
    '  col=aces(col*0.82); o=vec4(pow(col,vec3(1./2.2)),1.);\n' +
    '}';
  var VS_BG = '#version 300 es\nout vec2 vUV; void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUV=p; gl_Position=vec4(p*2.-1.,1.,1.); }';
  var FS_BG = '#version 300 es\nprecision highp float; in vec2 vUV; out vec4 o; uniform mat4 uIVP;\n' + COMMON +
    'void main(){ vec4 a=uIVP*vec4(vUV*2.-1.,1.,1.); vec4 b=uIVP*vec4(vUV*2.-1.,-1.,1.); vec3 d=normalize(a.xyz/a.w-b.xyz/b.w);\n' +
    '  vec3 c=sky(d); c=aces(c*0.82); o=vec4(pow(c,vec3(1./2.2)),1.); }';

  /* -------------------------------------------------------------- engine */
  function AGScene(canvas, opts) {
    opts = opts || {};
    var gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: !!opts.preserve, alpha: false });
    if (!gl) throw new Error('WebGL2 not available');
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map(function (l, i) { return (i + 1) + ': ' + l; }).join('\n')); return s; }
    function prog(vs, fs) { var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
      return { p: p, u: u }; }
    var P = prog(VS, FS), PD = prog(VS_DEPTH, FS_DEPTH), PB = prog(VS_BG, FS_BG);

    // build scene once
    if (!order.length) {
      buildYard(); buildCrane(); buildTrolley(); buildSpreader(); buildCables(); buildTruck(); buildTrailer();
      container('pick', CONT.navy, 0, 0, 0);      // the container that moves
      container('load', CONT.navy, 0, 0, 0);      // (unused placeholder kept hidden)
    }
    var gpu = {};
    order.forEach(function (name) {
      var n = nodes[name]; gpu[name] = [];
      Object.keys(n.parts).forEach(function (k) {
        var part = n.parts[k], g = part.g, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        [g.p, g.n, g.l, g.o].forEach(function (arr, i) {
          var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
          gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 0, 0);
        });
        gpu[name].push({ vao: vao, count: g.p.length / 3, mat: part.mat });
      });
    });
    gl.bindVertexArray(null);

    function depthTarget(size) {
      var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex: tex, fb: fb, size: size };
    }
    var SHADOW = depthTarget(opts.shadowSize || 4096), HEIGHT = depthTarget(1024);

    // logo texture
    var lc = document.createElement('canvas'); lc.width = 2048; lc.height = 256;
    var cx = lc.getContext('2d'); cx.clearRect(0, 0, 2048, 256); cx.fillStyle = '#fff';
    cx.font = '700 150px "Arial Black", "Helvetica Neue", Arial, sans-serif'; cx.textBaseline = 'middle';
    var txt = 'ATLANTIC GATE', tw = cx.measureText(txt).width, mark = 200, gap = 50, total = mark + gap + tw, x0 = (2048 - total) / 2;
    cx.beginPath(); cx.lineWidth = 22; cx.strokeStyle = '#fff'; cx.lineJoin = 'round';
    cx.moveTo(x0 + 20, 205); cx.lineTo(x0 + 20, 95); cx.lineTo(x0 + 100, 50); cx.lineTo(x0 + 180, 95); cx.lineTo(x0 + 180, 205); cx.stroke();
    cx.fillRect(x0 + 60, 140, 80, 65);
    cx.fillText(txt, x0 + mark + gap, 132);
    var logo = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, logo);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, lc);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    var aniso = gl.getExtension('EXT_texture_filter_anisotropic'); if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);

    var env = {
      sun: norm([-0.7, 0.5, 0.5]), sunCol: [3.1, 2.5, 1.85],
      skyTop: srgb('#6E9AC6'), skyHor: srgb('#F2D9BC'), gnd: srgb('#857C70')
    };

    /* ---------- animation timeline (t: 0..1) ---------- */
    var PICK = { x: -7.6 + 2 * (CW + 0.32), y: CH / 2 + 3 * CH, z: 0 }; // top of the right-hand row, 4th tier
    var LANE_X = 6.3, TRAILER_TOP = 1.6 + CH / 2;
    function state(t) {
      var s = {};
      // truck arrives (0.12–0.46), waits, leaves (0.84–1)
      var arrive = smooth(0.10, 0.46, t), leave = smooth(0.84, 1.0, t);
      s.truckZ = lerp(-44, 8.3, arrive) + leave * 26;
      s.wheelSpin = (s.truckZ + 44) / 0.52;
      // trolley position + hoist height (height of container bottom above ground)
      var lift = smooth(0.06, 0.24, t), travel = smooth(0.26, 0.50, t), lower = smooth(0.52, 0.72, t), release = smooth(0.74, 0.84, t);
      s.trolleyX = lerp(PICK.x, LANE_X, travel);
      var pickBottom = PICK.y - CH / 2, carryBottom = 13.8, dropBottom = TRAILER_TOP - CH / 2;
      var cb = lerp(pickBottom, carryBottom, lift); cb = lerp(cb, dropBottom, lower);
      s.containerBottom = cb;
      s.spreaderY = cb + CH + lerp(0, 2.4, release);
      s.containerOnTruck = lower >= 0.999;
      // gentle sway while travelling
      s.sway = Math.sin(t * 40) * 0.05 * (travel * (1 - travel)) * 4;
      return s;
    }
    var CAM = [ // t, eye, target, fov
      [0.00, [-31, 13, 44], [-4.5, 11.5, 0], 36],
      [0.30, [-33, 12, 47], [-2.5, 10.5, 0], 37],
      [0.62, [-30, 10, 50], [0, 8.5, 2], 38],
      [0.84, [-27, 8.5, 52], [3, 6.8, 5], 38],
      [1.00, [-30, 8.5, 58], [6, 6.5, 10], 38]
    ];
    function camAt(t) {
      for (var i = 0; i < CAM.length - 1; i++) if (t <= CAM[i + 1][0]) break;
      var a = CAM[i], b = CAM[Math.min(i + 1, CAM.length - 1)], k = smooth(a[0], b[0], t);
      function mixv(u, v) { return [lerp(u[0], v[0], k), lerp(u[1], v[1], k), lerp(u[2], v[2], k)]; }
      return { eye: mixv(a[1], b[1]), target: mixv(a[2], b[2]), fov: lerp(a[3], b[3], k) };
    }

    function nodeMatrices(t) {
      var s = state(t), M = {};
      M.static = m4(); M.crane = m4();
      M.trolley = T(s.trolleyX, 0, 0);
      M.spreader = chain(T(s.trolleyX + s.sway, s.spreaderY, 0));
      var cableTop = TOPY + 1.05, cableBot = s.spreaderY + 1.4, len = Math.max(0.1, cableTop - cableBot);
      M.cables = chain(T(s.trolleyX + s.sway * 0.5, cableTop, 0), S(1, len, 1));
      M.truck = T(LANE_X, 0, s.truckZ);
      var cz = s.containerOnTruck ? s.truckZ + TRAILER_Z : 0;
      var cxp = s.containerOnTruck ? LANE_X : s.trolleyX + s.sway;
      M.pick = T(cxp, s.containerBottom + CH / 2, cz);
      M.load = S(0, 0, 0);
      return M;
    }

    function drawAll(prog, VP, M, withMat) {
      gl.uniformMatrix4fv(prog.u.uVP, false, VP);
      order.forEach(function (name) {
        if (name === 'load') return;
        gl.uniformMatrix4fv(prog.u.uM, false, M[name]);
        gpu[name].forEach(function (d) {
          if (withMat) {
            var m = d.mat;
            gl.uniform3fv(prog.u.uColor, m.c); gl.uniform1f(prog.u.uRough, m.r); gl.uniform1f(prog.u.uMetal, m.m);
            gl.uniform1i(prog.u.uType, m.t); gl.uniform4fv(prog.u.uX, m.x); gl.uniform3fv(prog.u.uEmit, m.e);
          } else if (d.mat.t === 7) return;
          gl.bindVertexArray(d.vao); gl.drawArrays(gl.TRIANGLES, 0, d.count);
        });
      });
      gl.bindVertexArray(null);
    }

    function render(t, override) {
      var W = canvas.width, Hh = canvas.height, M = nodeMatrices(t), cam = camAt(t);
      if (override) cam = override;
      if (W / Hh < 1) {
        var asp = W / Hh, f = cam.fov * Math.PI / 180, hf = Math.atan(Math.tan(f / 2) * (16 / 9));
        cam = { eye: [cam.eye[0] * 0.74, cam.eye[1] * 0.85, cam.eye[2] * 0.74], target: [cam.target[0] + 3, cam.target[1] + 2.2, cam.target[2]],
                fov: 2 * Math.atan(Math.tan(hf * 0.74) / asp) * 180 / Math.PI };
      }
      // shadow pass (sun, ortho box around the action)
      var c = [2, 6, 0], sd = env.sun;
      var sv = lookAt([c[0] + sd[0] * 80, c[1] + sd[1] * 80, c[2] + sd[2] * 80], c, [0, 1, 0]);
      var SVP = mul(ortho(-48, 48, -40, 40, 1, 200), sv);
      gl.useProgram(PD.p); gl.bindFramebuffer(gl.FRAMEBUFFER, SHADOW.fb); gl.viewport(0, 0, SHADOW.size, SHADOW.size);
      gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3);
      drawAll(PD, SVP, M, false);
      // height pass (top-down) for ambient occlusion
      var HR = [-40, -40, 80, 40]; // x0, z0, size, max height
      var hv = lookAt([0, HR[3], 0], [0, 0, 0], [0, 0, -1]);
      var HVP = mul(ortho(-40, 40, -40, 40, 0, HR[3]), hv);
      gl.bindFramebuffer(gl.FRAMEBUFFER, HEIGHT.fb); gl.viewport(0, 0, HEIGHT.size, HEIGHT.size); gl.clear(gl.DEPTH_BUFFER_BIT);
      drawAll(PD, HVP, M, false);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      // main pass
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, Hh);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      var V = lookAt(cam.eye, cam.target, [0, 1, 0]), Pm = persp(cam.fov * Math.PI / 180, W / Hh, 0.5, 1500), VP = mul(Pm, V);
      // background
      gl.useProgram(PB.p); gl.disable(gl.DEPTH_TEST);
      gl.uniformMatrix4fv(PB.u.uIVP, false, invert(VP)); setEnv(PB);
      gl.drawArrays(gl.TRIANGLES, 0, 3); gl.enable(gl.DEPTH_TEST);
      gl.useProgram(P.p); setEnv(P);
      gl.uniform3fv(P.u.uCam, cam.eye); gl.uniformMatrix4fv(P.u.uSVP, false, SVP);
      // height texture maps world xz -> uv; our ortho view looks down with up=-z so v grows with +z
      gl.uniform4f(P.u.uHR, HR[0], HR[1], HR[2], HR[3]); gl.uniform1f(P.u.uFog, opts.fog || 0.0032);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, SHADOW.tex); gl.uniform1i(P.u.uShadow, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, HEIGHT.tex); gl.uniform1i(P.u.uHeight, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, logo); gl.uniform1i(P.u.uLogo, 2);
      gl.disable(gl.CULL_FACE);
      drawAll(P, VP, M, true);
    }
    function setEnv(pr) {
      gl.uniform3fv(pr.u.uSunDir, env.sun); gl.uniform3fv(pr.u.uSunCol, env.sunCol);
      gl.uniform3fv(pr.u.uSkyTop, env.skyTop); gl.uniform3fv(pr.u.uSkyHor, env.skyHor); gl.uniform3fv(pr.u.uGndCol, env.gnd);
    }
    return { render: render, camAt: camAt, gl: gl };
  }
  function invert(m) {
    var a = m, inv = new Float32Array(16);
    inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
    inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
    inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
    inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
    inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
    inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
    inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
    inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
    var det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    det = 1 / det; for (var i = 0; i < 16; i++) inv[i] *= det; return inv;
  }
  global.AGScene = AGScene;
})(window);
