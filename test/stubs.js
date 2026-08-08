// Minimal in-memory fakes for the Apps Script services Code.gs touches.
var VISITOR = 'ravi@example.com';
var OWNER = 'aneesh@example.com';

var DB = {
  Members: [
    ['Email', 'Name', 'ReportsTo', 'Active'],
    ['aneesh@example.com', 'Aneesh', '', true],
    ['ravi@example.com', 'Ravi', 'aneesh@example.com', true],
    ['sunita@example.com', 'Sunita', 'ravi@example.com', true],
    ['deep@example.com', 'Deep', 'sunita@example.com', true],       // 3 levels under Aneesh
    ['meera@example.com', 'Meera', 'aneesh@example.com', true],     // Ravi's peer
    ['arun@example.com', 'Arun', 'meera@example.com', true],        // under the peer
    ['loopa@example.com', 'LoopA', 'loopb@example.com', true],      // deliberate cycle
    ['loopb@example.com', 'LoopB', 'loopa@example.com', true],
    ['gone@example.com', 'Gone', 'nosuch@example.com', false]       // dangling boss + inactive
  ],
  Tasks: [['ID','Title','Details','Assignee','Priority','Status','Due','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy']],
  Activity: [['At','TaskID','Actor','Action','Summary']]
};

function Range(sheet, row, col, rows, cols) {
  this.getValues = function () {
    var out = [];
    for (var r = 0; r < rows; r++) {
      var line = [];
      var src = sheet._rows[row - 1 + r] || [];
      for (var c = 0; c < cols; c++) line.push(src[col - 1 + c] === undefined ? '' : src[col - 1 + c]);
      out.push(line);
    }
    return out;
  };
  this.setValues = function (vals) {
    vals.forEach(function (line, r) {
      var target = row - 1 + r;
      while (sheet._rows.length <= target) sheet._rows.push([]);
      line.forEach(function (v, c) { sheet._rows[target][col - 1 + c] = v; });
    });
    return this;
  };
  this.setFontWeight = function () { return this; };
  this.setDataValidation = function () { return this; };
}

function Sheet(name, rows) {
  this._rows = rows;
  this.getName = function () { return name; };
  this.getLastRow = function () { return this._rows.length; };
  this.getLastColumn = function () { return (this._rows[0] || []).length; };
  this.getMaxRows = function () { return this._rows.length + 100; };
  this.setFrozenRows = function () { return this; };
  this.getRange = function (r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); };
  this.appendRow = function (vals) { this._rows.push(vals.slice()); };
  this.deleteRow = function (r) { this._rows.splice(r - 1, 1); };
}

var SHEET_OBJS = {};
Object.keys(DB).forEach(function (k) { SHEET_OBJS[k] = new Sheet(k, DB[k]); });

var SpreadsheetApp = {
  getActive: function () {
    return {
      getSheetByName: function (n) { return SHEET_OBJS[n] || null; },
      insertSheet: function (n) { SHEET_OBJS[n] = new Sheet(n, [[]]); return SHEET_OBJS[n]; },
      toast: function () {}
    };
  },
  flush: function () {},
  newDataValidation: function () {
    return { requireValueInList: function () { return { build: function () { return {}; } }; } };
  }
};

var Session = {
  getActiveUser: function () { return { getEmail: function () { return VISITOR; } }; },
  getEffectiveUser: function () { return { getEmail: function () { return OWNER; } }; },
  getScriptTimeZone: function () { return 'Asia/Kolkata'; }
};

var LockService = {
  getScriptLock: function () {
    return { tryLock: function () { return true; }, releaseLock: function () {} };
  }
};

var Utilities = {
  formatDate: function (d) {
    return [d.getFullYear(),
            String(d.getMonth() + 1).padStart(2, '0'),
            String(d.getDate()).padStart(2, '0')].join('-');
  }
};

var HtmlService = { createHtmlOutputFromFile: function () { return { setTitle: function () { return this; }, addMetaTag: function () { return this; } }; } };
