(function () {
  var places = [];  // loadWaterplayData()가 채움 (구글시트 또는 내장 data.js)
  var map, geocoder;
  var markers = [];
  var overlays = [];
  var activeIndex = -1;
  var provinceFilter = "서울";  // 시/도 탭: 전체 | 서울 | 경기
  var regionFilter = "마포구";  // 첫 화면 기본 필터: 마포구
  var catFilter = "전체";
  var PROVINCE_REGION = { "서울": "서울특별시", "경기": "경기도" };
  var isAdmin = false;
  var currentPlace = null;
  var reviewCounts = {}; // placeId -> count

  var listEl = document.getElementById("list");
  var provinceFiltersEl = document.getElementById("province-filters");
  var regionFiltersEl = document.getElementById("region-filters");
  var catFiltersEl = document.getElementById("cat-filters");
  var errEl = document.getElementById("map-error");
  var errMsgEl = document.getElementById("map-error-msg");

  function tagClass(cat) { return cat.indexOf("무료") > -1 || cat.indexOf("공원") > -1 || cat.indexOf("하천") > -1 || cat.indexOf("도심") > -1 ? "free" : "hangang"; }
  function isFreeCat(cat) { return cat.indexOf("무료") > -1 || cat.indexOf("공원") > -1 || cat.indexOf("하천") > -1 || cat.indexOf("도심") > -1; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }

  // ---- 필터 후보 (선택된 시/도 내 자치구 기준) ----
  function placesInProvince() {
    if (provinceFilter === "전체") return places;
    var want = PROVINCE_REGION[provinceFilter];
    return places.filter(function (p) { return p.region === want; });
  }

  function regions() {
    var seen = {}, out = [];
    placesInProvince().forEach(function (p) { var d = p.district || p.region; if (d && !seen[d]) { seen[d] = 1; out.push(d); } });
    out.sort(function (a, b) { return a.localeCompare(b, "ko"); });
    return ["전체"].concat(out);
  }

  function placeVisible(p) {
    if (provinceFilter !== "전체" && p.region !== PROVINCE_REGION[provinceFilter]) return false;
    if (regionFilter !== "전체" && (p.district || p.region) !== regionFilter) return false;
    if (catFilter === "무료" && !isFreeCat(p.category)) return false;
    if (catFilter === "유료" && (p.fee || "").indexOf("유료") === -1) return false;
    return true;
  }

  // ---- 필터 칩 (버그 수정: 매번 innerHTML 초기화) ----
  function renderFilters() {
    // 시/도 탭
    provinceFiltersEl.innerHTML = "";
    ["전체", "서울", "경기"].forEach(function (pv) {
      var tab = document.createElement("button");
      tab.className = "tab" + (pv === provinceFilter ? " active" : "");
      tab.textContent = pv;
      tab.addEventListener("click", function () {
        if (provinceFilter === pv) return;
        provinceFilter = pv; regionFilter = "전체"; activeIndex = -1;
        renderFilters(); renderList(); applyMarkerVisibility(); fitVisible();
      });
      provinceFiltersEl.appendChild(tab);
    });

    // 지역(자치구) 칩
    regionFiltersEl.innerHTML = "";
    regions().forEach(function (r) {
      var chip = document.createElement("button");
      chip.className = "chip" + (r === regionFilter ? " active" : "");
      chip.textContent = r;
      chip.addEventListener("click", function () {
        regionFilter = r; activeIndex = -1;
        renderFilters(); renderList(); applyMarkerVisibility(); fitVisible();
      });
      regionFiltersEl.appendChild(chip);
    });
    // 카테고리 칩
    catFiltersEl.innerHTML = "";
    var cats = [["전체", "전체"], ["무료", "무료"], ["유료", "유료"]];
    cats.forEach(function (pair) {
      var chip = document.createElement("button");
      chip.className = "chip" + (pair[0] === catFilter ? " active" : "");
      chip.textContent = pair[1];
      chip.addEventListener("click", function () {
        catFilter = pair[0]; activeIndex = -1;
        renderFilters(); renderList(); applyMarkerVisibility(); fitVisible();
      });
      catFiltersEl.appendChild(chip);
    });
  }

  // ---- 사이드바 목록 ----
  function renderList() {
    listEl.innerHTML = "";
    var shown = 0;
    places.forEach(function (p, i) {
      if (!placeVisible(p)) return;
      shown++;
      var rc = reviewCounts[p.id] || 0;
      var card = document.createElement("div");
      card.className = "card" + (i === activeIndex ? " active" : "");
      card.innerHTML =
        '<div class="card-head"><h2>' + esc(p.name) + '</h2>' +
        '<span class="tag ' + tagClass(p.category) + '">' + esc(p.category) + '</span></div>' +
        '<div class="region-badge">' + esc(p.region) + ' · ' + esc(p.district) + '</div>' +
        '<div class="addr">' + esc(p.addressRoad) + '</div>' +
        '<div class="meta">' +
        '<div class="row"><span class="k">기간</span><b>' + esc(p.period) + '</b></div>' +
        '<div class="row"><span class="k">시간</span><span>' + esc(p.hours) + '</span></div>' +
        '<div class="row"><span class="k">요금</span><span>' + esc(p.fee) + '</span></div>' +
        (p.note ? '<div class="row"><span class="k">안내</span><span>' + esc(p.note) + '</span></div>' : '') +
        '</div>' +
        (p.source ? '<a class="src-link" href="' + esc(p.source) + '" target="_blank" rel="noopener">구청 공식 안내 ↗</a>' : '') +
        '<div class="card-foot">' +
        '<button class="card-btn btn-map">지도에서 보기</button>' +
        '<button class="card-btn btn-review">사진·리뷰 <span class="rc">(' + rc + ')</span></button>' +
        '</div>';
      card.querySelector(".btn-map").addEventListener("click", function (e) { e.stopPropagation(); focusPlace(i); });
      card.querySelector(".btn-review").addEventListener("click", function (e) { e.stopPropagation(); openReviews(p); });
      card.addEventListener("click", function () { focusPlace(i); });
      listEl.appendChild(card);
    });
    if (shown === 0) {
      listEl.innerHTML = '<div class="empty-hint">해당 조건의 물놀이장이 없어요.<br>다른 지역/종류를 선택해 보세요.</div>';
    }
  }

  function applyMarkerVisibility() {
    markers.forEach(function (m, i) {
      if (!m) return;
      var vis = placeVisible(places[i]);
      m.setMap(vis ? map : null);
      if (!vis && overlays[i]) overlays[i].setMap(null);
    });
  }

  function fitVisible() {
    if (!map) return;
    var bounds = new kakao.maps.LatLngBounds();
    var any = false;
    markers.forEach(function (m, i) {
      if (m && placeVisible(places[i])) { bounds.extend(m.getPosition()); any = true; }
    });
    if (any) map.setBounds(bounds);
  }

  // ---- 지도 초기화 (지도 객체는 1회만 생성) ----
  function initMap() {
    if (window.__kakaoLoadFailed || typeof kakao === "undefined" || !kakao.maps) {
      showError("카카오맵 SDK를 불러오지 못했습니다. 개발자 콘솔에서 카카오맵 서비스 활성화 및 Web 도메인 등록을 확인해 주세요.");
      renderFilters(); renderList();
      return;
    }
    kakao.maps.load(function () {
      if (!map) {
        var container = document.getElementById("map");
        map = new kakao.maps.Map(container, {
          center: new kakao.maps.LatLng(37.556, 126.98),
          level: 8
        });
        map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
      }
      var hasGeocoder = kakao.maps.services && kakao.maps.services.Geocoder;
      if (hasGeocoder && !geocoder) geocoder = new kakao.maps.services.Geocoder();
      addWooriMarker();
      renderMarkers();
      renderFilters();
      renderList();
    });
  }

  // ---- 우리어린이집 스폰서 마커 (필터·데이터 교체와 무관하게 항상 표시) ----
  var wooriMarker = null, wooriOverlay = null;
  function addWooriMarker() {
    if (wooriMarker || !map) return;
    var pos = new kakao.maps.LatLng(37.5590768, 126.9111368);
    var img = new kakao.maps.MarkerImage(
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(wooriMarkerSvg()),
      new kakao.maps.Size(40, 50),
      { offset: new kakao.maps.Point(20, 50) }
    );
    wooriMarker = new kakao.maps.Marker({ position: pos, map: map, image: img, title: "우리어린이집", zIndex: 5 });

    var content = document.createElement("div");
    content.className = "iw iw-woori";
    content.innerHTML =
      '<span class="iw-close">×</span>' +
      '<div class="iw-badge">공동육아 · AD</div>' +
      '<h3>우리어린이집</h3>' +
      '<div class="iw-addr">서울 마포구 성미산로 25-6</div>' +
      '<div class="iw-meta">' +
      '<div><b>1994년 대한민국 첫 번째 공동육아</b></div>' +
      '<div>자연과 마을에서 자라나는 아이들 · 텔 02-324-0933</div>' +
      '</div>' +
      '<a class="iw-btn" href="https://www.woori1994.com/" target="_blank" rel="noopener">홈페이지 · 입학 상담</a>';
    wooriOverlay = new kakao.maps.CustomOverlay({ position: pos, content: content, yAnchor: 1.32, zIndex: 6 });
    content.querySelector(".iw-close").addEventListener("click", function (e) { e.stopPropagation(); wooriOverlay.setMap(null); });
    kakao.maps.event.addListener(wooriMarker, "click", function () {
      overlays.forEach(function (o) { if (o) o.setMap(null); });
      if (wooriOverlay) { map.panTo(wooriMarker.getPosition()); wooriOverlay.setMap(map); }
    });
  }

  function wooriMarkerSvg() {
    // 주황·노랑 계열 하트/집 마커 (물놀이장과 시각적으로 구분)
    return '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50" viewBox="0 0 40 50">' +
      '<path d="M20 0C9 0 0 9 0 20c0 14 20 30 20 30s20-16 20-30C40 9 31 0 20 0z" fill="#f5a623"/>' +
      '<circle cx="20" cy="20" r="11" fill="#fff"/>' +
      '<path d="M20 26.5l-5.2-5.1c-1.7-1.7-1.7-4.3 0-6 1.6-1.5 4-1.3 5.2.4 1.2-1.7 3.6-1.9 5.2-.4 1.7 1.7 1.7 4.3 0 6L20 26.5z" fill="#f5a623"/>' +
      '</svg>';
  }

  // ---- 마커 전체 재렌더 (데이터 교체 시 호출 가능) ----
  function renderMarkers() {
    // 기존 마커/오버레이 제거
    markers.forEach(function (m) { if (m) m.setMap(null); });
    overlays.forEach(function (o) { if (o) o.setMap(null); });
    markers = [];
    overlays = [];

    var done = 0;
    if (!places.length) { return; }
    places.forEach(function (p, i) {
      function place(pos) {
        addMarker(i, pos);
        done++;
        if (done === places.length) fitVisible();
      }
      // 좌표가 이미 있으면 그대로 사용(빠름). 없을 때만 주소로 지오코딩.
      var hasCoord = p.lat != null && p.lng != null && !isNaN(p.lat) && !isNaN(p.lng);
      if (!hasCoord && geocoder && p.addressRoad) {
        geocoder.addressSearch(p.addressRoad, function (result, status) {
          if (status === kakao.maps.services.Status.OK && result[0]) {
            place(new kakao.maps.LatLng(result[0].y, result[0].x));
          } else {
            place(new kakao.maps.LatLng(p.lat || 37.5665, p.lng || 126.9780));
          }
        });
      } else {
        place(new kakao.maps.LatLng(p.lat || 37.5665, p.lng || 126.9780));
      }
    });
  }

  function addMarker(i, pos) {
    var p = places[i];
    var isFree = isFreeCat(p.category);
    var img = new kakao.maps.MarkerImage(
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markerSvg(isFree)),
      new kakao.maps.Size(34, 44),
      { offset: new kakao.maps.Point(17, 44) }
    );
    var marker = new kakao.maps.Marker({ position: pos, map: map, image: img, title: p.name });
    markers[i] = marker;

    var content = document.createElement("div");
    content.className = "iw";
    content.innerHTML =
      '<span class="iw-close">×</span>' +
      '<h3>' + esc(p.name) + '</h3>' +
      '<div class="iw-addr">' + esc(p.addressRoad) + '</div>' +
      '<div class="iw-meta">' +
      '<div><b>' + esc(p.period) + '</b></div>' +
      '<div>' + esc(p.hours) + ' · ' + esc(p.fee) + '</div>' +
      '<div style="margin-top:4px;color:#5b7a94">' + esc(p.note) + '</div>' +
      '</div>' +
      '<span class="iw-btn">사진·리뷰 보기</span>';

    var overlay = new kakao.maps.CustomOverlay({ position: pos, content: content, yAnchor: 1.35, zIndex: 3 });
    overlays[i] = overlay;
    content.querySelector(".iw-close").addEventListener("click", function (e) { e.stopPropagation(); overlay.setMap(null); });
    content.querySelector(".iw-btn").addEventListener("click", function (e) { e.stopPropagation(); openReviews(p); });

    kakao.maps.event.addListener(marker, "click", function () { focusPlace(i); });
    if (!placeVisible(p)) marker.setMap(null);
  }

  function markerSvg(isFree) {
    var c = isFree ? "#23a06b" : "#2f6fd6";
    return '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">' +
      '<path d="M17 0C7.6 0 0 7.6 0 17c0 12 17 27 17 27s17-15 17-27C34 7.6 26.4 0 17 0z" fill="' + c + '"/>' +
      '<circle cx="17" cy="17" r="8" fill="#fff"/>' +
      '<path d="M11 18c1.2-1.2 2-1.2 3 0s1.8 1.2 3 0 1.8-1.2 3 0" stroke="' + c + '" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
      '</svg>';
  }

  function focusPlace(i) {
    activeIndex = i;
    renderList();
    if (!map || !markers[i]) return;
    overlays.forEach(function (o) { if (o) o.setMap(null); });
    map.panTo(markers[i].getPosition());
    overlays[i].setMap(map);
  }

  function showError(msg) { errMsgEl.innerHTML = msg; errEl.classList.remove("hidden"); }

  // ================= 리뷰 기능 =================
  var modal = document.getElementById("review-modal");
  var rvGallery = document.getElementById("rv-gallery");
  var rvList = document.getElementById("rv-list");
  var rvCount = document.getElementById("rv-count");
  var rvForm = document.getElementById("rv-form");
  var rvName = document.getElementById("rv-name");
  var rvContent = document.getElementById("rv-content");
  var rvPhoto = document.getElementById("rv-photo");
  var rvFileLabel = document.getElementById("rv-file-label");
  var rvPreview = document.getElementById("rv-preview");
  var rvPreviewImg = document.getElementById("rv-preview-img");
  var rvSubmit = document.getElementById("rv-submit");
  var rvMsg = document.getElementById("rv-msg");
  var pendingPhoto = null;

  // 배포(*.pplx.app)에서는 백엔드 포트가 자동 라우팅되지 않아 /port/5000 접두어가 필요함.
  // 로컬/기타 환경에서는 상대경로(/api) 그대로 사용.
  var API_BASE = (location.hostname.indexOf(".pplx.app") !== -1) ? "/port/5000" : "";
  function api(path, opts) {
    return fetch(API_BASE + "/api" + path, opts).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || "요청 실패"); });
      return r.json();
    });
  }

  function openReviews(p) {
    currentPlace = p;
    document.getElementById("rv-place-name").textContent = p.name;
    document.getElementById("rv-place-addr").textContent = p.region + " · " + p.district + " · " + p.addressRoad;
    rvGallery.innerHTML = '<p class="rv-empty">불러오는 중...</p>';
    rvList.innerHTML = '<p class="rv-empty">불러오는 중...</p>';
    rvMsg.textContent = ""; rvMsg.className = "rv-msg";
    resetForm();
    modal.classList.remove("hidden");
    loadReviews(p.id);
  }

  function loadReviews(placeId) {
    api("/reviews?placeId=" + encodeURIComponent(placeId)).then(function (data) {
      var reviews = data.reviews || [];
      reviewCounts[placeId] = reviews.length;
      renderGallery(reviews);
      renderReviews(reviews);
      renderList(); // 사이드바 카운트 갱신
    }).catch(function (e) {
      rvList.innerHTML = '<p class="rv-empty">리뷰를 불러오지 못했습니다: ' + esc(e.message) + '</p>';
      rvGallery.innerHTML = '<p class="rv-empty">-</p>';
    });
  }

  function renderGallery(reviews) {
    var photos = reviews.filter(function (r) { return r.photo_url; });
    if (!photos.length) { rvGallery.innerHTML = '<p class="rv-empty">아직 사진이 없어요.</p>'; return; }
    rvGallery.innerHTML = "";
    photos.forEach(function (r) {
      var img = document.createElement("img");
      img.src = r.photo_url; img.alt = r.author + "님의 사진";
      img.addEventListener("click", function () { openLightbox(r.photo_url); });
      rvGallery.appendChild(img);
    });
  }

  function renderReviews(reviews) {
    rvCount.textContent = reviews.length;
    if (!reviews.length) { rvList.innerHTML = '<p class="rv-empty">첫 리뷰를 남겨보세요.</p>'; return; }
    rvList.innerHTML = "";
    reviews.forEach(function (r) {
      var item = document.createElement("div");
      item.className = "rv-item";
      var date = (r.created_at || "").slice(0, 10);
      var html =
        '<div class="rv-item-head"><span class="rv-item-name">' + esc(r.author) + '</span>' +
        '<span class="rv-item-date">' + esc(date) + '</span></div>' +
        '<div class="rv-item-text">' + esc(r.content) + '</div>';
      if (r.photo_url) html += '<div class="rv-item-photo"><img src="' + esc(r.photo_url) + '" alt="리뷰 사진" /></div>';
      item.innerHTML = html;
      if (r.photo_url) item.querySelector(".rv-item-photo img").addEventListener("click", function () { openLightbox(r.photo_url); });
      if (isAdmin) {
        var del = document.createElement("button");
        del.className = "rv-del"; del.textContent = "삭제";
        del.addEventListener("click", function () { deleteReview(r.id); });
        item.appendChild(del);
      }
      rvList.appendChild(item);
    });
  }

  function deleteReview(id) {
    if (!confirm("이 리뷰를 삭제할까요?")) return;
    api("/reviews/" + id, {
      method: "DELETE",
      headers: { "X-Admin-Token": adminToken || "" }
    }).then(function () {
      loadReviews(currentPlace.id);
    }).catch(function (e) { alert("삭제 실패: " + e.message); });
  }

  // 사진 미리보기 + base64 변환
  rvPhoto.addEventListener("change", function () {
    var file = rvPhoto.files[0];
    if (!file) { pendingPhoto = null; rvPreview.classList.add("hidden"); rvFileLabel.textContent = "사진 첨부 (선택)"; return; }
    if (file.size > 4 * 1024 * 1024) { rvMsg.textContent = "사진은 4MB 이하만 가능합니다."; rvMsg.className = "rv-msg err"; rvPhoto.value = ""; return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      pendingPhoto = e.target.result;
      rvPreviewImg.src = pendingPhoto;
      rvPreview.classList.remove("hidden");
      rvFileLabel.textContent = file.name;
    };
    reader.readAsDataURL(file);
  });

  rvForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var author = rvName.value.trim();
    var content = rvContent.value.trim();
    if (!author || !content) return;
    rvSubmit.disabled = true; rvMsg.textContent = "등록 중..."; rvMsg.className = "rv-msg";
    api("/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId: currentPlace.id, author: author, content: content, photo: pendingPhoto })
    }).then(function () {
      rvMsg.textContent = "리뷰가 등록되었습니다. 고맙습니다!"; rvMsg.className = "rv-msg ok";
      resetForm();
      loadReviews(currentPlace.id);
    }).catch(function (err) {
      rvMsg.textContent = "등록 실패: " + err.message; rvMsg.className = "rv-msg err";
    }).finally(function () { rvSubmit.disabled = false; });
  });

  function resetForm() {
    rvForm.reset(); pendingPhoto = null;
    rvPreview.classList.add("hidden");
    rvFileLabel.textContent = "사진 첨부 (선택)";
  }

  // 모달 닫기
  Array.prototype.forEach.call(document.querySelectorAll("[data-close]"), function (el) {
    el.addEventListener("click", function () { modal.classList.add("hidden"); });
  });

  // ================= 관리자 =================
  var adminModal = document.getElementById("admin-modal");
  var adminBtn = document.getElementById("admin-btn");
  var adminForm = document.getElementById("admin-form");
  var adminPw = document.getElementById("admin-pw");
  var adminMsg = document.getElementById("admin-msg");
  var adminLogged = document.getElementById("admin-logged");
  var adminToken = null;

  // 관리자 로그인 창 열기 (숨은 URL #admin 또는 로그인 상태의 버튼으로만 접근)
  function openAdmin() {
    adminModal.classList.remove("hidden");
    updateAdminUI();
  }
  adminBtn.addEventListener("click", openAdmin);

  // 주소 끝에 #admin 이 있으면 관리자 로그인 창 자동 노출 (평소엔 완전히 숨김)
  function checkAdminHash() {
    if ((location.hash || "").toLowerCase() === "#admin") openAdmin();
  }
  checkAdminHash();
  window.addEventListener("hashchange", checkAdminHash);
  Array.prototype.forEach.call(document.querySelectorAll("[data-close-admin]"), function (el) {
    el.addEventListener("click", function () {
      adminModal.classList.add("hidden");
      // 로그인 안 한 상태에서 닫으면 #admin 해시 제거 (새로고침 시 재노출 방지)
      if (!isAdmin && (location.hash || "").toLowerCase() === "#admin") {
        history.replaceState(null, "", location.pathname + location.search);
      }
    });
  });

  adminForm.addEventListener("submit", function (e) {
    e.preventDefault();
    adminMsg.textContent = "확인 중..."; adminMsg.className = "rv-msg";
    api("/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: adminPw.value })
    }).then(function (res) {
      isAdmin = true; adminToken = res.token;
      adminMsg.textContent = ""; adminPw.value = "";
      // 로그인 성공 시에만 버튼을 노출 (상태 표시 + 재접근/로그아웃용)
      adminBtn.classList.remove("hidden");
      adminBtn.classList.add("on"); adminBtn.textContent = "관리자 ✓";
      updateAdminUI();
      if (currentPlace && !modal.classList.contains("hidden")) loadReviews(currentPlace.id);
    }).catch(function () {
      adminMsg.textContent = "비밀번호가 올바르지 않습니다."; adminMsg.className = "rv-msg err";
    });
  });

  document.getElementById("admin-logout").addEventListener("click", function () {
    isAdmin = false; adminToken = null;
    // 로그아웃하면 버튼을 다시 완전히 숨김
    adminBtn.classList.remove("on"); adminBtn.textContent = "관리자";
    adminBtn.classList.add("hidden");
    adminModal.classList.add("hidden");
    updateAdminUI();
    if (currentPlace && !modal.classList.contains("hidden")) loadReviews(currentPlace.id);
  });

  function updateAdminUI() {
    if (isAdmin) { adminForm.classList.add("hidden"); adminLogged.classList.remove("hidden"); }
    else { adminForm.classList.remove("hidden"); adminLogged.classList.add("hidden"); }
  }

  // ================= 라이트박스 =================
  var lightbox = document.createElement("div");
  lightbox.className = "lightbox hidden";
  lightbox.innerHTML = '<img alt="확대 이미지" />';
  document.body.appendChild(lightbox);
  lightbox.addEventListener("click", function () { lightbox.classList.add("hidden"); });
  function openLightbox(src) { lightbox.querySelector("img").src = src; lightbox.classList.remove("hidden"); }

  // ESC 키로 모달 닫기
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      modal.classList.add("hidden"); adminModal.classList.add("hidden"); lightbox.classList.add("hidden");
    }
  });

  // 시작 시 전체 리뷰 카운트 미리 로드
  function preloadCounts() {
    api("/reviews/counts").then(function (data) {
      reviewCounts = data.counts || {};
      renderList();
    }).catch(function () { /* 무시 */ });
  }

  // 데이터 소스 표시 (선택)
  function showSourceBadge(label) {
    var el = document.getElementById("data-source");
    if (el) el.textContent = "데이터: " + label + " · " + places.length + "곳";
  }

  // ---- 로딩 오버레이 제어 ----
  function setLoadingText(msg) {
    var t = document.getElementById("loading-text");
    if (t) t.textContent = msg;
  }
  function hideLoading() {
    var el = document.getElementById("loading-overlay");
    if (!el) return;
    el.classList.add("hide");
    setTimeout(function () { if (el && el.parentNode) el.style.display = "none"; }, 500);
  }

  // 시작: (1) 마포구 시드로 즉시 렌더 → (2) 전체 목록 백그라운드 로드 후 교체
  function bootstrap() {
    // (1) 마포구 시드 데이터로 즉시 지도/마커 렌더 (네트워크 대기 없음)
    var seed = window.MAPO_SEED_PLACES || [];
    if (seed.length) {
      places = seed.slice();
      showSourceBadge("마포구");
      initMap();
      setLoadingText("마포구 물놀이장을 먼저 보여드려요 · 서울 전체 불러오는 중...");
    } else {
      setLoadingText("물놀이장 정보를 불러오는 중...");
    }

    // (2) 전체 데이터(102곳) 백그라운드 로드
    if (typeof window.loadWaterplayData === "function") {
      window.loadWaterplayData(function (loaded, label) {
        var full = loaded || [];
        if (full.length) {
          places = full;
          showSourceBadge(label);
          // 지도가 이미 있으면 마커만 교체, 아직 없으면 초기화
          if (map) { renderMarkers(); renderFilters(); renderList(); }
          else { initMap(); }
        }
        preloadCounts();
        hideLoading();
      });
    } else {
      // 폴백: 로더 없으면 내장 전체 데이터
      var full = window.WATERPLAY_PLACES || [];
      if (full.length) { places = full; if (map) { renderMarkers(); renderFilters(); renderList(); } else { initMap(); } }
      preloadCounts();
      hideLoading();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
