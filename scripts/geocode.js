// ────────────────────────────────────────────────────────────────
//  Kakao REST API 로 주소 → 좌표(lat/lng) 지오코딩
//
//  용도:
//   1) 새 장소를 data/places.json 에 lat/lng 없이 추가한 뒤 좌표 채우기
//        npm run geocode
//   2) 임의 주소 한 건 빠르게 조회
//        node scripts/geocode.js "서울 마포구 성미산로 25-6"
//
//  필요: .env 의 KAKAO_REST_API_KEY (지도 표시용 JS 키가 아니라 REST 키)
// ────────────────────────────────────────────────────────────────
'use strict';
require('../load-env');

const fs = require('fs');
const path = require('path');

const KEY = process.env.KAKAO_REST_API_KEY;
if (!KEY) {
  console.error('❌ .env 에 KAKAO_REST_API_KEY 를 설정하세요. (Kakao Developers → REST API 키)');
  process.exit(1);
}

const HEADERS = { Authorization: `KakaoAK ${KEY}` };

// 주소 검색 → 실패 시 키워드(장소명) 검색으로 폴백
async function geocode(query) {
  const addrUrl =
    'https://dapi.kakao.com/v2/local/search/address.json?query=' +
    encodeURIComponent(query);
  let r = await fetch(addrUrl, { headers: HEADERS });
  if (r.ok) {
    const j = await r.json();
    if (j.documents && j.documents[0]) {
      const d = j.documents[0];
      return { lat: parseFloat(d.y), lng: parseFloat(d.x), via: 'address' };
    }
  }
  const kwUrl =
    'https://dapi.kakao.com/v2/local/search/keyword.json?query=' +
    encodeURIComponent(query);
  r = await fetch(kwUrl, { headers: HEADERS });
  if (r.ok) {
    const j = await r.json();
    if (j.documents && j.documents[0]) {
      const d = j.documents[0];
      return { lat: parseFloat(d.y), lng: parseFloat(d.x), via: 'keyword' };
    }
  }
  return null;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

(async () => {
  const arg = process.argv[2];

  // 모드 2: 단일 주소 조회
  if (arg) {
    const res = await geocode(arg);
    if (res) console.log(`✅ ${arg}\n   lat=${res.lat}, lng=${res.lng} (${res.via})`);
    else console.log(`❌ 찾지 못함: ${arg}`);
    return;
  }

  // 모드 1: places.json 에서 좌표 없는 항목 채우기
  const file = path.join(__dirname, '..', 'data', 'places.json');
  const rawObj = JSON.parse(fs.readFileSync(file, 'utf8'));
  const places = Array.isArray(rawObj) ? rawObj : rawObj.places || [];

  const missing = places.filter(
    (p) => p.lat == null || p.lng == null || isNaN(p.lat) || isNaN(p.lng)
  );
  if (!missing.length) {
    console.log('✅ 모든 장소에 좌표가 이미 있습니다. 할 일 없음.');
    return;
  }
  console.log(`🔎 좌표 없는 장소 ${missing.length}곳 지오코딩 시작...`);

  let ok = 0;
  for (const p of missing) {
    const query = p.addressRoad || `${p.district || ''} ${p.name}`;
    const res = await geocode(query);
    if (res) {
      p.lat = res.lat;
      p.lng = res.lng;
      ok++;
      console.log(`  ✓ ${p.name} → ${res.lat}, ${res.lng} (${res.via})`);
    } else {
      console.log(`  ✗ ${p.name} — 실패 (${query})`);
    }
    await sleep(200); // API 호출 간격
  }

  // 원래 구조(객체/배열) 유지하며 저장
  if (Array.isArray(rawObj)) fs.writeFileSync(file, JSON.stringify(places, null, 2), 'utf8');
  else { rawObj.places = places; fs.writeFileSync(file, JSON.stringify(rawObj, null, 2), 'utf8'); }

  console.log(`\n✅ 완료: ${ok}/${missing.length} 채움 → data/places.json 저장`);
})();
