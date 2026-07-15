// ────────────────────────────────────────────────────────────────
//  data/places.json → Supabase public.places 로 업서트
//  사용: npm run seed:supabase
//  필요: .env 의 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY,
//        그리고 db/schema.sql 로 places 테이블 생성 완료.
// ────────────────────────────────────────────────────────────────
'use strict';
require('../load-env');

const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !key || /YOUR-PROJECT/.test(url)) {
  console.error('❌ .env 에 SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 를 설정하세요.');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(url, key, { auth: { persistSession: false } });

const file = path.join(__dirname, '..', 'data', 'places.json');
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const places = Array.isArray(raw) ? raw : raw.places || [];

// 앱 스키마(camelCase) → DB 컬럼(snake_case)
const rows = places.map((p) => ({
  id: p.id,
  region: p.region,
  district: p.district,
  name: p.name,
  category: p.category,
  address_road: p.addressRoad,
  lat: p.lat,
  lng: p.lng,
  period: p.period,
  hours: p.hours,
  fee: p.fee,
  note: p.note,
  tel: p.tel,
  source: p.source,
}));

(async () => {
  console.log(`⏫ ${rows.length}곳을 Supabase places 에 업서트 중...`);
  // 대용량 한글 페이로드 안전을 위해 청크 단위 업서트
  const CHUNK = 50;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from('places').upsert(slice, { onConflict: 'id' });
    if (error) {
      console.error(`❌ ${i}~${i + slice.length} 실패:`, error.message);
      process.exit(1);
    }
    console.log(`  ✓ ${i + slice.length}/${rows.length}`);
  }
  const { count } = await supabase
    .from('places')
    .select('*', { count: 'exact', head: true });
  console.log(`✅ 완료. Supabase places 총 ${count}행`);
})();
