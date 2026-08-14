var md5 = (function () {
  var S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  var K = [];
  for (var i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  }

  function add(x, y) {
    return (x + y) >>> 0;
  }

  function cmn(q, a, b, x, s, t) {
    a = add(a, q);
    a = add(a, add(x, t));
    return add((a << s) | (a >>> (32 - s)), b);
  }

  var R = [
    function (a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); },
    function (a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); },
    function (a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); },
    function (a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
  ];

  function idx(r, t) {
    if (r === 0) return t;
    if (r === 1) return (5 * t + 1) % 16;
    if (r === 2) return (3 * t + 5) % 16;
    return (7 * t) % 16;
  }

  function hex(x) {
    var chars = '0123456789abcdef';
    var out = '';
    for (var i = 0; i < 4; i++) {
      var w = x[i];
      for (var j = 0; j < 4; j++) {
        out += chars[(w >>> 4) & 15] + chars[w & 15];
        w >>>= 8;
      }
    }
    return out;
  }

  return function md5(message) {
    var str = unescape(encodeURIComponent(message));
    var n = str.length;
    var pad = Math.ceil(Math.ceil((n + 9) / 4) / 16) * 16;
    var w = new Array(pad);
    for (var i = 0; i < pad; i++) w[i] = 0;
    for (var j = 0; j < n; j++) w[j >> 2] |= str.charCodeAt(j) << ((j % 4) * 8);
    w[n >> 2] |= 0x80 << ((n % 4) * 8);
    w[pad - 2] = (n * 8) >>> 0;
    w[pad - 1] = Math.floor((n * 8) / 0x100000000);

    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

    for (var off = 0; off < pad; off += 16) {
      var k = w.slice(off, off + 16);
      var a = a0, b = b0, c = c0, d = d0;
      for (var r = 0; r < 4; r++) {
        var f = R[r];
        for (var g = 0; g < 4; g++) {
          var t = r * 16 + g * 4;
          a = f(a, b, c, d, k[idx(r, g * 4)], S[t], K[t]);
          d = f(d, a, b, c, k[idx(r, g * 4 + 1)], S[t + 1], K[t + 1]);
          c = f(c, d, a, b, k[idx(r, g * 4 + 2)], S[t + 2], K[t + 2]);
          b = f(b, c, d, a, k[idx(r, g * 4 + 3)], S[t + 3], K[t + 3]);
        }
      }
      a0 = add(a0, a);
      b0 = add(b0, b);
      c0 = add(c0, c);
      d0 = add(d0, d);
    }

    return hex([a0, b0, c0, d0]);
  };
})();
