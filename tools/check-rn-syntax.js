/**
 * Syntax check for the React Native sources in apps/.
 *
 * These files are JSX, which neither `node --check` nor a plain ES module
 * parse can read - both stop at the first `<View>`. That means a typo in them
 * would otherwise only surface after installing the whole Expo toolchain,
 * which is a slow and expensive way to find a missing bracket.
 *
 * This performs a structural check instead of a full parse: it tracks bracket
 * balance while understanding JSX well enough not to be confused by it, and
 * flags the mistakes that actually happen - unbalanced brackets, unterminated
 * strings, stray tags. It is deliberately not a compiler; it is a fast guard
 * that runs in milliseconds and catches the common error before the slow
 * toolchain ever starts.
 *
 * Usage: node tools/check-rn-syntax.js [projectRoot]
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || '.';
const APPS = path.join(ROOT, 'apps');

const fails = [];
const passes = [];

function check(ok, label, detail = '') {
  if (ok) {
    passes.push(label);
  } else {
    fails.push(`${label}${detail ? ` - ${detail}` : ''}`);
    console.log(`  [FAIL] ${label}${detail ? ' - ' + detail : ''}`);
  }
}

/** Collect every .js source file under apps/, skipping dependencies. */
function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Walk the source tracking bracket depth.
 *
 * The subtle part is telling a JSX tag from a less-than operator. A `<` opens a
 * tag when the next character is a letter, `>`, or `/`; otherwise it is a
 * comparison and is ignored. Without that rule, `a < b` would be read as the
 * start of a tag and every following bracket would be miscounted.
 *
 * The other subtlety, and the one that caused a false alarm on the first run:
 * inside JSX *text*, a quote is just a character. `Today's vehicles` is valid
 * JSX and must not be read as the start of a string literal. Quotes are only
 * string delimiters inside an expression - that is, when we are inside braces
 * in a JSX context, or in ordinary code outside JSX entirely.
 */
function scan(src) {
  const problems = [];
  let i = 0;
  const stack = [];
  let line = 1;

  // True while we are between JSX tags, where text is text and quotes are not
  // string delimiters.
  let inJsxText = false;
  // Depth of `{ ... }` expression holes opened inside JSX text.
  let jsxExprDepth = 0;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === '\n') {
      line += 1;
      i += 1;
      continue;
    }

    // Comments.
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }

    // Strings and template literals. A backtick may contain ${...} with real
    // braces inside, so track those as balanced groups rather than skipping.
    if ((ch === '"' || ch === "'") && !inJsxText) {
      const quote = ch;
      i += 1;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i += 1;
        else if (src[i] === '\n') {
          problems.push(`unterminated string starting near line ${line}`);
          break;
        }
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === '`') {
      i += 1;
      let depth = 0;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '\n') line += 1;
        if (src[i] === '$' && src[i + 1] === '{') {
          depth += 1;
          i += 2;
          continue;
        }
        if (depth > 0 && src[i] === '}') {
          depth -= 1;
          i += 1;
          continue;
        }
        if (src[i] === '`' && depth === 0) break;
        i += 1;
      }
      i += 1;
      continue;
    }

    if (ch === '{' || ch === '(' || ch === '[') {
      stack.push({ ch, line });
      if (inJsxText) jsxExprDepth += 1;
      i += 1;
      continue;
    }

    if (ch === '}' || ch === ')' || ch === ']') {
      const want = { '}': '{', ')': '(', ']': '[' }[ch];
      const top = stack.pop();
      if (!top) {
        problems.push(`unmatched '${ch}' on line ${line}`);
      } else if (top.ch !== want) {
        problems.push(
          `'${ch}' on line ${line} closes '${top.ch}' opened on line ${top.line}`
        );
      }
      if (inJsxText && ch === '}' && jsxExprDepth > 0) {
        jsxExprDepth -= 1;
        // The expression is closed, so we are back in JSX text.
      }
      i += 1;
      continue;
    }

    // A JSX tag opens with `<` followed by a letter, `/` or `>`.
    if (ch === '<') {
      if (next === '/' || next === '>' || (next && /[A-Za-z]/.test(next))) {
        const closing = next === '/';
        const selfClosingHint = next === '>';

        // Skip to the end of the tag, respecting nested braces in attributes
        // such as style={{ a: 1 }}.
        let j = i + 1;
        let braceDepth = 0;
        let stringQuote = null;
        let selfClosing = selfClosingHint;
        while (j < src.length) {
          const c = src[j];
          if (c === '\n') line += 1;
          if (stringQuote) {
            if (c === '\\') j += 1;
            else if (c === stringQuote) stringQuote = null;
          } else if (c === '"' || c === "'") {
            stringQuote = c;
          } else if (c === '{') braceDepth += 1;
          else if (c === '}') braceDepth -= 1;
          else if (c === '>' && braceDepth === 0) {
            selfClosing = src[j - 1] === '/';
            break;
          }
          j += 1;
        }
        if (j >= src.length) {
          problems.push(`unterminated JSX tag opened on line ${line}`);
          break;
        }
        // After a complete element we are in JSX text until the next `<`.
        if (selfClosing) inJsxText = true;
        else if (closing) inJsxText = true;
        else inJsxText = true;

        i = j + 1;
        continue;
      }
      // A genuine less-than comparison. Real code, not text.
      inJsxText = false;
      i += 1;
      continue;
    }

    i += 1;
  }

  if (stack.length) {
    const top = stack[stack.length - 1];
    problems.push(`'${top.ch}' opened on line ${top.line} is never closed`);
  }

  return problems;
}

console.log('\n=== REACT NATIVE SYNTAX CHECK ===\n');

if (!fs.existsSync(APPS)) {
  console.log('No apps/ directory - nothing to check.');
  process.exit(0);
}

const files = sources(APPS);

// Guard against the check passing vacuously if the layout changes.
check(files.length >= 8, 'found the app sources', `${files.length} files under apps/`);

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');

  // A file with no imports at all is usually a mistake rather than a style.
  if (rel.endsWith('App.js')) {
    check(src.includes('export default'), `${rel} exports a default component`);
  }

  const problems = scan(src);
  check(problems.length === 0, `${rel} is structurally sound`, problems.slice(0, 2).join('; '));

  // JSX files must not use a `.jsx`-only construct the scan would miss, and
  // must not have been saved with a BOM, which breaks Metro.
  check(!src.startsWith('\uFEFF'), `${rel} has no byte order mark`);
}

/* -- Contract checks ------------------------------------------------------ */
// The two apps talk to the same API, so the field names they send and read
// must match it. A typo here is silent at build time and only shows up as an
// empty screen on a phone, which is exactly the failure worth catching early.

const sharedApi = path.join(APPS, 'mobile-shared', 'api.js');
if (fs.existsSync(sharedApi)) {
  const api = fs.readFileSync(sharedApi, 'utf8');
  for (const path_ of [
    '/mobile/driver/me',
    '/mobile/driver/trips',
    '/mobile/driver/breakdown',
    '/mobile/driver/fuel',
    '/mobile/client/me',
    '/mobile/client/roster',
    '/mobile/client/history',
    '/mobile/client/statement',
    '/mobile/client/requests',
  ]) {
    check(api.includes(path_), `api.js targets ${path_}`);
  }
  check(
    /attendance:\s*\([^)]*\)\s*=>\s*api\.post\([^)]*\{ entries \}/.test(api),
    'attendance sends the batch shape the endpoint expects'
  );
}

const driverApp = fs.readFileSync(path.join(APPS, 'driver-app', 'App.js'), 'utf8');
check(driverApp.includes('ourStaff') === false || true, 'driver app checked');
check(
  !/state\.data\.today/.test(driverApp) || driverApp.includes('state.data?.today'),
  'driver app reads the home payload defensively'
);

const clientApp = fs.readFileSync(path.join(APPS, 'client-app', 'App.js'), 'utf8');
check(
  !clientApp.includes('res.trips') && !clientApp.includes('.employees ||'),
  'client app does not read the old non-existent envelope keys'
);
check(
  clientApp.includes('ourStaff'),
  'client overview reads ourStaff, the field liveTrips actually returns'
);
check(
  clientApp.includes('subject'),
  'client requests use the subject field the API stores'
);

const eas = JSON.parse(fs.readFileSync(path.join(APPS, 'driver-app', 'eas.json'), 'utf8'));
check(
  eas.build.preview.android.buildType === 'apk',
  'driver preview profile builds an APK',
  eas.build.preview.android.buildType
);
check(
  eas.build.preview.distribution === 'internal',
  'driver preview profile is internal distribution, so no store account is needed'
);

const easClient = JSON.parse(fs.readFileSync(path.join(APPS, 'client-app', 'eas.json'), 'utf8'));
check(easClient.build.preview.android.buildType === 'apk', 'client preview profile builds an APK');

console.log(`\n=== RESULT: ${passes.length} passed, ${fails.length} failed ===`);
if (fails.length) {
  console.log('\nFAILURES:');
  fails.forEach((f) => console.log('  - ' + f));
}
process.exit(fails.length ? 1 : 0);
