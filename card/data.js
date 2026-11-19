// =====================================================================
//  오늘의 키워드 카드 — 기본 설정 파일
//  · 날짜별 문구는 daily/ 폴더에 키워드별로 들어 있습니다 (하루 한 줄, 60일치).
//      한 줄 형식:  말풍선 문구 ## 실천 꿀팁      (" | " 는 줄바꿈)
//      말풍선의 *별표* 단어는 키워드 강조, 꿀팁의 '작은따옴표' 단어는 형광펜 강조
//  · START_DATE 날은 각 파일의 1번째 줄, 다음 날은 2번째 줄… 순서로 하루씩 넘어갑니다.
//  · 그림: image 에 파일이 있으면 그 그림을, 없으면 이모지 그림을 보여줍니다.
// =====================================================================

const CHURCH_NAME = "동해교회";

// QR에 들어갈 카드 주소 (출력 후에는 바꾸지 마세요 — 바꾸면 QR을 다시 뽑아야 해요)
const CARD_URL = "https://attend.iasis-ministry.org/card/";

// 행사 기간 (한국 시간): 2026-11-22(1일차) ~ 2026-12-27(36일차)
//  · 각 키워드 파일의 1~36번째 줄이 행사 기간에 하루씩 나옵니다 (34일차 = 성탄절).
//  · 37번째 줄부터는 예비 문구예요. 행사 전에는 1일차, 행사가 끝난 뒤에는 36일차 문구가 계속 보입니다.
const START_DATE = "2026-11-22";
const EVENT_DAYS = 36;

const DAILY = {};

const KEYWORDS = [
  { id: "courage", name: "용기", flag: "승리", emoji: "🦸", color: "#f97316", image: "img/courage.jpg" },
  { id: "faith", name: "믿음", flag: "아멘", emoji: "🙏", color: "#6366f1", image: "img/faith.jpg" },
  { id: "breakthrough", name: "돌파", flag: "전진", emoji: "🚀", color: "#ef4444", image: "img/breakthrough.jpg" },
  { id: "certainty", name: "확실", flag: "확신", emoji: "💯", color: "#0ea5e9", image: "img/certainty.jpg" },
  { id: "love", name: "사랑", flag: "샬롬", emoji: "💖", color: "#ec4899", image: "img/love.jpg" },
  { id: "together", name: "협력", flag: "하나", emoji: "🤝", color: "#22c55e", image: "img/together.jpg" },
  { id: "skill", name: "실력", flag: "최고", emoji: "🏅", color: "#a855f7", image: "img/skill.jpg" },
];
