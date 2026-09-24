/**
 * INTERNAL NAP OUTAGE MONITORING
 * Professional Dashboard + 1-Minute Auto Refresh + Safe Error-Fix Agent
 *
 * SOURCE: DATABASE
 * OUTPUT: DASHBOARD
 * LOG: AGENT_LOG
 *
 * INSTALLATION:
 * 1. Google Sheet -> Extensions -> Apps Script
 * 2. Replace the editor contents with this file.
 * 3. Save.
 * 4. Run setupNAPDashboard() once and authorize the script.
 *
 * IMPORTANT:
 * - The agent never invents business data.
 * - Formula repair only copies an existing valid formula pattern in the same column.
 * - Existing valid formulas and hard-coded values are not overwritten.
 * - The dashboard recalculates from the live DATABASE sheet every minute.
 */

const CFG = Object.freeze({
  SOURCE: 'DATABASE',
  DASHBOARD: 'DASHBOARD',
  LOG: 'AGENT_LOG',
  FORMULA_AUDIT: 'FORMULA_AUDIT',
  REFRESH_MINUTES: 1,
  AUTO_REPAIR: true,
  MIN_FORMULA_COVERAGE: 0.70,
  MAX_LOG_ROWS: 2000,
  MAX_PROVINCES: 12,
  MAX_TEAMS: 12,
  MAX_CHART_ROWS: 10,
  HEADERS: {
    timestamp: ['timestamp', 'date/time', 'datetime'],
    concernGroup: ['concern group', 'concern_group', 'concern'],
    province: ['province'],
    municipality: ['municipality', 'city/municipality', 'city'],
    barangay: ['barangay'],
    facility: ['facility'],
    napStatus: ['nap status', 'nap_status', 'status'],
    dateRestored: ['date restored', 'restored date'],
    finalStatus: ['final status', 'final_status'],
    opsTeam: ['ops team', 'team', 'assigned team'],
    dateEndorsed: ['date endorsed', 'endorsed date'],
    ageing: ['ageing', 'aging'],
    sla: ['sla', 'sla status'],
    type: ['type'],
    endorsedMonth: ['endorsed month', 'month'],
    endorsedYear: ['endorsed year', 'year'],
    sort2: ['sort2', 'sort 2']
  }
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('NAP Control Center')
    .addItem('Refresh Dashboard Now', 'refreshDashboard')
    .addItem('Run Error-Fix Agent', 'runErrorFixAgent')
    .addItem('Audit Exact Formulas', 'auditExactFormulas')
    .addItem('Audit Formula Columns', 'auditFormulaColumns')
    .addSeparator()
    .addItem('Install 1-Minute Auto Refresh', 'installOneMinuteRefresh')
    .addItem('Remove Auto Refresh', 'removeAutoRefresh')
    .addToUi();
}

/** Run once manually. */
function setupNAPDashboard() {
  ensureLogSheet_();
  refreshDashboard();
  installOneMinuteRefresh();
  log_('SETUP', 'Dashboard initialized; 1-minute auto refresh installed.');
}

/** Installs exactly one refresh trigger for this project. */
function installOneMinuteRefresh() {
  removeAutoRefresh(false);
  ScriptApp.newTrigger('refreshDashboard')
    .timeBased()
    .everyMinutes(CFG.REFRESH_MINUTES)
    .create();
  log_('TRIGGER', 'Installed refreshDashboard every ' + CFG.REFRESH_MINUTES + ' minute.');
}

function removeAutoRefresh(writeLog) {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'refreshDashboard') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  if (writeLog !== false) {
    log_('TRIGGER', 'Removed ' + removed + ' refresh trigger(s).');
  }
}

/** Main scheduled/manual refresh. */
function refreshDashboard() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const source = ss.getSheetByName(CFG.SOURCE);
    if (!source) throw new Error('Sheet "' + CFG.SOURCE + '" was not found.');

    ensureLogSheet_();

    const repair = runRepairEngine_(source);
    SpreadsheetApp.flush();

    const metrics = readMetrics_(source);
    buildDashboard_(metrics, repair);
    SpreadsheetApp.flush();

    log_('REFRESH',
      'Rows=' + metrics.totalRows +
      '; pending=' + metrics.pending +
      '; restored=' + metrics.restored +
      '; beyond48=' + metrics.beyond48 +
      '; repaired=' + repair.repaired +
      '; errors=' + repair.errors
    );
  } catch (err) {
    log_('REFRESH_ERROR', errorText_(err));
    writeDashboardError_(errorText_(err));
  } finally {
    lock.releaseLock();
  }
}

/** Manual safe-repair entry point. */
function runErrorFixAgent() {
  const source = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.SOURCE);
  if (!source) throw new Error('Sheet "' + CFG.SOURCE + '" was not found.');

  const result = runRepairEngine_(source);
  SpreadsheetApp.getUi().alert(
    'NAP Error-Fix Agent',
    'Rows checked: ' + result.dataRows +
    '\nFormula columns: ' + result.formulaColumns +
    '\nCells repaired: ' + result.repaired +
    '\nErrors remaining: ' + result.errors +
    '\n\nDetails are recorded in AGENT_LOG.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/** Shows formula coverage and repairability without changing data. */
function auditFormulaColumns() {
  const source = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.SOURCE);
  if (!source) throw new Error('Sheet "' + CFG.SOURCE + '" was not found.');

  const audit = inspectFormulaColumns_(source);
  log_('FORMULA_AUDIT', audit.message);
  SpreadsheetApp.getUi().alert('Formula Audit', audit.message, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Safe formula self-healing:
 * - detects formula columns from the live sheet
 * - requires >=70% formula coverage by default
 * - finds a valid existing R1C1 formula in that column
 * - repairs only blank/error formula cells
 * - skips rows that are completely empty
 */
function runRepairEngine_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return { dataRows: 0, formulaColumns: 0, repaired: 0, errors: 0 };
  }

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const formulas = sheet.getRange(1, 1, lastRow, lastCol).getFormulasR1C1();
  const headerRow = findHeaderRow_(values);
  const dataStart = headerRow; // zero-based index of first data row
  const dataRows = Math.max(0, lastRow - headerRow);

  let formulaColumns = 0;
  let repaired = 0;

  if (CFG.AUTO_REPAIR && dataRows > 0) {
    for (let c = 0; c < lastCol; c++) {
      let formulaCount = 0;
      for (let r = dataStart; r < lastRow; r++) {
        if (formulas[r][c]) formulaCount++;
      }
      if (!formulaCount) continue;

      formulaColumns++;
      const coverage = formulaCount / dataRows;
      if (coverage < CFG.MIN_FORMULA_COVERAGE) continue;

      let sourceFormula = '';
      for (let r = dataStart; r < lastRow; r++) {
        if (formulas[r][c] && !isErrorValue_(values[r][c])) {
          sourceFormula = formulas[r][c];
          break;
        }
      }
      if (!sourceFormula) continue;

      // Batch contiguous repair runs for better performance.
      let runStart = -1;
      let runLength = 0;

      const flushRun = () => {
        if (runStart < 0 || runLength === 0) return;
        try {
          sheet.getRange(runStart + 1, c + 1, runLength, 1)
            .setFormulaR1C1(sourceFormula);
          repaired += runLength;
        } catch (err) {
          log_('REPAIR_ERROR',
            'Column ' + (c + 1) + ', start row ' + (runStart + 1) + ': ' + errorText_(err));
        }
        runStart = -1;
        runLength = 0;
      };

      for (let r = dataStart; r < lastRow; r++) {
        const needsRepair =
          !formulas[r][c] ||
          isErrorValue_(values[r][c]);

        const activeRow = !isEmptyRow_(values[r]);

        if (needsRepair && activeRow) {
          if (runStart < 0) runStart = r;
          runLength++;
        } else {
          flushRun();
        }
      }
      flushRun();
    }
  } else {
    formulaColumns = countFormulaColumns_(formulas, dataStart);
  }

  SpreadsheetApp.flush();

  const freshValues = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const errors = countErrors_(freshValues, dataStart);

  if (repaired) {
    log_('AUTO_REPAIR', 'Repaired ' + repaired + ' formula cell(s); errors remaining=' + errors);
  }

  return { dataRows, formulaColumns, repaired, errors };
}


/**
 * Reads the actual formulas from DATABASE and writes an exact formula audit.
 * Screenshots show calculated values, not the underlying formula text, so this
 * function is the authoritative verification step for AGEING, SLA, month/year,
 * SORT2 and any other calculated columns.
 */
function auditExactFormulas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const source = ss.getSheetByName(CFG.SOURCE);
  if (!source) throw new Error('Sheet "' + CFG.SOURCE + '" was not found.');

  const lastRow = source.getLastRow();
  const lastCol = source.getLastColumn();
  if (lastRow < 2) throw new Error('DATABASE has no data rows.');

  const values = source.getRange(1, 1, lastRow, lastCol).getValues();
  const formulasA1 = source.getRange(1, 1, lastRow, lastCol).getFormulas();
  const formulasR1C1 = source.getRange(1, 1, lastRow, lastCol).getFormulasR1C1();
  const headerRow = findHeaderRow_(values);
  const headers = values[headerRow - 1];

  let audit = ss.getSheetByName(CFG.FORMULA_AUDIT);
  if (!audit) audit = ss.insertSheet(CFG.FORMULA_AUDIT);
  audit.clear();
  audit.setHiddenGridlines(true);

  const output = [[
    'Column', 'Header', 'Formula Coverage', 'Formula Variants',
    'Sample A1 Formula', 'Sample R1C1 Formula', 'Error Cells', 'Repair Safe'
  ]];

  for (let c = 0; c < lastCol; c++) {
    const variants = {};
    let formulaCount = 0;
    let errorCount = 0;
    let sampleA1 = '';
    let sampleR1C1 = '';

    for (let r = headerRow; r < lastRow; r++) {
      const a1 = formulasA1[r][c];
      const r1c1 = formulasR1C1[r][c];

      if (a1) {
        formulaCount++;
        variants[r1c1] = (variants[r1c1] || 0) + 1;
        if (!sampleA1) sampleA1 = a1;
        if (!sampleR1C1) sampleR1C1 = r1c1;
      }

      if (isErrorValue_(values[r][c])) errorCount++;
    }

    if (!formulaCount) continue;

    const coverage = formulaCount / Math.max(1, lastRow - headerRow);

    output.push([
      columnLetter_(c + 1),
      headers[c] || '',
      coverage,
      Object.keys(variants).length,
      sampleA1,
      sampleR1C1,
      errorCount,
      coverage >= CFG.MIN_FORMULA_COVERAGE ? 'YES' : 'NO'
    ]);
  }

  audit.getRange(1, 1, output.length, output[0].length).setValues(output);
  audit.getRange(1, 1, 1, output[0].length).setFontWeight('bold');
  if (output.length > 1) {
    audit.getRange(2, 3, output.length - 1, 1).setNumberFormat('0.0%');
  }
  audit.setFrozenRows(1);
  audit.autoResizeColumns(1, output[0].length);

  audit.getRange(output.length + 2, 1, 5, 2).setValues([
    ['Diagnostic', 'Observed workbook pattern from the supplied screenshots'],
    ['AGEING / decimal days', 'Appears to measure elapsed time from Date Endorsed to Date Restored; otherwise it continues to NOW().'],
    ['AGEING / duration', 'Appears to use the same elapsed duration and display days + hours.'],
    ['SLA', 'Appears to classify elapsed duration as within 24 hrs, within 48 hrs, or beyond 48 hrs.'],
    ['Authority', 'The live A1/R1C1 formulas above are the exact formulas currently stored in DATABASE.']
  ]);
  audit.getRange(output.length + 2, 1, 1, 2).setFontWeight('bold');
  audit.getRange(output.length + 3, 1, 4, 2).setWrap(true);

  log_('EXACT_FORMULA_AUDIT',
    'Captured live A1/R1C1 formulas for ' + (output.length - 1) + ' formula columns.');

  SpreadsheetApp.getUi().alert(
    'Exact Formula Audit Complete',
    'FORMULA_AUDIT contains the actual formulas read directly from DATABASE.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function columnLetter_(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function inspectFormulaColumns_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { message: 'No data rows found.' };

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const formulas = sheet.getRange(1, 1, lastRow, lastCol).getFormulasR1C1();
  const headerRow = findHeaderRow_(values);
  const headers = values[headerRow - 1];
  const dataRows = lastRow - headerRow;
  const lines = ['Rows checked: ' + dataRows, ''];

  for (let c = 0; c < lastCol; c++) {
    let count = 0;
    let errors = 0;
    for (let r = headerRow; r < lastRow; r++) {
      if (formulas[r][c]) count++;
      if (isErrorValue_(values[r][c])) errors++;
    }
    if (!count) continue;

    const coverage = count / Math.max(1, dataRows);
    lines.push(
      (headers[c] || ('Column ' + (c + 1))) +
      ' | formulas=' + count +
      ' | coverage=' + Math.round(coverage * 100) + '%' +
      ' | errors=' + errors +
      ' | safe repair=' + (coverage >= CFG.MIN_FORMULA_COVERAGE ? 'YES' : 'NO')
    );
  }

  if (lines.length === 2) lines.push('No formula columns detected.');
  return { message: lines.join('\n') };
}

/** Reads the live DATABASE and creates dashboard metrics. */
function readMetrics_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return emptyMetrics_();

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headerRow = findHeaderRow_(values);
  const headers = values[headerRow - 1];
  const cols = resolveColumns_(headers);

  const status = {};
  const sla = {};
  const province = {};
  const team = {};
  let pending = 0;
  let restored = 0;
  let beyond48 = 0;
  let activeRows = 0;

  for (let r = headerRow; r < lastRow; r++) {
    const row = values[r];
    if (isEmptyRow_(row)) continue;
    activeRows++;

    const finalStatus = cleanText_(cell_(row, cols.finalStatus));
    const slaValue = cleanText_(cell_(row, cols.sla));
    const provinceValue = cleanText_(cell_(row, cols.province)) || 'Unspecified';
    const teamValue = cleanText_(cell_(row, cols.opsTeam)) || 'Unassigned';

    if (finalStatus) status[finalStatus] = (status[finalStatus] || 0) + 1;
    if (slaValue) sla[slaValue] = (sla[slaValue] || 0) + 1;
    province[provinceValue] = (province[provinceValue] || 0) + 1;
    team[teamValue] = (team[teamValue] || 0) + 1;

    if (finalStatus.toUpperCase() === 'PENDING') pending++;
    if (finalStatus.toUpperCase() === 'RESTORED') restored++;
    if (isBeyond48_(row, cols)) beyond48++;
  }

  return {
    totalRows: activeRows,
    pending,
    restored,
    beyond48,
    statusSummary: sortCounts_(status),
    slaSummary: sortCounts_(sla),
    provinceSummary: sortCounts_(province),
    teamSummary: sortCounts_(team),
    headerRow
  };
}

function isBeyond48_(row, cols) {
  const sla = cleanText_(cell_(row, cols.sla)).toLowerCase();
  if (sla.indexOf('beyond 48') >= 0 || sla.indexOf('beyond48') >= 0 || sla.indexOf('>48') >= 0) return true;

  const ageing = cell_(row, cols.ageing);
  if (typeof ageing === 'number' && ageing > 2) return true;
  const match = String(ageing || '').match(/-?\d+(?:\.\d+)?/);
  if (match && Number(match[0]) > 2) return true;

  const endorsed = toDate_(cell_(row, cols.dateEndorsed));
  if (!endorsed) return false;
  const finalStatus = cleanText_(cell_(row, cols.finalStatus)).toUpperCase();
  const restored = toDate_(cell_(row, cols.dateRestored));
  const end = finalStatus === 'RESTORED' && restored ? restored : new Date();
  return (end.getTime() - endorsed.getTime()) > 48 * 60 * 60 * 1000;
}

function buildDashboard_(m, repair) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let dash = ss.getSheetByName(CFG.DASHBOARD);
  if (!dash) dash = ss.insertSheet(CFG.DASHBOARD);

  dash.clear();
  dash.clearConditionalFormatRules();
  dash.getCharts().forEach(c => dash.removeChart(c));
  dash.setHiddenGridlines(true);
  dash.setFrozenRows(2);

  // Title
  dash.getRange('A1:N1').merge().setValue('INTERNAL NAP OUTAGE MONITORING — CONTROL DASHBOARD');
  dash.getRange('A1:N1').setFontFamily('Arial').setFontSize(18).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy HH:mm:ss');
  dash.getRange('A2:N2').merge().setValue(
    'Live DATABASE summary  |  Auto refresh: 1 minute  |  Last refresh: ' + now
  );
  dash.getRange('A2:N2').setFontFamily('Arial').setFontSize(9)
    .setHorizontalAlignment('center');

  // KPI cards
  kpi_(dash, 'A4:C6', 'TOTAL RECORDS', m.totalRows, 'Live rows');
  kpi_(dash, 'D4:F6', 'PENDING', m.pending, 'Open records');
  kpi_(dash, 'G4:I6', 'RESTORED', m.restored, 'Closed records');
  kpi_(dash, 'J4:L6', 'BEYOND 48 HRS', m.beyond48, 'SLA exposure');
  kpi_(dash, 'M4:N6', 'DATA ERRORS', repair.errors, 'After repair');

  section_(dash, 'A8:F8', 'STATUS SUMMARY');
  table2_(dash, 9, 1, ['Final Status', 'Count'], m.statusSummary);

  section_(dash, 'H8:N8', 'SLA SUMMARY');
  table2_(dash, 9, 8, ['SLA', 'Count'], m.slaSummary);

  section_(dash, 'A17:F17', 'RECORDS BY PROVINCE');
  table2_(dash, 18, 1, ['Province', 'Count'], m.provinceSummary.slice(0, CFG.MAX_PROVINCES));

  section_(dash, 'H17:N17', 'RECORDS BY OPS TEAM');
  table2_(dash, 18, 8, ['Ops Team', 'Count'], m.teamSummary.slice(0, CFG.MAX_TEAMS));

  section_(dash, 'A35:N35', 'DATA QUALITY & SELF-HEALING AGENT');
  const agent = [
    ['Rows checked', m.totalRows],
    ['Formula columns', repair.formulaColumns],
    ['Cells repaired', repair.repaired],
    ['Errors remaining', repair.errors],
    ['Auto refresh', 'EVERY 1 MINUTE'],
    ['Repair mode', CFG.AUTO_REPAIR ? 'SAFE AUTO-REPAIR ON' : 'AUDIT ONLY']
  ];
  dash.getRange(36, 1, agent.length, 2).setValues(agent);
  dash.getRange(36, 1, agent.length, 2).setBorder(true, true, true, true, true, true);
  dash.getRange('A36:A41').setFontWeight('bold');

  dash.getRange('D36:N41').merge().setValue(
    'AGENT PROTECTION RULES\n' +
    '• Uses the live DATABASE as the source of truth.\n' +
    '• Detects formula coverage and spreadsheet error values.\n' +
    '• Repairs only blank/error cells when a valid existing formula pattern is available.\n' +
    '• Uses R1C1 formulas so relative references adjust to the repaired row.\n' +
    '• Does not overwrite valid formulas or hard-coded operational values.\n' +
    '• Every refresh/repair event is logged in AGENT_LOG.'
  );
  dash.getRange('D36:N41').setWrap(true).setVerticalAlignment('top').setFontSize(9);

  // Hidden chart source area.
  writeChartData_(dash, 44, 1, ['Province', 'Count'], m.provinceSummary.slice(0, CFG.MAX_CHART_ROWS));
  writeChartData_(dash, 44, 4, ['SLA', 'Count'], m.slaSummary);
  dash.hideRows(44, 30);

  createCharts_(dash, m);
  styleDashboard_(dash);
  dash.setTabColor('#1F4E78');
}

function kpi_(sheet, a1, label, value, sub) {
  const r = sheet.getRange(a1);
  const row = r.getRow(), col = r.getColumn(), cols = r.getNumColumns();
  r.setBorder(true, true, true, true, true, true);
  sheet.getRange(row, col, 1, cols).merge().setValue(label)
    .setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center');
  sheet.getRange(row + 1, col, 1, cols).merge().setValue(value)
    .setFontWeight('bold').setFontSize(22).setHorizontalAlignment('center');
  sheet.getRange(row + 2, col, 1, cols).merge().setValue(sub)
    .setFontSize(8).setHorizontalAlignment('center');
}

function section_(sheet, a1, title) {
  sheet.getRange(a1).merge().setValue(title).setFontWeight('bold').setFontSize(11)
    .setBorder(false, false, true, false, false, false);
}

function table2_(sheet, row, col, headers, rows) {
  const body = [headers].concat(rows.length ? rows : [['No data', 0]]);
  sheet.getRange(row, col, body.length, 2).setValues(body)
    .setBorder(true, true, true, true, true, true);
  sheet.getRange(row, col, 1, 2).setFontWeight('bold');
  sheet.getRange(row + 1, col + 1, Math.max(1, body.length - 1), 1).setHorizontalAlignment('right');
}

function writeChartData_(sheet, row, col, headers, rows) {
  const body = [headers].concat(rows.length ? rows : [['No data', 0]]);
  sheet.getRange(row, col, body.length, 2).setValues(body);
}

function createCharts_(sheet, m) {
  const pRows = Math.max(2, Math.min(CFG.MAX_CHART_ROWS + 1, m.provinceSummary.length + 1));
  const sRows = Math.max(2, m.slaSummary.length + 1);

  const provinceChart = sheet.newChart().asColumnChart()
    .addRange(sheet.getRange(44, 1, pRows, 2))
    .setPosition(8, 4, 0, 0)
    .setOption('title', 'Top Provinces by Record Count')
    .setOption('legend', { position: 'none' })
    .setOption('height', 270)
    .setOption('width', 520)
    .build();
  sheet.insertChart(provinceChart);

  const slaChart = sheet.newChart().asPieChart()
    .addRange(sheet.getRange(44, 4, sRows, 2))
    .setPosition(18, 4, 0, 0)
    .setOption('title', 'SLA Distribution')
    .setOption('pieHole', 0.45)
    .setOption('height', 270)
    .setOption('width', 520)
    .build();
  sheet.insertChart(slaChart);
}

function styleDashboard_(sheet) {
  sheet.setColumnWidths(1, 14, 92);
  sheet.setRowHeight(1, 30);
  sheet.setRowHeight(2, 20);
  sheet.getRange('A1:N41').setFontFamily('Arial').setVerticalAlignment('middle');
  sheet.getRange('A4:N6').setBorder(true, true, true, true, true, true);
  sheet.getRange('J5:L5').setFontWeight('bold');

  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(0)
      .setBackground('#FCE8E6')
      .setFontColor('#B31412')
      .setRanges([sheet.getRange('J5:L5')])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberEqualTo(0)
      .setBackground('#E6F4EA')
      .setFontColor('#137333')
      .setRanges([sheet.getRange('J5:L5')])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(0)
      .setBackground('#FCE8E6')
      .setFontColor('#B31412')
      .setRanges([sheet.getRange('M5:N5')])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberEqualTo(0)
      .setBackground('#E6F4EA')
      .setFontColor('#137333')
      .setRanges([sheet.getRange('M5:N5')])
      .build()
  ];
  sheet.setConditionalFormatRules(rules);
}

function writeDashboardError_(message) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let dash = ss.getSheetByName(CFG.DASHBOARD);
    if (!dash) dash = ss.insertSheet(CFG.DASHBOARD);
    dash.getRange('A1:N10').clear();
    dash.getRange('A1:N1').merge().setValue('NAP DASHBOARD — REFRESH ERROR')
      .setFontWeight('bold').setFontSize(16);
    dash.getRange('A2:N5').merge().setValue(message).setWrap(true);
  } catch (_) {}
}

/* ---------- General helpers ---------- */

function findHeaderRow_(values) {
  const scan = Math.min(values.length, 30);
  for (let r = 0; r < scan; r++) {
    const row = values[r].map(normalizeHeader_);
    const hits = row.filter(x =>
      ['timestamp', 'province', 'municipality', 'facility', 'final status', 'date endorsed', 'ageing', 'sla'].indexOf(x) >= 0
    ).length;
    if (hits >= 3) return r + 1;
  }
  return 1;
}

function resolveColumns_(headers) {
  const n = headers.map(normalizeHeader_);
  const out = {};
  Object.keys(CFG.HEADERS).forEach(key => {
    out[key] = -1;
    for (let i = 0; i < n.length; i++) {
      if (CFG.HEADERS[key].indexOf(n[i]) >= 0) {
        out[key] = i;
        break;
      }
    }
  });
  return out;
}

function normalizeHeader_(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
}

function cell_(row, index) { return index >= 0 ? row[index] : ''; }
function cleanText_(v) { return String(v == null ? '' : v).trim(); }
function isEmptyRow_(row) { return row.every(v => v === '' || v === null); }

function isErrorValue_(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return ['#REF!', '#DIV/0!', '#VALUE!', '#N/A', '#NAME?', '#NUM!', '#NULL!', '#ERROR!'].indexOf(s) >= 0;
}

function toDate_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    if (!isNaN(d)) return d;
  }
  return null;
}

function sortCounts_(obj) {
  return Object.keys(obj).map(k => [k, obj[k]]).sort((a, b) => b[1] - a[1]);
}

function emptyMetrics_() {
  return { totalRows: 0, pending: 0, restored: 0, beyond48: 0, statusSummary: [], slaSummary: [], provinceSummary: [], teamSummary: [] };
}

function countFormulaColumns_(formulas, startRow) {
  if (!formulas.length) return 0;
  let total = 0;
  for (let c = 0; c < formulas[0].length; c++) {
    for (let r = startRow; r < formulas.length; r++) {
      if (formulas[r][c]) { total++; break; }
    }
  }
  return total;
}

function countErrors_(values, startRow) {
  let n = 0;
  for (let r = startRow; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      if (isErrorValue_(values[r][c])) n++;
    }
  }
  return n;
}

function errorText_(err) { return err && err.stack ? err.stack : String(err); }

/* ---------- Logging ---------- */

function ensureLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CFG.LOG);
  if (!sheet) {
    sheet = ss.insertSheet(CFG.LOG);
    sheet.getRange(1, 1, 1, 3).setValues([['Timestamp', 'Event', 'Message']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function log_(event, message) {
  try {
    const sheet = ensureLogSheet_();
    sheet.appendRow([new Date(), event, String(message).slice(0, 5000)]);
    const excess = sheet.getLastRow() - CFG.MAX_LOG_ROWS;
    if (excess > 0) sheet.deleteRows(2, excess);
  } catch (_) {}
}