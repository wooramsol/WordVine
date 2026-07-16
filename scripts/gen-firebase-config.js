// Firebase 웹앱 설정(firebase-config.js) 생성
// - 웹앱이 없으면 만들고, sdkconfig를 받아 public/firebase-config.js로 저장
// CI(GitHub Actions)에서 GOOGLE_APPLICATION_CREDENTIALS와 함께 실행됨
const { execSync } = require('child_process');
const fs = require('fs');

const PROJECT = process.env.FIREBASE_PROJECT || 'wordbaduk';

function fb(cmd) {
  return execSync(`firebase ${cmd} --project ${PROJECT} --json`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parse(out) {
  // firebase --json 출력에서 JSON 부분만 추출
  const start = out.indexOf('{');
  return JSON.parse(out.slice(start));
}

// 1) 웹앱 찾기 (없으면 생성)
let appId = null;
try {
  const j = parse(fb('apps:list WEB'));
  const apps = j.result || [];
  if (apps.length) appId = apps[0].appId;
} catch (e) {
  console.log('apps:list 실패(무시):', e.message.slice(0, 200));
}
if (!appId) {
  console.log('웹앱이 없어 새로 생성합니다…');
  const j = parse(fb('apps:create WEB WordBaduk'));
  appId = j.result?.appId || j.result?.app?.appId;
}
if (!appId) throw new Error('웹앱 ID를 얻지 못했습니다.');
console.log('웹앱:', appId);

// 2) SDK 설정 받기
const j = parse(fb(`apps:sdkconfig WEB ${appId}`));
const cfg = j.result?.sdkConfig || j.result;
if (!cfg || !cfg.apiKey) {
  throw new Error('sdkconfig 파싱 실패: ' + JSON.stringify(j).slice(0, 300));
}
if (!cfg.databaseURL) {
  throw new Error(
    'databaseURL이 없습니다. Firebase 콘솔 → Realtime Database → "데이터베이스 만들기"를 먼저 실행하세요.'
  );
}

// 3) 파일 생성
fs.writeFileSync(
  'public/firebase-config.js',
  'window.FIREBASE_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n'
);
console.log('public/firebase-config.js 생성 완료:', cfg.projectId, cfg.databaseURL);
