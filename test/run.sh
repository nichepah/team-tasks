#!/bin/sh
# Backend rules against in-memory fakes, then static checks on the UI.
# Neither needs a Google account or a deployment. Usage: sh test/run.sh
set -e
cd "$(dirname "$0")/.."
trap 'rm -f test/.bundle.js' EXIT
cat test/stubs.js Code.gs test/tests.js > test/.bundle.js
node test/.bundle.js
node test/ui-check.js
