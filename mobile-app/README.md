# 낱말바둑 모바일 앱 (Capacitor)

이 폴더는 기존 웹앱(`../public`, https://wordvine-6846a.web.app )을
Capacitor로 감싸서 iOS/Android 네이티브 앱으로 만든 프로젝트입니다.

## 동작 방식

`capacitor.config.json`의 `server.url`이 실제 배포된 사이트
(`https://wordvine-6846a.web.app`)를 가리키고 있습니다. 즉 앱은
웹뷰 안에서 이 URL을 바로 엽니다. 그래서:

- `public/index.html`을 고치고 `git push`만 하면(기존 GitHub Actions
  파이프라인) **앱도 즉시 최신 버전으로 반영**됩니다. 게임 로직/UI를
  고칠 때마다 앱스토어에 재제출할 필요가 없습니다.
- `/api/identify`, `firebase-config.js`, `words.txt` 등 상대경로
  fetch가 전부 그대로 작동합니다 (origin이 실제 사이트이기 때문).
- 앱스토어 재제출이 필요한 경우는 아이콘/스플래시/권한 등
  **네이티브 셸을 바꿀 때뿐**입니다.

## 아이콘/스플래시

`assets/icon-source.svg`로 만든 임시 플레이스홀더 아이콘입니다
(바둑판 + 돌 모티브, 초록 배경). iOS `AppIcon.appiconset`과 Android
`mipmap-*` 전부에 이미 반영돼 있습니다. 정식 배포 전에 실제
브랜드 아이콘으로 교체를 권장합니다. `assets/playstore-icon-512.png`,
`assets/feature-graphic-1024x500.png`는 각각 Play Console에
올리는 스토어 등록용 512x512 아이콘, 1024x500 피처 그래픽입니다
(앱 자체에는 포함 안 됨).

## iOS 빌드 (Mac 필요)

```bash
cd mobile-app
npm install
npx cap open ios
```

Xcode가 열리면:
1. 좌측 `App` 프로젝트 선택 → `Signing & Capabilities`에서
   본인 Apple Developer 팀(계정) 선택, Bundle Identifier는
   `com.wooramsol.wordvine` (그대로 써도 되고, 스토어 제출 전이라면
   원하는 값으로 바꿔도 됩니다 — 제출 후엔 변경 불가).
2. 상단 기기 선택에서 시뮬레이터 또는 실기기 선택 후 ▶ 실행해서
   먼저 동작 확인.
3. 문제 없으면 `Product → Archive` → Organizer에서
   `Distribute App → App Store Connect`로 업로드.
4. App Store Connect (appstoreconnect.apple.com)에서 새 앱 생성,
   스크린샷/설명/개인정보처리방침 URL 등 입력 후 심사 제출.

## Android 빌드

Mac이 아니어도 Android Studio(또는 CLI)만 있으면 됩니다.

```bash
cd mobile-app
npm install
npx cap open android
```

Android Studio에서:
1. `Build → Generate Signed Bundle / APK` → Android App Bundle(.aab)
   선택, 새 키스토어 생성(이 키스토어는 분실하면 이후 업데이트를
   같은 앱으로 못 올리니 안전한 곳에 백업 필수).
2. Google Play Console(play.google.com/console)에서 앱 생성 후
   생성된 .aab 업로드, 스토어 등록정보 작성 후 제출.

## 참고

- 웹앱이 실시간 멀티플레이어(Firebase Realtime DB)라
  `server.url` 방식(항상 라이브 사이트 로드)이 로컬 번들 방식보다
  적합합니다. 오프라인에서는 어차피 게임을 할 수 없는 구조라
  단점이 없습니다.
- Apple/Google 둘 다 "그냥 웹사이트를 감싼 앱"은 반려될 수 있는데
  (Apple 가이드라인 4.2), 낱말바둑은 실제 인터랙티브 캔버스
  게임이라 문제없이 통과하는 사례가 일반적입니다. 다만 심사 시
  네이티브 앱처럼 보이도록(상태바 스타일, 스플래시, 아이콘 등)
  마무리하는 게 안전합니다.
