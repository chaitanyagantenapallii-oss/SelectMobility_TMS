#!/usr/bin/env node
'use strict';

/**
 * Build a signed release APK for a mobile app - directly from its source folder.
 *
 * Why this exists
 * ---------------
 * The apps used to be copied into a separate tree (C:\Users\Chait\eas-builds)
 * before building, because Metro walked up from apps/<app> and mistook the
 * repository root for the project root. That copy step meant two copies of every
 * source file, and edits silently did nothing until someone remembered to sync.
 *
 * Both causes are now fixed at the source:
 *   - apps/<app>/metro.config.js pins the Metro project root, so the app builds
 *     correctly from where it lives.
 *   - this script re-applies the release signing configuration after prebuild,
 *     which is the only thing a fresh `expo prebuild` does not produce.
 *
 * So there is one master copy of each app: apps/<app>. Edit it, run this script,
 * get an APK. Nothing to sync.
 *
 * Usage
 * -----
 *   node tools/build-apk.js driver
 *   node tools/build-apk.js client
 *   node tools/build-apk.js driver --clean      # regenerate android/ first
 *   node tools/build-apk.js driver --prebuild   # force prebuild
 *
 * Environment overrides: SMI_KEYSTORE, SMI_KEYSTORE_PASSWORD, SMI_KEY_ALIAS.
 */

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPS_DIR = path.join(ROOT, 'apps');
const OUTPUT_DIR = path.join(ROOT, 'SMI-APKs');

const JAVA_HOME = process.env.JAVA_HOME || 'C:\\Program Files\\Microsoft\\jdk-17.0.20.101-hotspot';
const ANDROID_HOME = process.env.ANDROID_HOME || 'C:\\Android\\Sdk';

/*
 * The keystore lives outside the repository on purpose: it is the apps' identity
 * (losing it means no future build can update an installed app in place), and a
 * file that important should not sit in a working tree that gets copied around.
 */
const KEYSTORE = process.env.SMI_KEYSTORE || 'C:\\Users\\Chait\\.smi-keys\\selectmobility-release.keystore';
const KEYSTORE_PASSWORD = process.env.SMI_KEYSTORE_PASSWORD || 'selectmobility2026';
const KEY_ALIAS = process.env.SMI_KEY_ALIAS || 'selectmobility';

const APPS = {
  driver: { dir: 'driver-app', name: 'smi-driver', label: 'SMI Driver' },
  client: { dir: 'client-app', name: 'smi-client', label: 'SMI Client' },
  employee: { dir: 'employee-app', name: 'smi-employee', label: 'SMI Employee' },
};

/* -------------------------------------------------------------------------- */

function log(msg) { console.log(msg); }
function step(msg) { console.log(`\n=== ${msg} ===`); }

function die(msg) {
  console.error(`\nFAILED: ${msg}\n`);
  process.exit(1);
}

function run(cmd, args, cwd, env = {}) {
  return execFileSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
}

/** Read a value out of an app's app.json - the single source of version truth. */
function readAppConfig(appDir) {
  const cfg = JSON.parse(fs.readFileSync(path.join(appDir, 'app.json'), 'utf8'));
  return cfg.expo || {};
}

/* --- Native project generation -------------------------------------------- */

function ensurePrebuild(appDir, { clean, force }) {
  const androidDir = path.join(appDir, 'android');

  if (clean && fs.existsSync(androidDir)) {
    step('Removing existing android/ (--clean)');
    fs.rmSync(androidDir, { recursive: true, force: true });
  }

  if (force && fs.existsSync(androidDir)) {
    step('Removing existing android/ (--prebuild)');
    fs.rmSync(androidDir, { recursive: true, force: true });
  }

  if (fs.existsSync(androidDir)) {
    log('android/ already exists - reusing it. Pass --prebuild to regenerate.');
    return;
  }

  step('Generating the native project (expo prebuild)');
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install'], appDir, {
    CI: '1',
    EXPO_OFFLINE: '1',
  });
}

/* --- Signing -------------------------------------------------------------- */

const RELEASE_SIGNING_BLOCK = `
        release {
            // Release credentials come from gradle.properties, which this script
            // writes from the keystore path below, so no password is committed
            // to the repository.
            if (project.hasProperty('SMI_RELEASE_STORE_FILE')) {
                storeFile file(project.property('SMI_RELEASE_STORE_FILE'))
                storePassword project.property('SMI_RELEASE_STORE_PASSWORD')
                keyAlias project.property('SMI_RELEASE_KEY_ALIAS')
                keyPassword project.property('SMI_RELEASE_KEY_PASSWORD')
            }
        }`;

/**
 * Teach the generated project to sign with the real release key.
 *
 * `expo prebuild` always emits a project whose release build is signed with the
 * debug keystore. A debug-signed APK installs fine but cannot later be updated
 * over a release-signed one, so this has to be corrected on every regeneration.
 *
 * Every patch fails loudly rather than silently leaving a debug-signed build.
 */
function patchSigning(appDir) {
  const gradlePath = path.join(appDir, 'android', 'app', 'build.gradle');
  let src = fs.readFileSync(gradlePath, 'utf8');

  if (src.includes('SMI_RELEASE_STORE_FILE')) {
    log('Signing already configured in build.gradle.');
  } else {
    step('Adding the release signing config to build.gradle');

    // 1. Add a `release` block inside signingConfigs, after the debug one.
    const signingRe = /(signingConfigs\s*\{\s*debug\s*\{[\s\S]*?\n\s*\}\n)(\s*\})/;
    if (!signingRe.test(src)) {
      die('Could not find the signingConfigs block in android/app/build.gradle. '
        + 'Expo\'s template may have changed - update tools/build-apk.js.');
    }
    src = src.replace(signingRe, `$1${RELEASE_SIGNING_BLOCK}\n$2`);
  }

  // 2. Point the release build type at the release key when it is available.
  //    There are two `signingConfig signingConfigs.debug` lines - one in the
  //    debug build type, one in release. Only the second should change, so the
  //    last occurrence is the one to replace.
  const marker = 'signingConfig signingConfigs.debug';
  const last = src.lastIndexOf(marker);
  // Newer Expo templates already use the conditional release/debug form.
  // Leave that generated configuration intact instead of treating it as stale.
  if (last === -1 && src.includes("signingConfig project.hasProperty('SMI_RELEASE_STORE_FILE')")) {
    log('Release signing config already selects the release key when configured.');
    return;
  }
  if (last === -1) {
    die('Could not find the release signingConfig line in android/app/build.gradle.');
  }
  const alreadyConditional = src.slice(last - 120, last).includes('project.hasProperty');
  if (!alreadyConditional) {
    const conditional = 'signingConfig project.hasProperty(\'SMI_RELEASE_STORE_FILE\') '
      + '? signingConfigs.release : signingConfigs.debug';
    src = src.slice(0, last) + conditional + src.slice(last + marker.length);
  }

  fs.writeFileSync(gradlePath, src);
  log('build.gradle updated.');
}

/** Put the keystore path and credentials where build.gradle expects them. */
function patchGradleProperties(appDir) {
  const propsPath = path.join(appDir, 'android', 'gradle.properties');
  let props = fs.readFileSync(propsPath, 'utf8');

  if (props.includes('SMI_RELEASE_STORE_FILE')) {
    log('gradle.properties already has the signing properties.');
    return;
  }

  step('Writing signing properties to gradle.properties');
  props += [
    '',
    '# --- Release signing ---------------------------------------------------',
    '# Written by tools/build-apk.js. Points at the keystore that defines these',
    '# apps\' identity, deliberately kept outside the repository.',
    `SMI_RELEASE_STORE_FILE=${KEYSTORE.replace(/\\/g, '/')}`,
    `SMI_RELEASE_STORE_PASSWORD=${KEYSTORE_PASSWORD}`,
    `SMI_RELEASE_KEY_ALIAS=${KEY_ALIAS}`,
    `SMI_RELEASE_KEY_PASSWORD=${KEYSTORE_PASSWORD}`,
    '',
  ].join('\n');

  fs.writeFileSync(propsPath, props);
  log(`Keystore: ${KEYSTORE}`);
}

/* --- Build ---------------------------------------------------------------- */

function gradleBuild(appDir) {
  step('Building the release APK (this takes several minutes)');
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  run(gradlew, ['assembleRelease', '--no-daemon'], path.join(appDir, 'android'), {
    JAVA_HOME,
    ANDROID_HOME,
  });
}

/** Locate aapt so the built APK can be inspected rather than trusted. */
function findAapt() {
  const buildTools = path.join(ANDROID_HOME, 'build-tools');
  if (!fs.existsSync(buildTools)) return null;
  const versions = fs.readdirSync(buildTools).sort().reverse();
  for (const v of versions) {
    const exe = path.join(buildTools, v, process.platform === 'win32' ? 'aapt.exe' : 'aapt');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

/**
 * Verify the APK against app.json.
 *
 * The version used to drift: editing app.json alone left the old versionCode in
 * a pre-generated native project. Building in place fixes that, and this check
 * makes any future drift impossible to ship unnoticed.
 */
function verify(apkPath, expected) {
  const aapt = findAapt();
  if (!aapt) {
    log('aapt not found - skipping APK verification.');
    return true;
  }
  const out = execFileSync(aapt, ['dump', 'badging', apkPath], { encoding: 'utf8' });
  const pkg = (out.match(/^package: (.*)$/m) || [])[1] || '';
  const versionCode = (pkg.match(/versionCode='(\d+)'/) || [])[1];
  const versionName = (pkg.match(/versionName='([^']*)'/) || [])[1];

  step('Verifying the built APK');
  log(`  versionCode : ${versionCode} (expected ${expected.android && expected.android.versionCode})`);
  log(`  versionName : ${versionName} (expected ${expected.version})`);

  const wantCode = String((expected.android && expected.android.versionCode) || '');
  const ok = versionCode === wantCode && versionName === expected.version;
  if (!ok) {
    die(`The APK reports ${versionName} (${versionCode}) but app.json says `
      + `${expected.version} (${wantCode}). The native project is stale - rebuild with --prebuild.`);
  }
  log('  Version matches app.json.');
  return true;
}

/* --- Main ----------------------------------------------------------------- */

function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  const clean = args.includes('--clean');
  const forcePrebuild = args.includes('--prebuild');

  if (!target || !APPS[target]) {
    log('Usage: node tools/build-apk.js <driver|client> [--clean] [--prebuild]');
    process.exit(1);
  }

  const app = APPS[target];
  const appDir = path.join(APPS_DIR, app.dir);

  log(`\n=== Building ${app.label} from ${appDir} ===`);

  if (!fs.existsSync(appDir)) die(`App folder not found: ${appDir}`);
  if (!fs.existsSync(path.join(appDir, 'node_modules'))) {
    die(`${appDir}/node_modules is missing. Run:\n`
      + `  cd apps/${app.dir} && npm install --legacy-peer-deps --no-audit --no-fund --ignore-scripts`);
  }
  if (!fs.existsSync(path.join(appDir, 'metro.config.js'))) {
    log('WARNING: metro.config.js is missing. Metro may mistake the repository '
      + 'root for the project root and fail to bundle.');
  }
  if (!fs.existsSync(KEYSTORE)) {
    die(`Keystore not found at ${KEYSTORE}.\n`
      + 'Without it the APK would be debug-signed and could not update an '
      + 'existing install. Set SMI_KEYSTORE to its real location.');
  }

  const appConfig = readAppConfig(appDir);
  log(`Version: ${appConfig.version} (versionCode ${appConfig.android && appConfig.android.versionCode})`);

  ensurePrebuild(appDir, { clean, force: forcePrebuild });
  patchSigning(appDir);
  patchGradleProperties(appDir);
  gradleBuild(appDir);

  const built = path.join(appDir, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  if (!fs.existsSync(built)) die(`Gradle reported success but no APK was produced at ${built}`);

  verify(built, appConfig);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const named = path.join(OUTPUT_DIR, `${app.name}-v${appConfig.version}.apk`);
  fs.copyFileSync(built, named);

  step('Done');
  log(`  APK     : ${named}`);
  log(`  Size    : ${(fs.statSync(named).size / 1024 / 1024).toFixed(1)} MB`);
  log(`  Source  : ${appDir}`);
  log('');
}

main();
