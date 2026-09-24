const MASTER_HEADERS = [
  'Program Name', 'Name', 'Address', 'City', 'State', 'Zipcode', 'Email', 'Phone Number ', 'DOB', 'Age', 'Gender', 'Ethnic Origin', 'Demographics', 'Placement Entity', 'Placement Type', 'Placement Title', '180 Day Check\nStill Employed?', '365 Day Check\nStill Employed?'
];

const files = { bsaContact: null, bsaGraduate: null, bsaRetention: null, osyReport: null };
let generatedCsv = '';

const $ = (id) => document.getElementById(id);
const normalizeHeader = (value) => String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeText = (value) => String(value ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const clean = (value) => String(value ?? '').trim();
const IGNORED_OSY_NAMES = new Set(['droppedaftercertified', 'droppedafercertified']);

const FILE_SCHEMAS = {
  bsaContact: {
    label: 'BSA contact report',
    required: [
      ['email'], ['address'], ['city'], ['state'], ['zipcode', 'zip'],
      ['cell phone', 'phone number'], ['dob', 'd o b'], ['age'], ['gender'], ['ethnicity', 'ethnic origin']
    ],
    requiredAny: [{ label: 'Full Name OR First Name + Last Name', groups: [['full name'], ['first name', 'last name']] }]
  },
  bsaGraduate: {
    label: 'BSA graduate report',
    required: [['first name'], ['last name'], ['placement entity'], ['placement type'], ['placement title']]
  },
  bsaRetention: {
    label: 'BSA retention report',
    required: [['first name'], ['last name'], ['180 day check still employed'], ['365 day check still employed']]
  },
  osyReport: {
    label: 'OSY report',
    continuation: ['date rtw docs expire', 'basic skills deficient yes or no', 'math score', 'reading score'],
    required: [
      ['name'], ['address'], ['phone number'], ['d o b', 'dob'], ['age'], ['email'], ['gender'],
      ['ethnic origin', 'ethnicity'], ['student status', 'parenting foster youth homeless offender hs dropout']
    ]
  }
};

function parseRawCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false, lineNumber = 1;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some((value) => clean(value))) rows.push({ values: row, line: lineNumber });
      row = [];
      lineNumber += 1;
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); if (row.some((value) => clean(value))) rows.push({ values: row, line: lineNumber }); }
  return rows;
}

function headerMatches(headers, required) {
  return required.some((name) => headers.includes(normalizeHeader(name)));
}

function schemaMatches(headers, schema) {
  return schema.required.every((required) => headerMatches(headers, required)) &&
    (schema.requiredAny || []).every((requirement) => requirement.groups.some((group) => group.every((name) => headers.includes(normalizeHeader(name)))));
}

function findHeader(rows, schema) {
  for (let index = 0; index < rows.length; index += 1) {
    const headers = rows[index].values.map(normalizeHeader);
    const nextHeaders = rows[index + 1]?.values.map(normalizeHeader) || [];
    const hasContinuation = schema.continuation?.some((name) => headerMatches(nextHeaders, [name]));
    if (hasContinuation) {
      const mergedHeaders = headers.map((header, column) => header || nextHeaders[column]);
      if (schemaMatches(mergedHeaders, schema)) {
        return { index, headers: mergedHeaders, values: rows[index], continuationIndex: index + 1 };
      }
    }
    if (!schemaMatches(headers, schema)) continue;
    return { index, headers, values: rows[index] };
  }
  for (let index = 0; index < rows.length - 1; index += 1) {
    const headers = rows[index].values.map(normalizeHeader);
    const continuation = rows[index + 1].values.map(normalizeHeader);
    const mergedHeaders = headers.map((header, column) => header || continuation[column]);
    if (schemaMatches(mergedHeaders, schema)) {
      return { index, headers: mergedHeaders, values: rows[index], continuationIndex: index + 1 };
    }
  }
  return null;
}

function parseCsv(text, fileKey) {
  const rows = parseRawCsv(text);
  const schema = FILE_SCHEMAS[fileKey];
  if (!schema) throw new Error(`No validation schema is configured for ${fileKey}.`);
  const header = findHeader(rows, schema);
  if (!header) {
    const expected = schema.required.map((names) => names[0]).concat((schema.requiredAny || []).map((requirement) => requirement.label)).join(', ');
    throw new Error(`${schema.label} is missing required columns. Expected columns include: ${expected}.`);
  }
  const dataStart = (header.continuationIndex ?? header.index) + 1;
  return rows.slice(dataStart).map((row, index) => header.headers.reduce((record, column, columnIndex) => {
    if (column) record[column] = clean(row.values[columnIndex]);
    return record;
  }, { __sourceRow: row.line })).filter((record) => Object.entries(record).some(([key, value]) => key !== '__sourceRow' && clean(value)));
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

function isIgnoredOsyRecord(record) {
  return IGNORED_OSY_NAMES.has(normalizeText(fullName(record)));
}

function isValidFullName(value) {
  const words = clean(value).split(/\s+/).filter(Boolean);
  return words.length >= 2 && /[^0-9\s]/.test(clean(value));
}

function isValidEmail(value) {
  return !clean(value) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function identityValidationIssues(record, sourceLabel) {
  const issues = [];
  const name = fullName(record);
  const email = get(record, 'Email');
  if (!isValidFullName(name)) issues.push(`${sourceLabel} has an invalid full name.`);
  if (!isValidEmail(email)) issues.push(`${sourceLabel} has an invalid email.`);
  return issues;
}

function parseAddress(address, knownCities = []) {
  const value = clean(address).replace(/\s+/g, ' ');
  const locationMatch = value.match(/^(.*?)(?:,?\s+)([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)(?:\s+(.*))?$/i);
  const zipOnlyMatch = value.match(/^(.*?)(?:,?\s+)(\d{5}(?:-\d{4})?)(?:\s+(.*))?$/);
  const prefix = locationMatch?.[1] || zipOnlyMatch?.[1];
  const state = locationMatch?.[2]?.toUpperCase() || '';
  const zipcode = locationMatch?.[3] || zipOnlyMatch?.[2] || '';
  const trailing = locationMatch?.[4] || zipOnlyMatch?.[3] || '';
  if (!prefix) return { address: value, city: '', state, zipcode };

  const cityCandidates = [...new Set(knownCities.map(clean).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  const exactCity = cityCandidates.find((candidate) => new RegExp(`(?:^|\\s)${escapeRegExp(candidate)}$`, 'i').test(prefix));
  const fuzzyCity = exactCity || cityCandidates.find((candidate) => {
    if (candidate.includes(' ')) return false;
    const lastWord = prefix.split(/\s+/).at(-1) || '';
    return lastWord.length > 4 && levenshteinDistance(normalizeText(lastWord), normalizeText(candidate)) <= 2;
  });
  const city = fuzzyCity;
  if (city) {
    const street = prefix.slice(0, prefix.length - city.length).replace(/[,\s]+$/, '');
    return { address: [street, trailing].filter(Boolean).join(' '), city, state, zipcode };
  }

  const commaParts = prefix.split(',').map(clean).filter(Boolean);
  if (commaParts.length > 1) {
    return { address: commaParts.slice(0, -1).join(', '), city: commaParts.at(-1), state, zipcode };
  }
  return { address: value, city: '', state, zipcode };
}

function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function levenshteinDistance(left, right) {
  const distances = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = distances[0];
    distances[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const previous = distances[rightIndex];
      distances[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? diagonal
        : 1 + Math.min(distances[rightIndex], distances[rightIndex - 1], diagonal);
      diagonal = previous;
    }
  }
  return distances[right.length];
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

function bsaRow(contact, graduate, retention) {
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
    '180 Day Check\nStill Employed?': get(retention, '180 Day Check\nStill Employed?'),
    '365 Day Check\nStill Employed?': get(retention, '365 Day Check\nStill Employed?')
  };
}

function osyRow(record, knownCities) {
  const address = parseAddress(get(record, 'Address'), knownCities);
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

function identityMarkup(record) {
  const name = fullName(record) || '(no name)';
  const email = get(record, 'Email') || '(no email)';
  return `Name: ${escapeHtml(name)} | Email: ${escapeHtml(email)}`;
}

function rowDetailsMarkup(label, rows, emptyMessage, listClass = '') {
  const content = rows.length ? `<ul class="review-list ${listClass}">${rows.slice(0, 100).map((row) => `<li>${row}</li>`).join('')}</ul>${rows.length > 100 ? `<p class="review-copy">Showing the first 100 rows.</p>` : ''}` : `<p class="review-copy">${emptyMessage}</p>`;
  return `<details class="review-details"><summary>${label} (${rows.length})</summary>${content}</details>`;
}

function validationMarkup(issues, successfulRows, failedRows) {
  const issueMarkup = issues.length ? `<p class="review-label error">Validation issues (${issues.length})</p><ul class="review-list error-list">${issues.slice(0, 40).map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>${issues.length > 40 ? `<p class="review-copy">Showing the first 40 issues.</p>` : ''}` : '<p class="review-copy">Validation passed: every BSA and OSY source row is represented in the output.</p>';
  return `${rowDetailsMarkup('Successful rows', successfulRows, 'No successful rows were generated.')}${rowDetailsMarkup('Failed rows', failedRows, 'No failed rows.', 'error-list')}${issueMarkup}`;
}

function buildReport() {
  try {
    const contactRecords = parseCsv(files.bsaContact.text, 'bsaContact');
    const graduateRecords = parseCsv(files.bsaGraduate.text, 'bsaGraduate');
    const retentionRecords = parseCsv(files.bsaRetention.text, 'bsaRetention');
    const osyRecords = parseCsv(files.osyReport.text, 'osyReport').filter((record) => !isIgnoredOsyRecord(record));
    const graduateIndex = indexRecords(graduateRecords);
    const retentionIndex = indexRecords(retentionRecords);
    const contactIndex = indexRecords(contactRecords);
    const rows = [];
    const bsaRowsByContact = new Map();
    const validationIssues = [];
    const successfulRows = [];
    const failedRows = [];
    let successfulBsaCount = 0;
    let successfulOsyCount = 0;
    const knownCities = [...new Set(contactRecords.map((record) => get(record, 'City')).filter(Boolean))];
    contactRecords.forEach((contact, index) => {
      const sourceRow = contact.__sourceRow;
      const identityIssues = identityValidationIssues(contact, `BSA contact row ${sourceRow}`);
      if (identityIssues.length) {
        validationIssues.push(...identityIssues);
        failedRows.push(`${escapeHtml(identityIssues.join(' '))} | ${identityMarkup(contact)}`);
        return;
      }
      const graduate = findMatch(contact, graduateIndex) || {};
      const retention = findMatch(contact, retentionIndex) || {};
      const row = bsaRow(contact, graduate, retention);
      rows.push(row);
      bsaRowsByContact.set(contact, row);
      successfulRows.push(identityMarkup(contact));
      successfulBsaCount += 1;
    });
    const coEnrolled = [];
    const unmatchedOsy = [];
    osyRecords.forEach((record, index) => {
      const sourceRow = record.__sourceRow;
      const match = findMatch(record, contactIndex);
      const identityIssues = identityValidationIssues(record, `OSY row ${sourceRow}`);
      if (identityIssues.length) {
        validationIssues.push(...identityIssues);
        failedRows.push(`${escapeHtml(identityIssues.join(' '))} | ${identityMarkup(record)}`);
        return;
      }
      if (match) {
        coEnrolled.push(fullName(record));
        successfulOsyCount += 1;
        const existing = bsaRowsByContact.get(match);
        if (existing) {
          existing['Program Name'] = 'BSA + OSY';
        } else {
          validationIssues.push(`OSY row ${sourceRow} matched a BSA contact but no BSA output row was found.`);
        }
      } else {
          rows.push(osyRow(record, knownCities));
        unmatchedOsy.push(fullName(record));
        successfulRows.push(identityMarkup(record));
        successfulOsyCount += 1;
      }
    });
    const expectedRows = contactRecords.length + osyRecords.length - coEnrolled.length - failedRows.length;
    if (rows.length !== expectedRows) {
      validationIssues.push(`Output row count is ${rows.length}; expected ${expectedRows} from ${contactRecords.length} BSA and ${osyRecords.length} OSY source rows.`);
    }
    generatedCsv = toCsv(rows);
    setMetric(0, rows.length); setMetric(1, `${successfulBsaCount}/${contactRecords.length}`); setMetric(2, `${successfulOsyCount}/${osyRecords.length}`); setMetric(3, coEnrolled.length);
    $('downloadButton').disabled = false;
    const bsaOnlyMarkup = '';
    const unmatchedMarkup = '';
    const coMarkup = coEnrolled.length ? `<p class="review-label">Co-enrolled records added (${coEnrolled.length})</p>` : '';
    $('reviewPanel').innerHTML = validationMarkup(validationIssues, successfulRows, failedRows) + bsaOnlyMarkup + unmatchedMarkup + coMarkup;
    setStatus(`Generated ${rows.length} rows with the master schema${validationIssues.length ? ` with ${validationIssues.length} validation issue${validationIssues.length === 1 ? '' : 's'}` : ''}. Review the summary, then download.`, validationIssues.length > 0);
  } catch (error) {
    setStatus(`Could not generate report: ${error.message}`, true);
  }
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character])); }

function readFile(key, labelId, file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      parseCsv(reader.result, key);
      files[key] = { name: file.name, text: reader.result };
    } catch (error) {
      files[key] = null;
      $(labelId).textContent = 'Choose CSV';
      $('generateButton').disabled = true;
      setStatus(`${file.name} was rejected: ${error.message}`, true);
      return;
    }
    $(labelId).textContent = file.name;
    $('generateButton').disabled = !Object.values(files).every(Boolean);
    setStatus(Object.values(files).every(Boolean) ? 'All reports loaded. Generate a joined CSV when ready.' : 'Add the remaining reports to begin.');
  };
  reader.onerror = () => setStatus(`Could not read ${file.name}.`, true);
  reader.readAsText(file);
}

[['bsaContact', 'bsaContactName'], ['bsaGraduate', 'bsaGraduateName'], ['bsaRetention', 'bsaRetentionName'], ['osyReport', 'osyReportName']].forEach(([inputId, labelId]) => {
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
