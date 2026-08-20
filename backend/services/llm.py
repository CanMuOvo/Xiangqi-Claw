"""Generate natural-language teaching explanations using OpenAI."""

from __future__ import annotations

from openai import AsyncOpenAI

from backend.models.schemas import (
    CoachRequest,
    CoachResponse,
    ExplanationRequest,
    ExplanationResponse,
)
from backend.services.openai_client import LLM_MODEL
from backend.services.notation import fen_to_description


def classify_quality(
    user_score_cp: int, best_score_cp: int, prev_score_cp: int
) -> str:
    """Beginner-friendly quality classification.

    The key insight: for a beginner, what matters is whether the move turned
    an advantage into a disadvantage, not the raw centipawn loss. Small
    inaccuracies are fine as long as the position stays favorable.

    Scores are always from the moving side's perspective (positive = good).
    prev_score_cp: engine eval before the move (from moving side's view)
    user_score_cp: eval after user's move (from moving side's view)
    best_score_cp: eval after best move (from moving side's view)
    """
    score_loss = max(0, best_score_cp - user_score_cp)

    was_winning = prev_score_cp > 50
    now_losing = user_score_cp < -50
    flipped = was_winning and now_losing

    if score_loss <= 15:
        return "brilliant"

    if flipped:
        if score_loss > 200:
            return "blunder"
        return "mistake"

    if score_loss <= 60:
        return "good"
    if score_loss <= 150:
        return "inaccuracy"
    if score_loss <= 300:
        return "mistake"
    return "blunder"


def classify_quality_simple(score_loss: int) -> str:
    """Simpler classification used by game review where we don't have prev_score."""
    if score_loss <= 15:
        return "brilliant"
    if score_loss <= 60:
        return "good"
    if score_loss <= 150:
        return "inaccuracy"
    if score_loss <= 300:
        return "mistake"
    return "blunder"


async def generate_explanation(
    req: ExplanationRequest, client: AsyncOpenAI
) -> ExplanationResponse:
    score_loss = max(0, req.best_score_cp - req.user_score_cp)
    prev_score = req.prev_score_cp if req.prev_score_cp is not None else req.best_score_cp
    quality = classify_quality(req.user_score_cp, req.best_score_cp, prev_score)

    player_name = "我方" if req.player_at_bottom == req.side.value else "对方"
    side_name = "红方" if req.side.value == "w" else "黑方"

    if req.player_at_bottom == "w":
        perspective_desc = "你执红棋（棋盘下方），黑棋是对手。"
    else:
        perspective_desc = "你执黑棋（棋盘下方），红棋是对手。"

    pv_user_str = " ".join(req.pv_after_user[:5]) if req.pv_after_user else "无"
    pv_best_str = " ".join(req.pv_after_best[:5]) if req.pv_after_best else "无"

    was_winning = prev_score > 50
    now_losing = req.user_score_cp < -50
    flipped = was_winning and now_losing

    if quality in ("brilliant", "good"):
        tone_instruction = """这步棋走得不错！请表扬学生，然后温和地提一下是否有更好的选择（如果有的话）。
语气要积极、鼓励。如果最佳走法和学生的走法一样或者差距很小，就纯粹表扬即可。"""
    elif quality == "inaccuracy":
        tone_instruction = """这步棋可以走，但不是最优。请温和地指出有更好的选择，引导学生思考为什么另一步更好。
不要批评学生，而是用"你有没有考虑过...""其实还有一步更妙的棋..."这样的引导方式。"""
    else:
        tone_instruction = f"""这步棋走得不太好（{'从优势变成了劣势！' if flipped else '丢失了不少分数'}）。
请明确指出这步棋的问题，并根据引擎搜索出的后续变化，引导学生思考为什么这步棋不好。
比如对手接下来可能怎么走、会造成什么威胁。但语气仍然要友善，像一个耐心的老师。"""

    prompt = f"""你是一位友善的中国象棋教练，正在帮助一个新手学生理解棋局。请用中文解释这步棋。

{perspective_desc}
当前是第 {req.move_number} 手，{side_name}走棋。

走之前的局面评分: {prev_score} 分（正数表示{side_name}优势）
学生走了: {req.user_move_cn}（走后评分: {req.user_score_cp} 分）
最佳着法: {req.best_move_cn}（走后评分: {req.best_score_cp} 分）
差距: {score_loss} 分

学生走法后续可能的变化: {pv_user_str}
最佳走法后续可能的变化: {pv_best_str}

{tone_instruction}

要求:
- 用2-4句话解释
- 不要使用FEN格式或UCI格式的走法表示，用自然的中文棋语（如"车一进一"、"炮打中兵"等）
- 永远从{perspective_desc.split("，")[0].replace("你", "")}的视角来分析
- 不要重复说评分数字，而是用"优势""劣势""均势"等自然语言"""

    resp = await client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=400,
        temperature=0.7,
    )

    explanation = resp.choices[0].message.content.strip()
    return ExplanationResponse(
        explanation=explanation,
        quality=quality,
        score_loss=score_loss,
    )


async def generate_game_summary(
    moves_data: list[dict], client: AsyncOpenAI
) -> str:
    """Generate a summary of an entire game review."""
    move_descriptions = []
    for i, m in enumerate(moves_data):
        if m["quality"] in ("mistake", "blunder"):
            side = "红方" if i % 2 == 0 else "黑方"
            move_descriptions.append(
                f"第{i+1}手: {side}走{m['move']}（{m['quality']}，丢失{m['score_loss']}分）"
            )

    key_moments = "\n".join(move_descriptions[:10]) if move_descriptions else "整局没有明显失误"

    prompt = f"""你是一位中国象棋教练，请用中文总结这盘棋的复盘要点。

关键时刻:
{key_moments}

总步数: {len(moves_data)}

请用3-5句话总结:
1. 双方整体表现
2. 最关键的转折点
3. 一个针对性的提高建议

语气友善，给予鼓励。"""

    resp = await client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=400,
        temperature=0.7,
    )
    return resp.choices[0].message.content.strip()


async def extract_move_candidates(text: str, fen: str, client: AsyncOpenAI) -> list[str]:
    """把学生的话转成候选走法（标准中文记谱），供引擎逐个验证。

    规则解析器无法处理抽象/非标准说法时使用：
    - 学生明确说了走法 → 原样提取
    - 学生只说意图（如"快点出车"）→ 结合棋盘推荐符合意图的具体走法
    提取/推荐失败返回空列表。
    """
    turn_cn = "红" if fen.split()[1] == "w" else "黑"
    board_desc = fen_to_description(fen)
    prompt = f"""你是中国象棋走法生成器。学生会描述他想走的棋或策略，你需要给出 1-2 个**具体走法**（标准中文记谱），供引擎验证。
记谱规则：红方走法用中文数字（一~九），黑方用阿拉伯数字（1~9），格式如「马七进八」「车九进一」「炮二平五」。
当前轮到{turn_cn}方走。
当前局面：{board_desc}

学生的话：{text}

规则：
1. 如果学生明确说出了走法（如「马七进八」），原样提取。
2. 如果学生只说意图（如「快点出车」「想兑子」），根据当前局面推荐 1-2 个符合该意图的具体走法。
3. 如果学生的问题只是询问局面评估/形势（如「当前局面如何」「这棋哪边好」「有什么好棋」），
   而不是想走某步棋，直接输出 none，不要推荐走法。
4. 只输出你能确定在当前局面合法的走法（基于给定的棋子位置和轮走方）。
只输出走法，每行一个，最多 2 个；实在无法给出就走法输出 none。不要输出其他内容。"""

    resp = await client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=80,
        temperature=0,
    )
    lines = resp.choices[0].message.content.strip().splitlines()
    moves: list[str] = []
    for ln in lines:
        ln = ln.strip()
        if not ln or ln.lower() == "none":
            continue
        moves.append(ln)
    return moves[:2]


async def explain_engine_verdict(
    question: str, verdict: str, history_cn: str, fen: str, client: AsyncOpenAI
) -> str:
    """LLM 解读引擎验证结果：解释数据背后的棋理，回应学生的顾虑（如"窝心马不危险吗"）。

    引擎验证数据是权威的、不可更改的，LLM 只负责把它讲成学生能理解的语言，
    不得编造新的分数或走法。
    """
    system_prompt = (
        "你是一位经验丰富、语气友善的中国象棋教练。学生会收到引擎验证结果（数据权威、不可更改），"
        "并提出疑问或顾虑。\n"
        "回答要求（务必遵守）：\n"
        "1. 【最重要】先识别学生话里的具体顾虑（如「会不会丢子」「马是不是要被吃」「会不会被将军」"
        "「这样亏不亏」），**直接回答这个顾虑**：会/不会、为什么。\n"
        "2. 引擎验证结果里的【引擎推演后续】是引擎算出的真实变化线（对方最优应对及后续），"
        "【子力追踪】是引擎沿变化线数棋子得出的「担心的子吃没被吃」（安全/第几步被吃）。"
        "回答「对方会怎么应对」「会不会丢子」「后续局面如何」等问题时，**必须直接引用这两项**，"
        "不要自己推演走法或编造应对。\n"
        "3. 然后给出引擎对这一步的判定（分数、接近最佳/好棋/漏招等），解释为什么。\n"
        "4. 最佳走法只作为简短的对比参照（一两句即可）。\n"
        "5. 可以引用数据，但不得编造新的分数或走法；用自然中文棋语（如「车进肋道」「马跃中路」）；\n"
        "6. 回答 3-6 句话，像老师在耐心讲解。"
    )
    user_prompt = f"""学生的问题：{question}

走棋历史（中文记谱）：{history_cn or "开局"}

【当前棋盘】
{fen_to_description(fen)}

引擎验证结果：
{verdict}

请用中文回答学生。"""

    resp = await client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=400,
        temperature=0.7,
    )
    return resp.choices[0].message.content.strip()


async def generate_coach_reply(
    req: CoachRequest, client: AsyncOpenAI
) -> CoachResponse:
    """AI 教练对话：学生说出对局面的想法/提问，教练结合引擎数据点评回复。"""
    if req.player_at_bottom == "w":
        perspective_desc = "你执红棋（棋盘下方），黑棋是对手。"
    else:
        perspective_desc = "你执黑棋（棋盘下方），红棋是对手。"

    pv_str = " ".join(req.engine_pv_cn[:6]) if req.engine_pv_cn else "暂无"
    board_desc = fen_to_description(req.fen)

    system_prompt = (
        "你是一位经验丰富、语气友善的中国象棋教练，正在和学生在对局中交流。"
        "学生会说出他对当前局面的想法、计划或提问。"
        "你会收到完整的棋盘棋子位置、引擎评估分数、引擎最佳走法及变化线。"
        "回答必须严格遵守以下规则：\n"
        "1. 涉及具体走法和局面判断时，只能依据提供的引擎数据（分数、最佳走法、变化线），"
        "严禁凭空编造走法或评分；如果引擎数据不足，就明确说'这一步需要我进一步分析'。\n"
        "2. 你可以基于棋子位置做战略层面的分析（如子力布置、攻守方向），但具体着法建议"
        "优先引用引擎最佳走法。\n"
        "3. 永远用自然的中文棋语（如「车一进一」「炮打中卒」），不要用 UCI 坐标或 FEN。\n"
        "4. 回答控制在 3-6 句话，像老师在课堂上循循善诱，用「明显优势」「略优」「均势」"
        "等自然语言描述局面，不要罗列数字。"
    )

    user_prompt = f"""{perspective_desc}

【当前棋盘】
{board_desc}

【引擎分析数据】
- 走棋历史（中文）：{req.history_cn or "开局"}
- 引擎评估：{req.engine_score_cp} 分（正数表示当前走棋方优势）
- 引擎最佳走法：{req.engine_best_move_cn or "暂无"}
- 最佳变化线：{pv_str}

【学生的话】
{req.question}
"""

    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    for m in req.messages:
        messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": user_prompt})

    resp = await client.chat.completions.create(
        model=LLM_MODEL,
        messages=messages,
        max_tokens=500,
        temperature=0.7,
    )
    return CoachResponse(reply=resp.choices[0].message.content.strip())
