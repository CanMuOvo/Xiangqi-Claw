import { useEffect, useRef, useState } from 'react';
import './CoachPanel.css';

interface Props {
  fen: string;
  historyCn: string;
  playerAtBottom: 'w' | 'b';
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const QUICK_QUESTIONS = ['当前谁优势？', '我该怎么走？', '可以绝杀吗？'];

export default function CoachPanel({
  fen,
  historyCn,
  playerAtBottom,
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
        setMessages([...nextMessages, { role: 'assistant', content: data.reply }]);
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
                  {m.content}
                </div>
                {isLongContent(m.content) && (
                  <button className="coach-expand" onClick={() => toggleExpand(i)}>
                    {expanded.has(i) ? '收起 ▴' : '展开全部 ▾'}
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
