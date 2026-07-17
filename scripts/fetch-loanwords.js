// 우리말샘(국립국어원) 오픈API로 외래어 명사를 모아 public/words.txt에 추가한다.
//
// Claude(작업 샌드박스)는 opendict.korean.go.kr으로 나가는 네트워크가 방화벽에 막혀 있어서
// 이 스크립트는 사람이 로컬 터미널(맥)에서 직접 실행해야 한다.
//
// 사용법:
//   OPENDICT_KEY=발급받은키 node scripts/fetch-loanwords.js probe
//     -> API 응답 모양(필드명)을 실제로 한 번 확인하기 위한 테스트 호출. 딱 1건만 조회하고
//        원본 JSON을 그대로 출력한 뒤 종료함(words.txt는 건드리지 않음).
//        이 출력을 그대로 복사해서 Claude에게 붙여넣어 주면, 그 모양에 맞춰 아래 추출 로직
//        (extractWord/extractPos/extractOrigin)이 정확한지 같이 확인하고 필요하면 고침.
//
//   OPENDICT_KEY=발급받은키 node scripts/fetch-loanwords.js run
//     -> 실제로 여러 음절로 시작하는 외래어를 모아 words.txt에 병합함(중복 자동 제외).
//        먼저 probe로 필드명을 확인한 뒤에 실행할 것.
//
// 주의: 인증키는 커밋하지 말 것(환경변수로만 넘김). 이 API는 결제/개인정보 없는 공공데이터
// 오픈API 키라 채팅에 붙여넣는 것 자체는 문제 없지만, 그래도 스크립트 파일 안에는 하드코딩하지 않음.

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
// 하며 모두 훑는다. q(검색어) + method(검색방식)는 오픈API에서 가장 기본적이고 확실한
// 파라미터라 이 방식을 기본 전략으로 삼음(advanced 검색의 어종/품사 필터 파라미터 값은
// 문서를 직접 못 봐서 확신이 없어 보조적으로만 씀).
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

const NUM_PER_PAGE = 100; // 오픈API 한 번 요청당 최대 결과 개수(보통 100까지 허용됨)
const MAX_PAGES_PER_SYLLABLE = 5; // 음절 하나당 최대 500개까지만(과도한 호출 방지)
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
  return json;
}

// 응답 아이템에서 실제 필드명을 확신할 수 없어서, 흔히 쓰이는 후보 키 이름들을 순서대로 시도함.
// probe로 실제 응답을 보고 나면 이 목록을 정확한 키 하나로 좁혀도 됨.
function pick(obj, candidates) {
  for (const c of candidates) {
    if (obj && obj[c] !== undefined && obj[c] !== null && obj[c] !== '') return obj[c];
  }
  return undefined;
}

function extractItems(json) {
  // 표준국어대사전/우리말샘 오픈API는 보통 channel.item 배열(또는 item이 1건이면 객체) 형태.
  const channel = json.channel || json.Channel || json;
  let items = channel.item || channel.Item || [];
  if (!Array.isArray(items)) items = [items];
  return items;
}

function extractWord(item) {
  const raw = pick(item, ['word', 'target_word', 'target', 'entry_name', 'expression']);
  if (!raw) return null;
  // 표제어에 발음/음절 구분(^, ㆍ, 공백) 등이 붙어 나오는 경우가 있어 정리
  return String(raw).replace(/[\^ㆍ\s]/g, '');
}

function extractPos(item) {
  const sense = Array.isArray(item.sense) ? item.sense[0] : item.sense;
  return pick(item, ['pos']) || pick(sense || {}, ['pos', 'type']);
}

function extractOrigin(item) {
  // 어종(고유어/한자어/외래어/혼종어) — 흔히 word_unit이나 sense 안의 type/lang 필드 등에 있을 것으로
  // 추정. probe 결과를 보고 정확한 경로로 바꿔야 함.
  const sense = Array.isArray(item.sense) ? item.sense[0] : item.sense;
  return pick(item, ['word_unit', 'lang_type', 'origin']) || pick(sense || {}, ['lang_type', 'origin', 'type']);
}

async function probe() {
  console.log('테스트 조회 중… (검색어: 카메라)');
  const json = await callApi({ q: '카메라', num: '3' });
  console.log('\n=== 원본 응답(JSON) ===');
  console.log(JSON.stringify(json, null, 2));

  const items = extractItems(json);
  console.log(`\n=== 파싱 결과(item ${items.length}건) ===`);
  for (const it of items) {
    console.log({
      word: extractWord(it),
      pos: extractPos(it),
      origin: extractOrigin(it),
    });
  }
  console.log('\n위 "원본 응답"과 "파싱 결과"를 그대로 복사해서 Claude에게 보여주세요.');
  console.log('word/pos/origin이 실제 값과 안 맞으면 스크립트의 extractWord/extractPos/extractOrigin을 고친 뒤 다시 probe 해봐야 해요.');
}

async function run() {
  const existing = new Set(
    fs.readFileSync(WORDS_PATH, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
  );
  console.log(`기존 사전: ${existing.size.toLocaleString()}개`);

  const found = new Map(); // word -> { pos, origin } (검토용 참고 정보)
  let calls = 0;

  for (const syl of SEED_SYLLABLES) {
    for (let page = 0; page < MAX_PAGES_PER_SYLLABLE; page++) {
      const start = page * NUM_PER_PAGE + 1;
      let json;
      try {
        json = await callApi({ q: syl, method: 'start', start: String(start), num: String(NUM_PER_PAGE) });
      } catch (e) {
        console.log(`  [${syl}] 페이지 ${page + 1} 실패(건너뜀): ${e.message.slice(0, 150)}`);
        break;
      }
      calls++;
      const items = extractItems(json);
      if (!items.length) break; // 더 이상 결과 없음

      for (const it of items) {
        const word = extractWord(it);
        if (!word) continue;
        if (!/^[가-힣]{2,15}$/.test(word)) continue; // 순한글, 2~15글자만(게임 규칙과 동일)
        const pos = extractPos(it);
        const origin = extractOrigin(it);
        // 명사만, 외래어만 — 값 표기를 확신 못 해 문자열에 "명사"/"외래어"가 포함되는지로 느슨하게 판단
        const isNoun = !pos || String(pos).includes('명사');
        const isLoanword = origin && String(origin).includes('외래어');
        if (isNoun && isLoanword && !existing.has(word)) {
          found.set(word, { pos, origin });
        }
      }
      await sleep(DELAY_MS);
      if (items.length < NUM_PER_PAGE) break; // 마지막 페이지
    }
    process.stdout.write(`\r[${syl}] 처리 완료 — 지금까지 새 단어 ${found.size}개, API 호출 ${calls}회        `);
  }
  console.log('\n\n수집 완료:', found.size, '개의 새 외래어 명사 후보');

  if (found.size === 0) {
    console.log('추가할 새 단어가 없어요(필터 조건이 너무 엄격하거나 origin/pos 필드명이 다를 수 있음 — probe로 먼저 확인해 보세요).');
    return;
  }

  // 미리보기 일부 출력(검수용)
  const sample = [...found.keys()].slice(0, 30);
  console.log('\n예시 30개:', sample.join(', '));

  const merged = [...existing, ...found.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  fs.writeFileSync(WORDS_PATH, merged.join('\n') + '\n');
  console.log(`\npublic/words.txt에 ${found.size}개 추가 완료 (총 ${merged.length.toLocaleString()}개).`);
  console.log('git diff로 확인 후 커밋/푸시하거나, Claude에게 결과를 보여주고 정리를 맡겨도 됩니다.');
}

(async () => {
  const mode = process.argv[2];
  if (mode === 'run') await run();
  else await probe(); // 인자 없이 실행하면 안전하게 probe만
})().catch(e => { console.error('오류:', e); process.exit(1); });
