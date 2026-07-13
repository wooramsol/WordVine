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

// 운영 배포 전에 반드시 별도 값으로 설정 권장:
//   firebase functions:config:set identify.salt="충분히 긴 랜덤 문자열" --project <프로젝트ID>
// 설정하지 않으면 아래 기본값을 쓰는데, 기본값은 소스에 공개되어 있어 안전하지 않다.
const SALT = (functions.config().identify && functions.config().identify.salt) || 'nakmal-baduk-default-salt-change-me';

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
