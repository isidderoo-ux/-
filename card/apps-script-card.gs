/**
 * 키워드 카드 조회 기록용 Apps Script (출석 체크 시트와 별도)
 *
 * [설정 방법]
 * 1. 구글 드라이브에서 새 구글 시트를 만듭니다. (예: "키워드 카드 기록")
 * 2. 상단 메뉴 [확장 프로그램] > [Apps Script] 를 엽니다.
 * 3. 기본 코드를 지우고 이 파일 내용을 전부 붙여넣은 뒤 저장합니다.
 * 4. 편집기 위쪽에서 함수 "setup" 을 골라 [실행] → 권한 승인
 *      → "카드조회", "카드 요약" 탭이 만들어집니다.
 * 5. [배포] > [새 배포] > 톱니바퀴에서 유형 "웹 앱"
 *      - 다음 사용자 인증 정보로 실행: 나
 *      - 액세스 권한이 있는 사용자: 모든 사용자
 *    → [배포] 후 나오는 "웹 앱 URL"(…/exec)을 복사합니다.
 * 6. 그 주소를 card/data.js 의 LOG_URL 에 넣습니다. (주소를 알려주시면 대신 넣어드려요)
 *
 * [기록 규칙]
 *  - 카드를 열 때마다 "카드조회" 탭에 한 줄 (날짜, 시간, 키워드, 기기ID, 출입증ID, 이름)
 *  - 같은 날 같은 기기에서 같은 키워드를 여러 번 열면 1번만 기록
 *  - 기기ID는 폰마다 정해지는 익명 번호. 출석 체크 출입증이 그 폰에 저장돼 있으면 가려진 이름도 기록
 *  - "카드 요약" 탭: 총 조회 수, 참여 인원(기기 기준), 날짜별·키워드별 조회 수, 날짜별 참여 인원
 *
 * ※ 코드를 고친 뒤에는 [배포] > [배포 관리] > 수정(연필) > 버전 "새 버전" 으로 다시 배포해야 반영됩니다.
 */

const CARD_SHEET = "카드조회";
const CARD_HEADERS = ["날짜", "시간", "키워드", "기기ID", "출입증ID", "이름", "중복확인키"];
const CARD_KEYWORDS = ["용기", "믿음", "돌파", "확실", "사랑", "협력", "실력"];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // 동시에 들어온 요청을 순서대로 처리
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.action !== "card") return json({ ok: false, error: "unknown" });
    return json(logCardView(d));
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function logCardView(d) {
  const kw = String(d.kw || "");
  const device = String(d.device || "");
  const time = String(d.time || "");
  if (CARD_KEYWORDS.indexOf(kw) < 0 || !/^D-[0-9A-Z]{8}$/.test(device) ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time)) {
    return { ok: false, error: "invalid" };
  }
  const uid = /^U-[0-9A-F]{6}$/.test(String(d.uid || "")) ? String(d.uid) : "";
  const date = time.slice(0, 10);
  const key = date + "|" + device + "|" + kw;

  const sheet = getCardSheet();
  if (sheet.getLastRow() > 1) {
    const found = sheet.getRange(2, 7, sheet.getLastRow() - 1, 1)
      .createTextFinder(key).matchEntireCell(true).findNext();
    if (found) return { ok: true, duplicate: true };
  }
  sheet.appendRow([date, time.slice(11), kw, device, uid, uid ? safeText(d.name) : "", key]);
  return { ok: true };
}

/** 처음 한 번 편집기에서 실행: 탭 만들기 */
function setup() {
  getCardSheet();
}

function getCardSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CARD_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CARD_SHEET);
    sheet.appendRow(CARD_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange("A:B").setNumberFormat("@"); // 날짜·시간 자동 변환 방지
    sheet.hideColumns(7); // 중복확인키는 내부용
    const first = ss.getSheetByName("시트1") || ss.getSheetByName("Sheet1");
    if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  }
  setupCardViews();
  return sheet;
}

/** "카드 요약" 탭 (수식이라 기록이 들어오면 자동 갱신) */
function setupCardViews() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName("카드 요약")) return;
  const src = "'" + CARD_SHEET + "'";
  const v = ss.insertSheet("카드 요약", 0);
  v.getRange("A1").setFormula(
    '="📊 키워드 카드  총 조회 "&COUNTA(' + src + '!A2:A)&"회 · 참여 인원 "&COUNTUNIQUE(' + src + '!D2:D)&"명(기기 기준)"'
  ).setFontSize(15).setFontWeight("bold");
  v.getRange("A3").setValue("날짜별 · 키워드별 조회 수").setFontWeight("bold");
  v.getRange("A4").setFormula(
    "=IFERROR(QUERY(" + src + "!A2:D,\"select A, count(D) where A is not null group by A pivot C order by A desc label A '날짜'\",0),\"아직 기록이 없습니다\")"
  );
  v.getRange("K3").setValue("날짜별 참여 인원").setFontWeight("bold");
  v.getRange("K4").setFormula(
    "=IFERROR(QUERY(UNIQUE(FILTER({" + src + "!A2:A," + src + "!D2:D}," + src + "!A2:A<>\"\")),\"select Col1, count(Col2) group by Col1 order by Col1 desc label Col1 '날짜', count(Col2) '참여 인원'\",0),\"\")"
  );
  v.getRange("A4:H4").setFontWeight("bold").setBackground("#fef3c7");
  v.getRange("K4:L4").setFontWeight("bold").setBackground("#fef3c7");
  v.getRange("A5:A").setNumberFormat("yyyy-mm-dd");   // 날짜가 숫자(46345 등)로 보이지 않도록
  v.getRange("K5:K").setNumberFormat("yyyy-mm-dd");
  v.setFrozenRows(4);
}

/** 이미 만들어진 "카드 요약" 탭의 날짜 표시 고치기 (편집기에서 한 번 실행) */
function fixDateFormat() {
  const v = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("카드 요약");
  if (!v) return;
  v.getRange("A5:A").setNumberFormat("yyyy-mm-dd");
  v.getRange("K5:K").setNumberFormat("yyyy-mm-dd");
}

/** 수식으로 해석될 수 있는 값(=, +, -, @ 로 시작)을 일반 텍스트로 저장 */
function safeText(v) {
  const s = String(v || "").slice(0, 30);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
