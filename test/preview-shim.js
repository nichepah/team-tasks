/**
 * Browser shim for the local preview (see preview.sh).
 *
 * Stands in for google.script.run by calling the real Code.gs functions, which
 * are in turn talking to the in-memory fakes from stubs.js. Nothing here
 * reimplements a rule — permissions, search, sorting and the activity log are
 * the deployed code paths, so what you see locally is what the web app does.
 *
 * Pick a visitor with ?as=ravi@example.com to see how the same data looks to
 * somebody else — Arun's tasks turn "view only" for everyone outside his line.
 */
(function () {
  'use strict';

  /* -------------------------------------------------- run as a given visitor */

  // team_() and isAdmin_() memoise per execution; a real request starts fresh,
  // so clear both whenever the visitor changes.
  function as(email, fn) {
    VISITOR = email;
    teamCache_ = null;
    ownerCache_ = null;
    return fn();
  }

  function dayKey(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return [d.getFullYear(),
            String(d.getMonth() + 1).padStart(2, '0'),
            String(d.getDate()).padStart(2, '0')].join('-');
  }

  /* ------------------------------------------------------------- demo content */

  var SEED = [
    ['ravi@example.com',   { title: 'Audit blast furnace #3 shift log', assignee: 'deep@example.com',
                         priority: 'High', status: 'In Progress', due: dayKey(0),
                         details: 'Cross-check the charge sheet against the operator log for '
                                + 'shifts B and C.\n\nPending: signature from the shift in-charge.' }],
    ['sunita@example.com', { title: 'Recalibrate stack emission sensors', assignee: 'deep@example.com',
                         priority: 'Critical', status: 'Blocked', due: dayKey(-2),
                         details: 'Blocked on the calibration gas cylinder from stores (indent 4471).' }],
    ['aneesh@example.com', { title: 'Review capex proposal for mill upgrade', assignee: 'ravi@example.com',
                         priority: 'Critical', status: 'Open', due: dayKey(2),
                         details: 'Committee meets Friday. Need the payback working sheet attached.' }],
    ['ravi@example.com',   { title: 'Replace conveyor belt idlers on line 2', assignee: 'sunita@example.com',
                         priority: 'High', status: 'Open', due: dayKey(-6),
                         details: 'Six seized idlers between transfer points 4 and 5.' }],
    ['ravi@example.com',   { title: 'Draft monthly production summary', assignee: 'ravi@example.com',
                         priority: 'Medium', status: 'Open', due: dayKey(1) }],
    ['ravi@example.com',   { title: 'Close out vendor invoices for Q2', assignee: 'sunita@example.com',
                         priority: 'Medium', status: 'Open', due: dayKey(5) }],
    ['meera@example.com',  { title: 'Safety induction for new contractors', assignee: 'arun@example.com',
                         priority: 'High', status: 'Open', due: dayKey(3),
                         details: 'Batch of 14. Needs the updated confined-space module.' }],
    ['aneesh@example.com', { title: 'Quarterly manpower plan', assignee: 'meera@example.com',
                         priority: 'Medium', status: 'In Progress' }],
    ['deep@example.com',   { title: 'Update SOP for coke oven changeover', assignee: 'deep@example.com',
                         priority: 'Low', status: 'Done' }],
    ['deep@example.com',   { title: 'Log lab results for heat 4412', assignee: 'deep@example.com',
                         priority: 'Low', status: 'Cancelled' }]
  ];

  SEED.forEach(function (pair) {
    as(pair[0], function () { return saveTask(pair[1]); });
  });

  // One edit, so the Activity tab has an "Updated" entry with a real field diff.
  as('ravi@example.com', function () {
    var t = listTasks({ scope: 'all', search: 'idlers' }).tasks[0];
    return saveTask({
      id: t.id, title: t.title, details: t.details + '\n\nStores confirmed stock on 2 of 6.',
      assignee: t.assignee, priority: 'Critical', status: 'In Progress', due: t.due
    });
  });

  /* -------------------------------------------------- google.script.run stand-in */

  var SERVER = ['bootstrap', 'listTasks', 'listActivity', 'saveTask', 'deleteTask'];
  var LATENCY = 180;          // enough to see the skeletons and the saving state

  var visitor = (function () {
    var m = /[?&]as=([^&]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : 'ravi@example.com';
  })();

  function runner() {
    var onOk = null;
    var onErr = null;

    var api = {
      withSuccessHandler: function (fn) { onOk = fn; return api; },
      withFailureHandler: function (fn) { onErr = fn; return api; }
    };

    SERVER.forEach(function (name) {
      api[name] = function (arg) {
        setTimeout(function () {
          try {
            var result = as(visitor, function () { return window[name](arg); });
            if (onOk) onOk(result);
          } catch (e) {
            if (onErr) onErr({ message: e.message });
          }
        }, LATENCY);
      };
    });

    return api;
  }

  window.google = {
    script: {
      run: {
        withSuccessHandler: function (fn) { return runner().withSuccessHandler(fn); },
        withFailureHandler: function (fn) { return runner().withFailureHandler(fn); }
      }
    }
  };

  console.log('Local preview · signed in as ' + visitor +
              ' · switch with ?as=aneesh@example.com (owner), deep@example.com, arun@example.com');
})();
