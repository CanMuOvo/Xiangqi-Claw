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
          setInfo(data as EngineInfo);
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

  const analyse = useCallback((fen: string, depth = 18) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setInfo(null);
    setResult(null);
    setShallow(null);
    setAnalysing(true);
    wsRef.current.send(JSON.stringify({ fen, depth }));
  }, []);

  // 仅浅层分析（depth 6）：供实时胜率独立取数，不触碰分析面板的 info/result/analysing
  const analyseShallow = useCallback((fen: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setShallow(null);
    wsRef.current.send(JSON.stringify({ fen, depth: 6 }));
  }, []);

  return { connected, engineName, info, result, analysing, shallow, analyse, analyseShallow };
}
