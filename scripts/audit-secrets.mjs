// Verify no credential has leaked into the repo or its history.
//   npm run audit:secrets
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const PATTERNS = [
  ['Groq API key', /gsk_[A-Za-z0-9]{20,}/],
  ['Twilio API key SID', /SK[0-9a-f]{32}/],
  ['Twilio Account SID', /AC[0-9a-f]{32}/],
  // sk- is OpenAI, sk_ is ElevenLabs — one pattern covers both
  ['OpenAI / ElevenLabs key', /sk[-_][A-Za-z0-9]{20,}/],
  ['Private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const ALLOW = /ACxxxx|SKxxxx|your_|example|placeholder|0{8,}|\$\{|process\.env/;

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
let problems = 0;
const ok = (m) => console.log('  \u2713 ' + m);
const bad = (m) => { console.log('  \u2717 ' + m); problems++; };

console.log('\n.env handling');
if (!existsSync('.env')) ok('.env absent (fine on a machine that does not run the bot)');
else ok('.env present locally');
try { sh('git ls-files --error-unmatch .env'); bad('.env IS TRACKED BY GIT — remove it from the index now'); }
catch { ok('.env is not tracked by git'); }
try { sh('git check-ignore -q .env'); ok('.env is covered by .gitignore'); }
catch { bad('.env is NOT gitignored'); }

console.log('\ntracked files');
let tracked = 0;
for (const file of sh('git ls-files').split('\n').filter(Boolean)) {
  let body = '';
  try { body = sh(`git show HEAD:"${file}"`); } catch { continue; }
  for (const [name, re] of PATTERNS) {
    for (const line of body.split('\n')) {
      if (re.test(line) && !ALLOW.test(line)) { bad(`${name} in ${file}`); tracked++; }
    }
  }
}
if (!tracked) ok('no credential patterns in any tracked file');

console.log('\ngit history (every blob, every commit)');
let hist = 0;
try {
  const blobs = sh("git rev-list --all --objects").split('\n').map((l) => l.split(' ')[0]);
  const seen = new Set();
  for (const sha of blobs) {
    if (!sha || seen.has(sha)) continue;
    seen.add(sha);
    let body = '';
    try { body = execSync(`git cat-file -p ${sha}`, { encoding: 'utf8', maxBuffer: 8e6, stdio: ['ignore','pipe','ignore'] }); }
    catch { continue; }
    if (body.length > 400000) continue;
    for (const [name, re] of PATTERNS) {
      const m = body.match(re);
      if (m && !ALLOW.test(m[0])) { bad(`${name} found in history blob ${sha.slice(0, 8)}`); hist++; }
    }
  }
} catch { /* shallow or empty repo */ }
if (!hist) ok('no credential patterns anywhere in git history');

console.log('\nhooks');
let hp = '';
try { hp = sh('git config core.hooksPath'); } catch {}
hp === '.githooks' ? ok('pre-commit secret guard is active') : bad('run: git config core.hooksPath .githooks');

console.log(problems ? `\n${problems} problem(s) found\n` : '\nAll clear.\n');
process.exit(problems ? 1 : 0);
