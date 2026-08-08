/**
 * Static checks on Index.html — no browser, no dependencies.
 *
 * The UI is one inlined file talking to Code.gs over google.script.run, so the
 * things that break it are drift, not logic: an element id renamed in the markup
 * but not the script, a server function that no longer exists, a new priority or
 * status with no colour rule. Each of those is cheap to catch by reading both
 * files, and expensive to notice after deployment.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
var backend = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');

var pass = 0, fail = 0;

function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? ' -- ' + detail : '')); }
}

/** Every match of the first capturing group, de-duplicated. */
function all(re, s) {
  var out = [], m;
  while ((m = re.exec(s)) !== null) if (out.indexOf(m[1]) === -1) out.push(m[1]);
  return out;
}

/** The quoted strings inside `var NAME = [...]` in Code.gs. */
function arrayLiteral(name) {
  var m = new RegExp('var ' + name + '\\s*=\\s*\\[([^\\]]*)\\]').exec(backend);
  return m ? all(/'([^']+)'/g, m[1]) : [];
}

var script = (function () {
  var m = /<script>([\s\S]*)<\/script>/.exec(html);
  return m ? m[1] : '';
})();

var styles = (function () {
  var m = /<style>([\s\S]*?)<\/style>/.exec(html);
  return m ? m[1] : '';
})();

var markup = html.replace(/<script>[\s\S]*<\/script>/, '').replace(/<style>[\s\S]*?<\/style>/, '');

console.log('\n-- ui: structure --');
ok('the inline script is present', script.length > 1000);
ok('the stylesheet is present', styles.length > 1000);

var syntaxError = '';
try { new vm.Script(script, { filename: 'Index.html <script>' }); }
catch (e) { syntaxError = e.message; }
ok('the inline script parses', !syntaxError, syntaxError);

console.log('\n-- ui: element ids --');
var declared = all(/\bid="([^"]+)"/g, markup);
var referenced = all(/\$\('([^']+)'\)/g, script);
var missing = referenced.filter(function (id) { return declared.indexOf(id) === -1; });
ok('every $(id) the script reads exists in the markup', missing.length === 0,
   'missing: ' + missing.join(', '));

var closeTargets = all(/data-close="([^"]+)"/g, markup);
var badClose = closeTargets.filter(function (id) { return declared.indexOf(id) === -1; });
ok('every data-close points at a real dialog', badClose.length === 0,
   'missing: ' + badClose.join(', '));

// TABS drives both the nav and which section it reveals.
var tabs = all(/\{ id: '([a-z]+)', label:/g, script);
var badTabs = tabs.filter(function (t) { return declared.indexOf('view-' + t) === -1; });
ok('every nav tab has a matching view- section', tabs.length === 3 && badTabs.length === 0,
   'missing: ' + badTabs.join(', '));

console.log('\n-- ui: server contract --');
var called = all(/call\('([^']+)'/g, script);
var absent = called.filter(function (fn) {
  return !new RegExp('function ' + fn + '\\s*\\(').test(backend);
});
ok('every server function the UI calls exists in Code.gs',
   called.length >= 4 && absent.length === 0, 'missing: ' + absent.join(', '));

var exposed = called.filter(function (fn) { return /_$/.test(fn); });
ok('the UI never calls a private (trailing underscore) function', exposed.length === 0,
   exposed.join(', '));

console.log('\n-- ui: colours stay in step with Code.gs --');
var priorities = arrayLiteral('PRIORITIES');
var statuses = arrayLiteral('STATUSES');
ok('priorities were found in Code.gs', priorities.length > 0);
ok('statuses were found in Code.gs', statuses.length > 0);

var unstyled = priorities.filter(function (p) {
  return styles.indexOf('.p-' + p) === -1;
});
ok('every priority has a .p-<name> colour rule', unstyled.length === 0,
   'add a rule for: ' + unstyled.join(', '));

var statusClass = (function () {
  var m = /var STATUS_CLASS = \{([\s\S]*?)\};/.exec(script);
  if (!m) return null;
  var out = {}, pair, re = /'([^']+)':\s*'([^']*)'/g;
  while ((pair = re.exec(m[1])) !== null) out[pair[1]] = pair[2];
  return out;
})();

ok('STATUS_CLASS is readable', !!statusClass);

if (statusClass) {
  var unknown = Object.keys(statusClass).filter(function (s) {
    return statuses.indexOf(s) === -1;
  });
  ok('STATUS_CLASS only names statuses Code.gs defines', unknown.length === 0,
     'stale: ' + unknown.join(', '));

  var noRule = Object.keys(statusClass).filter(function (s) {
    return statusClass[s] && styles.indexOf('.pill.' + statusClass[s]) === -1;
  });
  ok('every STATUS_CLASS value has a .pill rule', noRule.length === 0,
     'missing: ' + noRule.join(', '));
}

console.log('\n-- ui: safety --');
// User text is rendered with textContent everywhere; the single permitted
// innerHTML writes a constant icon path. Anything else is a scripting risk.
var innerHtmlUses = script.match(/\.innerHTML\s*=/g) || [];
ok('innerHTML is assigned exactly once', innerHtmlUses.length === 1,
   'found ' + innerHtmlUses.length + ' assignments');
ok('that one assignment is the icon path table',
   /svg\.innerHTML = PATHS\[name\]/.test(script));

ok('the mobile viewport is declared with viewport-fit', /viewport-fit=cover/.test(backend));
ok('safe-area insets are honoured', /env\(safe-area-inset-bottom\)/.test(styles));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
if (fail) process.exit(1);
