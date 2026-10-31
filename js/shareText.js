/* =============================================================
   WORLD AWARE RISK ASSESSMENT — js/shareText.js
   Plain-text share message. Pure function: no DOM, no storage, no
   other globals, so tests/run.js can run it in node.
   Input: the object from buildReportData() and the report edits.
   ============================================================= */

'use strict';

/** Strip a leading house number (123, 123B, 12-14) from an address. Keeps street names like "4th Street". */
function stripHouseNumber(addr) {
  return String(addr || '').replace(/^\s*\d+(?!(?:st|nd|rd|th)\s)(?:[A-Za-z]+|-\d+[A-Za-z]*|-[A-Za-z]*)?\s+/i, '').trim();
}

/** "1234 Pearl St, Boulder, CO 80302, USA" -> "Pearl St, Boulder" */
function shareStreetAndCity(location) {
  const parts = stripHouseNumber(location).split(',').map(s => s.trim()).filter(Boolean);
  return parts.slice(0, 2).join(', ');
}

/**
 * The share message: at most 8 short lines, plain sentences.
 * Lists are capped at 5 hazards per line so a long assessment still fits on a phone.
 */
function buildShareText(data, edits) {
  data = data || {};
  edits = edits || {};
  const scored = Array.isArray(data.scored) ? data.scored : [];
  const MAX_LISTED = 5;

  const list = items => {
    const shown = items.slice(0, MAX_LISTED).map(it => `${it.name}, score ${it.score}`);
    const more = items.length - shown.length;
    return shown.join('; ') + (more > 0 ? `; and ${more} more` : '');
  };

  const preparedFor = String(edits.preparedFor || '').trim();
  const who = preparedFor || (data.typeKey === 'neighborhood' ? 'Our neighborhood' : 'Our household');
  const where = shareStreetAndCity(data.location);
  const when = data.dateDisplay || data.date || '';
  const lines = [];
  // "Our household: hazard check, Broadway, Boulder CO (October 31, 2026)"; no stray comma when there is no address
  lines.push([`${who}: hazard check`, where].filter(Boolean).join(', ') + (when ? ` (${when})` : ''));
  lines.push('Each hazard is scored out of 25: how likely it is here, times how badly it would hit us.');

  const critical = scored.filter(it => it.level === 'CRITICAL');
  const high = scored.filter(it => it.level === 'HIGH');
  if (critical.length) lines.push(`Act on these in the next 30 days: ${list(critical)}.`);
  if (high.length) lines.push(`Write down a plan for these this season: ${list(high)}.`);
  if (!critical.length && !high.length) {
    lines.push(scored.length
      ? `Nothing scored high or critical. Highest: ${scored[0].name}, score ${scored[0].score} out of 25.`
      : 'No hazards scored yet.');
  }

  const county = data.research && data.research.county ? data.research.county : '';
  const isBoulder = /boulder/i.test(`${county} ${data.location || ''}`);
  lines.push(isBoulder
    ? 'Anyone can do this week: sign up for BOCO Alert at bocoalert.org and look up your evacuation zone in the Genasys Protect app.'
    : 'Anyone can do this week: sign up for your county\'s emergency alerts and learn two ways out of the neighborhood.');
  lines.push('Before your next renewal: ask your insurance agent what it would cost to rebuild today and whether your policy covers that.');
  lines.push('These scores are a planning-level screen built from public data and our own judgment. They are not an engineering, insurance or official flood or fire determination.');
  lines.push('Made with World Aware\'s risk check. Questions, or want one done for your street: beworldaware.com');
  return lines.join('\n');
}
