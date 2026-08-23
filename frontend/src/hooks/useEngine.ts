import { useCallback, useEffect, useRef, useState } from 'react';

export interface EngineInfo {
  fen: string;
  depth: number;
  score_cp: number;
  score_mate: number | null;
  wdl: [number, number, number] | null;
  pv: string[];
  pv_cn?: string[];
  nodes: number;
  nps: number;
  multipv?: number;
}

export interface EngineResult {
  fen: string;
  best_move: string;
  best_move_cn?: string;
  ponder: string | null;
  depth: number;
}

// 浅层分数：用于计算胜率（深度 <=6，未收敛到残局"例和"，保留子力+位置优势）
export interface ShallowScore {
  cp: number;
  mate: number | null;
  fen: string;
}

export function useEngine() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [engineName, setEngineName] = useState<string | null>(null);
  const [info, setInfo] = useState<EngineInfo | null>(null);
  // Top N 候选线（按 multipv 索引存，lines[0] 即最佳）
  const [lines, setLines] = useState<EngineInfo[]>([]);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [shallow, setShallow] = useState<ShallowScore | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws/analysis`);

      ws.onopen = () => {
        setConnected(true);
        // 连接成功后获取引擎名称（如「皮卡鱼（Pikafish）」）
        fetch('/api/health')
          .then((r) => r.json())
          .then((d) => setEngineName(d.engine ?? null))
          .catch(() => {});
      };
      ws.onclose = () => {
        setConnected(false);
        setAnalysing(false);
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, 2000);
        }
      };
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'info') {
          const infoMsg = data as EngineInfo;
          const mipv = infoMsg.multipv ?? 1;
          // 按 multipv 索引存入候选线（0 = 最佳）
          setLines((prev) => {
            const next = [...prev];
            next[mipv - 1] = infoMsg;
            return next.slice(0, 3);
          });
          if (mipv === 1) {
            setInfo(infoMsg);
          }
          // 记录浅层分数：depth <= 6 时子力+位置优势还在，未被残局例和收敛冲掉
          if (data.depth <= 6) {
            setShallow({
              cp: data.score_cp,
              mate: data.score_mate,
              fen: data.fen,
            });
          }
        } else if (data.type === 'bestmove') {
          setResult(data as EngineResult);
          setAnalysing(false);
        } else if (data.type === 'stopped') {
          // 分析被电脑走棋等 REST 请求打断：停止"分析中"状态（保留最近数据）
          setAnalysing(false);
        }
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const analyse = useCallback((fen: string, depth = 16) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    // 不清空旧数据：新局面的结果未到前由面板的 stale 机制（降透明度+更新中）衔接展示，
    // 避免走棋后分析内容消失导致面板高度跳动
    setAnalysing(true);
    wsRef.current.send(JSON.stringify({ fen, depth, multipv: 3 }));
  }, []);

  // 仅浅层分析（depth 6）：供实时胜率独立取数，不触碰分析面板的 info/result/analysing
  const analyseShallow = useCallback((fen: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ fen, depth: 6, multipv: 1 }));
  }, []);

  return { connected, engineName, info, lines, result, analysing, shallow, analyse, analyseShallow };
}
