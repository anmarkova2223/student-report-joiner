const MASTER_PRESET = [
  ['Program Name', ['Program Name']],
  ['Name', ['Name']],
  ['Enrollment Date', ['Last Program Enrolled Start Date', 'Start Date', 'Enrollment Date']],
  ['Address', ['Address', 'Street Address']],
  ['City', ['Mailing City', 'City']],
  ['State', ['Mailing State/Province (text only)', 'State']],
  ['Zipcode', ['Zipcode', 'Zip']],
  ['Email', ['Email']],
  ['Phone Number ', ['Phone', 'Cell Phone', 'Phone Number']],
  ['DOB', ['Date of Birth', 'DOB', 'D.O.B']],
  ['Age', ['Age']],
  ['Gender', ['Gender']],
  ['Ethnic Origin', ['Ethnicity', 'Ethnic Origin', 'Ethnicity/Race']],
  ['Demographics', ['Student Status', 'Parenting/Foster Youth/Homeless/Offender/HS Dropout']],
  ['Placement Entity', ['Initial Placement: Employer: Account Name', 'Employer: Account Name', 'Placement Entity', 'Employer']],
  ['Placement Type', ['Initial Placement: Profession Code', 'Profession Code', 'Placement Type']],
  ['Placement Title', ['Initial Placement: Job Title', 'Job Title', 'Placement Title', 'Position']],
  ['180 Day Check\nStill Employed?', ['180 Day Check\nStill Employed?']],
  ['365 Day Check\nStill Employed?', ['365 Day Check\nStill Employed?']],
  ['Industry Related?', ['Placement Type', 'Industry Related', 'Industry or Non-industry', 'Initial Placement: Profession Code', 'Profession Code']]
];

const MAX_PROGRAM_LENGTH = 5;
const KEY_COLUMNS = ['Name', 'Program Name'];
const IGNORED_NAMES = new Set(['droppedaftercertified', 'droppedafercertified']);
const RULE_LABELS = { blank: 'Leave blank', join: 'Join with ;', first: 'First value', last: 'Last value' };
const BLANK_LABEL = 'Blank (unresolved)';

const state = { files: [], nextId: 1, base: null, joined: null, rules: {}, overrides: {}, merges: [], splits: {}, master: null, openDetails: new Set(), pendingDownload: null };

const $ = (id) => document.getElementById(id);
const normalizeHeader = (value) => String(value ?? '').replace(/^﻿/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeText = (value) => String(value ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const clean = (value) => String(value ?? '').trim();
const GENDER_WORDS = { m: 'Male', male: 'Male', f: 'Female', female: 'Female' };
const genderWord = (value) => GENDER_WORDS[value.toLowerCase()] || value;

function parseRawCsv(text) {
  text = text.replace(/^﻿/, '');
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

// ---------- Files: header row and name column ----------

const filledCount = (row) => row.values.filter((value) => clean(value)).length;

function looksLikeContinuation(header, next) {
  if (!header || !next) return false;
  const values = next.values.map(clean);
  const count = values.filter(Boolean).length;
  return count > 0 && count < filledCount(header) / 2 &&
    values.every((value) => !/\d/.test(value)) &&
    values.some((value, column) => value && !clean(header.values[column]));
}

function detectHeader(rows) {
  const counts = rows.slice(0, 60).map(filledCount);
  const threshold = Math.max(2, Math.max(0, ...counts) * 0.6);
  const index = Math.max(0, counts.findIndex((count) => count >= threshold));
  return { line: rows[index]?.line ?? 1, continuation: looksLikeContinuation(rows[index], rows[index + 1]) };
}

function applyHeader(file) {
  const headerIndex = file.rows.findIndex((row) => row.line === file.headerLine);
  file.error = headerIndex < 0 ? `Row ${file.headerLine} is blank or past the end of the file.` : '';
  if (headerIndex < 0) { file.columns = []; file.records = []; file.nameMode = { type: 'single', column: '' }; return; }
  const header = file.rows[headerIndex].values;
  const continuation = file.continuation ? file.rows[headerIndex + 1]?.values || [] : [];
  const seen = new Map();
  file.columns = [];
  for (let column = 0; column < Math.max(header.length, continuation.length); column += 1) {
    let name = clean(header[column]) || clean(continuation[column]);
    if (!name) continue;
    const count = (seen.get(normalizeHeader(name)) || 0) + 1;
    seen.set(normalizeHeader(name), count);
    if (count > 1) name = `${name} (${count})`;
    file.columns.push({ index: column, header: name, key: normalizeHeader(name) });
  }
  const dataStart = headerIndex + (file.continuation ? 2 : 1);
  file.records = file.rows.slice(dataStart).map((row) => ({
    line: row.line,
    values: Object.fromEntries(file.columns.map((column) => {
      const value = clean(row.values[column.index]);
      return [column.key, column.key === 'gender' ? genderWord(value) : value];
    }))
  })).filter((record) => Object.values(record.values).some(Boolean));
  const keys = file.columns.map((column) => column.key);
  const mode = file.nameMode;
  const modeValid = mode && (mode.type === 'single' ? keys.includes(mode.column) : keys.includes(mode.first) && keys.includes(mode.last));
  if (!modeValid) file.nameMode = guessNameMode(file.columns);
}

function guessNameMode(columns) {
  const find = (name) => columns.find((column) => column.key === normalizeHeader(name))?.key;
  const single = find('Full Name') || find('Name');
  if (single) return { type: 'single', column: single };
  const first = find('First Name'), last = find('Last Name');
  if (first && last) return { type: 'combo', first, last };
  return { type: 'single', column: '' };
}

function nameOf(record, mode) {
  if (mode.type === 'combo') return [record.values[mode.first], record.values[mode.last]].filter(Boolean).join(' ');
  return record.values[mode.column] || '';
}

// Everything before the first underscore is the program name, e.g. `BSA_Student Info.csv` → BSA.
function programFromFileName(fileName) {
  const underscore = fileName.indexOf('_');
  if (underscore < 0) return { error: 'has no underscore after the program name' };
  const program = fileName.slice(0, underscore);
  if (!program) return { error: 'has no program name before the underscore' };
  if (/\s/.test(program)) return { error: `program name "${program}" contains a space` };
  if (program.length > MAX_PROGRAM_LENGTH) return { error: `program name "${program}" is longer than ${MAX_PROGRAM_LENGTH} characters` };
  return { program };
}

function addFiles(fileList) {
  const rejected = [];
  const accepted = [...fileList].filter((file) => {
    const { error } = programFromFileName(file.name);
    if (error) rejected.push(`${file.name} ${error}`);
    return !error;
  });
  if (rejected.length) setStatus(`Rejected: ${rejected.join('; ')}. File names must start with a program name of 1–${MAX_PROGRAM_LENGTH} characters with no spaces, then an underscore (e.g. BSA_Report.csv).`, true);
  accepted.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseRawCsv(reader.result);
      const detected = detectHeader(rows);
      const entry = { id: state.nextId++, name: file.name, program: programFromFileName(file.name).program, rows, headerLine: detected.line, continuation: detected.continuation, nameMode: null };
      applyHeader(entry);
      state.files.push(entry);
      invalidateJoin();
      renderFiles();
      if (!rejected.length) setStatus(`${state.files.length} file${state.files.length === 1 ? '' : 's'} loaded. Check each header row and name column, then join.`);
    };
    reader.onerror = () => setStatus(`Could not read ${file.name}.`, true);
    reader.readAsText(file);
  });
}

function columnOptions(columns, selected) {
  return columns.map((column) => `<option value="${escapeHtml(column.key)}"${column.key === selected ? ' selected' : ''}>${escapeHtml(column.header)}</option>`).join('');
}

function nameReady(file) {
  const mode = file.nameMode;
  return mode.type === 'combo' ? Boolean(mode.first && mode.last) : Boolean(mode.column);
}

function renderFiles() {
  $('fileList').innerHTML = state.files.map((file) => {
    const mode = file.nameMode;
    const placeholder = '<option value="">Choose column</option>';
    const nameFields = mode.type === 'combo'
      ? `<select data-id="${file.id}" data-field="first" aria-label="First name column">${placeholder}${columnOptions(file.columns, mode.first)}</select><span class="plus">+</span><select data-id="${file.id}" data-field="last" aria-label="Last name column">${placeholder}${columnOptions(file.columns, mode.last)}</select>`
      : `<select data-id="${file.id}" data-field="column" aria-label="Name column">${placeholder}${columnOptions(file.columns, mode.column)}</select>`;
    const preview = file.columns.slice(0, 6).map((column) => escapeHtml(column.header)).join(' · ');
    const issue = file.error || (!nameReady(file) ? 'Choose the name column(s).' : '');
    return `<article class="file-card">
      <header><span class="badge">${escapeHtml(file.program)}</span><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><button class="icon-button" type="button" data-id="${file.id}" data-action="remove-file" aria-label="Remove ${escapeHtml(file.name)}">×</button></header>
      <div class="field-row"><label>Header row <input type="number" min="1" data-id="${file.id}" data-field="headerLine" value="${file.headerLine}"></label>
        <label class="check"><input type="checkbox" data-id="${file.id}" data-field="continuation"${file.continuation ? ' checked' : ''}> Header continues on next row</label></div>
      <p class="file-preview">${file.columns.length} columns · ${file.records.length} rows${preview ? ` — ${preview}${file.columns.length > 6 ? ' …' : ''}` : ''}</p>
      <div class="field-row"><label>Join on <select data-id="${file.id}" data-field="nameType"><option value="single"${mode.type === 'single' ? ' selected' : ''}>Single column</option><option value="combo"${mode.type === 'combo' ? ' selected' : ''}>First + last</option></select></label>${nameFields}</div>
      ${issue ? `<p class="file-issue">${escapeHtml(issue)}</p>` : ''}
    </article>`;
  }).join('');
  $('joinButton').disabled = !state.files.length || !state.files.every((file) => !file.error && nameReady(file));
}

function updateFile(event) {
  const file = state.files.find((entry) => entry.id === Number(event.target.dataset.id));
  if (!file) return;
  const field = event.target.dataset.field;
  if (field === 'headerLine') { file.headerLine = Number(event.target.value); applyHeader(file); }
  else if (field === 'continuation') { file.continuation = event.target.checked; applyHeader(file); }
  else if (field === 'nameType') {
    const guess = guessNameMode(file.columns);
    file.nameMode = event.target.value === 'combo'
      ? { type: 'combo', first: guess.first || '', last: guess.last || '' }
      : { type: 'single', column: guess.type === 'single' ? guess.column : '' };
  } else file.nameMode[field] = event.target.value;
  invalidateJoin();
  renderFiles();
}

// ---------- Join ----------

function isValidFullName(value) {
  const words = clean(value).split(/\s+/).filter(Boolean);
  return words.length >= 2 && /[^0-9\s]/.test(clean(value));
}

function buildBase() {
  const people = new Map();
  const columns = new Map();
  const failed = [];
  const reserved = new Set(KEY_COLUMNS.map(normalizeHeader));
  state.files.forEach((file) => {
    file.columns.forEach((column) => {
      if (!columns.has(column.key)) columns.set(column.key, reserved.has(column.key) ? `${column.header} (source)` : column.header);
    });
    file.records.forEach((record) => {
      const name = clean(nameOf(record, file.nameMode)).replace(/\s+/g, ' ');
      if (IGNORED_NAMES.has(normalizeText(name))) return;
      if (!isValidFullName(name)) {
        failed.push(`${file.name} row ${record.line}: ${name ? `"${name}" is not a full name` : 'no name'}`);
        return;
      }
      const baseKey = mergedKey(normalizeText(name));
      const keptName = state.merges.find((merge) => merge.to.key === baseKey)?.to.name || name;
      // A split assigns this person's rows to groups; group 1 keeps the plain key so its choices survive the split.
      const group = state.splits[baseKey]?.[recordId(file.id, record)] || 1;
      const key = group > 1 ? `${baseKey}#${group}` : baseKey;
      if (!people.has(key)) people.set(key, { key, baseKey, group, name: keptName, programs: new Set(), rowsByFile: new Map() });
      const person = people.get(key);
      person.programs.add(file.program);
      if (!person.rowsByFile.has(file.id)) person.rowsByFile.set(file.id, []);
      person.rowsByFile.get(file.id).push(record);
    });
  });
  return { people: [...people.values()], columns: [...columns.entries()], failed, nearMisses: findNearMisses([...people.values()]) };
}

const recordId = (fileId, record) => `${fileId}:${record.line}`;

// Follows confirmed typo merges so every spelling resolves to the kept person's key.
function mergedKey(key) {
  const seen = new Set();
  let current = key;
  while (!seen.has(current)) {
    seen.add(current);
    const merge = state.merges.find((entry) => entry.from.key === current);
    if (!merge) break;
    current = merge.to.key;
  }
  return current;
}

function findNearMisses(people) {
  const pairs = [];
  const fileNames = (person) => [...person.rowsByFile.keys()].map((id) => state.files.find((file) => file.id === id)?.name).join(', ');
  const summary = (person) => ({ key: person.baseKey, name: person.name, files: fileNames(person) });
  const seen = new Set();
  for (let left = 0; left < people.length; left += 1) {
    for (let right = left + 1; right < people.length; right += 1) {
      const a = people[left], b = people[right];
      if (a.baseKey === b.baseKey || seen.has(`${a.baseKey}|${b.baseKey}`)) continue;
      if (a.baseKey.length < 6 || Math.abs(a.baseKey.length - b.baseKey.length) > 2) continue;
      if ([...a.rowsByFile.keys()].some((id) => b.rowsByFile.has(id))) continue;
      if (levenshteinDistance(a.baseKey, b.baseKey) <= 2) {
        seen.add(`${a.baseKey}|${b.baseKey}`);
        pairs.push({ a: summary(a), b: summary(b) });
      }
    }
  }
  return pairs;
}

function onReviewClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const index = Number(button.dataset.index);
  if (button.dataset.action === 'merge') {
    const pair = state.base.nearMisses[index];
    const [to, from] = button.dataset.keep === 'a' ? [pair.a, pair.b] : [pair.b, pair.a];
    state.merges.push({ from: { key: from.key, name: from.name }, to: { key: to.key, name: to.name } });
  } else if (button.dataset.action === 'unmerge') state.merges.splice(index, 1);
  else if (button.dataset.action === 'unsplit') delete state.splits[button.dataset.key];
  else return;
  state.base = buildBase();
  refresh();
}

function onReviewToggle(event) {
  const key = event.target.dataset?.key;
  if (!key) return;
  if (event.target.open) state.openDetails.add(key); else state.openDetails.delete(key);
}

// Values that differ only in capitalization count as one; the first spelling seen is kept.
function distinctIgnoringCase(values) {
  const byLowercase = new Map();
  values.forEach((value) => { if (!byLowercase.has(value.toLowerCase())) byLowercase.set(value.toLowerCase(), value); });
  return [...byLowercase.values()];
}

// null marks a cell left blank by an unresolved conflict, as opposed to '' for a value that was never there.
// Later steps must not fill a null cell from another file, a fallback column, or a calculation.
function applyChoice(choice, present, distinct) {
  if (choice === 'first') return present[0];
  if (choice === 'last') return present.at(-1);
  if (choice === 'join') return distinct.join('; ');
  if (choice.startsWith('value:') && distinct.includes(choice.slice(6))) return choice.slice(6);
  return null;
}

function resolve(values, ruleKey, person, conflicts, scope, column, fileIds) {
  const present = values.filter(Boolean);
  const distinct = distinctIgnoringCase(present);
  if (distinct.length <= 1) return distinct[0] || '';
  const override = state.overrides[`${ruleKey}|${person.key}`];
  const ruleValue = applyChoice(state.rules[ruleKey] || 'blank', present, distinct);
  const value = override ? applyChoice(override, present, distinct) : ruleValue;
  if (!conflicts.has(ruleKey)) conflicts.set(ruleKey, { ruleKey, scope, column, columnKey: ruleKey.split('|').at(-1), items: [] });
  conflicts.get(ruleKey).items.push({ personKey: person.key, name: person.name, person, fileIds, values: distinct, ruleValue, value, overridden: Boolean(override) });
  return value;
}

function computeJoined(base) {
  const conflicts = new Map();
  const headers = [...KEY_COLUMNS, ...base.columns.map(([, header]) => header)];
  const rows = base.people.map((person) => {
    const row = { 'Name': person.name, 'Program Name': [...person.programs].sort().join(' + ') };
    base.columns.forEach(([key, header]) => {
      const files = state.files.filter((file) => person.rowsByFile.has(file.id) && file.columns.some((column) => column.key === key));
      const fileValues = files.map((file) => resolve(person.rowsByFile.get(file.id).map((record) => record.values[key]), `file:${file.id}|${key}`, person, conflicts, `Within ${file.name}`, header, [file.id]));
      row[header] = fileValues.includes(null) ? null : resolve(fileValues, `cross|${key}`, person, conflicts, 'Across files', header, files.map((file) => file.id));
    });
    return row;
  });
  return { headers, rows, conflicts: [...conflicts.values()] };
}

function invalidateJoin() {
  state.base = null; state.joined = null;
  ['results', 'conflicts', 'crossConflicts', 'masterSection'].forEach((id) => { $(id).hidden = true; });
}

function runJoin() {
  state.base = buildBase();
  refresh();
  ['results', 'conflicts', 'crossConflicts', 'masterSection'].forEach((id) => { $(id).hidden = false; });
  setStatus(`Joined ${state.base.people.length} people from ${state.files.length} files${state.base.failed.length ? `; ${state.base.failed.length} rows failed validation` : ''}.`, state.base.failed.length > 0);
}

function refresh() {
  state.joined = computeJoined(state.base);
  if (!state.master) state.master = presetMaster();
  else state.master.forEach((column) => { column.sources = column.sources.filter((source) => state.joined.headers.includes(source)); });
  renderSummary();
  renderConflicts();
  renderMaster();
}

// ---------- Review and conflicts ----------

function renderSummary() {
  const { base, joined } = state;
  const conflictCount = joined.conflicts.reduce((total, conflict) => total + conflict.items.length, 0);
  const metrics = [joined.rows.length, state.files.length, conflictCount, base.nearMisses.length];
  [...$('metrics').children].forEach((metric, index) => { metric.querySelector('strong').textContent = metrics[index]; });
  const list = (label, items, listClass = '') => `<details class="review-details"><summary>${label} (${items.length})</summary>${items.length ? `<ul class="review-list ${listClass}">${items.slice(0, 200).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>${items.length > 200 ? '<p class="review-copy">Showing the first 200.</p>' : ''}` : '<p class="review-copy">None.</p>'}</details>`;
  const pairDetails = (key, label, items, render) => `<details class="review-details" data-key="${key}"${state.openDetails.has(key) ? ' open' : ''}><summary>${label} (${items.length})</summary>${items.length ? `<ul class="pair-list">${items.map(render).join('')}</ul>` : '<p class="review-copy">None.</p>'}</details>`;
  const typos = pairDetails('review:typos', 'Possible name typos — confirm to join', base.nearMisses, (pair, index) => `<li>
    <span><strong>${escapeHtml(pair.a.name)}</strong> <span class="pair-files">${escapeHtml(pair.a.files)}</span></span>
    <span class="pair-arrow">↔</span>
    <span><strong>${escapeHtml(pair.b.name)}</strong> <span class="pair-files">${escapeHtml(pair.b.files)}</span></span>
    <span class="pair-actions"><button class="button secondary small" type="button" data-action="merge" data-index="${index}" data-keep="a">Join as ${escapeHtml(pair.a.name)}</button><button class="button secondary small" type="button" data-action="merge" data-index="${index}" data-keep="b">Join as ${escapeHtml(pair.b.name)}</button></span>
  </li>`);
  const merged = pairDetails('review:merged', 'Confirmed name joins', state.merges, (merge, index) => `<li>
    <span><strong>${escapeHtml(merge.from.name)}</strong> → <strong>${escapeHtml(merge.to.name)}</strong></span>
    <span class="pair-actions"><button class="button secondary small" type="button" data-action="unmerge" data-index="${index}">Undo</button></span>
  </li>`);
  const splitEntries = Object.entries(state.splits).map(([key, groups]) => ({ key, name: base.people.find((person) => person.baseKey === key)?.name || key, count: new Set(Object.values(groups)).size }));
  const splits = pairDetails('review:splits', 'Split people', splitEntries, (entry) => `<li>
    <span><strong>${escapeHtml(entry.name)}</strong> split into ${entry.count} people</span>
    <span class="pair-actions"><button class="button secondary small" type="button" data-action="unsplit" data-key="${escapeHtml(entry.key)}">Undo</button></span>
  </li>`);
  $('reviewPanel').innerHTML = list('Failed rows (excluded)', base.failed, 'error-list') + typos + merged + splits +
    list('Joined people', joined.rows.map((row) => `${row['Name']} — ${row['Program Name']}`));
}

function renderConflicts() {
  const within = state.joined.conflicts.filter((conflict) => !conflict.ruleKey.startsWith('cross|'));
  const across = state.joined.conflicts.filter((conflict) => conflict.ruleKey.startsWith('cross|'));
  const scopes = state.files.map((file) => `Within ${file.name}`).filter((scope) => within.some((conflict) => conflict.scope === scope));
  $('conflictPanel').innerHTML = within.length
    ? scopes.map((scope) => `<h3 class="review-label conflict-scope">${escapeHtml(scope.replace(/^Within /, ''))}</h3>${within.filter((conflict) => conflict.scope === scope).map(conflictRow).join('')}`).join('')
    : '<p class="review-copy">No conflicts within files. Every person has one value per column in each report.</p>';
  $('crossConflictPanel').innerHTML = across.length
    ? across.map(conflictRow).join('')
    : '<p class="review-copy">No conflicts across files. The reports agree on every value.</p>';
}

function conflictRow(conflict) {
  const rule = state.rules[conflict.ruleKey] || 'blank';
  const open = state.openDetails.has(conflict.ruleKey);
  const overridden = conflict.items.filter((item) => state.overrides[`${conflict.ruleKey}|${item.personKey}`]).length;
  return `<div class="conflict-row">
    <span class="conflict-column">${escapeHtml(conflict.column)}</span>
    <select data-rule="${escapeHtml(conflict.ruleKey)}" aria-label="Rule for ${escapeHtml(conflict.column)}">${Object.entries(RULE_LABELS).map(([value, label]) => `<option value="${value}"${value === rule ? ' selected' : ''}>${label}</option>`).join('')}</select>
    <details class="review-details" data-key="${escapeHtml(conflict.ruleKey)}"${open ? ' open' : ''}><summary>${conflict.items.length} people${overridden ? ` · ${overridden} overridden` : ''}</summary>${open ? overrideList(conflict) : ''}</details>
  </div>`;
}

function overrideList(conflict) {
  return `<ul class="override-list">${conflict.items.map((item) => {
    const key = `${conflict.ruleKey}|${item.personKey}`;
    const current = state.overrides[key] || '';
    const options = [['', item.ruleValue ?? BLANK_LABEL], ...(item.ruleValue === null ? [] : [['blank', 'Leave blank']]), ['join', `Join with ;: ${item.values.join('; ')}`], ...item.values.map((value) => [`value:${value}`, `Pick: ${value}`])];
    return `<li class="row-link${item.overridden ? ' overridden' : ''}" data-row-key="${escapeHtml(key)}" tabindex="0" title="View ${escapeHtml(item.name)}'s conflicting rows">
      <span class="override-person"><strong>${escapeHtml(item.name)}</strong><span class="override-value">→ ${escapeHtml(item.value ?? BLANK_LABEL)}${item.overridden ? ' <em>(override)</em>' : ''}</span></span>
      <span class="override-controls"><select data-override="${escapeHtml(key)}" aria-label="Value for ${escapeHtml(item.name)}">${options.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>
      <button class="button view-conflicts" type="button" aria-label="View conflicts for ${escapeHtml(item.name)}">View conflicts ↗</button></span>
    </li>`;
  }).join('')}</ul>`;
}

// Pop-up with every source row behind one person's conflict. Transposed (one line per field, one
// column per source row) because the rows are too wide to read side by side.
// Transposed table of source rows: one line per field, one column per row. `firstKey` is pinned first
// and shaded as the conflict; other fields whose values differ between rows are shaded too.
function rowsTableHtml(rows, firstKey, columnHeader) {
  const headers = new Map(state.base.columns);
  const keys = [...headers.keys()].filter((key) => key !== firstKey && rows.some((row) => row.values[key]));
  const differs = (key) => distinctIgnoringCase(rows.map((row) => row.values[key]).filter(Boolean)).length > 1;
  const fieldRow = (key, rowClass) => `<tr class="${rowClass}"><th scope="row">${escapeHtml(headers.get(key))}</th>${rows.map((row) => `<td>${escapeHtml(row.values[key] || '')}</td>`).join('')}</tr>`;
  return `<div class="dialog-tools"><label class="check"><input type="checkbox" id="onlyDiffering"> Only show fields that differ</label>
      <span>${firstKey ? '<span class="legend conflict-cell">conflict</span> ' : ''}<span class="legend diff-cell">differs</span></span></div>
    <div class="dialog-scroll"><table class="rows-table" id="rowsDialogTable"><thead><tr><th>Field</th>${rows.map((row) => `<th>${escapeHtml(row.file)}<span class="row-number">row ${row.line}</span>${columnHeader ? columnHeader(row) : ''}</th>`).join('')}</tr></thead>
    <tbody>${firstKey ? fieldRow(firstKey, 'conflict-cell') : ''}${keys.map((key) => fieldRow(key, differs(key) ? 'diff-cell' : 'same-row')).join('')}</tbody></table></div>`;
}

function personRows(person, fileIds = [...person.rowsByFile.keys()]) {
  return fileIds.flatMap((fileId) => {
    const file = state.files.find((entry) => entry.id === fileId);
    return person.rowsByFile.get(fileId).map((record) => ({ id: recordId(fileId, record), fileOrder: state.files.indexOf(file), file: file.name, line: record.line, values: record.values, group: person.group }));
  });
}

function openRowsDialog(rowKey) {
  const ruleKey = rowKey.slice(0, rowKey.lastIndexOf('|'));
  const personKey = rowKey.slice(rowKey.lastIndexOf('|') + 1);
  const conflict = state.joined.conflicts.find((entry) => entry.ruleKey === ruleKey);
  const item = conflict?.items.find((entry) => entry.personKey === personKey);
  if (!item) return;
  $('rowsDialogBody').innerHTML = `<header class="dialog-header">
      <div><p class="eyebrow">${escapeHtml(conflict.scope)} · ${escapeHtml(conflict.column)}</p><h2>${escapeHtml(item.name)}</h2>
      <p class="review-copy">Current value: <strong>${escapeHtml(item.value ?? BLANK_LABEL)}</strong>${item.overridden ? ' (override)' : ''}</p></div>
      <span class="dialog-actions"><button class="button secondary small" type="button" data-action="open-split" data-key="${escapeHtml(item.person.baseKey)}">Different people? Split…</button>
      <button class="icon-button" type="button" data-action="close-dialog" aria-label="Close">×</button></span>
    </header>
    ${rowsTableHtml(personRows(item.person, item.fileIds), conflict.columnKey)}`;
  if (!$('rowsDialog').open) $('rowsDialog').showModal();
}

// Lists every row with this name across all files; each row is assigned to Person 1, 2, ...
function openSplitDialog(baseKey) {
  const people = state.base.people.filter((person) => person.baseKey === baseKey);
  const rows = people.flatMap((person) => personRows(person)).sort((left, right) => left.fileOrder - right.fileOrder || left.line - right.line);
  const groupSelect = (row) => `<select class="split-select" data-split-row="${escapeHtml(row.id)}" aria-label="Person for ${escapeHtml(row.file)} row ${row.line}">${rows.map((_, index) => `<option value="${index + 1}"${index + 1 === row.group ? ' selected' : ''}>Person ${index + 1}</option>`).join('')}</select>`;
  $('rowsDialogBody').innerHTML = `<header class="dialog-header">
      <div><p class="eyebrow">Split people</p><h2>${escapeHtml(people[0].name)}</h2>
      <p class="review-copy">All ${rows.length} rows with this name. Assign each row to a person; each person becomes a separate row with the same name.</p></div>
      <span class="dialog-actions">${state.splits[baseKey] ? `<button class="button secondary small" type="button" data-action="remove-split" data-key="${escapeHtml(baseKey)}">Undo split</button>` : ''}
      <button class="button primary small" type="button" data-action="apply-split" data-key="${escapeHtml(baseKey)}">Apply split</button>
      <button class="icon-button" type="button" data-action="close-dialog" aria-label="Close">×</button></span>
    </header>
    ${rowsTableHtml(rows, '', groupSelect)}`;
  if (!$('rowsDialog').open) $('rowsDialog').showModal();
}

function applySplit(baseKey) {
  const assignments = [...$('rowsDialogBody').querySelectorAll('select[data-split-row]')].map((select) => [select.dataset.splitRow, Number(select.value)]);
  const groups = [...new Set(assignments.map(([, group]) => group))].sort((left, right) => left - right);
  if (groups.length < 2) delete state.splits[baseKey];
  else state.splits[baseKey] = Object.fromEntries(assignments.map(([id, group]) => [id, groups.indexOf(group) + 1]));
  rebuildAfterIdentityChange();
}

function rebuildAfterIdentityChange() {
  $('rowsDialog').close();
  state.base = buildBase();
  refresh();
}

function onDialogClick(event) {
  if (event.target === $('rowsDialog')) { $('rowsDialog').close(); return; }
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, key } = button.dataset;
  if (action === 'close-dialog') $('rowsDialog').close();
  else if (action === 'confirm-download') { $('rowsDialog').close(); state.pendingDownload(); }
  else if (action === 'open-split') openSplitDialog(key);
  else if (action === 'apply-split') applySplit(key);
  else if (action === 'remove-split') { delete state.splits[key]; rebuildAfterIdentityChange(); }
}

function onConflictClick(event) {
  if (event.target.closest('select')) return;
  const row = event.target.closest('li[data-row-key]');
  if (row) openRowsDialog(row.dataset.rowKey);
}

function onConflictKeydown(event) {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('li[data-row-key]')) {
    event.preventDefault();
    openRowsDialog(event.target.dataset.rowKey);
  }
}

function onConflictToggle(event) {
  const details = event.target;
  if (!details.matches?.('details[data-key]')) return;
  const key = details.dataset.key;
  if (!details.open) { state.openDetails.delete(key); return; }
  state.openDetails.add(key);
  if (!details.querySelector('.override-list')) details.insertAdjacentHTML('beforeend', overrideList(state.joined.conflicts.find((conflict) => conflict.ruleKey === key)));
}

function onConflictChange(event) {
  const { rule, override } = event.target.dataset;
  if (rule) state.rules[rule] = event.target.value;
  else if (override && event.target.value) state.overrides[override] = event.target.value;
  else if (override) delete state.overrides[override];
  else return;
  refresh();
}

// ---------- Master report ----------

const TRANSFORMS = {
  enrollmentdate: 'Blanked when not a valid M/D/YYYY date',
  address: 'Split into city / state / ZIP when those are blank',
  city: 'Filled from the address when blank',
  state: 'Filled from the address when blank',
  zipcode: 'Filled from the address when blank',
  age: 'Calculated from DOB when blank',
  industryrelated: 'Normalized to Industry Related / Non Industry Related / Industry Educational',
  gender: 'M / F mapped to Male / Female'
};

function presetMaster() {
  const byKey = new Map(state.joined.headers.map((header) => [normalizeHeader(header), header]));
  return MASTER_PRESET.map(([header, candidates]) => ({
    header,
    sources: [...new Set(candidates.map((candidate) => byKey.get(normalizeHeader(candidate))).filter(Boolean))]
  }));
}

function sourceOptions(selected, placeholder) {
  return `${placeholder ? `<option value="">${placeholder}</option>` : ''}${state.joined.headers.map((header) => `<option value="${escapeHtml(header)}"${header === selected ? ' selected' : ''}>${escapeHtml(header)}</option>`).join('')}`;
}

function renderMaster() {
  const rows = state.master.map((column, index) => {
    const transform = TRANSFORMS[normalizeHeader(column.header)];
    const sources = column.sources.map((source, sourceIndex) => `<span class="source-chip"><select data-source="${index}:${sourceIndex}" aria-label="Source ${sourceIndex + 1}">${sourceOptions(source)}</select><button class="icon-button" type="button" data-action="remove-source" data-index="${index}" data-source-index="${sourceIndex}" aria-label="Remove source">×</button></span>`).join('');
    return `<tr>
      <td class="mono">${index + 1}</td>
      <td><strong>${escapeHtml(column.header)}</strong>${transform ? `<span class="transform-note">${transform}</span>` : ''}</td>
      <td class="sources">${sources}<select data-add-source="${index}" aria-label="Add source">${sourceOptions('', column.sources.length ? '+ fallback…' : '+ source…')}</select></td>
      <td class="row-actions"><button class="icon-button" type="button" data-action="up" data-index="${index}" aria-label="Move up"${index === 0 ? ' disabled' : ''}>↑</button><button class="icon-button" type="button" data-action="down" data-index="${index}" aria-label="Move down"${index === state.master.length - 1 ? ' disabled' : ''}>↓</button><button class="icon-button" type="button" data-action="remove" data-index="${index}" aria-label="Remove column">×</button></td>
    </tr>`;
  }).join('');
  $('masterPanel').innerHTML = `<div class="table-wrap"><table class="master-table"><thead><tr><th>#</th><th>Master column</th><th>Joined source (first non-blank wins)</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="controls"><select id="addMasterColumn" aria-label="Add a master column">${sourceOptions('', 'Add a joined column…')}</select>
    <button class="button secondary" type="button" data-action="reset-master">Reset to master preset</button></div>`;
}

function onMasterChange(event) {
  const target = event.target;
  if (target.dataset.source) {
    const [index, sourceIndex] = target.dataset.source.split(':').map(Number);
    state.master[index].sources[sourceIndex] = target.value;
  } else if (target.dataset.addSource && target.value) {
    const column = state.master[Number(target.dataset.addSource)];
    if (!column.sources.includes(target.value)) column.sources.push(target.value);
  } else if (target.id === 'addMasterColumn' && target.value) {
    state.master.push({ header: target.value, sources: [target.value] });
  } else return;
  renderMaster();
}

function onMasterClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const index = Number(button.dataset.index);
  const { action } = button.dataset;
  if (action === 'up' || action === 'down') {
    const other = action === 'up' ? index - 1 : index + 1;
    [state.master[index], state.master[other]] = [state.master[other], state.master[index]];
  } else if (action === 'remove') state.master.splice(index, 1);
  else if (action === 'remove-source') state.master[index].sources.splice(Number(button.dataset.sourceIndex), 1);
  else if (action === 'reset-master') state.master = presetMaster();
  renderMaster();
}

function industryTag(value) {
  const tagOne = (text) => {
    const code = text.match(/^(\d{2})\s*-/);
    if (code) return code[1] === '00' ? 'Non Industry Related' : code[1] === '01' ? 'Industry Educational' : 'Industry Related';
    const normalized = normalizeText(text);
    if (normalized === 'nonindustryrelated' || normalized === 'nonindustry') return 'Non Industry Related';
    if (normalized === 'industryrelated' || normalized === 'industry') return 'Industry Related';
    if (normalized === 'industryeducational') return 'Industry Educational';
    return text;
  };
  return [...new Set(clean(value).split(/;\s*/).filter(Boolean).map(tagOne))].join('; ');
}

function genderValue(value) {
  const mapped = clean(value).split(/;\s*/).filter(Boolean).map(genderWord);
  return distinctIgnoringCase(mapped).join('; ');
}

function buildMaster() {
  const issues = [];
  const headers = state.master.map((column) => column.header);
  const columnFor = (key) => state.master.find((column) => normalizeHeader(column.header) === key);
  const firstValue = (row, column) => {
    const value = column.sources.map((source) => row[source]).find((candidate) => candidate === null || clean(candidate));
    return value === undefined ? '' : value;
  };
  const cityColumn = columnFor('city');
  const knownCities = cityColumn ? [...new Set(state.joined.rows.map((row) => firstValue(row, cityColumn)).filter(Boolean))] : [];
  const [address, city, region, zip, dob, age, enrollment, industry, gender] =
    ['address', 'city', 'state', 'zipcode', 'dob', 'age', 'enrollmentdate', 'industryrelated', 'gender'].map((key) => columnFor(key)?.header);
  const rows = state.joined.rows.map((joinedRow) => {
    const row = Object.fromEntries(state.master.map((column) => [column.header, firstValue(joinedRow, column)]));
    if (enrollment && !isValidDate(row[enrollment])) {
      issues.push(`${joinedRow['Name']}: invalid ${enrollment} "${row[enrollment]}" exported as blank.`);
      row[enrollment] = '';
    }
    if (age && dob && row[age] === '' && row[dob]) {
      row[age] = calculateAge(row[dob]);
      if (!row[age]) issues.push(`${joinedRow['Name']}: could not calculate ${age} from ${dob} "${row[dob]}"; exported as blank.`);
    }
    const locationHeaders = [city, region, zip].filter(Boolean);
    if (address && row[address]?.includes(';') && locationHeaders.length && locationHeaders.every((header) => row[header] === '')) {
      issues.push(`${joinedRow['Name']}: joined ${address} "${row[address]}" was not split into ${locationHeaders.join(', ')}; those are exported as blank.`);
    } else if (address && row[address] && locationHeaders.length && locationHeaders.every((header) => row[header] === '')) {
      const parsed = parseAddress(row[address], knownCities);
      if (parsed.city || parsed.state || parsed.zipcode) {
        row[address] = parsed.address || row[address];
        if (city) row[city] = parsed.city;
        if (region) row[region] = parsed.state;
        if (zip) row[zip] = parsed.zipcode;
      }
    }
    if (industry && row[industry]) row[industry] = industryTag(row[industry]);
    if (gender && row[gender]) row[gender] = genderValue(row[gender]);
    return row;
  });
  return { headers, rows, issues };
}

// ---------- Transform helpers ----------

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
  const city = exactCity || cityCandidates.find((candidate) => {
    if (candidate.includes(' ')) return false;
    const lastWord = prefix.split(/\s+/).at(-1) || '';
    return lastWord.length > 4 && levenshteinDistance(normalizeText(lastWord), normalizeText(candidate)) <= 2;
  });
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

function calculateAge(value) {
  if (!clean(value) || value.includes(';')) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const birthdayPassed = today.getMonth() > date.getMonth() || (today.getMonth() === date.getMonth() && today.getDate() >= date.getDate());
  if (!birthdayPassed) age -= 1;
  return age >= 0 ? String(age) : '';
}

function isValidDate(value) {
  const text = clean(value);
  if (!text) return true;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return false;
  const date = new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
  return date.getFullYear() === Number(match[3]) && date.getMonth() === Number(match[1]) - 1 && date.getDate() === Number(match[2]);
}

// ---------- Output ----------

// Spreadsheet apps run cells starting with these characters as formulas; a leading apostrophe keeps them as text.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

function toCsv(headers, rows) {
  const escape = (value) => {
    const text = String(value ?? '');
    return `"${(FORMULA_TRIGGER.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
  };
  return [headers.map(escape).join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\r\n') + '\r\n';
}

function download(filename, csv) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Downloads straight away when nothing needs flagging; otherwise warns first. `rows` line up with state.joined.rows.
function requestDownload(filename, headers, rows, issues = []) {
  const blanks = new Map();
  rows.forEach((row, index) => headers.filter((header) => row[header] === null).forEach((header) => {
    blanks.set(header, [...(blanks.get(header) || []), state.joined.rows[index]['Name']]);
  }));
  const save = () => download(filename, toCsv(headers, rows));
  if (!blanks.size && !issues.length) { save(); return; }
  state.pendingDownload = save;
  const blankCount = [...blanks.values()].reduce((total, names) => total + names.length, 0);
  const list = (label, items, listClass = '') => `<details class="review-details"><summary>${escapeHtml(label)} (${items.length})</summary><ul class="review-list ${listClass}">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>`;
  $('rowsDialogBody').innerHTML = `<header class="dialog-header">
      <div><p class="eyebrow">Before you download</p><h2>${escapeHtml(filename)}</h2>
      ${blankCount ? `<p class="review-copy">${blankCount} ${blankCount === 1 ? 'value' : 'values'} will be <strong>blank</strong> because the conflict is unresolved. To fill them in, choose a rule or pick a value in steps 03 and 04.</p>` : ''}
      ${issues.length ? `<p class="review-copy">${issues.length} other ${issues.length === 1 ? 'value' : 'values'} could not be used, as listed below.</p>` : ''}</div>
      <span class="dialog-actions"><button class="icon-button" type="button" data-action="close-dialog" aria-label="Close">×</button></span>
    </header>
    <div class="dialog-scroll">${[...blanks].map(([header, names]) => list(header, names)).join('')}${issues.length ? list('Other issues', issues, 'error-list') : ''}</div>
    <div class="controls section-end"><button class="button secondary" type="button" data-action="close-dialog">Go back and review</button>
    <button class="button primary" type="button" data-action="confirm-download">Download with blanks <span aria-hidden="true">↓</span></button></div>`;
  $('rowsDialog').showModal();
}

function setStatus(message, isError = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', isError);
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character])); }

$('fileInput').addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = ''; });
$('fileList').addEventListener('change', updateFile);
$('fileList').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="remove-file"]');
  if (!button) return;
  state.files = state.files.filter((file) => file.id !== Number(button.dataset.id));
  invalidateJoin();
  renderFiles();
});
$('joinButton').addEventListener('click', runJoin);
$('resetButton').addEventListener('click', () => window.location.reload());
$('reviewPanel').addEventListener('click', onReviewClick);
$('reviewPanel').addEventListener('toggle', onReviewToggle, true);
['conflictPanel', 'crossConflictPanel'].forEach((id) => {
  $(id).addEventListener('change', onConflictChange);
  $(id).addEventListener('click', onConflictClick);
  $(id).addEventListener('keydown', onConflictKeydown);
  $(id).addEventListener('toggle', onConflictToggle, true);
});
$('rowsDialog').addEventListener('click', onDialogClick);
$('rowsDialog').addEventListener('change', (event) => {
  if (event.target.id === 'onlyDiffering') $('rowsDialogTable').classList.toggle('only-differing', event.target.checked);
});
$('masterPanel').addEventListener('change', onMasterChange);
$('masterPanel').addEventListener('click', onMasterClick);
$('downloadJoinedButton').addEventListener('click', () => requestDownload('joined-all-columns.csv', state.joined.headers, state.joined.rows));
$('downloadMasterButton').addEventListener('click', () => {
  const master = buildMaster();
  $('masterIssues').innerHTML = master.issues.length
    ? `<details class="review-details"><summary>Master transformation issues (${master.issues.length})</summary><ul class="review-list error-list">${master.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul></details>`
    : '<p class="review-copy">No transformation issues.</p>';
  requestDownload('master-report.csv', master.headers, master.rows, master.issues);
});
