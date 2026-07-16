-- ────────────────────────────────────────────────────────────────
--  Supabase 스키마 — 여름 어린이 물놀이장 지도
--  Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
--  (로컬 JSON 폴백만 쓸 경우엔 실행하지 않아도 됩니다.)
-- ────────────────────────────────────────────────────────────────

-- ── 리뷰 테이블 (사용자 생성 데이터) ──────────────────────────────
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  place_id    text        not null,
  author      text        not null,
  content     text        not null,
  photo_url   text,
  created_at  timestamptz not null default now()
);

create index if not exists reviews_place_id_idx on public.reviews (place_id);
create index if not exists reviews_created_at_idx on public.reviews (created_at desc);

-- RLS: 서버가 service_role 키로 접근하면 RLS를 우회합니다(권장).
-- anon 키만 쓸 경우 아래 정책으로 공개 읽기 + 공개 쓰기를 허용할 수 있으나,
-- 삭제는 서버(관리자 토큰)에서만 하도록 anon 삭제는 열지 않습니다.
alter table public.reviews enable row level security;

drop policy if exists reviews_public_read on public.reviews;
create policy reviews_public_read
  on public.reviews for select
  using (true);

drop policy if exists reviews_public_insert on public.reviews;
create policy reviews_public_insert
  on public.reviews for insert
  with check (true);

-- (삭제/수정 정책은 만들지 않음 → anon 키로는 삭제 불가.
--  삭제는 서버가 service_role 키로 수행)

-- ── (선택) 물놀이장 테이블 ────────────────────────────────────────
--  기본 앱은 places 를 data/places.json 에서 서빙하므로 이 테이블은 선택입니다.
--  Supabase 에서 places 를 관리하고 싶다면 아래를 만들고
--  `npm run seed:supabase` 로 data/places.json 을 밀어 넣으세요.
create table if not exists public.places (
  id            text primary key,
  region        text,
  district      text,
  name          text,
  category      text,
  address_road  text,
  lat           double precision,
  lng           double precision,
  period        text,
  hours         text,
  fee           text,
  note          text,
  tel           text,
  source        text,
  sort_order    integer,
  updated_at    timestamptz default now(),
  -- 편의시설 3상태(true=있음 / false=없음 / NULL=미확인).
  -- Supabase Table Editor에서 체크박스를 켜고 끄면 앱에 반영된다(캐시 TTL 1분).
  toilet        boolean,   -- 화장실 🚺
  shower        boolean,   -- 샤워실 🚿
  changing      boolean,   -- 탈의실 👕
  store         boolean    -- 편의점 🏪
);

alter table public.places enable row level security;

-- 앱(익명 사용자)이 장소 목록을 읽을 수 있도록 공개 읽기 허용.
drop policy if exists places_public_read on public.places;
create policy places_public_read
  on public.places for select
  using (true);

-- 기존 places 테이블에 편의시설 컬럼이 없다면 추가(재실행 안전).
alter table public.places
  add column if not exists toilet   boolean,
  add column if not exists shower   boolean,
  add column if not exists changing boolean,
  add column if not exists store    boolean;

-- ── 제보 테이블 (사용자 제보 → 관리자 전용 열람) ───────────────────
--  service_role 키 사용이 필수다(anon 정책을 두지 않는다).
--  RLS가 모든 anon 접근을 차단하고 서버가 service_role 키로만 접근한다.
--
--  ⚠️ 한때 "anon 키 + 컬럼 GRANT로 contact만 제외" 방식(방식 B)을 시도했으나,
--  이 프로젝트에 이미 걸려있던 더 넓은 기본 권한과 충돌해 컬럼 GRANT가
--  무시되고 contact를 포함한 전체 제보 내용이 anon으로 그대로 노출되는
--  것이 확인되어 폐기했다. reports는 절대 anon 정책/GRANT를 추가하지 말 것.
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  place_id    text,                          -- null이면 "새 물놀이장 제보"
  type        text not null default 'etc',   -- new-place | correction | amenity | etc
  content     text not null,
  contact     text,
  status      text not null default 'new',   -- new | done
  created_at  timestamptz not null default now()
);

create index if not exists reports_status_idx on public.reports (status);
create index if not exists reports_created_at_idx on public.reports (created_at desc);

alter table public.reports enable row level security;
-- 정책을 만들지 않음 = RLS가 모든 접근을 기본 차단(service_role만 우회 가능).
