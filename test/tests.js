var pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}
function throws(label, fn, re) {
  try { fn(); fail++; console.log('  FAIL ' + label + ' (no error thrown)'); }
  catch (e) {
    if (!re || re.test(e.message)) { pass++; console.log('  ok   ' + label); }
    else { fail++; console.log('  FAIL ' + label + ' -- got: ' + e.message); }
  }
}
function as(email, fn) {
  VISITOR = email; teamCache_ = null; ownerCache_ = null;
  return fn();
}

console.log('\n-- reporting graph --');
var t = team_();
ok('Aneesh has 5 people beneath him (2 direct + 3 indirect)',
   descendants_('aneesh@example.com', t).sort().join(',') ===
   'arun@example.com,deep@example.com,meera@example.com,ravi@example.com,sunita@example.com');
ok('Ravi sees Sunita and her report Deep',
   descendants_('ravi@example.com', t).sort().join(',') === 'deep@example.com,sunita@example.com');
ok('Deep is a leaf', descendants_('deep@example.com', t).length === 0);
ok('Deep reports up through Sunita, Ravi, Aneesh',
   ancestors_('deep@example.com', t).join(',') === 'sunita@example.com,ravi@example.com,aneesh@example.com');
ok('a cycle in the sheet does not hang', descendants_('loopa@example.com', t).length <= 2);
ok('a dangling manager link is dropped', t.byEmail['gone@example.com'].reportsTo === '');
ok('Active=false is read as inactive', t.byEmail['gone@example.com'].active === false);

console.log('\n-- who may edit --');
ok('assignee edits own task', canEdit_('deep@example.com', 'deep@example.com', t));
ok('direct officer edits', canEdit_('sunita@example.com', 'deep@example.com', t));
ok('officer two levels up edits', canEdit_('ravi@example.com', 'deep@example.com', t));
ok('officer three levels up edits', canEdit_('aneesh@example.com', 'deep@example.com', t));
ok('a peer manager cannot edit', !canEdit_('meera@example.com', 'deep@example.com', t));
ok('a subordinate cannot edit their officer', !canEdit_('deep@example.com', 'ravi@example.com', t));
ok('an unrelated person cannot edit', !canEdit_('arun@example.com', 'deep@example.com', t));
ok('owner is admin', canEdit_(OWNER, 'arun@example.com', t));

console.log('\n-- create --');
var a = as('ravi@example.com', function () {
  return saveTask({ title: 'Audit blast furnace log', details: 'Line 3',
                    assignee: 'deep@example.com', priority: 'High' });
});
ok('id is generated', a.id === 'T0001');
ok('createdBy is the actor', a.createdBy === 'ravi@example.com');
ok('updatedAt stamped at create', !!a.updatedAt);
ok('priority stored', a.priority === 'High');
ok('default status is Open', a.status === 'Open');

as('deep@example.com', function () {
  saveTask({ title: 'Own task', assignee: 'deep@example.com', priority: 'Low' });
});
as('meera@example.com', function () {
  saveTask({ title: 'Peer team task', assignee: 'arun@example.com',
             priority: 'Critical', status: 'Blocked' });
});

throws('cannot create for someone outside your line',
  function () { as('meera@example.com', function () { saveTask({ title: 'x', assignee: 'deep@example.com' }); }); },
  /only create tasks for yourself/);
throws('cannot assign to a non-member',
  function () { as('ravi@example.com', function () { saveTask({ title: 'x', assignee: 'stranger@gmail.com' }); }); },
  /not on the Members tab/);
throws('title is required',
  function () { as('ravi@example.com', function () { saveTask({ title: '   ', assignee: 'ravi@example.com' }); }); },
  /title is required/);

console.log('\n-- update --');
throws('a peer manager cannot edit across teams',
  function () { as('meera@example.com', function () { saveTask({ id: 'T0001', title: 'hijack', assignee: 'deep@example.com' }); }); },
  /reporting officers can edit/);
throws('a subordinate cannot edit upward',
  function () { as('deep@example.com', function () { saveTask({ id: 'T0003', title: 'nope', assignee: 'arun@example.com' }); }); },
  /reporting officers can edit/);
throws('cannot push work sideways by reassigning',
  function () { as('ravi@example.com', function () { saveTask({ id: 'T0001', title: 'Audit blast furnace log', assignee: 'arun@example.com' }); }); },
  /reassign a task to yourself/);

var before = a.updatedAt;
var upd = as('aneesh@example.com', function () {
  return saveTask({ id: 'T0001', title: 'Audit blast furnace log', details: 'Line 3 and 4',
                    assignee: 'deep@example.com', priority: 'Critical',
                    status: 'In Progress', due: '2026-08-20' });
});
ok('officer up the chain can edit', upd.status === 'In Progress');
ok('updatedBy becomes the editor', upd.updatedBy === 'aneesh@example.com');
ok('createdBy is preserved', upd.createdBy === 'ravi@example.com');
ok('createdAt is preserved', upd.createdAt === a.createdAt);
ok('updatedAt moved forward', Date.parse(upd.updatedAt) >= Date.parse(before));
ok('due date round-trips', upd.due.slice(0, 10) === '2026-08-20');

var log = DB.Activity.slice(1);
var last = log[log.length - 1];
ok('the edit is logged against the task', last[1] === 'T0001' && last[3] === 'Updated');
ok('the log names the changed fields',
   /Priority: High/.test(last[4]) && /Status: Open/.test(last[4]) && /Details edited/.test(last[4]));

console.log('\n-- listing, scope, search --');
var mine = as('deep@example.com', function () { return listTasks({ scope: 'mine' }); });
ok('scope=mine returns only my rows',
   mine.tasks.length === 2 && mine.tasks.every(function (x) { return x.assignee === 'deep@example.com'; }));

var teamList = as('ravi@example.com', function () { return listTasks({ scope: 'team' }); });
ok('scope=team spans indirect reports', teamList.total === 2);
ok('every task in my team is editable by me',
   teamList.tasks.every(function (x) { return x.canEdit; }));

var all = as('deep@example.com', function () { return listTasks({ scope: 'all' }); });
ok('everyone can view every task', all.total === 3);
ok("another team's task is view-only",
   all.tasks.filter(function (x) { return x.assignee === 'arun@example.com'; })[0].canEdit === false);

var recent = as('aneesh@example.com', function () { return listTasks({ scope: 'all' }); });
var stamps = recent.tasks.map(function (x) { return Date.parse(x.updatedAt); });
ok('default order is reverse chronological',
   stamps.every(function (v, i) { return i === 0 || stamps[i - 1] >= v; }));

var byPri = as('aneesh@example.com', function () { return listTasks({ scope: 'all', sort: 'priority' }); });
ok('priority sort puts Critical first', byPri.tasks[0].priority === 'Critical');
ok('priority sort puts Low last', byPri.tasks[byPri.tasks.length - 1].priority === 'Low');

ok('search matches the details column',
   as('deep@example.com', function () { return listTasks({ scope: 'all', search: 'line 4' }); }).total === 1);
ok('search matches an assignee name',
   as('deep@example.com', function () { return listTasks({ scope: 'all', search: 'arun' }); }).total === 1);
ok('search matches a task id',
   as('deep@example.com', function () { return listTasks({ scope: 'all', search: 'T0001' }); }).total === 1);
ok('search is case-insensitive',
   as('deep@example.com', function () { return listTasks({ scope: 'all', search: 'BLAST' }); }).total === 1);
ok('multiple words must all match',
   as('deep@example.com', function () { return listTasks({ scope: 'all', search: 'blast furnace' }); }).total === 1);
ok('unrelated words match nothing',
   as('deep@example.com', function () { return listTasks({ scope: 'all', search: 'blast zzz' }); }).total === 0);
ok('filter by priority',
   as('deep@example.com', function () { return listTasks({ scope: 'all', priority: 'Critical' }); }).total === 2);
ok('filter by status',
   as('deep@example.com', function () { return listTasks({ scope: 'all', status: 'Blocked' }); }).total === 1);
ok('hideDone drops closed tasks',
   as('deep@example.com', function () { return listTasks({ scope: 'all', hideDone: true }); }).total === 3);
ok('haystack is not shipped to the browser', all.tasks[0].haystack === undefined);

console.log('\n-- paging --');
var p1 = as('deep@example.com', function () { return listTasks({ scope: 'all', limit: 2, offset: 0 }); });
var p2 = as('deep@example.com', function () { return listTasks({ scope: 'all', limit: 2, offset: 2 }); });
ok('page 1 is full', p1.tasks.length === 2 && p1.total === 3);
ok('page 2 continues without overlap',
   p2.tasks.length === 1 && p1.tasks.concat(p2.tasks).map(function (x) { return x.id; })
     .filter(function (v, i, arr) { return arr.indexOf(v) === i; }).length === 3);

console.log('\n-- bootstrap --');
var b = as('ravi@example.com', function () { return bootstrap(); });
ok('assignable = me + my whole subtree',
   b.assignable.sort().join(',') === 'deep@example.com,ravi@example.com,sunita@example.com');
ok('non-admin is not flagged admin', b.me.isAdmin === false);
var bo = as('aneesh@example.com', function () { return bootstrap(); });
ok('owner is flagged admin', bo.me.isAdmin === true);
var stranger = as('vendor@example.com', function () { return bootstrap(); });
ok('an unlisted visitor is marked unknown', stranger.me.known === false);
ok('an unlisted visitor can assign nothing', stranger.assignable.length === 0);

console.log('\n-- anonymous visitor --');
throws('an unidentifiable visitor is refused',
  function () { as('', function () { return listTasks({}); }); },
  /Could not identify/);

console.log('\n-- delete --');
throws('cannot delete outside your line',
  function () { as('meera@example.com', function () { deleteTask('T0001'); }); },
  /do not have permission/);
as('ravi@example.com', function () { return deleteTask('T0001'); });
ok('the row is gone',
   as('deep@example.com', function () { return listTasks({ scope: 'all' }); }).total === 2);
ok('the deletion is logged', DB.Activity[DB.Activity.length - 1][3] === 'Deleted');

console.log('\n-- activity feed --');
var feed = as('ravi@example.com', function () { return listActivity(50); });
ok('feed is newest first', Date.parse(feed[0].at) >= Date.parse(feed[feed.length - 1].at));
ok('feed resolves actor names', feed[0].actorName === 'Ravi');
ok('feed marks removed tasks', feed[0].taskTitle === '(removed)');

console.log('\n-- id generation --');
var n = as('ravi@example.com', function () {
  return saveTask({ title: 'After a delete', assignee: 'ravi@example.com' });
});
ok('ids never get reused after a delete', n.id === 'T0004');

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
if (fail) process.exit(1);
