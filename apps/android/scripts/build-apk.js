const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const androidRoot = path.resolve(__dirname, '..');
const nativeAndroidDir = path.join(androidRoot, 'android');
const distDir = path.join(androidRoot, 'dist');

function run() {
  console.log('====================================================');
  console.log(' Building LazyTerminal Standalone Android APK');
  console.log('====================================================');

  // 1. Ensure native Android project exists via expo prebuild
  if (!fs.existsSync(nativeAndroidDir)) {
    console.log('[Android Build] Native android directory missing. Running expo prebuild...');
    try {
      execSync('npx expo prebuild --platform android --no-install', {
        cwd: androidRoot,
        stdio: 'inherit',
      });
    } catch (err) {
      console.error('[Android Build Error] expo prebuild failed:', err.message);
      process.exit(1);
    }
  }

  // 2. Check environment prerequisites: Java and Android SDK
  const hasJava = (() => {
    try {
      execSync('javac -version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const hasAndroidSdk = Boolean(androidHome && fs.existsSync(androidHome));

  if (!hasJava || !hasAndroidSdk) {
    console.error('----------------------------------------------------');
    console.error('[Android Build Blocker] Required build tools missing:');
    if (!hasJava) {
      console.error(' - Java Development Kit (JDK 17+) is not installed or not in PATH.');
    }
    if (!hasAndroidSdk) {
      console.error(' - ANDROID_HOME environment variable is not set or directory does not exist.');
    }
    console.error('----------------------------------------------------');
    console.error('Local Environment Notice:');
    console.error('The local machine lacks the Android SDK / Java build toolchain.');
    console.error('Standalone APK builds are fully automated in GitHub Actions CI (.github/workflows/release.yml),');
    console.error('which runs on an Ubuntu runner pre-equipped with Java 17 and the Android SDK.');
    console.error('----------------------------------------------------');
    process.exit(1);
  }

  // 3. Execute Gradle build using wrapper
  const isWindows = process.platform === 'win32';
  const gradlewCmd = isWindows ? 'gradlew.bat' : './gradlew';

  // Make gradlew executable on POSIX systems
  if (!isWindows) {
    try {
      execSync(`chmod +x ${path.join(nativeAndroidDir, 'gradlew')}`, { stdio: 'ignore' });
    } catch {
      // ignore
    }
  }

  // Build target: assembleRelease if keystore configured, else assembleDebug for installable APK
  const hasSigningKey = Boolean(process.env.ANDROID_KEYSTORE_BASE64 || process.env.RELEASE_KEYSTORE_PATH);
  const buildTask = hasSigningKey ? 'assembleRelease' : 'assembleDebug';

  console.log(`[Android Build] Running ${gradlewCmd} ${buildTask}...`);
  try {
    execSync(`${gradlewCmd} ${buildTask}`, {
      cwd: nativeAndroidDir,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('[Android Build Error] Gradle build failed:', err.message);
    process.exit(1);
  }

  // 4. Locate and export generated APK
  const apkSearchDirs = [
    path.join(nativeAndroidDir, 'app', 'build', 'outputs', 'apk', 'release'),
    path.join(nativeAndroidDir, 'app', 'build', 'outputs', 'apk', 'debug'),
  ];

  let foundApk = null;
  for (const dir of apkSearchDirs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      const apk = files.find((f) => f.endsWith('.apk') && !f.includes('-unaligned'));
      if (apk) {
        foundApk = path.join(dir, apk);
        break;
      }
    }
  }

  if (!foundApk) {
    console.error('[Android Build Error] Build succeeded but could not locate output .apk file.');
    process.exit(1);
  }

  fs.mkdirSync(distDir, { recursive: true });
  const targetApk = path.join(distDir, 'LazyTerminal.apk');
  fs.copyFileSync(foundApk, targetApk);

  const stat = fs.statSync(targetApk);
  console.log('====================================================');
  console.log(`[Android Build Success] Standalone APK generated cleanly:`);
  console.log(` Path: ${targetApk}`);
  console.log(` Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB (${stat.size} bytes)`);
  console.log(` Build Type: ${hasSigningKey ? 'Release (Signed)' : 'Preview/Debug (Installable)'}`);
  console.log('====================================================');
}

run();
