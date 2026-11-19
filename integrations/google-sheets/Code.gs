/** @OnlyCurrentDoc */
const COOKGAME_EXPORT_URL = 'https://cookgame.shogo0x2e.com/api/operator/survey-snapshot';
const COOKGAME_SHEET_NAMES = ['回答一覧', '項目説明', '更新状況'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('回答データ')
    .addItem('今すぐ更新', 'syncCookgameResponses')
    .addItem('30分ごとの更新を設定', 'installCookgameSync')
    .addItem('自動更新を停止', 'stopCookgameSync').addToUi();
}

function installCookgameSync() {
  // Fail before creating a trigger if credentials or the first refresh are invalid.
  syncCookgameResponses();
  stopCookgameSync();
  ScriptApp.newTrigger('syncCookgameResponses').timeBased().everyMinutes(30).create();
  SpreadsheetApp.getActiveSpreadsheet().toast('30分ごとの自動更新を設定しました。', '回答データ');
}

function stopCookgameSync() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'syncCookgameResponses')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function syncCookgameResponses() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('別の更新処理が実行中です。後でもう一度お試しください。');
  try {
    const token = PropertiesService.getScriptProperties().getProperty('COOKGAME_EXPORT_TOKEN');
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('プロジェクトの設定で COOKGAME_EXPORT_TOKEN を設定してください。');
    const response = UrlFetchApp.fetch(COOKGAME_EXPORT_URL, {
      method: 'get', headers: {Authorization: 'Bearer ' + token},
      followRedirects: false, muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) throw new Error('回答の取得に失敗しました（HTTP ' + response.getResponseCode() + '）。前回のデータは保持されています。');
    let snapshot;
    try { snapshot = JSON.parse(response.getContentText()); }
    catch (_) { throw new Error('回答データの形式が不正です。前回のデータは保持されています。'); }
    validateCookgameSnapshot_(snapshot);
    // Fetch and validate everything before touching the existing sheet.
    const book = SpreadsheetApp.getActiveSpreadsheet();
    const answerRows = [snapshot.columns.map(c => c.label)].concat(snapshot.rows);
    const dictionary = [['見出し', '内部キー', '説明・選択肢']].concat(snapshot.columns.map(c => [c.label, c.id, c.description]));
    const updated = Utilities.formatDate(new Date(snapshot.generatedAt), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    const status = [['項目', '内容'], ['最終更新（日本時間）', updated], ['回答数', snapshot.count],
      ['対象', '送信済みの通常回答（デモ回答・途中保存は除外）'],
      ['自動更新の設定', '30分ごと（設定後に有効／実行時刻は多少前後します）'],
      ['正本', '自宅サーバーのSQLite'], ['シートの用途', '閲覧・分析用。回答一覧の直接編集は次回の更新で置き換わります。']];
    writeCookgameTab_(book, COOKGAME_SHEET_NAMES[0], answerRows);
    writeCookgameTab_(book, COOKGAME_SHEET_NAMES[1], dictionary);
    writeCookgameTab_(book, COOKGAME_SHEET_NAMES[2], status);
    book.getSheetByName(COOKGAME_SHEET_NAMES[0]).setFrozenColumns(1);
    book.getSheetByName(COOKGAME_SHEET_NAMES[1]).setColumnWidth(1, 210).setColumnWidth(2, 190).setColumnWidth(3, 600);
    book.getSheetByName(COOKGAME_SHEET_NAMES[2]).setColumnWidth(1, 200).setColumnWidth(2, 650);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}

function validateCookgameSnapshot_(data) {
  const bad = () => { throw new Error('回答データの形式が不正です。前回のデータは保持されています。'); };
  if (!data || data.schemaVersion !== 1 || data.scope !== 'completed-non-demo' ||
      !Array.isArray(data.columns) || data.columns.length < 1 || data.columns.length > 100 ||
      !Array.isArray(data.rows) || data.rows.length > 5000 || data.count !== data.rows.length ||
      !Number.isFinite(Date.parse(data.generatedAt))) bad();
  const seen = new Set();
  data.columns.forEach(c => {
    if (!c || typeof c.id !== 'string' || seen.has(c.id) || typeof c.label !== 'string' || typeof c.description !== 'string') bad();
    seen.add(c.id);
  });
  if (data.columns[0].id !== 'id') bad();
  const ids = new Set();
  data.rows.forEach(row => {
    if (!Array.isArray(row) || row.length !== data.columns.length || typeof row[0] !== 'string' || ids.has(row[0])) bad();
    ids.add(row[0]);
    row.forEach(cell => { if (cell !== null && !['number', 'string', 'boolean'].includes(typeof cell) || typeof cell === 'number' && !Number.isFinite(cell)) bad(); });
  });
}

function cookgameLiteral_(value) {
  if (value === null || value === undefined) return '';
  // Free text must remain text, including answers that resemble spreadsheet formulas.
  return typeof value === 'string' && /^[\s]*[=+@\-]/.test(value) ? "'" + value : value;
}

function writeCookgameTab_(book, name, rows) {
  let sheet = book.getSheetByName(name);
  if (!sheet && name === '回答一覧') {
    const first = book.getSheets();
    if (first.length === 1 && first[0].getName() === 'シート1' && first[0].getLastRow() === 0) sheet = first[0].setName(name);
  }
  if (!sheet) sheet = book.insertSheet(name);
  const height = rows.length, width = rows[0].length, oldHeight = sheet.getLastRow(), oldWidth = sheet.getLastColumn();
  if (sheet.getMaxRows() < height) sheet.insertRowsAfter(sheet.getMaxRows(), height - sheet.getMaxRows());
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  sheet.getRange(1, 1, height, width).setValues(rows.map(row => row.map(cookgameLiteral_)));
  if (oldHeight > height) sheet.getRange(height + 1, 1, oldHeight - height, Math.max(width, oldWidth)).clearContent();
  if (oldWidth > width) sheet.getRange(1, width + 1, Math.max(height, oldHeight), oldWidth - width).clearContent();
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#f1f3f4').setWrap(true);
  sheet.getRange(1, 1, height, width).setVerticalAlignment('top');
  sheet.getRange(1, 1, 1, width).setNote('SQLiteから自動更新されます。項目説明シートで選択肢をご確認ください。');
  if (name === '回答一覧') {
    sheet.setColumnWidths(1, width, 160);
    sheet.getRange(2, 1, Math.max(1, height - 1), width).setWrap(true);
    const filter = sheet.getFilter();
    if (filter) filter.remove();
    sheet.getRange(1, 1, Math.max(2, height), width).createFilter();
  } else sheet.getRange(1, 1, height, width).setWrap(true).setHorizontalAlignment('left');
}
