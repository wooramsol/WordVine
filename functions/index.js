/**
 * 낱말바둑 - IP 기반 익명 플레이어 ID 발급
 *
 * 클라이언트는 접속할 때마다 /api/identify 를 호출해서 자신의 ID를 받는다.
 * 실제 IP 주소는 이 함수 안에서만 잠깐 쓰이고, 클라이언트나 DB 어디에도
 * 저장되지 않는다 — 서버 전용 SALT로 HMAC 해시를 만들어 짧은 익명 ID만 응답한다.
 * 같은 공인 IP(같은 와이파이/같은 통신사 NAT 등)를 쓰는 사람은 같은 ID로 묶이고,
 * 네트워크를 바꾸면(와이파이<->모바일데이터, VPN 등) 다른 ID가 된다.
 */
const functions = require('firebase-functions');
const crypto = require('crypto');

// firebase functions:config:set 은 2025년 말부로 셧다운된 구식 API라 여기선 쓰지 않는다.
// 대신 functions/.env (배포 시 함께 업로드됨)의 IDENTIFY_SALT 환경변수를 사용.
// .env가 없으면(로컬 테스트, 시크릿 미설정 등) 아래 기본값으로 폴백 — 운영에서는
// 반드시 별도 값을 functions/.env에 IDENTIFY_SALT=... 형태로 설정할 것.
const SALT = process.env.IDENTIFY_SALT || 'nakmal-baduk-default-salt-change-me';

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
}

exports.identify = functions.https.onRequest((req, res) => {
  res.set('Cache-Control', 'no-store');
  const ip = clientIp(req);
  const hash = crypto.createHmac('sha256', SALT).update(ip).digest('hex').slice(0, 10);
  res.json({ id: 'P-' + hash });
});
