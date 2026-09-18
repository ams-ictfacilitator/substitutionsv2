/** Tiny runner: node test/run.js  — executes every *.test.js in this folder. */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
global.check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
for (const f of files) {
  console.log('\n── ' + f + ' ' + '─'.repeat(Math.max(0, 50 - f.length)));
  require(path.join(__dirname, f));
}
console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
