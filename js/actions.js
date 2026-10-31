/* =============================================================
   WORLD AWARE RISK ASSESSMENT — js/actions.js
   Default action items for the report. DOM-free so tests/run.js
   can load it in node. buildDefaultActions(data) takes the object
   from buildReportData() (app.js) and returns plain-text lines,
   most urgent first. The report shows them in the editable
   "Action items" box until the user types their own.
   ============================================================= */

'use strict';

// Ten lines at most, so "Act now" still means something.
const ACTIONS_MAX_LINES = 10;

// Boulder County hints for addresses typed by hand (research fills in the county itself).
const _BOCO_TOWNS = /(^|,)\s*(Boulder|Longmont|Louisville|Lafayette|Superior|Nederland|Lyons|Niwot|Gunbarrel|Jamestown|Allenspark|Hygiene|Eldorado Springs)\b/i;
const _BOCO_ZIPS  = /\b(8030[1-9]|80310|80025|80026|80027|80455|80466|80481|80501|80502|80503|80510|80533|80540|80544)\b/;

/** Where the assessment is, as far as the report data can tell. */
function actionsLocale(data) {
  const rs = (data && data.research) || {};
  const text = [data && data.location, rs.address, rs.matchedAddress].filter(Boolean).join(' | ');
  const county = String(rs.county || '');
  const stateAbbr = String(rs.stateAbbr || '').toUpperCase();
  const inColorado = stateAbbr
    ? stateAbbr === 'CO'
    : (/\bCO\b/.test(text) || /colorado/i.test(text) || /\b8[01]\d{3}\b/.test(text));

  let boulderCounty = false;
  if (/boulder/i.test(county)) boulderCounty = !stateAbbr || stateAbbr === 'CO';
  else if (!county) {
    boulderCounty = /boulder county/i.test(text)
      || _BOCO_ZIPS.test(text)
      || (inColorado && text.split('|').some(part => _BOCO_TOWNS.test(part.trim())));
  }
  return { boulderCounty, inColorado };
}

/*
 * Hazard-specific lines, keyed by hazard id (HAZARD_DATA in app.js).
 * Hazards that call for the same steps share a group so the list never
 * repeats itself. Each group gives one or two lines; the first matters most.
 */
const ACTION_GROUPS = [
  {
    key: 'wildfire', ids: [1],
    lines: loc => [
      'Clear the first 5 feet around the house of anything that burns, such as firewood, wood mulch, dead plants, doormats and stored items.',
      loc.boulderCounty
        ? 'Get a free home assessment. West of US 36 and CO 93, Wildfire Partners does one and covers half the cost of eligible work up to $2,000. Inside Boulder city limits, ask about the City of Boulder Wildfire Resilience Assistance Program.'
        : 'Ask your fire district whether it offers a free home wildfire assessment.',
    ],
  },
  {
    key: 'flood', ids: [3, 4],
    lines: () => [
      'Look up your address on the FEMA flood map at msc.fema.gov and note which way water would reach the house.',
      'Price flood insurance now. Standard homeowners policies leave out flood, and a new flood policy usually has a 30-day wait before it pays.',
    ],
  },
  {
    key: 'power', ids: [8, 24],
    lines: loc => [
      'Plan for 3 days without power, including how you will run any medical device, stay warm with the furnace off and keep phones charged.',
      loc.boulderCounty
        ? 'Keep a battery bank charged for anything that has to stay on. Xcel has cut power ahead of time in Boulder County on high-wind days.'
        : 'Keep a battery bank charged for anything that has to stay on, and ask your utility how it warns customers before it shuts off power on purpose.',
    ],
  },
  {
    key: 'earthquake', ids: [2],
    lines: () => [
      'Strap the water heater to the wall and anchor tall furniture and bookshelves, starting with bedrooms.',
    ],
  },
  {
    key: 'hail', ids: [5],
    lines: () => [
      'Decide where the cars go when hail is forecast, and check the roof after every big storm.',
      'When the roof is due for replacement, ask your insurer whether an impact-rated (Class 4) roof earns a premium credit.',
    ],
  },
  {
    key: 'wind', ids: [63],
    lines: () => [
      'Trim branches that hang over the roof, and bring in or tie down patio furniture, trash bins and trampolines when high wind is forecast.',
      'Stay well away from any downed power line, assume it is live, and call 911 and your utility.',
    ],
  },
  {
    key: 'heat', ids: [9],
    lines: () => [
      'Pick the coolest room in the house for heat waves, plan how to keep it cool if the power goes out, and write down who you will check on.',
    ],
  },
  {
    key: 'drought', ids: [10],
    lines: () => [
      'Look up your water provider\'s watering rules, and when you can water, put it on the plants closest to the house first so they stay green and slow a fire.',
    ],
  },
  {
    key: 'smoke', ids: [23],
    lines: () => [
      'Set up one clean-air room with a portable HEPA air cleaner, or a box fan with a MERV 13 filter strapped to it, and keep N95 masks for everyone.',
      'On smoky days check the air quality at airnow.gov and keep windows shut while it reads unhealthy.',
    ],
  },
  {
    key: 'landslide', ids: [11],
    lines: () => [
      'If a burn scar sits uphill, treat a flash flood warning as the signal to get to higher ground, away from the channel, right away.',
      'Watch for new cracks in walls or the ground, tilting trees or fences, and doors that start to stick, and report them to your county.',
    ],
  },
  {
    key: 'radon', ids: [64],
    lines: () => [
      'Test the lowest lived-in floor for radon with a short-term test kit from a hardware store or your county health department.',
      'If a test reads 4 pCi/L or higher, get quotes from a certified radon mitigation contractor.',
    ],
  },
  {
    key: 'housefire', ids: [65],
    lines: () => [
      'Put a smoke alarm in every bedroom, outside each sleeping area and on every floor, and test them once a month.',
      'Keep a fire extinguisher in the kitchen, clean the dryer lint screen after every load, and agree on a meeting spot outside.',
    ],
  },
  {
    key: 'chemical', ids: [15],
    lines: () => [
      'Learn to shelter in place: pick an inside room, keep tape and plastic sheeting there, and practice turning off the furnace, air conditioning and fans quickly.',
      'Find out which rail lines and freight routes run near you, so a shelter-in-place order makes sense the moment it comes.',
    ],
  },
  {
    key: 'nuclear', ids: [18],
    lines: () => [
      'If you are told of a radiation release, get inside, close windows and vents, turn off fans and the furnace, and stay in until officials say it is safe.',
      'Take potassium iodide only if health officials tell you to, and sign up for county alerts so those instructions reach you.',
    ],
  },
  {
    key: 'gas', ids: [17],
    lines: () => [
      'Find the gas shutoff at the meter and keep the right wrench next to it. Turn it off only if you smell gas or are told to.',
      'Put a carbon monoxide alarm on every floor, and if you smell gas, get out first and call from outside.',
    ],
  },
  {
    key: 'water', ids: [27],
    lines: () => [
      'Store two weeks of water, about 1 gallon per person per day, and swap it out every six months.',
      'Find the main water shutoff valve and make sure every adult in the house can turn it.',
    ],
  },
  {
    key: 'road', ids: [36],
    lines: () => [
      'Map two ways out of your neighborhood by car and one on foot, and drive the second route once so it is familiar.',
      'Keep the gas tank at least half full in fire season and before winter storms.',
    ],
  },
  {
    key: 'outbreak', ids: [22],
    lines: () => [
      'Keep two weeks of food, prescriptions and household supplies on hand, and write down who looks after whom if the adults get sick.',
      'Keep some cash at home in small bills, plus paper copies of key phone numbers, accounts and prescriptions, for when cards and phones stop working.',
    ],
  },
  {
    key: 'tornado', ids: [6],
    lines: () => [
      'Pick your shelter spot: a basement, or an inside room on the lowest floor with no windows, and practice getting there.',
      'Turn on emergency alerts on every phone and keep a weather radio, since outdoor sirens are not meant to be heard indoors.',
    ],
  },
  {
    key: 'soil', ids: [66],
    lines: () => [
      'Make sure gutters and downspouts carry water well away from the foundation, and keep sprinklers off the ground right next to the house.',
      'Watch for new cracks in the foundation or drywall and doors that start to stick, and have a structural engineer look before the cracks grow.',
    ],
  },
];

function _actionGroupFor(id) {
  return ACTION_GROUPS.find(g => g.ids.indexOf(id) !== -1) || null;
}

/** The lines every household gets, in order of urgency. */
function _baseActionLines(data, loc) {
  const size = parseInt(data && data.householdSize, 10);
  const people = size > 1 ? ` (${size} people)` : '';
  const lines = [];
  if (loc.boulderCounty) {
    lines.push('This week: sign up for BOCO Alert at www.BOCOAlert.org so county emergency alerts reach you.');
    lines.push('This week: install the Genasys Protect app, look up your evacuation zone and write it on the fridge. Turn on emergency alerts on every phone in the house.');
  } else {
    lines.push('This week: sign up for your county\'s emergency alert system. The sheriff\'s office or county website will have the link.');
    lines.push('This week: find out whether your area uses evacuation zones and learn yours. Turn on emergency alerts on every phone in the house.');
  }
  lines.push(`This month: pack a go-bag for each person${people} with water, medications, a phone charger, glasses, a change of clothes and some cash.`);
  lines.push('This month: put copies of IDs, insurance policies, the deed or lease and prescriptions in one folder you can grab on the way out, and take a phone video of every room with closets and drawers open.');
  lines.push('Before your insurance renews: ask your agent what it would cost to rebuild your home at today\'s prices and whether your policy would pay that much, since nearly 75% of Marshall Fire households were underinsured.');
  return lines;
}

/**
 * Default action items for a report, most urgent first.
 * @param {object} data  buildReportData() output
 * @returns {string[]}   plain-text lines, at most ACTIONS_MAX_LINES
 */
function buildDefaultActions(data) {
  data = data || {};
  const loc = actionsLocale(data);
  const base = _baseActionLines(data, loc);

  // One group per hazard type, in the order of its highest-scoring Critical or High hazard
  const groups = [];
  const seen = {};
  (data.scored || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0)).forEach(it => {
    if (it.level !== 'CRITICAL' && it.level !== 'HIGH') return;
    const g = _actionGroupFor(it.id);
    if (!g || seen[g.key]) return;
    seen[g.key] = true;
    groups.push({ name: it.name, lines: g.lines(loc), take: 0 });
  });

  // Fill the room left under the cap: every hazard's first line, then second lines
  let room = Math.max(0, ACTIONS_MAX_LINES - base.length);
  for (let pass = 0; pass < 2 && room > 0; pass++) {
    groups.forEach(g => {
      if (room > 0 && g.take === pass && g.lines.length > pass) { g.take = pass + 1; room--; }
    });
  }

  const hazardLines = [];
  groups.forEach(g => {
    g.lines.slice(0, g.take).forEach(line => hazardLines.push(`${g.name}: ${line.charAt(0).toLowerCase()}${line.slice(1)}`));
  });

  return base.concat(hazardLines).slice(0, ACTIONS_MAX_LINES);
}
