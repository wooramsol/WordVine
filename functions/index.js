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

/**
 * 낱말바둑 - 회원 계정 (닉네임+비밀번호+아이콘)
 *
 * 비회원(과일)과 별개로, 닉네임/비밀번호로 로그인하는 회원 계정을 제공한다.
 * 비밀번호는 클라이언트나 DB에 평문으로 남지 않는다 — 이 함수 안에서만 Node
 * 내장 crypto.scrypt로 솔트+해시를 만들어 members/{uid}에 저장하고, 로그인 시엔
 * 같은 방식으로 해시를 다시 계산해 timingSafeEqual로 비교한다.
 * 로그인/가입에 성공하면 그 uid를 그대로 응답에 실어 보내고, 클라이언트는 그 uid를
 * localStorage에 저장해 계속 그 uid로 접속한다 — 이 uid가 곧 게임 안에서의 clientId가
 * 됨(presence/board 등 기존 구조를 그대로 재사용). 처음엔 Firebase Auth 커스텀 토큰으로
 * 진짜 로그인 세션을 만들려 했지만, 이 프로젝트의 identify()처럼 애초에 clientId를
 * "서버가 확인해준 문자열"로만 취급하고 RTDB 규칙도 clientId별로 잠그지 않는 구조라
 * 커스텀 토큰이 주는 이점이 없고, 오히려 배포 환경의 IAM 권한(서비스 계정에
 * Service Account Token Creator 롤 필요) 문제로 실패하기 쉬워 제거함.
 *
 * members/{uid}         : { nickname, iconIdx, passwordHash, createdAt } — 비공개(admin 전용)
 * memberNicknames/{nick}: uid — 닉네임 중복 방지용 색인(소문자), 비공개(admin 전용)
 * memberProfiles/{uid}  : { nickname, iconIdx } — 공개 읽기(다른 플레이어에게 이름/아이콘 표시용)
 */
const admin = require('firebase-admin');
admin.initializeApp();

const NICKNAME_RE = /^[가-힣A-Za-z0-9]{2,10}$/;
// 클라이언트 index.html의 ICONS 배열과 개수가 반드시 같아야 함(둘 중 하나만 바꾸면 어긋남)
const ICON_COUNT = 42;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  let candidate, expected;
  try {
    candidate = crypto.scryptSync(password, salt, 64);
    expected = Buffer.from(hash, 'hex');
  } catch { return false; }
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

exports.signup = functions.https.onRequest(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: '허용되지 않은 요청이에요.' }); return; }
  const { nickname, password, iconIdx } = req.body || {};
  if (typeof nickname !== 'string' || !NICKNAME_RE.test(nickname)) {
    res.status(400).json({ error: '닉네임은 한글/영문/숫자 2~10자로 입력해주세요.' }); return;
  }
  if (typeof password !== 'string' || password.length < 4 || password.length > 30) {
    res.status(400).json({ error: '비밀번호는 4~30자로 입력해주세요.' }); return;
  }
  if (!Number.isInteger(iconIdx) || iconIdx < 0 || iconIdx >= ICON_COUNT) {
    res.status(400).json({ error: '아이콘을 선택해주세요.' }); return;
  }

  const nicknameLower = nickname.toLowerCase();
  const db = admin.database();
  const uid = db.ref('members').push().key;

  try {
    // 닉네임 색인을 트랜잭션으로 선점 — 이미 누가 쓰고 있으면(cur !== null) 그대로 두고
    // 실패 처리해서, 동시에 같은 닉네임으로 가입해도 한쪽만 성공하게 함
    const claim = await db.ref('memberNicknames/' + nicknameLower).transaction(cur => {
      if (cur !== null && cur !== undefined) return; // abort — 이미 사용 중
      return uid;
    });
    if (!claim.committed || claim.snapshot.val() !== uid) {
      res.status(409).json({ error: '이미 사용 중인 닉네임이에요.' }); return;
    }

    const passwordHash = hashPassword(password);
    await Promise.all([
      db.ref('members/' + uid).set({
        nickname, iconIdx, passwordHash, createdAt: admin.database.ServerValue.TIMESTAMP,
      }),
      db.ref('memberProfiles/' + uid).set({ nickname, iconIdx }),
    ]);

    res.json({ uid, nickname, iconIdx });
  } catch (e) {
    console.error('signup 실패:', e);
    res.status(500).json({ error: '가입 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.' });
  }
});

/**
 * 회원 탈퇴 — 비밀번호를 다시 확인한 뒤 members/memberNicknames/memberProfiles/
 * memberTotalScore에서 그 uid 관련 데이터를 전부 지운다. 애플 심사 가이드라인
 * 5.1.1(v)(앱 안에서 계정 삭제를 시작할 수 있어야 함) 대응용.
 * 이미 놓은 낱말/포획 영역(board.cells)은 지우지 않음 — 게임판은 다른 사람들과
 * 공유하는 공용 상태라 회원 개인 데이터로 보지 않고, 어차피 다음 판 재시작 때
 * 자연히 사라짐(low-stakes 신뢰 모델 유지).
 */
exports.deleteAccount = functions.https.onRequest(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: '허용되지 않은 요청이에요.' }); return; }
  const { uid, password } = req.body || {};
  if (typeof uid !== 'string' || !uid || typeof password !== 'string' || !password) {
    res.status(400).json({ error: '잘못된 요청이에요.' }); return;
  }

  const db = admin.database();
  const WRONG = '비밀번호가 올바르지 않아요.';
  try {
    const memberSnap = await db.ref('members/' + uid).once('value');
    const member = memberSnap.val();
    if (!member || !verifyPassword(password, member.passwordHash)) {
      res.status(401).json({ error: WRONG }); return;
    }
    const nicknameLower = String(member.nickname || '').toLowerCase();
    await Promise.all([
      db.ref('members/' + uid).remove(),
      db.ref('memberNicknames/' + nicknameLower).remove(),
      db.ref('memberProfiles/' + uid).remove(),
      db.ref('memberTotalScore/' + uid).remove(),
    ]);
    res.json({ ok: true });
  } catch (e) {
    console.error('deleteAccount 실패:', e);
    res.status(500).json({ error: '탈퇴 처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.' });
  }
});

exports.login = functions.https.onRequest(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: '허용되지 않은 요청이에요.' }); return; }
  const { nickname, password } = req.body || {};
  if (typeof nickname !== 'string' || typeof password !== 'string' || !nickname || !password) {
    res.status(400).json({ error: '닉네임과 비밀번호를 입력해주세요.' }); return;
  }

  const nicknameLower = nickname.toLowerCase();
  const db = admin.database();
  const WRONG = '닉네임 또는 비밀번호가 올바르지 않아요.';
  try {
    const uidSnap = await db.ref('memberNicknames/' + nicknameLower).once('value');
    const uid = uidSnap.val();
    if (!uid) { res.status(401).json({ error: WRONG }); return; }

    const memberSnap = await db.ref('members/' + uid).once('value');
    const member = memberSnap.val();
    if (!member || !verifyPassword(password, member.passwordHash)) {
      res.status(401).json({ error: WRONG }); return;
    }

    res.json({ uid, nickname: member.nickname, iconIdx: member.iconIdx });
  } catch (e) {
    console.error('login 실패:', e);
    res.status(500).json({ error: '로그인 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.' });
  }
});

/**
 * 푸시 알림 — 새 플레이어가 접속하면(presence/{clientId} 노드가 새로 생김) 등록된 다른
 * 기기들에 알림을 보낸다. 앱을 백그라운드/종료 상태로 둔 사람도 "누가 들어왔는지" 알고
 * 다시 들어와 같이 놀 수 있게 하려는 목적. 토큰은 pushTokens/{uid}에 클라이언트가 저장
 * (public/index.html의 setupPushNotifications, 네이티브 앱에서만 동작). 만료/무효
 * 토큰은 응답에서 걸러 그 자리에서 지워서 계속 실패하는 토큰이 쌓이지 않게 한다.
 */
exports.notifyOnJoin = functions.database.ref('/presence/{clientId}').onCreate(async (snap, context) => {
  const joinerId = context.params.clientId;
  const db = admin.database();
  const tokensSnap = await db.ref('pushTokens').once('value');
  const tokens = tokensSnap.val() || {};
  const entries = Object.entries(tokens).filter(([uid]) => uid !== joinerId);
  if (entries.length === 0) return null;

  let response;
  try {
    response = await admin.messaging().sendEachForMulticast({
      tokens: entries.map(([, t]) => t.token),
      notification: {
        title: '낱말바둑',
        body: '새로운 플레이어가 접속했어요! 함께 낱말바둑 해요 🍎',
      },
    });
  } catch (e) {
    console.error('notifyOnJoin 전송 실패:', e);
    return null;
  }

  const removals = [];
  response.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        removals.push(db.ref('pushTokens/' + entries[i][0]).remove());
      }
    }
  });
  if (removals.length) await Promise.all(removals);
  return null;
});
