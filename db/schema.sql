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

-- ── 제보 테이블 (사용자 제보 → 관리자 전용 열람) ───────────────────
--  두 가지 운용 방식 중 하나를 고를 수 있다.
--
--  [A] service_role 키 사용(가장 안전, 권장): 아래 anon 정책/GRANT를
--      실행하지 말 것. RLS가 모든 anon 접근을 차단하고 서버가
--      service_role 키로만 접근한다(RLS 우회).
--
--  [B] anon 키만 사용(service_role 키가 없을 때): 아래 anon 정책/GRANT를
--      실행한다. 제보 '등록'은 공개로 허용하되, '연락처(contact)'는
--      컬럼 GRANT에서 제외해 anon 조회 시 노출되지 않는다. 조회·수정·
--      삭제 UI는 서버의 관리자 토큰(requireAdmin)으로 앱단에서 보호한다.
--      단, contact를 제외한 제보 본문은 REST로 anon 조회가 가능하다는
--      점에 유의(민감 정보는 제보 본문에 남기지 않도록 안내).
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

-- ── [B] anon 키만 사용할 때만 아래를 실행 ──────────────────────────
-- 제보 등록(공개 INSERT)
drop policy if exists reports_insert on public.reports;
create policy reports_insert
  on public.reports for insert
  to anon, authenticated
  with check (true);
grant insert on public.reports to anon, authenticated;

-- 제보 조회(SELECT) — 단, contact(연락처)는 컬럼 GRANT에서 제외한다.
drop policy if exists reports_select on public.reports;
create policy reports_select
  on public.reports for select
  to anon, authenticated
  using (true);
grant select (id, place_id, type, content, status, created_at)
  on public.reports to anon, authenticated;

-- (수정/삭제 정책은 만들지 않음 → anon 키로는 상태변경·삭제 불가.
--  관리자 앱의 상태변경·삭제는 service_role 키 사용 시에만 동작)
