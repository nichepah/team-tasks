/**
 * Team Task Tracker — Apps Script backend.
 *
 * Data lives in the bound Google Sheet (three tabs: Members, Tasks, Activity).
 * Identity comes from the visitor's Google account, so edit rules are enforced
 * server-side and cannot be bypassed by the browser.
 *
 * First run: open the Apps Script editor and run setup() once.
 */

var SHEETS = { members: 'Members', tasks: 'Tasks', activity: 'Activity' };

var MEMBER_HEADERS = ['Email', 'Name', 'ReportsTo', 'Active'];
var TASK_HEADERS = ['ID', 'Title', 'Details', 'Assignee', 'Priority', 'Status',
                    'Due', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];
var ACTIVITY_HEADERS = ['At', 'TaskID', 'Actor', 'Action', 'Summary'];

var PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
var STATUSES = ['Open', 'In Progress', 'Blocked', 'Done', 'Cancelled'];

var MAX_TITLE = 200;
var MAX_DETAILS = 8000;
var PAGE_SIZE = 50;

/* ------------------------------------------------------------------ web app */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Team Tasks')
    // viewport-fit=cover lets the UI paint under a notch; the CSS then keeps
    // content clear of it with env(safe-area-inset-*).
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    // "Add to Home screen" then opens without browser chrome, like an app.
    .addMetaTag('mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-status-bar-style', 'default');
}

/* -------------------------------------------------------------------- setup */

/** Run once from the editor to create the tabs and register you as admin. */
function setup() {
  var ss = SpreadsheetApp.getActive();
  ensureSheet_(ss, SHEETS.members, MEMBER_HEADERS);
  var tasks = ensureSheet_(ss, SHEETS.tasks, TASK_HEADERS);
  ensureSheet_(ss, SHEETS.activity, ACTIVITY_HEADERS);

  // Keep hand-edits to the sheet valid.
  var last = Math.max(tasks.getMaxRows() - 1, 1);
  tasks.getRange(2, 5, last, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(PRIORITIES, true).build());
  tasks.getRange(2, 6, last, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());

  var owner = norm_(Session.getEffectiveUser().getEmail());
  var members = ss.getSheetByName(SHEETS.members);
  if (owner && members.getLastRow() < 2) {
    members.appendRow([owner, owner.split('@')[0], '', true]);
  }
  SpreadsheetApp.getActive().toast('Setup complete. Add your team to the Members tab.');
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var have = sh.getLastRow() > 0
    ? sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
    : [];
  if (String(have.slice(0, headers.length)) !== String(headers)) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ------------------------------------------------------------------ identity */

/**
 * The signed-in visitor. Deliberately does NOT fall back to the effective
 * (owner) user: that would hand owner rights to anyone Google won't identify.
 */
function whoami_() {
  return norm_(Session.getActiveUser().getEmail());
}

function requireUser_() {
  var email = whoami_();
  if (!email) {
    throw new Error('Could not identify your Google account. Open this link while ' +
                    'signed in to your organisation account.');
  }
  return email;
}

var ownerCache_ = null;

/** The account that deployed the app. Memoised — canEdit_ runs once per row. */
function isAdmin_(email) {
  if (ownerCache_ === null) ownerCache_ = norm_(Session.getEffectiveUser().getEmail());
  return !!email && email === ownerCache_;
}

/* ---------------------------------------------------------------- sheet i/o */

function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" is missing. Run setup() once from the Apps Script editor.');
  return sh;
}

function readRows_(name, headers) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  return values.map(function (row, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, c) { o[h] = row[c]; });
    return o;
  });
}

/* --------------------------------------------------------- reporting graph */

var teamCache_ = null;

/** Members plus the reporting graph, memoised per execution. */
function team_() {
  if (teamCache_) return teamCache_;

  var byEmail = {};
  var order = [];
  readRows_(SHEETS.members, MEMBER_HEADERS).forEach(function (r) {
    var email = norm_(r.Email);
    if (!email || byEmail[email]) return;
    byEmail[email] = {
      email: email,
      name: String(r.Name || '').trim() || email.split('@')[0],
      reportsTo: norm_(r.ReportsTo),
      active: truthy_(r.Active)
    };
    order.push(email);
  });

  // Drop manager links that point at nobody, and self-links.
  var children = {};
  order.forEach(function (email) {
    var boss = byEmail[email].reportsTo;
    if (!boss || boss === email || !byEmail[boss]) {
      byEmail[email].reportsTo = '';
      return;
    }
    (children[boss] = children[boss] || []).push(email);
  });

  teamCache_ = { byEmail: byEmail, order: order, children: children };
  return teamCache_;
}

/** Everyone below `email`, at any depth. Cycle-safe. */
function descendants_(email, t) {
  var out = [];
  var seen = {};
  seen[email] = true;
  var queue = (t.children[email] || []).slice();
  while (queue.length) {
    var cur = queue.shift();
    if (seen[cur]) continue;
    seen[cur] = true;
    out.push(cur);
    queue = queue.concat(t.children[cur] || []);
  }
  return out;
}

/** Every reporting officer above `email`, at any depth. Cycle-safe. */
function ancestors_(email, t) {
  var out = [];
  var seen = {};
  var cur = email;
  while (cur && !seen[cur]) {
    seen[cur] = true;
    var boss = (t.byEmail[cur] || {}).reportsTo;
    if (!boss || seen[boss]) break;
    out.push(boss);
    cur = boss;
  }
  return out;
}

/**
 * The one rule that matters: a task may be edited by its assignee, by anyone
 * the assignee reports to (directly or up the chain), or by the app owner.
 */
function canEdit_(actor, assignee, t) {
  if (!actor || !assignee) return false;
  if (actor === assignee) return true;
  if (ancestors_(assignee, t).indexOf(actor) !== -1) return true;
  return isAdmin_(actor);
}

/* ------------------------------------------------------------ client: read */

function bootstrap() {
  var me = requireUser_();
  var t = team_();
  var mine = t.byEmail[me];

  return {
    me: {
      email: me,
      name: mine ? mine.name : me.split('@')[0],
      known: !!mine,
      isAdmin: isAdmin_(me)
    },
    // Who this user may assign work to: themself plus their whole subtree.
    assignable: (mine ? [me] : []).concat(descendants_(me, t)),
    members: t.order.map(function (e) { return t.byEmail[e]; }),
    priorities: PRIORITIES,
    statuses: STATUSES,
    pageSize: PAGE_SIZE
  };
}

/**
 * opts: {search, scope: mine|team|all, priority, status, sort: recent|priority,
 *        assignee, hideDone, limit, offset}
 * Everyone may view every task; scope only narrows the list.
 */
function listTasks(opts) {
  var me = requireUser_();
  var t = team_();
  opts = opts || {};

  var scopeSet = null;
  if (opts.scope === 'mine') {
    scopeSet = {};
    scopeSet[me] = true;
  } else if (opts.scope === 'team') {
    scopeSet = {};
    scopeSet[me] = true;
    descendants_(me, t).forEach(function (e) { scopeSet[e] = true; });
  }

  var wantAssignee = norm_(opts.assignee);
  var terms = String(opts.search || '').toLowerCase().split(/\s+/)
    .filter(function (s) { return s; });

  var rows = readRows_(SHEETS.tasks, TASK_HEADERS)
    .map(function (r) { return mapTask_(r, me, t); })
    .filter(function (task) {
      if (!task.id) return false;
      if (scopeSet && !scopeSet[task.assignee]) return false;
      if (wantAssignee && task.assignee !== wantAssignee) return false;
      if (opts.priority && task.priority !== opts.priority) return false;
      if (opts.status && task.status !== opts.status) return false;
      if (opts.hideDone && (task.status === 'Done' || task.status === 'Cancelled')) return false;
      if (terms.length) {
        var hay = task.haystack;
        for (var i = 0; i < terms.length; i++) {
          if (hay.indexOf(terms[i]) === -1) return false;
        }
      }
      return true;
    });

  if (opts.sort === 'priority') {
    rows.sort(function (a, b) {
      return (a.priorityRank - b.priorityRank) || (b.updatedMs - a.updatedMs);
    });
  } else {
    // Default: reverse chronological on last update.
    rows.sort(function (a, b) { return b.updatedMs - a.updatedMs; });
  }

  var offset = Math.max(0, Number(opts.offset) || 0);
  var limit = Math.min(200, Number(opts.limit) || PAGE_SIZE);
  rows.forEach(function (r) { delete r.haystack; });

  return { tasks: rows.slice(offset, offset + limit), total: rows.length, offset: offset };
}

function mapTask_(r, me, t) {
  var assignee = norm_(r.Assignee);
  var member = t.byEmail[assignee];
  var updated = r.UpdatedAt || r.CreatedAt;
  var task = {
    id: String(r.ID || '').trim(),
    row: r._row,
    title: String(r.Title || ''),
    details: String(r.Details || ''),
    assignee: assignee,
    assigneeName: member ? member.name : (assignee || '—'),
    priority: PRIORITIES.indexOf(r.Priority) === -1 ? 'Medium' : r.Priority,
    status: STATUSES.indexOf(r.Status) === -1 ? 'Open' : r.Status,
    // A calendar day, not an instant: sent as yyyy-MM-dd so no timezone can
    // shift it to the day before on the way to the browser.
    due: dayKey_(r.Due),
    createdAt: toIso_(r.CreatedAt),
    createdBy: norm_(r.CreatedBy),
    updatedAt: toIso_(updated),
    updatedBy: norm_(r.UpdatedBy) || norm_(r.CreatedBy),
    canEdit: canEdit_(me, assignee, t)
  };
  task.priorityRank = PRIORITIES.indexOf(task.priority);
  task.updatedMs = millis_(updated);
  task.haystack = [task.id, task.title, task.details, task.assignee,
                   task.assigneeName, task.priority, task.status].join(' ').toLowerCase();
  return task;
}

/** Recent changes across the whole team, newest first. */
function listActivity(limit) {
  requireUser_();
  var t = team_();
  var titles = {};
  readRows_(SHEETS.tasks, TASK_HEADERS).forEach(function (r) {
    titles[String(r.ID || '').trim()] = String(r.Title || '');
  });

  var rows = readRows_(SHEETS.activity, ACTIVITY_HEADERS);
  var out = [];
  for (var i = rows.length - 1; i >= 0 && out.length < (limit || 60); i--) {
    var r = rows[i];
    var actor = norm_(r.Actor);
    out.push({
      at: toIso_(r.At),
      taskId: String(r.TaskID || ''),
      taskTitle: titles[String(r.TaskID || '').trim()] || '(removed)',
      actor: actor,
      actorName: (t.byEmail[actor] || {}).name || actor,
      action: String(r.Action || ''),
      summary: String(r.Summary || '')
    });
  }
  return out;
}

/* ----------------------------------------------------------- client: write */

/** Create (no id) or update (id) a task. Returns the saved task. */
function saveTask(input) {
  var me = requireUser_();
  var t = team_();
  input = input || {};

  var title = String(input.title || '').trim().slice(0, MAX_TITLE);
  if (!title) throw new Error('A title is required.');

  var assignee = norm_(input.assignee) || me;
  if (!t.byEmail[assignee]) {
    throw new Error('"' + assignee + '" is not on the Members tab. Add them first.');
  }

  var details = String(input.details || '').slice(0, MAX_DETAILS);
  var priority = PRIORITIES.indexOf(input.priority) === -1 ? 'Medium' : input.priority;
  var status = STATUSES.indexOf(input.status) === -1 ? 'Open' : input.status;
  var due = parseDate_(input.due);
  var id = String(input.id || '').trim();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('The sheet is busy. Please try again.');
  try {
    var sh = sheet_(SHEETS.tasks);
    var now = new Date();

    if (id) {
      var existing = findTask_(sh, id);
      if (!existing) throw new Error('That task no longer exists.');
      var owner = norm_(existing.Assignee);
      if (!canEdit_(me, owner, t)) {
        throw new Error('Only ' + (t.byEmail[owner] || {}).name + ' and their reporting officers can edit this task.');
      }
      // Reassignment must also land inside your own reporting line.
      if (assignee !== owner && !canEdit_(me, assignee, t)) {
        throw new Error('You can only reassign a task to yourself or to someone who reports to you.');
      }

      var changes = diff_([
        ['Title', existing.Title, title],
        ['Details', existing.Details, details],
        ['Assignee', owner, assignee],
        ['Priority', existing.Priority, priority],
        ['Status', existing.Status, status],
        ['Due', dayKey_(existing.Due), dayKey_(due)]
      ]);

      sh.getRange(existing._row, 1, 1, TASK_HEADERS.length).setValues([[
        id, title, details, assignee, priority, status, due,
        existing.CreatedAt || now, norm_(existing.CreatedBy) || me, now, me
      ]]);

      log_(id, me, changes.length ? 'Updated' : 'Touched',
           changes.length ? changes.join('; ') : 'no field changes');
    } else {
      if (!canEdit_(me, assignee, t)) {
        throw new Error('You can only create tasks for yourself or for someone who reports to you.');
      }
      id = nextId_(sh);
      sh.appendRow([id, title, details, assignee, priority, status, due, now, me, now, me]);
      log_(id, me, 'Created',
           'assigned to ' + (t.byEmail[assignee] || {}).name + ' · ' + priority);
    }

    SpreadsheetApp.flush();
    var saved = findTask_(sh, id);
    var task = mapTask_(saved, me, t);
    delete task.haystack;
    return task;
  } finally {
    lock.releaseLock();
  }
}

/** Delete a task. Same permission rule as editing; the activity log keeps the trace. */
function deleteTask(id) {
  var me = requireUser_();
  var t = team_();
  id = String(id || '').trim();
  if (!id) throw new Error('No task specified.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('The sheet is busy. Please try again.');
  try {
    var sh = sheet_(SHEETS.tasks);
    var existing = findTask_(sh, id);
    if (!existing) return { ok: true };
    if (!canEdit_(me, norm_(existing.Assignee), t)) {
      throw new Error('You do not have permission to delete this task.');
    }
    sh.deleteRow(existing._row);
    log_(id, me, 'Deleted', String(existing.Title || ''));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ helpers */

function findTask_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) {
      var row = sh.getRange(i + 2, 1, 1, TASK_HEADERS.length).getValues()[0];
      var o = { _row: i + 2 };
      TASK_HEADERS.forEach(function (h, c) { o[h] = row[c]; });
      return o;
    }
  }
  return null;
}

function nextId_(sh) {
  var last = sh.getLastRow();
  var max = 0;
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      var m = /^T(\d+)$/.exec(String(r[0]).trim());
      if (m) max = Math.max(max, Number(m[1]));
    });
  }
  return 'T' + pad_(max + 1, 4);
}

function log_(taskId, actor, action, summary) {
  sheet_(SHEETS.activity).appendRow([new Date(), taskId, actor, action, summary || '']);
}

function diff_(pairs) {
  var out = [];
  pairs.forEach(function (p) {
    var before = p[1] === null || p[1] === undefined ? '' : String(p[1]);
    var after = p[2] === null || p[2] === undefined ? '' : String(p[2]);
    if (before === after) return;
    out.push(p[0] === 'Details'
      ? 'Details edited'
      : p[0] + ': ' + (short_(before) || '—') + ' → ' + (short_(after) || '—'));
  });
  return out;
}

function short_(s) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

function norm_(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

function truthy_(v) {
  if (v === '' || v === null || v === undefined) return true;   // blank = active
  if (v === true) return true;
  if (v === false) return false;
  var s = String(v).trim().toLowerCase();
  return ['no', 'n', 'false', '0', 'inactive'].indexOf(s) === -1;
}

function pad_(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function toIso_(v) {
  if (v instanceof Date) return v.toISOString();
  var s = String(v == null ? '' : v).trim();
  return s;
}

/** Sort key that survives a timestamp typed into the sheet by hand. */
function millis_(v) {
  if (v instanceof Date) return v.getTime();
  var t = Date.parse(String(v == null ? '' : v));
  return isNaN(t) ? 0 : t;
}

function parseDate_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function dayKey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim();
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : '';
}
