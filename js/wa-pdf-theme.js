/* =====================================================================
   World Aware: jsPDF theme for Risk-Assessment-Home (js/report.js)
   Works with the vendored jsPDF 4.2.1 (js/vendor/jspdf.umd.min.js).
   Units: pt. Colors: [r,g,b]. Mirrors tokens.css.
   ===================================================================== */
'use strict';

const WA_PDF = {
  maroon:  [77, 0, 0],      // #4D0000
  amber:   [185, 122, 20],  // #B97A14  rules, spines only
  amber6:  [149, 98, 17],   // #956211  amber text
  cream:   [247, 237, 216], // #F7EDD8
  creamMuted: [217, 195, 174], // #D9C3AE  small text on maroon
  ink:     [32, 25, 19],    // #201913
  muted:   [102, 91, 84],   // #665B54
  rule:    [228, 220, 214], // #E4DCD6
  band:    [250, 246, 243], // #FAF6F3
  white:   [255, 255, 255],
};

/* Risk bands: fills + ink + meter steps. Key names match app.js RISK_LEVELS. */
const WA_PDF_LEVEL = {
  CRITICAL: { label: 'Critical', bg: [99, 17, 0],    fg: [255, 255, 255], steps: 4 }, // #631100
  HIGH:     { label: 'High',     bg: [155, 55, 0],   fg: [255, 255, 255], steps: 3 }, // #9B3700
  MEDIUM:   { label: 'Moderate', bg: [199, 109, 20], fg: [32, 25, 19],    steps: 2 }, // #C76D14
  LOW:      { label: 'Low',      bg: [228, 171, 95], fg: [32, 25, 19],    steps: 1 }, // #E4AB5F
  LIKELY:   { label: 'Not rated', bg: [242, 235, 230], fg: [102, 91, 84], steps: 0 }, // stone-100, unrated research item
};

/* Fonts: TTF files shipped in the app (cached by sw.js). Registered once per doc.
   Family names are what you pass to doc.setFont(). */
const WA_PDF_FONTS = [
  { file: 'fonts/ttf/SpaceGrotesk-Bold-latin.ttf', family: 'SpaceGrotesk', style: 'bold' },
  { file: 'fonts/ttf/Poppins-Regular-latin.ttf',   family: 'Poppins',      style: 'normal' },
  { file: 'fonts/ttf/Poppins-SemiBold-latin.ttf',  family: 'Poppins',      style: 'bold' },
];
let _waFontCache = null; // [{file, family, style, b64}]

function _bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Fetch + base64 the TTFs once. Returns true if brand fonts are available. */
async function waLoadPdfFonts() {
  if (_waFontCache) return true;
  try {
    const out = [];
    for (const f of WA_PDF_FONTS) {
      const res = await fetch(f.file);
      if (!res.ok) throw new Error(f.file + ' ' + res.status);
      out.push(Object.assign({}, f, { b64: _bufToB64(await res.arrayBuffer()) }));
    }
    _waFontCache = out;
    return true;
  } catch (e) {
    console.warn('Brand fonts unavailable for PDF, using Helvetica', e);
    return false;
  }
}

/** Register cached fonts on a jsPDF instance. Returns font names to use. */
function waRegisterPdfFonts(doc) {
  if (!_waFontCache) return { display: 'helvetica', body: 'helvetica', brand: false };
  _waFontCache.forEach(f => {
    const vfsName = f.file.split('/').pop();
    doc.addFileToVFS(vfsName, f.b64);
    doc.addFont(vfsName, f.family, f.style);
  });
  return { display: 'SpaceGrotesk', body: 'Poppins', brand: true };
}

/* Logo: load as data URL once (PNG 520x120). */
let _waLogoCache = {};
async function waLoadLogo(path) {
  if (_waLogoCache[path]) return _waLogoCache[path];
  const res = await fetch(path);
  const blob = await res.blob();
  const url = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
  _waLogoCache[path] = url;
  return url;
}

/* ---- Drawing helpers --------------------------------------------- */
const waFill  = (doc, c) => doc.setFillColor(c[0], c[1], c[2]);
const waText  = (doc, c) => doc.setTextColor(c[0], c[1], c[2]);
const waDraw  = (doc, c) => doc.setDrawColor(c[0], c[1], c[2]);

/** Page-1 maroon band with cream logo. Returns y below the band. */
function waCoverBand(doc, F, logoCreamDataUrl, programLabel) {
  const PW = doc.internal.pageSize.getWidth();
  const H = 86;
  waFill(doc, WA_PDF.maroon);
  doc.rect(0, 0, PW, H, 'F');
  if (logoCreamDataUrl) doc.addImage(logoCreamDataUrl, 'PNG', 54, 26, 152, 35);   // 520x120 source, aspect 4.33
  else { doc.setFont(F.display, 'bold'); doc.setFontSize(18); waText(doc, WA_PDF.cream); doc.text('World Aware', 54, 50); }
  doc.setFont(F.body, 'normal'); doc.setFontSize(8.5); waText(doc, WA_PDF.creamMuted);
  doc.text(programLabel || 'Neighborhood Resiliency Program', PW - 54, 47, { align: 'right' });
  return H + 30;
}

/** Running header for pages 2+: small full-color logo + title, hairline under. */
function waRunningHeader(doc, F, logoColorDataUrl, title) {
  const PW = doc.internal.pageSize.getWidth();
  if (logoColorDataUrl) doc.addImage(logoColorDataUrl, 'PNG', 54, 30, 87, 20);
  doc.setFont(F.body, 'normal'); doc.setFontSize(8); waText(doc, WA_PDF.muted);
  doc.text(title, PW - 54, 43, { align: 'right' });
  waDraw(doc, WA_PDF.rule); doc.setLineWidth(0.5); doc.line(54, 58, PW - 54, 58);
  return 76;
}

/** Section heading: Space Grotesk 13 maroon + 1pt amber rule. Returns new y. */
function waHeading(doc, F, text, x, y, w) {
  doc.setFont(F.display, 'bold'); doc.setFontSize(13); waText(doc, WA_PDF.maroon);
  doc.text(text, x, y + 13);
  waDraw(doc, WA_PDF.amber); doc.setLineWidth(1); doc.line(x, y + 20, x + w, y + 20);
  return y + 30;
}

/** Score box (54x40): band fill, score in Space Grotesk, band word under it. */
function waScoreBox(doc, F, x, y, levelKey, bigText) {
  const c = WA_PDF_LEVEL[levelKey] || WA_PDF_LEVEL.LIKELY;
  const W = 54, H = 40;
  waFill(doc, c.bg); doc.roundedRect(x, y, W, H, 3, 3, 'F');
  doc.setFont(F.display, 'bold'); doc.setFontSize(16); waText(doc, c.fg);
  doc.text(String(bigText), x + W / 2, y + 19, { align: 'center' });
  doc.setFont(F.body, 'bold'); doc.setFontSize(6.5);
  doc.text(c.label, x + W / 2, y + 31, { align: 'center' });
  // No meter here: at 54pt the word label is the non-color cue and a meter crowds it.
  return H;
}

/** Four band-count tiles across width w. counts = {CRITICAL, HIGH, MEDIUM, LOW}. */
function waCountTiles(doc, F, x, y, w, counts) {
  const keys = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  const gap = 4, tw = (w - gap * 3) / 4, th = 40;
  keys.forEach((k, i) => {
    const c = WA_PDF_LEVEL[k], tx = x + i * (tw + gap);
    waFill(doc, c.bg); doc.rect(tx, y, tw, th, 'F');
    waText(doc, c.fg);
    doc.setFont(F.display, 'bold'); doc.setFontSize(17); doc.text(String(counts[k] || 0), tx + 8, y + 20);
    doc.setFont(F.body, 'bold'); doc.setFontSize(7.5); doc.text(c.label, tx + 8, y + 32);
  });
  return th;
}

/** Footer on every page: beworldaware.com left (maroon), page x of y right. */
function waFooters(doc, F, leftNote) {
  const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight();
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    waDraw(doc, WA_PDF.rule); doc.setLineWidth(0.5); doc.line(54, PH - 44, PW - 54, PH - 44);
    doc.setFont(F.body, 'bold'); doc.setFontSize(8); waText(doc, WA_PDF.maroon);
    doc.text('beworldaware.com', 54, PH - 30);
    doc.setFont(F.body, 'normal'); waText(doc, WA_PDF.muted);
    if (leftNote) doc.text(leftNote, 54 + doc.getTextWidth('beworldaware.com') + 14, PH - 30);
    doc.text(`Page ${p} of ${n}`, PW - 54, PH - 30, { align: 'right' });
  }
}
