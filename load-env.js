// ────────────────────────────────────────────────────────────────
//  의존성 없는 초경량 .env 로더
//  프로젝트 루트의 .env 를 읽어 process.env 에 주입(이미 있는 값은 유지).
//  server.js / scripts 최상단에서 require('./load-env') 로 사용.
// ────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!m) continue; // 주석/빈 줄 무시
    const key = m[1];
    let val = (m[2] || '').trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
