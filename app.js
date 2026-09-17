const MASTER_HEADERS = [
  'Program Name', 'Name', 'Address', 'City', 'State', 'Zipcode', 'Email', 'Phone Number ', 'DOB', 'Age', 'Gender', 'Ethnic Origin', 'Demographics', 'Placement Entity', 'Placement Type', 'Placement Title', '180 Day Check\nStill Employed?', '365 Day Check\nStill Employed?'
];

const files = { bsaContact: null, bsaGraduate: null, osyReport: null };
let generatedCsv = '';

const $ = (id) => document.getElementById(id);
const normalizeHeader = (value) => String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeText = (value) => String(value ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const clean = (value) => String(value ?? '').trim();

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some((value) => clean(value))) rows.push(row);
      row = [];
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); if (row.some((value) => clean(value))) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((values) => headers.reduce((record, header, index) => {
    record[header] = clean(values[index]);
    return record;
  }, {}));
}

function get(record, ...names) {
  for (const name of names) {
    const value = record[normalizeHeader(name)];
    if (value) return value;
  }
  return '';
}

function fullName(record) {
  const direct = get(record, 'Full Name', 'Name');
  if (direct) return direct;
  return [get(record, 'First Name'), get(record, 'Last Name')].filter(Boolean).join(' ');
}

function parseAddress(address) {
  const value = clean(address).replace(/\s+/g, ' ');
  const match = value.match(/^(.*?)(?:,?\s+)([A-Za-z .'-]+),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (!match) return { address: value, city: '', state: '', zipcode: '' };
  return { address: match[1].replace(/,\s*$/, ''), city: clean(match[2]), state: match[3].toUpperCase(), zipcode: match[4] };
}

function makeKey(record) {
  const email = normalizeText(get(record, 'Email'));
  return email ? `email:${email}` : `name:${normalizeText(fullName(record))}`;
}

function indexRecords(records) {
  const index = new Map();
  records.forEach((record) => {
    const nameKey = `name:${normalizeText(fullName(record))}`;
    const email = normalizeText(get(record, 'Email'));
    if (nameKey !== 'name:') index.set(nameKey, record);
    if (email) index.set(`email:${email}`, record);
  });
  return index;
}

function findMatch(record, index) {
  const email = normalizeText(get(record, 'Email'));
  return (email && index.get(`email:${email}`)) || index.get(`name:${normalizeText(fullName(record))}`);
}

function bsaRow(contact, graduate) {
  const address = parseAddress(get(contact, 'Address'));
  return {
    'Program Name': 'BSA',
    'Name': fullName(contact),
    'Address': get(contact, 'Address'),
    'City': get(contact, 'City') || address.city,
    'State': get(contact, 'State') || address.state,
    'Zipcode': get(contact, 'Zipcode') || address.zipcode,
    'Email': get(contact, 'Email'),
    'Phone Number ': get(contact, 'Cell Phone', 'Phone Number'),
    'DOB': get(contact, 'DOB'),
    'Age': get(contact, 'Age'),
    'Gender': get(contact, 'Gender'),
    'Ethnic Origin': get(contact, 'Ethnicity', 'Ethnic Origin'),
    'Demographics': '',
    'Placement Entity': get(graduate, 'Placement Entity'),
    'Placement Type': get(graduate, 'Placement Type'),
    'Placement Title': get(graduate, 'Placement Title'),
    '180 Day Check\nStill Employed?': '',
    '365 Day Check\nStill Employed?': ''
  };
}

function osyRow(record) {
  const address = parseAddress(get(record, 'Address'));
  return {
    'Program Name': 'OSY',
    'Name': fullName(record),
    'Address': address.address || get(record, 'Address'),
    'City': address.city,
    'State': address.state,
    'Zipcode': address.zipcode,
    'Email': get(record, 'Email'),
    'Phone Number ': get(record, 'Phone Number'),
    'DOB': get(record, 'D.O.B', 'DOB'),
    'Age': get(record, 'Age'),
    'Gender': get(record, 'Gender'),
    'Ethnic Origin': get(record, 'Ethnic Origin', 'Ethnicity'),
    'Demographics': get(record, 'Student Status'),
    'Placement Entity': '', 'Placement Type': '', 'Placement Title': '',
    '180 Day Check\nStill Employed?': '', '365 Day Check\nStill Employed?': ''
  };
}

function toCsv(rows) {
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const headerRow = MASTER_HEADERS.map(escape).join(',');
  const dataRows = rows.map((row) => MASTER_HEADERS.map((header) => escape(row[header])).join(','));
  return [headerRow, ...dataRows].join('\r\n') + '\r\n';
}

function setMetric(index, value) {
  const metric = $('metrics').children[index];
  metric.querySelector('strong').textContent = value;
}

function setStatus(message, isError = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', isError);
}

function buildReport() {
  try {
    const contactRecords = parseCsv(files.bsaContact.text);
    const graduateRecords = parseCsv(files.bsaGraduate.text);
    const osyRecords = parseCsv(files.osyReport.text);
    const graduateIndex = indexRecords(graduateRecords);
    const contactIndex = indexRecords(contactRecords);
    const rows = [];
    const bsaNames = new Set();
    contactRecords.forEach((contact) => {
      const graduate = findMatch(contact, graduateIndex) || {};
      rows.push(bsaRow(contact, graduate));
      bsaNames.add(makeKey(contact));
    });
    const coEnrolled = [];
    const unmatchedOsy = [];
    osyRecords.forEach((record) => {
      const match = findMatch(record, contactIndex);
      if (match) {
        coEnrolled.push(fullName(record));
        const existing = rows.find((row) => normalizeText(row.Name) === normalizeText(fullName(match)));
        if (existing) existing['Program Name'] = 'BSA + OSY';
      } else {
        rows.push(osyRow(record));
        unmatchedOsy.push(fullName(record));
      }
    });
    generatedCsv = toCsv(rows);
    setMetric(0, rows.length); setMetric(1, contactRecords.length); setMetric(2, osyRecords.length); setMetric(3, coEnrolled.length);
    $('downloadButton').disabled = false;
    const unmatchedMarkup = unmatchedOsy.length ? `<p class="review-label">OSY-only records added (${unmatchedOsy.length})</p><ul class="review-list">${unmatchedOsy.slice(0, 20).map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>` : '<p class="review-copy">All OSY records matched an existing BSA student.</p>';
    const coMarkup = coEnrolled.length ? `<p class="review-label" style="margin-top:18px">Co-enrolled and merged (${coEnrolled.length})</p><ul class="review-list">${coEnrolled.slice(0, 20).map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>` : '';
    $('reviewPanel').innerHTML = unmatchedMarkup + coMarkup;
    setStatus(`Generated ${rows.length} rows with the master schema. Review the summary, then download.`);
  } catch (error) {
    setStatus(`Could not generate report: ${error.message}`, true);
  }
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character])); }

function readFile(key, labelId, file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    files[key] = { name: file.name, text: reader.result };
    $(labelId).textContent = file.name;
    $('generateButton').disabled = !Object.values(files).every(Boolean);
    setStatus(Object.values(files).every(Boolean) ? 'All reports loaded. Generate a joined CSV when ready.' : 'Add the remaining reports to begin.');
  };
  reader.onerror = () => setStatus(`Could not read ${file.name}.`, true);
  reader.readAsText(file);
}

[['bsaContact', 'bsaContactName'], ['bsaGraduate', 'bsaGraduateName'], ['osyReport', 'osyReportName']].forEach(([inputId, labelId]) => {
  $(inputId).addEventListener('change', (event) => readFile(inputId, labelId, event.target.files[0]));
});
$('generateButton').addEventListener('click', buildReport);
$('downloadButton').addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([generatedCsv], { type: 'text/csv;charset=utf-8' }));
  link.download = 'master-joined.csv';
  link.click();
  URL.revokeObjectURL(link.href);
});
$('resetButton').addEventListener('click', () => window.location.reload());
