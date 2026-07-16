// ────────────────────────────────────────────────────────────────
//  여름 어린이 물놀이장 지도 — Express 백엔드
//
//  데이터 계층 (하이브리드):
//   • places  : data/places.json (git 포함, 좌표 스냅샷)  — 정적 참조 데이터
//   • reviews : Supabase(설정 시) ↔ 로컬 JSON 파일(폴백)  — 사용자 생성 데이터
//
//  보안 자세:
//   • 관리자 비밀번호 미설정 시 로그인 항상 차단(fail-closed)
//   • 리뷰 삭제는 서버측 토큰 검증(UI 숨김 아님)
//   • 리뷰 등록 rate limit + 사진 크기/포맷 검증
//   • 출력 이스케이프는 프론트(app.js esc())에서 처리, 서버는 원문 저장
// ────────────────────────────────────────────────────────────────
'use strict';

require('./load-env'); // .env → process.env (있으면)

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 5000;
const app = express();

// 사진은 base64 data URL 로 전달되므로 body 한도를 넉넉히.
app.use(express.json({ limit: '10mb' }));

// ── 정적 파일: public/ 로만 한정 (server.js/.env 등 비노출) ──────
app.use(express.static(path.join(__dirname, 'public')));

// ════════════════════════════════════════════════════════════════
//  데이터 계층
// ════════════════════════════════════════════════════════════════
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY && !/YOUR-PROJECT/.test(SUPABASE_URL)) {
  try {
    // Node 환경에서 native WebSocket이 없을 때 ws 폴리필 주입
    // (@supabase/supabase-js 초기화가 WebSocket 미존재로 실패하는 것을 방지)
    if (typeof globalThis.WebSocket === 'undefined') {
      try { globalThis.WebSocket = require('ws'); } catch (_) {}
    }
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });
    console.log('[data] Supabase 연결됨 — 리뷰는 Supabase에 저장됩니다.');
  } catch (e) {
    console.warn('[data] Supabase 초기화 실패, 로컬 폴백 사용:', e.message);
  }
} else {
  console.log('[data] Supabase 미설정 — 리뷰는 로컬 JSON(data/reviews.local.json)에 저장됩니다.');
}

// ── places: data/places.json ────────────────────────────────────
const PLACES_FILE = path.join(__dirname, 'data', 'places.json');
let placesCache = null;
function getPlaces() {
  if (placesCache) return placesCache;
  try {
    const raw = JSON.parse(fs.readFileSync(PLACES_FILE, 'utf8'));
    placesCache = Array.isArray(raw) ? raw : raw.places || [];
  } catch (e) {
    console.error('[places] 로드 실패:', e.message);
    placesCache = [];
  }
  return placesCache;
}

// ── reviews: 로컬 JSON 폴백 저장소 ───────────────────────────────
const REVIEWS_FILE = path.join(__dirname, 'data', 'reviews.local.json');
function readLocalReviews() {
  try {
    return JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf8'));
  } catch {
    return [];
  }
}
function writeLocalReviews(list) {
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// 통합 리뷰 API (Supabase 우선, 없으면 로컬)
const reviewStore = {
  async listByPlace(placeId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('reviews')
        .select('id, place_id, author, content, photo_url, created_at')
        .eq('place_id', placeId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    }
    return readLocalReviews()
      .filter((r) => r.place_id === placeId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  },

  async counts() {
    if (supabase) {
      const { data, error } = await supabase.from('reviews').select('place_id');
      if (error) throw new Error(error.message);
      const c = {};
      (data || []).forEach((r) => (c[r.place_id] = (c[r.place_id] || 0) + 1));
      return c;
    }
    const c = {};
    readLocalReviews().forEach((r) => (c[r.place_id] = (c[r.place_id] || 0) + 1));
    return c;
  },

  async add({ placeId, author, content, photoUrl }) {
    const row = {
      place_id: placeId,
      author,
      content,
      photo_url: photoUrl || null,
    };
    if (supabase) {
      const { data, error } = await supabase
        .from('reviews')
        .insert(row)
        .select('id, place_id, author, content, photo_url, created_at')
        .single();
      if (error) throw new Error(error.message);
      return data;
    }
    const list = readLocalReviews();
    const saved = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      ...row,
    };
    list.push(saved);
    writeLocalReviews(list);
    return saved;
  },

  async remove(id) {
    if (supabase) {
      const { error } = await supabase.from('reviews').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }
    const list = readLocalReviews();
    const next = list.filter((r) => String(r.id) !== String(id));
    writeLocalReviews(next);
  },
};

// ── 제보(reports): 로컬 JSON 폴백 저장소 ─────────────────────────
// Supabase reports 테이블은 anon 정책이 아예 없어(db/schema.sql) 관리자
// (service_role)만 접근 가능 — 관리자 외 열람 자체가 DB 레벨에서 차단됨.
const REPORTS_FILE = path.join(__dirname, 'data', 'reports.local.json');
function readLocalReports() {
  try {
    return JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}
function writeLocalReports(list) {
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

const reportStore = {
  async list(status) {
    if (supabase) {
      let q = supabase
        .from('reports')
        .select('id, place_id, type, content, contact, status, created_at')
        .order('created_at', { ascending: false });
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    }
    let list = readLocalReports().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    if (status) list = list.filter((r) => r.status === status);
    return list;
  },

  async add({ placeId, type, content, contact }) {
    const row = { place_id: placeId || null, type, content, contact: contact || null, status: 'new' };
    if (supabase) {
      // service_role 키 사용 시 RLS를 우회하므로 insert 후 되읽기가 정상 동작한다.
      const { data, error } = await supabase
        .from('reports')
        .insert(row)
        .select('id, place_id, type, content, contact, status, created_at')
        .single();
      if (error) throw new Error(error.message);
      return data;
    }
    const list = readLocalReports();
    const saved = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row };
    list.push(saved);
    writeLocalReports(list);
    return saved;
  },

  async setStatus(id, status) {
    if (supabase) {
      const { error } = await supabase.from('reports').update({ status }).eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }
    const list = readLocalReports();
    const row = list.find((r) => String(r.id) === String(id));
    if (row) { row.status = status; writeLocalReports(list); }
  },

  async remove(id) {
    if (supabase) {
      const { error } = await supabase.from('reports').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }
    const list = readLocalReports();
    writeLocalReports(list.filter((r) => String(r.id) !== String(id)));
  },
};

// ════════════════════════════════════════════════════════════════
//  관리자 인증 (fail-closed + 브루트포스 제한 + 인메모리 토큰)
// ════════════════════════════════════════════════════════════════
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const adminTokens = new Set();
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12시간

// IP당 15분 10회 로그인 제한
const loginAttempts = new Map(); // ip -> { count, windowStart }
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 10;

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .toString()
    .split(',')[0]
    .trim();
}

function loginRateLimited(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now - rec.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  rec.count += 1;
  return rec.count > LOGIN_MAX;
}

function issueToken() {
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.add(token);
  setTimeout(() => adminTokens.delete(token), TOKEN_TTL_MS).unref?.();
  return token;
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token && adminTokens.has(token)) return next();
  return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
}

// 타이밍 안전 비교
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ════════════════════════════════════════════════════════════════
//  리뷰 등록 rate limit (IP당 쿨다운)
// ════════════════════════════════════════════════════════════════
const reviewPosts = new Map(); // ip -> [timestamps]
const REVIEW_WINDOW_MS = 10 * 60 * 1000; // 10분
const REVIEW_MAX = 5; // 10분당 5건

function reviewRateLimited(ip) {
  const now = Date.now();
  const arr = (reviewPosts.get(ip) || []).filter((t) => now - t < REVIEW_WINDOW_MS);
  arr.push(now);
  reviewPosts.set(ip, arr);
  return arr.length > REVIEW_MAX;
}

// ════════════════════════════════════════════════════════════════
//  제보 등록 rate limit (IP당 쿨다운) — 리뷰보다 더 빡빡하게
// ════════════════════════════════════════════════════════════════
const reportPosts = new Map(); // ip -> [timestamps]
const REPORT_WINDOW_MS = 10 * 60 * 1000; // 10분
const REPORT_MAX = 3; // 10분당 3건

function reportRateLimited(ip) {
  const now = Date.now();
  const arr = (reportPosts.get(ip) || []).filter((t) => now - t < REPORT_WINDOW_MS);
  arr.push(now);
  reportPosts.set(ip, arr);
  return arr.length > REPORT_MAX;
}

const REPORT_TYPES = ['new-place', 'correction', 'amenity', 'etc'];

// ════════════════════════════════════════════════════════════════
//  라우트
// ════════════════════════════════════════════════════════════════

// 헬스체크
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    supabase: !!supabase,
    places: getPlaces().length,
    adminConfigured: !!ADMIN_PASSWORD,
  });
});

// 물놀이장 목록
app.get('/api/places', (req, res) => {
  res.json({ places: getPlaces() });
});

// 특정 장소 리뷰
app.get('/api/reviews', async (req, res) => {
  const placeId = String(req.query.placeId || '');
  if (!placeId) return res.status(400).json({ error: 'placeId가 필요합니다.' });
  try {
    const reviews = await reviewStore.listByPlace(placeId);
    res.json({ reviews });
  } catch (e) {
    console.error('[reviews] 조회 실패:', e.message);
    res.status(500).json({ error: '리뷰를 불러오지 못했습니다.' });
  }
});

// 전체 리뷰 카운트 (사이드바 배지)
app.get('/api/reviews/counts', async (req, res) => {
  try {
    const counts = await reviewStore.counts();
    res.json({ counts });
  } catch (e) {
    console.error('[reviews] 카운트 실패:', e.message);
    res.status(500).json({ error: '카운트를 불러오지 못했습니다.' });
  }
});

// 리뷰 등록
app.post('/api/reviews', async (req, res) => {
  const ip = clientIp(req);
  if (reviewRateLimited(ip)) {
    return res
      .status(429)
      .json({ error: '잠시 후 다시 시도해 주세요. (등록이 너무 잦습니다)' });
  }

  const body = req.body || {};
  const placeId = String(body.placeId || '').trim();
  const author = String(body.author || '').trim();
  const content = String(body.content || '').trim();
  let photo = body.photo;

  if (!placeId || !author || !content) {
    return res.status(400).json({ error: '이름과 내용을 입력해 주세요.' });
  }
  if (author.length > 40 || content.length > 1000) {
    return res.status(400).json({ error: '입력이 너무 깁니다.' });
  }
  // 존재하는 장소인지 확인
  if (!getPlaces().some((p) => p.id === placeId)) {
    return res.status(400).json({ error: '알 수 없는 장소입니다.' });
  }

  // 사진 검증: data:image/ 접두어 + 7MB 상한
  let photoUrl = null;
  if (photo) {
    if (typeof photo !== 'string' || !/^data:image\/(png|jpe?g|gif|webp);base64,/.test(photo)) {
      return res.status(400).json({ error: '지원하지 않는 이미지 형식입니다.' });
    }
    // base64 실제 바이트 크기 ≈ length * 3/4
    const b64 = photo.split(',')[1] || '';
    const bytes = Math.floor((b64.length * 3) / 4);
    if (bytes > 7 * 1024 * 1024) {
      return res.status(400).json({ error: '사진은 7MB 이하만 가능합니다.' });
    }
    photoUrl = photo;
  }

  try {
    const saved = await reviewStore.add({ placeId, author, content, photoUrl });
    res.status(201).json({ review: saved });
  } catch (e) {
    console.error('[reviews] 등록 실패:', e.message);
    res.status(500).json({ error: '리뷰 등록에 실패했습니다.' });
  }
});

// 리뷰 삭제 (관리자)
app.delete('/api/reviews/:id', requireAdmin, async (req, res) => {
  try {
    await reviewStore.remove(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[reviews] 삭제 실패:', e.message);
    res.status(500).json({ error: '삭제에 실패했습니다.' });
  }
});

// 관리자 로그인
app.post('/api/admin/login', (req, res) => {
  const ip = clientIp(req);
  if (loginRateLimited(ip)) {
    return res
      .status(429)
      .json({ error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
  }
  // fail-closed: 비밀번호 미설정이면 로그인 자체를 막음
  if (!ADMIN_PASSWORD) {
    return res
      .status(503)
      .json({ error: '관리자 비밀번호가 설정되지 않았습니다(.env ADMIN_PASSWORD).' });
  }
  const password = (req.body && req.body.password) || '';
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  }
  const token = issueToken();
  res.json({ token }); // 비밀번호는 응답에 절대 포함하지 않음
});

// 관리자 로그아웃 (토큰 폐기)
app.post('/api/admin/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) adminTokens.delete(token);
  res.json({ ok: true });
});

// 제보 등록 (공개, 관리자만 열람 가능)
app.post('/api/reports', async (req, res) => {
  const ip = clientIp(req);
  if (reportRateLimited(ip)) {
    return res
      .status(429)
      .json({ error: '잠시 후 다시 시도해 주세요. (제보가 너무 잦습니다)' });
  }

  const body = req.body || {};
  const placeId = body.placeId ? String(body.placeId).trim() : null;
  const type = REPORT_TYPES.includes(body.type) ? body.type : 'etc';
  const content = String(body.content || '').trim();
  const contact = body.contact ? String(body.contact).trim() : null;

  if (!content) {
    return res.status(400).json({ error: '내용을 입력해 주세요.' });
  }
  if (content.length > 1000 || (contact && contact.length > 100)) {
    return res.status(400).json({ error: '입력이 너무 깁니다.' });
  }
  if (placeId && !getPlaces().some((p) => p.id === placeId)) {
    return res.status(400).json({ error: '알 수 없는 장소입니다.' });
  }

  try {
    const saved = await reportStore.add({ placeId, type, content, contact });
    res.status(201).json({ report: { id: saved.id } }); // 등록자에겐 최소 정보만 반환
  } catch (e) {
    console.error('[reports] 등록 실패:', e.message);
    res.status(500).json({ error: '제보 등록에 실패했습니다.' });
  }
});

// 제보 목록 (관리자 전용)
app.get('/api/admin/reports', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const reports = await reportStore.list(status);
    res.json({ reports });
  } catch (e) {
    console.error('[reports] 조회 실패:', e.message);
    res.status(500).json({ error: '제보를 불러오지 못했습니다.' });
  }
});

// 제보 상태 변경 (관리자 전용)
app.patch('/api/admin/reports/:id', requireAdmin, async (req, res) => {
  const status = (req.body && req.body.status) || '';
  if (status !== 'new' && status !== 'done') {
    return res.status(400).json({ error: 'status는 new 또는 done 이어야 합니다.' });
  }
  try {
    await reportStore.setStatus(req.params.id, status);
    res.json({ ok: true });
  } catch (e) {
    console.error('[reports] 상태 변경 실패:', e.message);
    res.status(500).json({ error: '상태 변경에 실패했습니다.' });
  }
});

// 제보 삭제 (관리자 전용)
app.delete('/api/admin/reports/:id', requireAdmin, async (req, res) => {
  try {
    await reportStore.remove(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[reports] 삭제 실패:', e.message);
    res.status(500).json({ error: '삭제에 실패했습니다.' });
  }
});

// SPA 폴백 (알 수 없는 비 API 경로는 index.html)
// 단, 확장자가 있는 경로(예: /server.js, /.env, /foo.css)는 존재하지 않으면 404 —
// 소스/시크릿 경로가 200(index.html)로 응답하지 않도록.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  // 마지막 세그먼트에 점이 있으면 파일 요청으로 간주 → 없으면 404
  // (예: /server.js, /.env, /foo.css). 선행 점 dotfile도 포함.
  const base = req.path.split('/').pop() || '';
  if (base.includes('.')) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  🌊 물놀이장 지도 서버 실행 중 → http://localhost:${PORT}`);
  console.log(`     장소 ${getPlaces().length}곳 · 관리자 ${ADMIN_PASSWORD ? '설정됨' : '미설정(로그인 차단)'}\n`);
});
