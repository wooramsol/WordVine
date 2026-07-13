# WordVine — 무한 십자낱말

모두가 함께 하나의 보드를 끝없이 채워가는 십자낱말 + 끝말잇기 웹게임.
보드는 Firebase Realtime Database에 영구 저장되어 지워지지 않고 계속 자란다.

## 구조 (Firebase)

- **Hosting**: `public/` (게임 페이지 + 사전 `words.txt`)
- **Realtime Database**: 보드 상태(`/board`), 접속자(`/presence`)
  - 실시간 리스너로 다른 유저의 단어가 즉시 반영됨
  - 배치는 RTDB 트랜잭션으로 처리해 동시 입력 경합에도 안전
- 서버 코드 없음 — 검증(사전·두음법칙)은 클라이언트 + 트랜잭션 재검증

## 배포 (GitHub Actions 자동)

`main`에 푸시하면 `.github/workflows/deploy.yml`이 자동으로 Firebase에 배포한다.

필요한 설정 (1회):
1. Firebase 콘솔에서 **Realtime Database 생성** (Build → Realtime Database → 데이터베이스 만들기)
2. GitHub 레포 **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키(JSON) 내용

배포 시 `scripts/gen-firebase-config.js`가 웹앱 등록과 `public/firebase-config.js` 생성을 자동 처리한다.

## 로컬 실행

배포된 DB를 그대로 쓰면서 페이지만 로컬로 띄우기:

```bash
# public/firebase-config.js가 필요 (배포 후 호스팅에서 받아오거나 CI 아티팩트 사용)
npx serve public   # 또는 python3 -m http.server -d public 8000
```

## 게임 규칙

- **사전 검증**: 명사 203,021개(`public/words.txt`)에 있는 단어만 가능
  (표준국어대사전 + hunspell-dict-ko 병합, 옛말·북한어·방언 제외)
- **두음법칙**: 기존 글자에서 시작할 때 첫 글자의 두음 변환형 인정 (ㄹ→ㄴ/ㅇ, ㄴ→ㅇ)
  - 원형 입력: '력' 칸에서 '력사' 입력 → '역사'로 인정
  - 변환형 입력: '립' 칸을 클릭해 '입구'라고 입력해도 인정 (그리드에는 '립구'로 표기)
- **방향 제한 없음**: 가로·세로 어느 칸에서든 같은 방향으로 계속 이어 쓸 수 있음
  (예전엔 가로 단어는 세로에서만 이을 수 있었지만, 이제는 그 제한이 없음)
- **단어 중복 금지**: 보드 전체에서 같은 단어(두음법칙 인정형 기준)는 한 번만 쓸 수 있음
- **병합/분리 판독**: 같은 줄에 붙은 기존 글자는 합쳐 읽을 수도, 분리해 읽을 수도 있음.
  [앞글자+입력+뒷글자, 앞글자+입력, 입력+뒷글자, 입력] 순(긴 판독부터)으로 검사해
  규칙과 사전을 만족하는 첫 판독을 채택
- 교차 글자는 일치해야 하고, 최소 한 글자는 기존 단어와 이어져야 함 (첫 단어 예외)
- 완성 단어 기준 2~15글자

## 조작

- 셀 클릭 → 단어 입력 (가로/세로 선택, 일부 글자만 입력해도 자동 판독)
- 방향키로 선택 칸 이동, Tab으로 가로/세로 전환
- 드래그로 이동, 휠로 확대/축소, Enter 한 번으로 제출
- 미리보기: 파랑 = 새 글자, 초록 = 함께 읽히는 기존 글자, 빨강 = 충돌

## 알려진 한계 (프로토타입)

- 검증이 클라이언트에서 수행되므로 악의적 유저가 DB에 직접 쓰는 것까지 막지는 못함
  (강화하려면 Cloud Functions 검증 + 규칙 잠금으로 이전)
- 보드가 커지면 트랜잭션이 전체 보드를 전송하므로 규모 확장 시 셀 단위 구조로 개편 필요
