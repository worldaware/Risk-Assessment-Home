/* =============================================================
   WORLD AWARE RISK ASSESSMENT — js/report.js
   Report view: renders buildReportData() (app.js) as an editable
   document, persists user edits, prints, and generates a real
   text-based PDF with the vendored jsPDF library (js/vendor/).
   ============================================================= */

'use strict';

const REPORT_EDITS_KEY = 'wa_report_edits';
const JSPDF_SRC = 'js/vendor/jspdf.umd.min.js';

/* ---------------------------------------------------------------
   EDIT STORAGE — { [assessmentId]: { title, preparedFor, summary,
   actions, notes: { [hazardId]: text } } }
--------------------------------------------------------------- */

function _readAllReportEdits() {
  try {
    const raw = localStorage.getItem(REPORT_EDITS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

function _writeAllReportEdits(all) {
  try {
    localStorage.setItem(REPORT_EDITS_KEY, JSON.stringify(all));
  } catch (e) {
    console.warn('Could not save report edits', e);
  }
}

/** Edits for the current assessment (always returns an object). */
function getReportEdits() {
  const all = _readAllReportEdits();
  const mine = all[state.assessmentId] || {};
  if (!mine.notes || typeof mine.notes !== 'object') mine.notes = {};
  return mine;
}

function _saveReportEdit(key, value) {
  const all = _readAllReportEdits();
  const mine = all[state.assessmentId] || { notes: {} };
  if (!mine.notes) mine.notes = {};
  if (key.startsWith('notes.')) {
    mine.notes[key.slice(6)] = value;
  } else {
    mine[key] = value;
  }
  all[state.assessmentId] = mine;
  _writeAllReportEdits(all);
}

function resetReportEdits() {
  showConfirm('Reset all report edits? Your title, notes and action items in the report go back to the defaults.', () => {
    const all = _readAllReportEdits();
    delete all[state.assessmentId];
    _writeAllReportEdits(all);
    renderReportView();
    if (typeof preparePdf === 'function') preparePdf();
  });
}

/* ---------------------------------------------------------------
   RESOLVED REPORT — data + edits merged into display strings.
   Used by the on-screen report, print, and PDF.
--------------------------------------------------------------- */

function _defaultReportTitle(data) {
  return `${data.typeLabel} Risk Assessment Report`;
}

function buildResolvedReport() {
  const data  = buildReportData();
  const edits = getReportEdits();
  const pick  = (v, d) => (typeof v === 'string' ? v : d);
  const noteFor = it => pick(edits.notes[it.id], it.notes || '');
  return {
    data,
    title:       pick(edits.title, _defaultReportTitle(data)),
    preparedFor: pick(edits.preparedFor, ''),
    summary:     pick(edits.summary, buildDefaultSummary(data)),
    actions:     pick(edits.actions, ''),
    scored:  data.scored.map(it  => Object.assign({}, it, { reportNotes: noteFor(it) })),
    unrated: data.unrated.map(it => Object.assign({}, it, { reportNotes: noteFor(it) })),
  };
}

/* ---------------------------------------------------------------
   ON-SCREEN / PRINT REPORT
--------------------------------------------------------------- */

function _editable(key, value, placeholder, tag, extraClass) {
  tag = tag || 'div';
  const empty = !String(value || '').trim();
  return `<${tag} class="rd-editable${extraClass ? ' ' + extraClass : ''}${empty ? ' is-empty' : ''}"
    contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true"
    data-edit="${key}" data-placeholder="${escHtml(placeholder || '')}">${escHtml(value || '')}</${tag}>`;
}

function _riskClass(level) {
  const rl = RISK_LEVELS[level];
  return rl ? 'b-' + rl.cls : 'b-unrated';
}

function renderReportView() {
  const doc = document.getElementById('report-doc');
  if (!doc) return;
  const r = buildResolvedReport();
  const d = r.data;

  const metaRows = [];
  metaRows.push(['Location', d.location || 'Not specified']);
  metaRows.push(['Date', d.dateDisplay || d.date]);
  metaRows.push(['Assessment type', d.typeLabel]);
  if (d.householdSize) metaRows.push(['Household size', d.householdSize]);
  if (d.hhNames) metaRows.push(['Households', d.hhNames.join(' & ')]);

  let html = `
    <header class="rd-header">
      <div class="rd-brand">
        <img src="assets/wa-lockup-reversed-cream.png" width="780" height="180" alt="World Aware, Emergency Planning" />
        <span class="rd-brand-url">beworldaware.com</span>
      </div>
      <div class="rd-header-body">
      ${_editable('title', r.title, 'Report title', 'h1', 'rd-title')}
      <p class="rd-prepared${r.preparedFor.trim() ? '' : ' is-empty-line'}" data-line="preparedFor">
        <span class="rd-label">Prepared for</span>
        ${_editable('preparedFor', r.preparedFor, 'Add a name or household', 'span', 'rd-inline')}
      </p>
      <dl class="rd-meta">
        ${metaRows.map(([k, v]) => `<div><dt>${escHtml(k)}</dt><dd>${escHtml(v)}</dd></div>`).join('')}
      </dl>
      </div>
    </header>

    <div class="rd-body">
    <section class="rd-section">
      <h2>Summary</h2>
      ${_editable('summary', r.summary, 'Write a short summary of this assessment', 'div', 'rd-summary')}
      <div class="rd-counts">
        ${['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(k => `<span class="rd-count ${_riskClass(k)}${d.counts[k] ? '' : ' is-zero'}"><span class="rd-count-num">${d.counts[k]}</span><span class="rd-count-label">${RISK_LEVELS[k].label}</span></span>`).join('')}
      </div>
      <p class="rd-count-line">${d.scored.length} scored${d.unrated.length ? `. ${d.unrated.length} identified by research with impact not yet rated` : ''}.</p>
    </section>
  `;

  // Ranked, fully scored hazards
  html += `<section class="rd-section"><h2>Ranked risks</h2>`;
  if (r.scored.length === 0) {
    html += `<p class="rd-empty">No hazards have both a likelihood and an impact rating yet.</p>`;
  } else {
    html += `<ol class="rd-list">`;
    r.scored.forEach((it, idx) => {
      html += `
        <li class="rd-item">
          <div class="rd-score ${_riskClass(it.level)}">
            <span class="rd-score-num">${it.score}</span>
            <span class="rd-score-label">${RISK_LEVELS[it.level].label}</span>
          </div>
          <div class="rd-item-body">
            <div class="rd-item-name"><span class="rd-rank">${idx + 1}.</span> ${escHtml(it.name)}</div>
            <div class="rd-item-meta">${escHtml(catLabel(it.category))}. ${escHtml(it.liText)}.${it.fromResearch ? ' Likelihood from address research.' : ''}</div>
            ${it.fromResearch && it.finding ? `<div class="rd-item-finding">${escHtml(it.finding)}</div>` : ''}
            ${_editable('notes.' + it.id, it.reportNotes, 'Add notes', 'div', 'rd-notes')}
          </div>
        </li>`;
    });
    html += `</ol>`;
  }
  html += `</section>`;

  // Research findings without impact
  if (r.unrated.length) {
    html += `
      <section class="rd-section rd-unrated">
        <h2>Identified by research, impact not yet rated</h2>
        <p class="rd-section-intro">Address research estimated the likelihood of these hazards. They do not have a risk score until their impact is rated.</p>
        <ul class="rd-list rd-list-plain">`;
    r.unrated.forEach(it => {
      html += `
          <li class="rd-item">
            <div class="rd-score rd-score-likelihood">
              <span class="rd-score-num">L${it.l}</span>
              <span class="rd-score-label">Not rated</span>
            </div>
            <div class="rd-item-body">
              <div class="rd-item-name">${escHtml(it.name)}</div>
              <div class="rd-item-meta">${escHtml(catLabel(it.category))}. Likelihood ${it.l} (${escHtml(it.likelihoodLabel)}).${it.confidence ? ' Confidence: ' + escHtml(it.confidence) + '.' : ''}</div>
              ${it.finding ? `<div class="rd-item-finding">${escHtml(it.finding)}</div>` : ''}
              ${it.source ? `<div class="rd-item-source">Source: ${escHtml(it.source)}</div>` : ''}
              ${_editable('notes.' + it.id, it.reportNotes, 'Add notes', 'div', 'rd-notes')}
            </div>
          </li>`;
    });
    html += `</ul></section>`;
  }

  // Action items
  html += `
    <section class="rd-section rd-actions${r.actions.trim() ? '' : ' is-empty-section'}" data-section="actions">
      <h2>Action items</h2>
      ${_editable('actions', r.actions, 'Type the steps you plan to take, one per line', 'div', 'rd-actions-text')}
    </section>`;

  // Research sources
  if (d.research) {
    const rs = d.research;
    html += `
      <section class="rd-section rd-sources">
        <h2>Research sources</h2>
        <p>${rs.matchedAddress ? `Matched address: ${escHtml(rs.matchedAddress)}. ` : ''}Likelihood was estimated for ${rs.findingCount} hazards from public data (confidence: ${rs.confidence.High} high, ${rs.confidence.Medium} medium, ${rs.confidence.Low} low${rs.estimatedCount ? `; ${rs.estimatedCount} used a regional fallback estimate` : ''}).</p>
        <ul>${rs.sources.map(s => `<li>${escHtml(s)}</li>`).join('')}</ul>
      </section>`;
  }

  html += `</div><footer class="rd-footer"><strong>beworldaware.com</strong><span>World Aware Emergency Planning, Boulder, Colorado</span></footer>`;

  doc.innerHTML = html;
  _bindReportEditing(doc);
}

function _bindReportEditing(doc) {
  if (doc._reportBound) return;
  doc._reportBound = true;

  let timer = null;
  doc.addEventListener('input', e => {
    const el = e.target.closest('[data-edit]');
    if (!el) return;
    const key = el.dataset.edit;
    const val = el.innerText.replace(/ /g, ' ').replace(/\n$/, '');
    const empty = !val.trim();
    el.classList.toggle('is-empty', empty);
    if (key === 'preparedFor') el.closest('.rd-prepared')?.classList.toggle('is-empty-line', empty);
    if (key === 'actions') el.closest('.rd-actions')?.classList.toggle('is-empty-section', empty);
    clearTimeout(timer);
    timer = setTimeout(() => _saveReportEdit(key, val), 250);
    // Save immediately too, so nothing is lost if the page closes
    _saveReportEdit(key, val);
    if (typeof invalidatePdf === 'function') invalidatePdf();
  });

  // Paste as plain text only
  doc.addEventListener('paste', e => {
    const el = e.target.closest('[data-edit]');
    if (!el) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  // Enter in single-line fields ends editing
  doc.addEventListener('keydown', e => {
    const el = e.target.closest('[data-edit]');
    if (!el) return;
    if (e.key === 'Enter' && (el.dataset.edit === 'title' || el.dataset.edit === 'preparedFor')) {
      e.preventDefault();
      el.blur();
    }
  });
}

/* ---------------------------------------------------------------
   PDF (jsPDF, text-based, loaded on demand)
   Theme (fonts, colors, band rendering) lives in js/wa-pdf-theme.js.
--------------------------------------------------------------- */

let _jspdfLoading = null;

function _loadJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (_jspdfLoading) return _jspdfLoading;
  _jspdfLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSPDF_SRC;
    s.async = true;
    s.onload = () => (window.jspdf && window.jspdf.jsPDF)
      ? resolve(window.jspdf.jsPDF)
      : reject(new Error('PDF library failed to initialise'));
    s.onerror = () => { _jspdfLoading = null; reject(new Error('Could not load PDF library')); };
    document.head.appendChild(s);
  });
  return _jspdfLoading;
}

let _pdfBrandFonts = false;   // true while the brand fonts are registered on the doc being built

/** Map text to characters the PDF fonts can draw (brand fonts are Latin subsets). */
function _pdfSafe(text) {
  let t = String(text || '')
    .replace(/[←-⇿]/g, '->')
    .replace(/[−]/g, '-')
    .replace(/[≤]/g, '<=').replace(/[≥]/g, '>=')
    .replace(/[   ]/g, ' ');
  if (_pdfBrandFonts) {
    // Glyphs missing from the Latin subsets: fall back to plain letters
    t = t.replace(/[Š]/g, 'S').replace(/[š]/g, 's').replace(/[Ÿ]/g, 'Y')
         .replace(/[Ž]/g, 'Z').replace(/[ž]/g, 'z').replace(/[ƒ]/g, 'f')
         .replace(/[†‡]/g, '').replace(/[‰]/g, '%');
  }
  // keep Latin-1 and the WinAnsi extras (dashes, quotes, bullet, ellipsis, etc.)
  return t
    .replace(/[^\x09\x0A\x0D\x20-\x7E¡-ÿ–—‘’“”•…€™ŒœŠšŸŽžƒˆ˜†‡‰‹›‚„]/g, '')
    .replace(/[ \t]+\n/g, '\n');
}

function reportPdfFilename(dateIso) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dateIso || '') ? dateIso : localToday();
  return `World-Aware-Risk-Report-${d}.pdf`;
}

/** Build the PDF document object (no download). */
async function buildReportPDF() {
  const JsPDF = await _loadJsPDF();
  // Brand fonts and logos are cached after the first load; each falls back on its own.
  const fontsOk = (typeof waLoadPdfFonts === 'function') ? await waLoadPdfFonts() : false;
  const logoCream = await waLoadLogo('assets/wa-lockup-reversed-cream-520.png').catch(() => null);
  const logoColor = await waLoadLogo('assets/wa-lockup-full-color-520.png').catch(() => null);

  const r = buildResolvedReport();
  const d = r.data;

  const doc = new JsPDF({ unit: 'pt', format: 'letter', compress: true });
  const F = fontsOk ? waRegisterPdfFonts(doc) : { display: 'helvetica', body: 'helvetica', brand: false };
  _pdfBrandFonts = !!F.brand;

  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M  = 54;
  const W  = PW - M * 2;
  const BOTTOM = PH - 60;
  const C = WA_PDF;
  let y = M;

  const setColor = c => doc.setTextColor(c[0], c[1], c[2]);
  // face: 'display' (Space Grotesk, bold only) or 'body' (Poppins)
  const font = (style, size, face) => {
    if (face === 'display') doc.setFont(F.display, F.brand ? 'bold' : style);
    else doc.setFont(F.body, style);
    doc.setFontSize(size);
  };
  const lh = size => size * 1.45;

  function newPage() {
    doc.addPage();
    y = waRunningHeader(doc, F, logoColor, r.title ? _pdfSafe(r.title).slice(0, 80) : 'Risk assessment report');
  }
  function ensure(h) {
    if (y + h > BOTTOM) newPage();
  }
  function para(text, opts) {
    opts = opts || {};
    const size = opts.size || 10.5;
    font(opts.style || 'normal', size, opts.face);
    setColor(opts.color || C.ink);
    const x = opts.x || M;
    const width = opts.width || W;
    const lines = doc.splitTextToSize(_pdfSafe(text), width);
    lines.forEach(line => {
      ensure(lh(size));
      doc.text(line, x, y + size);
      y += lh(size);
    });
    y += opts.after !== undefined ? opts.after : 4;
  }
  const HEADING_H = 38;
  // keep: height of the content that must stay on the same page as the heading
  function heading(text, keep) {
    ensure(HEADING_H + (keep || lh(10.5) * 2));
    y += 8;
    y = waHeading(doc, F, _pdfSafe(text), M, y, W);
  }
  function measure(text, size, width, style) {
    font(style || 'normal', size);
    return doc.splitTextToSize(_pdfSafe(text), width).length * lh(size);
  }

  // ── Cover band (page 1) ───────────────────────────────────
  y = waCoverBand(doc, F, logoCream, 'beworldaware.com');

  font('bold', 22, 'display');
  setColor(C.maroon);
  const titleLines = doc.splitTextToSize(_pdfSafe(r.title), W);
  titleLines.forEach((ln, i) => doc.text(ln, M, y + 18 + i * 27));
  y += 18 + (titleLines.length - 1) * 27;
  if (r.preparedFor.trim()) {
    y += 20;
    para('Prepared for ' + r.preparedFor, { size: 10.5, color: C.muted, after: 6 });
  } else {
    y += 8;
  }
  y += 6;

  // Meta box: cream fill with an amber spine
  const meta = [['Location', d.location || 'Not specified'], ['Date', d.dateDisplay || d.date], ['Assessment type', d.typeLabel]];
  if (d.householdSize) meta.push(['Household size', d.householdSize]);
  if (d.hhNames) meta.push(['Households', d.hhNames.join(' & ')]);
  const labelW = 118;
  const metaRowH = v => Math.max(15, measure(v, 10, W - labelW - 20));
  const metaH = meta.reduce((acc, [, v]) => acc + metaRowH(v), 0) + 16;
  ensure(metaH);
  doc.setFillColor(C.cream[0], C.cream[1], C.cream[2]);
  doc.rect(M, y, W, metaH, 'F');
  doc.setFillColor(C.amber[0], C.amber[1], C.amber[2]);
  doc.rect(M, y, 3, metaH, 'F');
  let my = y + 8;
  meta.forEach(([k, v]) => {
    font('bold', 8.5); setColor(C.muted);
    doc.text(_pdfSafe(k), M + 14, my + 10);
    font('normal', 10); setColor(C.ink);
    const lines = doc.splitTextToSize(_pdfSafe(v), W - labelW - 20);
    lines.forEach((ln, i) => doc.text(ln, M + labelW, my + 10 + i * 15));
    my += Math.max(15, lines.length * 15);
  });
  y += metaH + 6;

  // ── Summary ───────────────────────────────────────────────
  heading('Summary', measure(r.summary || ' ', 10.5, W) + 20);
  if (r.summary.trim()) para(r.summary, { after: 8 });
  ensure(40 + 24);
  waCountTiles(doc, F, M, y, W, d.counts);
  y += 40 + 8;
  let countLine = `${d.scored.length} hazard${d.scored.length === 1 ? '' : 's'} scored`;
  if (d.unrated.length) countLine += `. ${d.unrated.length} identified by research with impact not yet rated`;
  para(countLine + '.', { size: 9, color: C.muted });

  // ── Ranked risks ──────────────────────────────────────────
  const boxW = 54;
  const bodyX = M + boxW + 12;
  const bodyW = W - boxW - 12;
  // Height an item needs before it is allowed to start on the current page
  function itemHeight(it, rank, opts) {
    const nameText = (rank ? rank + '. ' : '') + it.name;
    const notes = (it.reportNotes || '').trim();
    let h = measure(nameText, 11, bodyW, 'bold') + measure(opts.meta, 9, bodyW);
    (opts.extra || []).forEach(t => { h += measure(t, 9, bodyW); });
    if (notes) h += measure('Notes: ' + notes, 9.5, bodyW) + 2;
    h = Math.max(h, 40) + 10;
    return Math.min(h, 130); // very long notes: allow page flow
  }
  function item(it, rank, opts) {
    const nameText = (rank ? rank + '. ' : '') + it.name;
    const extra = opts.extra || [];
    const notes = (it.reportNotes || '').trim();
    ensure(itemHeight(it, rank, opts));

    waScoreBox(doc, F, M, y, opts.levelKey, _pdfSafe(opts.boxNum));

    const startY = y;
    para(nameText, { x: bodyX, width: bodyW, size: 11, style: 'bold', color: C.ink, after: 0 });
    para(opts.meta, { x: bodyX, width: bodyW, size: 9, color: C.muted, after: 0 });
    extra.forEach(t => para(t, { x: bodyX, width: bodyW, size: 9, color: C.muted, after: 0 }));
    if (notes) {
      y += 2;
      para('Notes: ' + notes, { x: bodyX, width: bodyW, size: 9.5, color: C.ink, after: 0 });
    }
    y = Math.max(y, startY + 40) + 8;
    doc.setDrawColor(C.rule[0], C.rule[1], C.rule[2]);
    doc.setLineWidth(0.5);
    doc.line(M, y - 4, M + W, y - 4);
  }

  const scoredOpts = r.scored.map(it => ({
    levelKey: it.level,
    boxNum: String(it.score),
    meta: `${catLabel(it.category)}. ${it.liText}.`,
    extra: (it.fromResearch && it.finding) ? ['Research: ' + it.finding] : [],
  }));
  heading('Ranked risks', r.scored.length ? itemHeight(r.scored[0], 1, scoredOpts[0]) : lh(10.5) * 2);
  if (r.scored.length === 0) {
    para('No hazards have both a likelihood and an impact rating yet.', { color: C.muted });
  }
  r.scored.forEach((it, idx) => item(it, idx + 1, scoredOpts[idx]));

  // ── Unrated research findings ─────────────────────────────
  if (r.unrated.length) {
    const unratedOpts = r.unrated.map(it => ({
      levelKey: 'LIKELY',
      boxNum: 'L' + it.l,
      meta: `${catLabel(it.category)}. Likelihood ${it.l} (${it.likelihoodLabel}).${it.confidence ? ' Confidence: ' + it.confidence + '.' : ''}`,
      extra: [it.finding ? 'Finding: ' + it.finding : '', it.source ? 'Source: ' + it.source : ''].filter(Boolean),
    }));
    const introText = 'Address research estimated the likelihood of these hazards. They do not have a risk score until their impact is rated.';
    heading('Identified by research, impact not yet rated',
      measure(introText, 9.5, W) + 12 + itemHeight(r.unrated[0], null, unratedOpts[0]));
    para(introText, { size: 9.5, color: C.muted, after: 8 });
    r.unrated.forEach((it, idx) => item(it, null, unratedOpts[idx]));
  }

  // ── Action items ──────────────────────────────────────────
  if (r.actions.trim()) {
    heading('Action items');
    r.actions.split('\n').map(s => s.trim()).filter(Boolean).forEach(line => {
      const clean = line.replace(/^[-*•]\s*/, '');
      font('normal', 10.5);
      const lines = doc.splitTextToSize(_pdfSafe(clean), W - 14);
      lines.forEach((ln, i) => {
        ensure(lh(10.5));
        if (i === 0) {
          doc.setFillColor(C.amber[0], C.amber[1], C.amber[2]);
          doc.circle(M + 2, y + 7, 1.5, 'F');
        }
        font('normal', 10.5);
        setColor(C.ink);
        doc.text(ln, M + 14, y + 10.5);
        y += lh(10.5);
      });
      y += 2;
    });
  }

  // ── Research sources ──────────────────────────────────────
  if (d.research) {
    const rs = d.research;
    heading('Research sources');
    para(`${rs.matchedAddress ? 'Matched address: ' + rs.matchedAddress + '. ' : ''}Likelihood was estimated for ${rs.findingCount} hazards from public data (confidence: ${rs.confidence.High} high, ${rs.confidence.Medium} medium, ${rs.confidence.Low} low${rs.estimatedCount ? '; ' + rs.estimatedCount + ' used a regional fallback estimate' : ''}).`, { size: 9.5 });
    rs.sources.forEach(src => para(src, { size: 9, color: C.muted, after: 1 }));
  }

  // ── Footer on every page ──────────────────────────────────
  waFooters(doc, F, 'World Aware Emergency Planning, Boulder, Colorado');

  doc.setProperties({
    title: _pdfSafe(r.title),
    subject: 'World Aware Risk Assessment',
    creator: 'World Aware Risk Assessment Tool v2.1',
  });
  return { doc, filename: reportPdfFilename(d.date) };
}

/* ---------------------------------------------------------------
   PDF / SHARE — the single export button (Results and Report screens).
   iPhone only opens the share sheet if navigator.share() is called right
   inside the tap, so the PDF is built ahead of time and kept ready; the
   tap then shares the ready file with no waiting. The share sheet offers
   Print, Save to Files, Mail, Messages, etc. Where sharing files isn't
   supported (most desktop browsers), the PDF downloads instead.
--------------------------------------------------------------- */

let _pdfReady = null;      // { file, filename, blob } for the current report
let _pdfBuilding = null;   // in-flight build promise
let _pdfStaleTimer = null;

async function _buildPdfFile() {
  const { doc, filename } = await buildReportPDF();
  const blob = doc.output('blob');
  let file = null;
  try { file = new File([blob], filename, { type: 'application/pdf' }); } catch (_) {}
  return { file, filename, blob };
}

/** (Re)build the ready-to-share PDF. Call when the report data or edits change. */
function preparePdf() {
  const build = _buildPdfFile().then(r => {
    if (_pdfBuilding === build) { _pdfReady = r; _pdfBuilding = null; }
    return r;
  }).catch(err => {
    if (_pdfBuilding === build) _pdfBuilding = null;
    console.error('PDF preparation failed', err);
    return null;
  });
  _pdfReady = null;
  _pdfBuilding = build;
  return build;
}

/** Mark the ready PDF out of date and rebuild shortly (used while typing edits). */
function invalidatePdf() {
  _pdfReady = null;
  clearTimeout(_pdfStaleTimer);
  _pdfStaleTimer = setTimeout(preparePdf, 600);
}

function _canShareFile(file) {
  try { return !!(file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); }
  catch (_) { return false; }
}

function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function _shareOrDownload(r) {
  if (_canShareFile(r.file)) {
    return navigator.share({ files: [r.file], title: r.filename }).catch(err => {
      if (err && err.name === 'AbortError') return;            // user closed the sheet
      _downloadBlob(r.blob, r.filename);                      // share blocked: save instead
    });
  }
  _downloadBlob(r.blob, r.filename);
  return Promise.resolve();
}

function sharePdf(btnEl) {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  // Typing in the report may have a rebuild pending: flush it now.
  if (_pdfStaleTimer && !_pdfReady && !_pdfBuilding) { clearTimeout(_pdfStaleTimer); preparePdf(); }

  // Fast path: PDF already built, share synchronously inside the tap.
  if (_pdfReady) { _shareOrDownload(_pdfReady); return; }

  // Slow path: still building. Show progress, then try; if iPhone refuses the
  // share sheet because the tap "expired", ask for one more tap.
  const btn = btnEl || null;
  const label = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing PDF…'; }
  (_pdfBuilding || preparePdf()).then(r => {
    if (btn) { btn.disabled = false; btn.innerHTML = label; }
    if (!r) { alert('Could not create the PDF. Please try again.'); return; }
    if (_canShareFile(r.file)) {
      navigator.share({ files: [r.file], title: r.filename }).catch(err => {
        if (err && err.name === 'AbortError') return;
        if (btn) { btn.innerHTML = label; }
        alert('Your PDF is ready. Tap PDF / Share again to open it.');
      });
    } else {
      _downloadBlob(r.blob, r.filename);
    }
  });
}

// Back-compat name (older markup / tests)
function downloadReportPDF() { sharePdf(document.getElementById('report-pdf-btn')); }
