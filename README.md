# 여름 어린이 물놀이장 지도 (서울)

서울시 자치구 어린이 여름 물놀이장 **102곳**을 카카오맵 위에서 한눈에 보고,
방문자가 사진·리뷰를 남길 수 있는 웹앱. 상단에 공동육아 "우리어린이집" 홍보 배너와
전용 마커를 포함합니다.

> 이 저장소는 기존 Perplexity(pplx.app) 프로젝트를 **어느 PC에서든 `git clone` 후 바로
> 이어서 개발**할 수 있도록 재구성한 것입니다. 프론트엔드는 라이브에서 그대로 가져온
> 원본이고, 백엔드(`server.js`)는 동일한 API 계약으로 재작성했습니다.

---

## 빠른 시작 (아무 PC에서나)

```bash
git clone <이 저장소 URL>
cd mapo-waterplay
npm install
npm start
# → http://localhost:5000
```

`.env` 없이도 바로 실행됩니다. 이 경우:
- **물놀이장 102곳**은 `data/places.json` 에서 서빙 (좌표 포함, git에 있음)
- **리뷰**는 로컬 파일(`data/reviews.local.json`, git 제외)에 저장
- **관리자 로그인은 차단**(비밀번호 미설정 = fail-closed)

> ⚠️ 카카오맵은 **도메인 화이트리스트**로 보호됩니다. `localhost` 가 카카오 개발자 콘솔에
> 등록돼 있지 않으면 지도 타일이 안 뜰 수 있습니다. 지도까지 확인하려면 아래 "카카오맵
> 도메인 등록" 참고. (지도 없이도 목록·리뷰·관리자 API는 정상 동작)

---

## 전체 기능 켜기 (.env 설정)

```bash
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
```

`.env` 를 열어 채웁니다:

| 변수 | 용도 |
|---|---|
| `PORT` | 서버 포트 (기본 5000) |
| `ADMIN_PASSWORD` | 리뷰 삭제용 관리자 비밀번호. **미설정 시 관리자 로그인 차단** |
| `SUPABASE_URL` | Supabase 프로젝트 URL (리뷰를 여러 PC/방문자와 공유하려면) |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 쓰기 키(권장). **클라이언트 노출 금지** |
| `SUPABASE_ANON_KEY` | service_role 없을 때 폴백 |
| `KAKAO_REST_API_KEY` | 주소→좌표 지오코딩 스크립트용 (지도 표시용 JS 키와 다름) |

`.env` 는 `.gitignore` 되어 **절대 커밋되지 않습니다.**

---

## 데이터 아키텍처 (하이브리드)

| 데이터 | 성격 | 저장소 |
|---|---|---|
| **places** (102곳 + 좌표) | 정적 참조 데이터 | `data/places.json` (git 포함) |
| **reviews** (사진·리뷰) | 사용자 생성 데이터 | Supabase(설정 시) ↔ 로컬 JSON(폴백) |

정적 참조 데이터를 git에 두고, 실제로 PC 간 공유가 필요한 사용자 데이터만 Supabase에
두는 구조입니다.

> **원본과의 유일한 차이**: 원본은 리뷰 폴백에 SQLite(`better-sqlite3`)를 썼지만,
> 이 저장소는 **의존성 없는 JSON 파일 폴백**을 씁니다. 새 Windows PC에서 네이티브
> 컴파일 실패 없이 `npm install` 만으로 바로 돌아가게 하기 위함입니다. Supabase를
> 설정하면 리뷰는 Supabase에 저장되므로 이 폴백은 사용되지 않습니다.

### Supabase 연결하기

1. [supabase.com](https://supabase.com) 프로젝트 → **SQL Editor** 에서 [`db/schema.sql`](db/schema.sql) 실행 (reviews 테이블 생성)
2. **Project Settings → API** 에서 URL·키를 복사해 `.env` 에 입력
3. (선택) 물놀이장도 Supabase에서 관리하려면 `npm run seed:supabase` 로 `data/places.json` → Supabase `places` 업서트

---

## 스크립트

| 명령 | 설명 |
|---|---|
| `npm start` | 서버 실행 (http://localhost:5000) |
| `npm run seed:supabase` | `data/places.json` → Supabase `places` 업서트 |
| `npm run geocode` | `data/places.json` 의 좌표 없는 항목을 Kakao REST로 채움 |
| `node scripts/geocode.js "주소"` | 임의 주소 한 건 좌표 조회 |

새 물놀이장을 추가할 때: `data/places.json` 에 항목을 `lat/lng` 없이 넣고
`npm run geocode` 실행 → 좌표 자동 채움.

---

## API 계약

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/places` | 물놀이장 목록 `{places:[...]}` |
| GET | `/api/reviews?placeId=` | 특정 장소 리뷰 `{reviews:[...]}` |
| GET | `/api/reviews/counts` | 전체 리뷰 카운트 `{counts:{id:n}}` |
| POST | `/api/reviews` | 리뷰 등록 `{placeId,author,content,photo}` |
| DELETE | `/api/reviews/:id` | 리뷰 삭제 — `X-Admin-Token` 헤더 필요 |
| POST | `/api/admin/login` | 관리자 로그인 `{password}` → `{token}` |
| POST | `/api/admin/logout` | 토큰 폐기 |
| GET | `/api/health` | 상태 확인 |

프론트엔드는 `*.pplx.app` 도메인에서는 `/port/5000` 접두어를, 그 외(로컬 포함)에서는
상대경로 `/api` 를 자동으로 사용합니다(`app.js` / `sheet-loader.js`).

관리자 페이지: 라이브/로컬 모두 URL 끝에 `#admin` 을 붙이면 로그인 창이 열립니다.

---

## 보안 자세 (재작성 서버에 반영)

- **관리자 fail-closed** — `ADMIN_PASSWORD` 미설정 시 로그인 자체 차단(503)
- **서버측 인증** — 리뷰 삭제는 인메모리 토큰 검증(403), UI 숨김 아님
- **브루트포스 제한** — 로그인 IP당 15분 10회
- **리뷰 rate limit** — 등록 IP당 10분 5회 (원본 WARN 항목 반영)
- **관리자 토큰 TTL** — 12시간 후 만료 + 로그아웃 엔드포인트 (원본 WARN 항목 반영)
- **사진 검증** — `data:image/(png|jpg|gif|webp)` 접두어 + 7MB 상한
- **비밀 비노출** — `express.static` 이 `public/` 으로만 한정, `.env`/`server.js` 미노출
- **XSS 방지** — 화면 렌더 전 모두 `esc()` 이스케이프(프론트 `app.js`)
- **정적 참조 데이터 무자격증명 서빙** — `places` 는 쓰기 경로 없음

> 원본 보안 점검에서 WARN 3건(리뷰 rate limit / 사진 심층 검증 / 관리자 토큰 만료)이
> 있었고, 이 중 rate limit·토큰 만료·로그아웃은 이번 재작성에 반영했습니다. 사진은
> 여전히 매직바이트까지는 검사하지 않습니다(출력 이스케이프로 XSS는 차단됨).

---

## 파일 구조

```
mapo-waterplay/
├─ public/                # 프론트엔드 (라이브 원본 그대로)
│  ├─ index.html          # 진입 화면, 로딩 오버레이, 우리어린이집 배너
│  ├─ app.js              # 지도·마커·필터·리뷰·관리자 로직, esc() 이스케이프
│  ├─ style.css           # 전체 스타일
│  ├─ config.js           # (선택) 구글시트 CSV URL — 비어있음
│  ├─ data.js             # 내장 백업 데이터(window.WATERPLAY_PLACES)
│  ├─ mapo-seed.js        # 마포구 11곳 시드(초기 즉시 렌더용)
│  ├─ sheet-loader.js     # /api/places 백그라운드 로더
│  ├─ dol.gif, kids.png   # 우리어린이집 배너 이미지
├─ data/
│  ├─ places.json         # 물놀이장 102곳 + 좌표 (Supabase 스냅샷)
│  └─ reviews.local.json  # 로컬 리뷰 폴백 (git 제외, 자동 생성)
├─ db/
│  └─ schema.sql          # Supabase reviews/places 스키마
├─ scripts/
│  ├─ seed-supabase.js    # places.json → Supabase 업서트
│  └─ geocode.js          # Kakao REST 주소→좌표
├─ server.js              # Express 백엔드 (하이브리드)
├─ load-env.js            # 의존성 없는 .env 로더
├─ .env.example           # 환경변수 템플릿
└─ package.json
```

---

## 카카오맵 도메인 등록 (지도 타일이 안 뜰 때)

`public/index.html` 의 카카오 JS 키는 **도메인 화이트리스트**로 보호되는 공개용
클라이언트 키입니다. 새 도메인(예: `http://localhost:5000`)에서 지도를 보려면:

1. [Kakao Developers](https://developers.kakao.com) → 내 애플리케이션
2. **앱 설정 → 플랫폼 → Web** 에 사이트 도메인 추가 (예: `http://localhost:5000`)
3. **카카오맵 서비스 활성화** 확인

지도 없이도 목록·필터·리뷰·관리자 기능은 정상 동작합니다.

---

## 데이터 현황 (스냅샷 기준)

- 총 **102곳** / **25개 자치구** / 마포구 **11곳** / 유료 **2곳**
  (노원 꿀잼 워터파크, 양재천 수영장 — 라이브 최신 반영)
