// ────────────────────────────────────────────────────────────────
//  구글시트 CSV 로더 + 파서
//  window.loadWaterplayData(callback) 를 호출하면:
//   1) config의 SHEET_CSV_URL 이 있으면 시트에서 CSV를 받아 파싱
//   2) 실패하거나 URL이 없으면 내장 data.js(window.WATERPLAY_PLACES) 사용
//  callback(places, sourceLabel) 형태로 결과를 전달.
// ────────────────────────────────────────────────────────────────
(function () {
  // 간단한 CSV 파서 (따옴표 안의 쉼표/줄바꿈 처리)
  function parseCSV(text) {
    var rows = [], row = [], cur = "", inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i], n = text[i + 1];
      if (inQuotes) {
        if (c === '"' && n === '"') { cur += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { cur += c; }
      } else {
        if (c === '"') { inQuotes = true; }
        else if (c === ",") { row.push(cur); cur = ""; }
        else if (c === "\r") { /* skip */ }
        else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
        else { cur += c; }
      }
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  function clean(v) {
    if (v == null) return "";
    v = String(v).trim();
    return (v === "" || v.toLowerCase() === "n.a." || v === "-") ? "" : v;
  }

  // CSV 행들을 앱 place 객체로 변환
  // 기대 컬럼: 서울시(지역) | 자치구(시군구) | 장소이름 | 주소 | 운영기간 | 일일운영시간 | 쉬는시간/휴장일 | 무료/유료 | 출처
  function rowsToPlaces(rows) {
    if (!rows.length) return [];
    var out = [], idx = 0;
    // 첫 행이 헤더인지 감지 (장소이름/주소 등의 단어가 있으면 헤더로 간주)
    var start = 0;
    var first = rows[0].join(",");
    if (first.indexOf("장소") > -1 || first.indexOf("주소") > -1 || first.indexOf("자치구") > -1) start = 1;
    for (var r = start; r < rows.length; r++) {
      var row = rows[r];
      if (!row || row.length < 3) continue;
      var region = clean(row[0]) || "서울특별시";
      // "서울시" 표기를 "서울특별시"로 정규화
      if (region === "서울시") region = "서울특별시";
      var gu = clean(row[1]);
      var name = clean(row[2]);
      if (!name) continue;
      idx++;
      var addr = clean(row[3]) || (region + " " + gu);
      var period = clean(row[4]) || "2026년 여름";
      var hours = clean(row[5]) || "운영시간 문의";
      var rest = clean(row[6]);
      var fee = clean(row[7]) || "무료";
      var src = clean(row[8]);
      var category = (fee.indexOf("유료") > -1) ? "유료(자치구)" : "무료(자치구)";
      // 한강공원 계열 명칭이면 한강 카테고리로
      if (name.indexOf("한강공원") > -1) category = "한강공원";
      out.push({
        id: "sheet-" + idx,
        region: region,
        district: gu,
        name: name,
        category: category,
        addressRoad: addr,
        lat: null, lng: null,   // 지오코더가 주소로 보정
        period: period,
        hours: hours,
        fee: fee,
        note: rest,
        tel: "",
        source: src
      });
    }
    return out;
  }

  // API_BASE: 배포(*.pplx.app)에서는 백엔드 포트가 자동 라우팅되지 않아 /port/5000 접두어 필요.
  // 로컬/기타 환경에서는 상대경로(/api) 그대로 사용. (app.js API_BASE와 동일)
  function apiBase() {
    return (location.hostname.indexOf(".pplx.app") !== -1) ? "/port/5000" : "";
  }

  window.loadWaterplayData = function (callback) {
    var fallback = function (reason) {
      callback(window.WATERPLAY_PLACES || [], "내장 데이터" + (reason ? " (" + reason + ")" : ""));
    };
    // 1) Supabase(서버 API) 우선
    fetch(apiBase() + "/api/places?_t=" + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        var places = (json && json.places) || [];
        if (!places.length) { fallback("Supabase 비어있음"); return; }
        callback(places, "Supabase");
      })
      .catch(function (e) {
        console.warn("Supabase 로드 실패, 내장 데이터 사용:", e.message);
        fallback("서버 응답 없음");
      });
  };
})();
