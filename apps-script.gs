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
 * 5. 편집기 상단에서 함수 "setupViews" 를 골라 [실행] → "오늘 출석", "날짜별 요약", "개인별 출석" 탭이 생깁니다.
 *    (첫 출석이 기록될 때도 자동으로 만들어집니다)
 * 6. "오늘 출석" 탭을 연 상태에서 [공유] → 관리자에게 "뷰어" 권한으로 공유하고 링크를 복사합니다.
 *    (링크 끝의 #gid=… 덕분에 관리자는 바로 "오늘 출석" 탭으로 들어갑니다)
 *    같은 링크를 index.html 의 SHEET_VIEW_URL 에 넣으면 스캐너 화면에 바로가기 버튼이 생깁니다.
 *
 * 7. 아래 VIEW_PASSWORD 를 원하는 비밀번호로 바꿉니다. 사이트의 [출석 명단] 탭에서 이 비밀번호를 넣으면
 *    시트를 공유하지 않아도 명단을 볼 수 있습니다. (비밀번호는 Apps Script 안에만 있고 사이트 소스에는 없습니다)
 *
 * 8. (권장) 편집기에서 함수 "installDailyPurge" 를 골라 [실행] → 매일 새벽 3시에 보관 기간이 지난 기록을 지웁니다.
 *    실행하지 않아도 출석이 기록될 때 하루 한 번 자동으로 정리됩니다.
 *
 * ※ 코드를 고친 뒤에는 [배포] > [배포 관리] > 수정(연필) > 버전 "새 버전" 으로 다시 배포해야 반영됩니다.
 */

// ⚠️ 명단 보기 비밀번호: Apps Script 편집기에서만 바꾸세요. (GitHub의 apps-script.gs 에는 실제 비밀번호를 올리지 마세요)
//    6자리 이상 추천. 비밀번호를 10번 연속 틀리면 10분간 명단 보기가 잠깁니다.
const VIEW_PASSWORD = "여기에_비밀번호";

// 출석 기록 보관 기간(일). 이 기간이 지난 기록은 시트에서 자동으로 지워집니다.
const RETENTION_DAYS = 30;

const SHEET_NAME = "출석";
const HEADERS = ["날짜", "시간", "고유ID", "이름", "중복확인키"];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // 동시에 들어온 요청이 줄을 꼬지 않도록 순서대로 처리
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.action === "list") return json(listAttendance(d));
    if (d.action === "summary") return json(personSummary(d));

    const id = String(d.id || "");
    const time = String(d.time || "");
    if (!/^U-[0-9A-F]{6}$/.test(id) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time)) {
      return json({ ok: false, error: "invalid" });
    }

    const sheet = getSheet();
    const date = time.slice(0, 10);
    const key = date + "|" + id;
    if (date <= cutoffDate()) return json({ ok: true, expired: true }); // 보관 기간이 지난 기록(늦게 재전송된 것)은 버림

    // 같은 날 같은 ID는 한 번만 기록 (태블릿 재전송 시에도 중복 방지)
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const keys = sheet.getRange(2, 5, lastRow - 1, 1).getValues();
      for (let i = 0; i < keys.length; i++) {
        if (keys[i][0] === key) return json({ ok: true, duplicate: true });
      }
    }

    sheet.appendRow([date, time.slice(11), id, safeText(d.name), key]);
    purgeIfDue();
    rebuildPersonSheet();
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
 *  - "개인별 출석": 사람별 날짜마다 ✓ 표시와 합계 (rebuildPersonSheet 가 채움)
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

  if (!ss.getSheetByName("개인별 출석")) rebuildPersonSheet();

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
/** 명단 비밀번호 확인. 틀리면 오류 코드, 맞으면 null. 10번 연속 틀리면 10분 잠금 */
function checkPassword(d) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get("viewFails") || 0);
  if (fails >= 10) return "locked";
  if (!VIEW_PASSWORD || VIEW_PASSWORD === "여기에_비밀번호") return "not_configured";
  if (String(d.password || "") !== VIEW_PASSWORD) {
    cache.put("viewFails", String(fails + 1), 600);
    return "auth";
  }
  cache.remove("viewFails");
  return null;
}

function listAttendance(d) {
  const error = checkPassword(d);
  if (error) return { ok: false, error: error };

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

/** 출석 기록 전체 → 날짜 목록(오름차순)과 사람별 출석 날짜 */
function collectAttendance() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const dates = {};
  const people = {};
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getDisplayValues().forEach((r) => {
      const date = r[0], id = r[2];
      if (!date || !id) return;
      dates[date] = true;
      if (!people[id]) people[id] = { id: id, name: "", dates: {} };
      people[id].name = String(r[3]).replace(/^'/, ""); // 가장 최근 이름
      people[id].dates[date] = true;
    });
  }
  return { dates: Object.keys(dates).sort(), people: Object.keys(people).map((k) => people[k]) };
}

/** 사람별 출석 현황 (최근 limit회 모임 기준, 0이면 전체). 날짜는 최신순.
 *  기간 안에 한 번도 안 온 사람도 포함 → 장기 결석자 확인용 */
function personSummary(d) {
  const error = checkPassword(d);
  if (error) return { ok: false, error: error };

  const all = collectAttendance();
  const limit = Math.max(0, Math.floor(Number(d.limit) || 0));
  const dates = all.dates.slice().reverse().slice(0, limit || undefined);
  const rows = all.people
    .map((p) => {
      const attended = dates.map((dt) => !!p.dates[dt]);
      return { id: p.id, name: p.name, attended: attended, total: attended.filter(Boolean).length };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ko"));
  return { ok: true, dates: dates, totalDates: all.dates.length, people: rows };
}

/** "개인별 출석" 탭을 기록 전체로 다시 채움 (출석이 기록될 때마다 자동 실행) */
function rebuildPersonSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("개인별 출석");
  if (!sheet) {
    sheet = ss.insertSheet("개인별 출석", 2);
    sheet.setFrozenRows(1);
    sheet.setFrozenColumns(3);
  }
  const all = collectAttendance();
  const header = ["이름", "고유ID", "합계"].concat(all.dates);
  const rows = all.people
    .map((p) => {
      const marks = all.dates.map((dt) => (p.dates[dt] ? "✓" : ""));
      return [p.name, p.id, marks.filter(Boolean).length].concat(marks);
    })
    .sort((a, b) => b[2] - a[2] || String(a[0]).localeCompare(String(b[0]), "ko"));
  sheet.clearContents();
  const values = [header].concat(rows);
  // 날짜 머리글이 날짜 형식으로 바뀌지 않도록 머리글 행은 텍스트로
  sheet.getRange(1, 1, 1, header.length).setNumberFormat("@").setFontWeight("bold").setBackground("#eef2ff");
  sheet.getRange(1, 1, values.length, header.length).setValues(values);
  sheet.getRange(1, 3, values.length, header.length - 2).setHorizontalAlignment("center");
}

// ---------- 보관 기간 지난 기록 삭제 ----------

/** 이 날짜 이하(yyyy-MM-dd)의 기록은 삭제 대상. 오늘이 10-29 이고 30일 보관이면 09-29 */
function cutoffDate() {
  const d = new Date();
  d.setDate(d.getDate() - RETENTION_DAYS);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

/** "출석" 탭에서 보관 기간이 지난 행을 지우고 지운 행 수를 돌려줌 */
function purgeOldRecords() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const cutoff = cutoffDate();
  const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length);
  const rows = range.getValues();
  const shown = range.getDisplayValues(); // 날짜 비교는 화면에 보이는 "yyyy-MM-dd" 글자로
  const keep = rows
    .filter((r, i) => shown[i][0] > cutoff)
    .map((r) => [r[0], r[1], r[2], safeText(r[3]), r[4]]); // 다시 쓸 때 이름이 수식으로 바뀌지 않게
  const removed = rows.length - keep.length;
  if (!removed) return 0;
  range.clearContent();
  if (keep.length) sheet.getRange(2, 1, keep.length, HEADERS.length).setValues(keep);
  return removed;
}

/** 출석이 기록될 때 하루 한 번만 정리 (트리거를 설치하지 않아도 동작하도록) */
function purgeIfDue() {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  if (props.getProperty("lastPurge") === today) return;
  purgeOldRecords();
  props.setProperty("lastPurge", today);
}

/** 매일 실행되는 정리 작업 (installDailyPurge 가 등록) */
function dailyPurge() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    purgeOldRecords();
    rebuildPersonSheet();
  } finally {
    lock.releaseLock();
  }
}

/** 편집기에서 한 번 실행: 매일 새벽 3시에 dailyPurge 를 돌리는 트리거 등록 */
function installDailyPurge() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "dailyPurge")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("dailyPurge").timeBased().everyDays(1).atHour(3).create();
  dailyPurge(); // 지금 한 번 바로 정리
}

/** 수식으로 해석될 수 있는 값(=, +, -, @ 로 시작)을 일반 텍스트로 저장 */
function safeText(v) {
  const s = String(v || "").slice(0, 30);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
