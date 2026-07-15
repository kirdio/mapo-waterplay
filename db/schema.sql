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
  source        text
);

alter table public.places enable row level security;

drop policy if exists places_public_read on public.places;
create policy places_public_read
  on public.places for select
  using (true);
