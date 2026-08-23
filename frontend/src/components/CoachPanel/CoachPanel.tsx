import { useEffect, useRef, useState } from 'react';
import './CoachPanel.css';

interface Props {
  fen: string;
  historyCn: string;
  playerAtBottom: 'w' | 'b';
  /** 沙盘演示：把教练推演的走法序列交给沙盘自动演示 */
  onDemoMoves?: (moves: string[]) => void;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 可沙盘演示的走法序列（UCI） */
  sandboxMoves?: string[];
  /** 消息生成时的局面 FEN：局面变化后推演按钮失效（序列不再匹配） */
  fen?: string;
}

const QUICK_QUESTIONS = ['当前谁优势？', '我该怎么走？', '可以绝杀吗？'];

export default function CoachPanel({
  fen,
  historyCn,
  playerAtBottom,
  onDemoMoves,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // 已展开的长消息索引（默认折叠超长回复，避免撑爆对话区）
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const fenRef = useRef(fen);
  // 当前局面在对话列表中的起始索引：换局面后只把新局面的对话发给 AI
  const sessionStartRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  // 估算内容是否超长：按消息宽度约 16 字符/行折算总行数
  const isLongContent = (content: string): boolean => {
    let total = 0;
    for (const line of content.split('\n')) {
      total += Math.max(1, Math.ceil(line.length / 16));
    }
    return total > 6;
  };

  const toggleExpand = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }
      return next;
    });
  };

  // 识别走法片段：中文数字（一二三）= 红方走法，阿拉伯数字（1-9）= 黑方走法
  const renderMoves = (text: string, keyStart: number): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    const moveRe = /([車车馬马象相士仕將将帥帅炮砲兵卒])([一二三四五六七八九1-9１-９])([進进退平])([一二三四五六七八九1-9１-９])/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let k = keyStart;
    while ((m = moveRe.exec(text)) !== null) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const isRed = /[一二三四五六七八九]/.test(m[2]);
      out.push(
        <span key={k++} className={isRed ? 'mv-red' : 'mv-black'}>{m[0]}</span>,
      );
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };

  // 渲染消息内容：把【标签】转成金色高亮徽标，走法按红黑着色，正文保持原样
  const renderContent = (content: string) => {
    const tokens: React.ReactNode[] = [];
    const re = /【([^】]+)】/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let key = 0;
    while ((m = re.exec(content)) !== null) {
      if (m.index > last) tokens.push(...renderMoves(content.slice(last, m.index), key));
      tokens.push(<span key={key++} className="coach-tag">{m[1]}</span>);
      last = m.index + m[0].length;
    }
    if (last < content.length) tokens.push(...renderMoves(content.slice(last), key));
    return tokens;
  };

  // 换局面（走棋/回看/新局）：保留历史对话；仅当当前局面有过实际问答时才插入分隔提示
  useEffect(() => {
    if (fenRef.current !== fen) {
      fenRef.current = fen;
      const recentConversation = messages
        .slice(sessionStartRef.current)
        .some((m) => m.role !== 'system');
      if (recentConversation) {
        sessionStartRef.current = messages.length;
        setMessages([
          ...messages,
          { role: 'system', content: '—— 局面已变化，以下对话基于新局面的分析 ——' },
        ]);
      }
    }
  }, [fen, messages]);

  // 新消息自动滚动到底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;
    const nextMessages: Message[] = [...messages, { role: 'user', content: q }];
    setMessages(nextMessages);
    setInput('');

    // 「这步对吗」只是引导，本地直接回答
    if (q.includes('对吗')) {
      setMessages([
        ...nextMessages,
        {
          role: 'assistant',
          content:
            '请在棋盘上走出你想走的一步（引擎分析面板会显示评分变化）；也可以直接告诉我你具体想走哪步（如「走车九进一」），我来分析这步棋和最佳着法的差距。',
        },
      ]);
      return;
    }

    // 其余问题（快捷/走法/抽象）都走后端：后端实时引擎分析 + 验证 + LLM 兜底，
    // 不依赖前端引擎分析面板的开关状态；历史只带当前局面以来的对话
    setLoading(true);
    try {
      const sessionMessages = messages
        .slice(sessionStartRef.current)
        .filter((m) => m.role !== 'system');
      const resp = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fen,
          question: q,
          history_cn: historyCn,
          player_at_bottom: playerAtBottom,
          messages: sessionMessages,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setMessages([...nextMessages, {
          role: 'assistant',
          content: data.reply,
          fen,
          sandboxMoves: Array.isArray(data.sandbox_moves) && data.sandbox_moves.length > 0
            ? data.sandbox_moves
            : undefined,
        }]);
      } else {
        const err = await resp.json().catch(() => ({ detail: '请求失败' }));
        setMessages([...nextMessages, { role: 'assistant', content: err.detail || '请求失败' }]);
      }
    } catch {
      setMessages([...nextMessages, { role: 'assistant', content: '网络错误，请稍后重试' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="coach-panel">
      <div className="coach-header">
        <h3>AI 教练</h3>
        <span className="coach-hint">说出你对当前局面的想法</span>
      </div>

      <div className="coach-list" ref={listRef}>
        {messages.length === 0 && (
          <p className="coach-empty">
            想和教练聊聊当前局面吗？说出你的思路或疑问，例如「我想兑子简化局面」
          </p>
        )}
        {messages.map((m, i) =>
          m.role === 'system' ? (
            <div key={i} className="coach-divider">
              {m.content}
            </div>
          ) : (
            <div key={i} className={`coach-msg ${m.role}`}>
              <span className="coach-msg-label">{m.role === 'user' ? '你' : '教练'}</span>
              <div className="coach-msg-body">
                <div className={`coach-msg-content${isLongContent(m.content) && !expanded.has(i) ? ' clamped' : ''}`}>
                  {renderContent(m.content)}
                </div>
                {isLongContent(m.content) && (
                  <button className="coach-expand" onClick={() => toggleExpand(i)}>
                    {expanded.has(i) ? '收起 ▴' : '展开全部 ▾'}
                  </button>
                )}
                {m.role === 'assistant' && m.sandboxMoves && m.sandboxMoves.length > 0 && m.fen === fen && (
                  <button className="coach-demo" onClick={() => onDemoMoves?.(m.sandboxMoves!)}>
                    ▶ 沙盘演示推演
                  </button>
                )}
              </div>
            </div>
          ),
        )}
        {loading && (
          <div className="coach-msg assistant">
            <span className="coach-msg-label">教练</span>
            <div className="coach-msg-content coach-typing">正在思考…</div>
          </div>
        )}
      </div>

      <form
        className="coach-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className="coach-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入你对当前局面的想法..."
          disabled={loading}
        />
        <button type="submit" className="coach-send" disabled={loading || !input.trim()}>
          发送
        </button>
      </form>

      <div className="coach-quick">
        {QUICK_QUESTIONS.map((q) => (
          <button key={q} className="coach-quick-btn" onClick={() => send(q)} disabled={loading}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
