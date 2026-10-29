"""
텔레그램 챌린지 봇: "나 OOO는 OOO에게 지지 않겠습니다" 선언을 모아서
누구에게 지지 않겠다고 한 선언이 몇 %인지 보여준다.

명령어
  /stats        전체 기간 통계
  /stats today  오늘(KST) 통계
  /me           내 선언 기록
  /reset        이 방의 기록 초기화 (방 관리자만)
"""
import logging
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone

from telegram import Update
from telegram.constants import ChatMemberStatus
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

KST = timezone(timedelta(hours=9))
DB_PATH = os.environ.get("DB_PATH", "challenge.db")

# "OOO에게 지지 않겠습니다" / "OOO님에게 절대 지지 않을 거야" 등에서 OOO를 뽑는다.
PATTERN = re.compile(
    r"(?P<target>[^\s,.!?~'\"]+?)\s*(?:님)?\s*(?:에게|한테|에겐|한텐)\s*"
    r"(?:절대\s*|결코\s*|꼭\s*)?지지\s*않"
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS declarations (
            id INTEGER PRIMARY KEY,
            chat_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            user_name TEXT NOT NULL,
            target TEXT NOT NULL,
            created_at TEXT NOT NULL
        )"""
    )
    return conn


def parse_target(text: str) -> str | None:
    m = PATTERN.search(text)
    return m.group("target") if m else None


def display_name(user) -> str:
    return user.full_name or user.username or str(user.id)


def bar(pct: float, width: int = 10) -> str:
    filled = round(pct / 100 * width)
    return "█" * filled + "░" * (width - filled)


async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.effective_message
    if not msg or not msg.text or not update.effective_user:
        return
    target = parse_target(msg.text)
    if not target:
        return
    user = update.effective_user
    with db() as conn:
        conn.execute(
            "INSERT INTO declarations (chat_id, user_id, user_name, target, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (msg.chat_id, user.id, display_name(user), target,
             datetime.now(KST).isoformat()),
        )
    log.info("chat=%s user=%s target=%s", msg.chat_id, user.id, target)


async def stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    today = bool(context.args) and context.args[0] in ("today", "오늘")
    where, params = "chat_id = ?", [chat_id]
    if today:
        where += " AND substr(created_at, 1, 10) = ?"
        params.append(datetime.now(KST).date().isoformat())

    with db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM declarations WHERE {where}", params
        ).fetchone()[0]
        rows = conn.execute(
            f"""SELECT target, COUNT(*) AS n, COUNT(DISTINCT user_id) AS people
                FROM declarations WHERE {where}
                GROUP BY target ORDER BY n DESC, target""",
            params,
        ).fetchall()

    title = "오늘의" if today else "전체"
    if total == 0:
        await update.effective_message.reply_text(f"{title} 선언이 아직 없습니다.")
        return

    lines = [f"🔥 {title} '지지 않겠습니다' 통계 (총 {total}회)", ""]
    for rank, (target, n, people) in enumerate(rows, 1):
        pct = n / total * 100
        lines.append(f"{rank}. {target}에게  {bar(pct)} {pct:.1f}%  ({n}회, {people}명)")
    await update.effective_message.reply_text("\n".join(lines))


async def me(update: Update, context: ContextTypes.DEFAULT_TYPE):
    with db() as conn:
        rows = conn.execute(
            """SELECT target, COUNT(*) FROM declarations
               WHERE chat_id = ? AND user_id = ?
               GROUP BY target ORDER BY COUNT(*) DESC""",
            (update.effective_chat.id, update.effective_user.id),
        ).fetchall()
    if not rows:
        await update.effective_message.reply_text("아직 선언한 기록이 없습니다.")
        return
    total = sum(n for _, n in rows)
    lines = [f"🙋 {display_name(update.effective_user)}님의 선언 (총 {total}회)", ""]
    for target, n in rows:
        lines.append(f"- {target}에게: {n}회 ({n / total * 100:.1f}%)")
    await update.effective_message.reply_text("\n".join(lines))


async def reset(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat = update.effective_chat
    if chat.type != "private":
        member = await chat.get_member(update.effective_user.id)
        if member.status not in (ChatMemberStatus.ADMINISTRATOR, ChatMemberStatus.OWNER):
            await update.effective_message.reply_text("방 관리자만 초기화할 수 있습니다.")
            return
    with db() as conn:
        conn.execute("DELETE FROM declarations WHERE chat_id = ?", (chat.id,))
    await update.effective_message.reply_text("이 방의 기록을 초기화했습니다.")


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text(
        "'나 OOO는 OOO에게 지지 않겠습니다' 선언을 집계합니다.\n"
        "/stats - 전체 통계\n/stats today - 오늘 통계\n/me - 내 기록\n/reset - 초기화(관리자)"
    )


def main():
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    db().close()
    app = Application.builder().token(token).build()
    app.add_handler(CommandHandler(["start", "help"], start))
    app.add_handler(CommandHandler("stats", stats))
    app.add_handler(CommandHandler("me", me))
    app.add_handler(CommandHandler("reset", reset))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))
    app.run_polling()


if __name__ == "__main__":
    main()
