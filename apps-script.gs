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
 * 5. 관리자에게는 시트 우측 상단 [공유] 에서 "보기 권한"으로 링크를 공유하고,
 *    같은 링크를 index.html 의 SHEET_VIEW_URL 에 넣으면 스캐너 화면에 바로가기 버튼이 생깁니다.
 *
 * ※ 코드를 고친 뒤에는 [배포] > [배포 관리] > 수정(연필) > 버전 "새 버전" 으로 다시 배포해야 반영됩니다.
 */

const SHEET_NAME = "출석";
const HEADERS = ["날짜", "시간", "고유ID", "이름", "중복확인키"];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // 동시에 들어온 요청이 줄을 꼬지 않도록 순서대로 처리
  try {
    const d = JSON.parse(e.postData.contents);
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
  }
  return sheet;
}

/** 수식으로 해석될 수 있는 값(=, +, -, @ 로 시작)을 일반 텍스트로 저장 */
function safeText(v) {
  const s = String(v || "").slice(0, 30);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
