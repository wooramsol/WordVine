// 우리말샘(국립국어원) 오픈API로 외래어 명사를 모아 public/words.txt에 추가한다.
//
// Claude(작업 샌드박스)는 opendict.korean.go.kr으로 나가는 네트워크가 방화벽에 막혀 있어서
// 이 스크립트는 사람이 로컬 터미널(맥)에서 직접 실행해야 한다.
//
// 실제 API 응답을 probe로 한 번 확인해서 아래처럼 구조를 확정함:
//   { channel: { total, item: [ { word, sense: [ { pos, origin, cat, definition, ... } ] } ] } }
// - word: 표제어. 공백/캐럿(^)/하이픈(-)으로 형태소 경계가 표시될 수 있음(예: "카메라 가방",
//   "카메라^등^이용^촬영죄", "카메라-눈") — 게임에서는 어차피 한 칸씩 이어 놓는 문자열이라
//   전부 이어붙여서 하나의 순한글 낱말로 씀.
// - sense[].pos: "명사"(단일 단어) 또는 ""(구/복합 표현 — 품사 표시가 원래 없음).
// - sense[].origin: 원어(어원) 표기. 순수 외래어면 라틴 문자(+공백/점/하이픈)만 있고,
//   한자나 한글이 섞여 있으면 한자어/고유어와 결합된 혼종어(예: "camera恐怖症", "camera가방").
//   그래서 "라틴 문자를 다 지웠을 때 아무것도 안 남으면(=한자/한글이 안 섞였으면) 순수 외래어"로 판단함.
//
// 사용법:
//   OPENDICT_KEY=발급받은키 node scripts/fetch-loanwords.js probe
//     -> API 파라미터(특히 method=start)가 기대대로 동작하는지 확인하는 테스트 호출.
//        결과를 scripts/probe-output.json에 저장하고 종료(words.txt는 안 건드림).
//
//   OPENDICT_KEY=발급받은키 node scripts/fetch-loanwords.js run
//     -> 여러 음절로 시작하는 외래어 명사를 모아 words.txt에 병합함(중복 자동 제외).
//
// 주의: 인증키는 커밋하지 말 것(환경변수로만 넘김).

const fs = require('fs');
const path = require('path');

const KEY = process.env.OPENDICT_KEY;
if (!KEY) {
  console.error('OPENDICT_KEY 환경변수가 없습니다. 예: OPENDICT_KEY=발급받은키 node scripts/fetch-loanwords.js probe');
  process.exit(1);
}

const WORDS_PATH = path.join(__dirname, '..', 'public', 'words.txt');
const API_BASE = 'https://opendict.korean.go.kr/api/search';

// 외래어가 흔히 시작하는 음절들 — method=start로 각 음절에서 시작하는 표제어를 페이지네이션
// 하며 모두 훑는다.
const SEED_SYLLABLES = [
  '가', '카', '나', '다', '타', '라', '마', '바', '파', '사',
  '아', '자', '차', '하', '거', '커', '너', '더', '터', '러',
  '머', '버', '퍼', '서', '어', '저', '처', '허', '고', '코',
  '노', '도', '토', '로', '모', '보', '포', '소', '오', '조',
  '초', '호', '구', '쿠', '누', '두', '투', '루', '무', '부',
  '푸', '수', '우', '주', '추', '후', '그', '크', '느', '드',
  '트', '르', '므', '브', '프', '스', '으', '즈', '츠', '흐',
  '기', '키', '니', '디', '티', '리', '미', '비', '피', '시',
  '이', '지', '치', '히', '뉴', '듀', '류', '뮤', '뷰', '퓨',
];

const NUM_PER_PAGE = 100; // 오픈API 한 번 요청당 최대 결과 개수(문서 기준 최대 100)
const MAX_PAGES_PER_SYLLABLE = 8; // 음절 하나당 최대 800개까지만(과도한 호출 방지)
const DELAY_MS = 150; // 요청 사이 간격(서버 부담 줄이기)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callApi(params) {
  const usp = new URLSearchParams({ key: KEY, req_type: 'json', ...params });
  const url = `${API_BASE}?${usp.toString()}`;
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`JSON 파싱 실패(HTTP ${res.status}). 응답 원문:\n${text.slice(0, 500)}`);
  }
  if (json.error) throw new Error(`API 오류 ${json.error.error_code}: ${json.error.message}`);
  return json;
}

function extractItems(json) {
  const channel = json.channel || {};
  let items = channel.item || [];
  if (!Array.isArray(items)) items = [items];
  return items;
}

// 표제어의 공백/캐럿/하이픈을 지워 한 덩어리 한글 문자열로 만듦
function cleanWord(raw) {
  if (!raw) return null;
  return String(raw).replace(/[\^ㆍ\-\s]/g, '');
}

// origin(원어 표기)에서 라틴 문자/공백/점/따옴표/하이픈을 지웠을 때 아무것도 안 남으면
// 한자나 한글이 안 섞인 "순수 외래어"라는 뜻
function isPureLoanwordOrigin(origin) {
  if (!origin) return false;
  const stripped = origin.replace(/[A-Za-z0-9\s.\-'’·]/g, '');
  return stripped.length === 0;
}

// 이 표제어를 외래어 명사로 채택할지 판단 — sense가 여러 개면 그중 하나라도 조건을
// 만족하면 채택(동음이의어 중 하나만 외래어 뜻이어도 표제어 자체는 쓸 수 있으므로)
function wordQualifies(item) {
  const senses = Array.isArray(item.sense) ? item.sense : (item.sense ? [item.sense] : []);
  if (!senses.length) return false;
  return senses.some(s => {
    const pos = s.pos || '';
    const posOk = pos === '' || pos === '명사'; // 명사이거나, 품사 표시가 없는 구/복합표현
    return posOk && isPureLoanwordOrigin(s.origin);
  });
}

async function probe() {
  console.log('테스트 1: 기본 검색 (q=카메라)');
  const basic = await callApi({ q: '카메라', num: '10' });
  console.log(`  total=${basic.channel.total}, item=${extractItems(basic).length}건`);

  console.log('테스트 2: method=start 검색 (q=카, 카로 "시작하는" 표제어만 나와야 정상)');
  const started = await callApi({ q: '카', method: 'start', num: '10' });
  const startedItems = extractItems(started);
  const allStartWithKa = startedItems.every(it => (it.word || '').startsWith('카'));
  console.log(`  total=${started.channel.total}, item=${startedItems.length}건, 전부 '카'로 시작함=${allStartWithKa}`);
  if (!allStartWithKa) {
    console.log('  ⚠️ method=start가 기대대로 동작 안 하는 것 같아요 — run 실행 전에 Claude에게 알려주세요.');
  }

  const outPath = path.join(__dirname, 'probe-output.json');
  fs.writeFileSync(outPath, JSON.stringify({ basic, started }, null, 2));
  console.log(`\n원본 응답을 ${outPath} 에 저장했어요. 문제없어 보이면 이제 run을 실행하면 됩니다.`);
}

async function run() {
  const existing = new Set(
    fs.readFileSync(WORDS_PATH, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
  );
  console.log(`기존 사전: ${existing.size.toLocaleString()}개`);

  const found = new Set();
  let calls = 0;

  for (const syl of SEED_SYLLABLES) {
    for (let page = 0; page < MAX_PAGES_PER_SYLLABLE; page++) {
      const start = page * NUM_PER_PAGE + 1;
      let json;
      try {
        json = await callApi({ q: syl, method: 'start', start: String(start), num: String(NUM_PER_PAGE) });
      } catch (e) {
        console.log(`\n  [${syl}] 페이지 ${page + 1} 실패(건너뜀): ${e.message.slice(0, 150)}`);
        break;
      }
      calls++;
      const items = extractItems(json);
      if (!items.length) break; // 더 이상 결과 없음

      for (const item of items) {
        const word = cleanWord(item.word);
        if (!word) continue;
        if (!/^[가-힣]{2,15}$/.test(word)) continue; // 순한글, 2~15글자만(게임 규칙과 동일)
        if (existing.has(word) || found.has(word)) continue;
        if (wordQualifies(item)) found.add(word);
      }
      await sleep(DELAY_MS);
      if (items.length < NUM_PER_PAGE) break; // 마지막 페이지
    }
    process.stdout.write(`\r[${syl}] 처리 완료 — 지금까지 새 단어 ${found.size}개, API 호출 ${calls}회        `);
  }
  console.log('\n\n수집 완료:', found.size, '개의 새 외래어 명사 후보');

  if (found.size === 0) {
    console.log('추가할 새 단어가 없어요. probe 결과를 다시 확인해 보세요.');
    return;
  }

  const sample = [...found].slice(0, 40);
  console.log('\n예시 40개:', sample.join(', '));

  const merged = [...existing, ...found].sort((a, b) => a.localeCompare(b, 'ko'));
  fs.writeFileSync(WORDS_PATH, merged.join('\n') + '\n');
  console.log(`\npublic/words.txt에 ${found.size}개 추가 완료 (총 ${merged.length.toLocaleString()}개).`);
  console.log('Claude에게 "다 됐어" 정도로 알려주시면 결과를 검수하고 커밋할게요.');
}

(async () => {
  const mode = process.argv[2];
  if (mode === 'run') await run();
  else await probe(); // 인자 없이 실행하면 안전하게 probe만
})().catch(e => { console.error('오류:', e.message); process.exit(1); });
