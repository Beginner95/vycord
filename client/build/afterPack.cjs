// electron-builder кладёт NS*UsageDescription (mac.extendInfo) только в Info.plist
// главного приложения. Камеру и микрофон в Chromium открывают хелперы Electron
// (Video Capture / Audio — utility-процессы), и macOS убивает процесс через
// SIGABRT, если в его собственном bundle нет описания причины доступа:
// video_capture.mojom.VideoCaptureService падал с exitCode 6 при входе в звонок.
const fs = require('node:fs');
const path = require('node:path');

const USAGE_KEYS = ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription'];

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function withUsageKeys(plistXml, entries) {
  const missing = entries.filter(([key]) => !plistXml.includes(`<key>${key}</key>`));
  if (missing.length === 0) return plistXml;

  const closing = plistXml.lastIndexOf('</dict>');
  if (closing === -1) throw new Error('Info.plist has no closing </dict>');

  const inserted = missing
    .map(([key, text]) => `\t<key>${key}</key>\n\t<string>${escapeXml(text)}</string>\n`)
    .join('');
  return plistXml.slice(0, closing) + inserted + plistXml.slice(closing);
}

function patchHelperPlists(appPath, entries) {
  const frameworksDir = path.join(appPath, 'Contents', 'Frameworks');
  const helpers = fs.readdirSync(frameworksDir).filter((name) => /Helper.*\.app$/.test(name));
  if (helpers.length === 0) throw new Error(`no Helper apps found in ${frameworksDir}`);

  for (const helper of helpers) {
    const plistPath = path.join(frameworksDir, helper, 'Contents', 'Info.plist');
    const original = fs.readFileSync(plistPath, 'utf8');
    if (original.startsWith('bplist')) throw new Error(`${plistPath} is a binary plist`);
    fs.writeFileSync(plistPath, withUsageKeys(original, entries));
  }
  return helpers;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const extendInfo = context.packager.config.mac?.extendInfo ?? {};
  const entries = USAGE_KEYS.map((key) => [key, extendInfo[key]]);
  const absent = entries.filter(([, text]) => !text).map(([key]) => key);
  if (absent.length > 0) throw new Error(`mac.extendInfo is missing ${absent.join(', ')}`);

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  patchHelperPlists(appPath, entries);
};

exports.patchHelperPlists = patchHelperPlists;
exports.withUsageKeys = withUsageKeys;
