/**
 * QR 출결 → 구글 시트 기록용 Apps Script
 *
 * [설정 방법]
 * 1. 구글 시트를 새로 만든 뒤 상단 메뉴 [확장 프로그램] > [Apps Script] 를 엽니다.
 * 2. 기본 코드를 지우고 이 파일 내용을 전부 붙여넣은 뒤 저장합니다.
 * 3. [배포] > [새 배포] > 유형 "웹 앱"
 *      - 다음 사용자 인증 정보로 실행: 나
 *      - 액세스 권한이 있는 사용자: 모든 사용자
 *    → [배포] 후 권한 승인, 표시되는 "웹 앱 URL"(…/exec)을 복사합니다.
 * 4. index.html 상단의 GOOGLE_SCRIPT_URL 에 그 URL을 넣습니다.
 * 5. 편집기 상단에서 함수 "setupViews" 를 골라 [실행] → "오늘 출석", "날짜별 요약" 탭이 생깁니다.
 *    (첫 출석이 기록될 때도 자동으로 만들어집니다)
 * 6. "오늘 출석" 탭을 연 상태에서 [공유] → 관리자에게 "뷰어" 권한으로 공유하고 링크를 복사합니다.
 *    (링크 끝의 #gid=… 덕분에 관리자는 바로 "오늘 출석" 탭으로 들어갑니다)
 *    같은 링크를 index.html 의 SHEET_VIEW_URL 에 넣으면 스캐너 화면에 바로가기 버튼이 생깁니다.
 *
 * 7. 아래 VIEW_PASSWORD 를 원하는 비밀번호로 바꿉니다. 사이트의 [출석 명단] 탭에서 이 비밀번호를 넣으면
 *    시트를 공유하지 않아도 명단을 볼 수 있습니다. (비밀번호는 Apps Script 안에만 있고 사이트 소스에는 없습니다)
 *
 * ※ 코드를 고친 뒤에는 [배포] > [배포 관리] > 수정(연필) > 버전 "새 버전" 으로 다시 배포해야 반영됩니다.
 */

// ⚠️ 명단 보기 비밀번호: Apps Script 편집기에서만 바꾸세요. (GitHub의 apps-script.gs 에는 실제 비밀번호를 올리지 마세요)
//    6자리 이상 추천. 비밀번호를 10번 연속 틀리면 10분간 명단 보기가 잠깁니다.
const VIEW_PASSWORD = "여기에_비밀번호";

const SHEET_NAME = "출석";
const HEADERS = ["날짜", "시간", "고유ID", "이름", "중복확인키"];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // 동시에 들어온 요청이 줄을 꼬지 않도록 순서대로 처리
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.action === "list") return json(listAttendance(d));

    const id = String(d.id || "");
    const time = String(d.time || "");
    if (!/^U-[0-9A-F]{6}$/.test(id) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time)) {
      return json({ ok: false, error: "invalid" });
    }

    const sheet = getSheet();
    const date = time.slice(0, 10);
    const key = date + "|" + id;

    // 같은 날 같은 ID는 한 번만 기록 (태블릿 재전송 시에도 중복 방지)
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const keys = sheet.getRange(2, 5, lastRow - 1, 1).getValues();
      for (let i = 0; i < keys.length; i++) {
        if (keys[i][0] === key) return json({ ok: true, duplicate: true });
      }
    }

    sheet.appendRow([date, time.slice(11), id, safeText(d.name), key]);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    // 날짜·시간이 자동 변환되지 않도록 텍스트 서식 지정
    sheet.getRange("A:B").setNumberFormat("@");
    sheet.hideColumns(5); // 중복확인키는 내부용
  }
  setupViews();
  return sheet;
}

/**
 * 관리자용 보기 탭을 만듭니다 (이미 있으면 건너뜀). 수식이라 기록이 들어오면 자동 갱신됩니다.
 *  - "오늘 출석": 오늘 인원 수 + 명단(시간순)
 *  - "날짜별 요약": 날짜별 출석 인원
 * Apps Script 편집기에서 이 함수를 직접 [실행]해도 됩니다.
 */
function setupViews() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = "'" + SHEET_NAME + "'";
  const today = 'TEXT(TODAY(),"yyyy-mm-dd")';

  if (!ss.getSheetByName("오늘 출석")) {
    const v = ss.insertSheet("오늘 출석", 0); // 첫 번째 탭으로
    v.getRange("A1").setFormula(
      '="📋 "&' + today + '&"  출석 "&COUNTIF(' + src + "!A2:A," + today + ')&"명"'
    );
    v.getRange("A1").setFontSize(16).setFontWeight("bold");
    v.getRange("A3:C3").setValues([["시간", "이름", "고유ID"]]).setFontWeight("bold").setBackground("#eef2ff");
    v.getRange("A4").setFormula(
      "=IFERROR(SORT(FILTER({" + src + "!B2:B," + src + "!D2:D," + src + "!C2:C}," +
        src + "!A2:A=" + today + "),1,TRUE),\"아직 출석자가 없습니다\")"
    );
    v.setFrozenRows(3);
    v.setColumnWidths(1, 3, 120);
  }

  if (!ss.getSheetByName("날짜별 요약")) {
    const s = ss.insertSheet("날짜별 요약", 1);
    s.getRange("A1").setFormula(
      "=IFERROR(QUERY(" + src + "!A2:C,\"select A, count(C) where A is not null group by A order by A desc " +
        "label A '날짜', count(C) '출석 인원'\",0),\"아직 기록이 없습니다\")"
    );
    s.getRange("A1:B1").setFontWeight("bold").setBackground("#eef2ff");
    s.setFrozenRows(1);
    s.setColumnWidths(1, 2, 120);
  }
}

/** 비밀번호 확인 후 해당 날짜(기본: 오늘)의 출석 명단을 돌려줌 */
function listAttendance(d) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get("viewFails") || 0);
  if (fails >= 10) return { ok: false, error: "locked" };
  if (!VIEW_PASSWORD || VIEW_PASSWORD === "여기에_비밀번호") return { ok: false, error: "not_configured" };
  if (String(d.password || "") !== VIEW_PASSWORD) {
    cache.put("viewFails", String(fails + 1), 600);
    return { ok: false, error: "auth" };
  }
  cache.remove("viewFails");

  const date = /^\d{4}-\d{2}-\d{2}$/.test(d.date || "")
    ? d.date
    : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const rows = [];
  if (sheet && sheet.getLastRow() > 1) {
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getDisplayValues();
    values.forEach((r) => {
      if (r[0] === date) rows.push({ time: r[1], id: r[2], name: String(r[3]).replace(/^'/, "") });
    });
  }
  rows.sort((a, b) => a.time.localeCompare(b.time));
  return { ok: true, date: date, count: rows.length, rows: rows };
}

/** 수식으로 해석될 수 있는 값(=, +, -, @ 로 시작)을 일반 텍스트로 저장 */
function safeText(v) {
  const s = String(v || "").slice(0, 30);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
