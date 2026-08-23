import { useState } from 'react';
import './VsComputerDialog.css';

export type VsSide = 'w' | 'b' | null;
export type VsDifficulty = 'easy' | 'normal' | 'hard' | 'master';

interface Props {
  currentSide: VsSide;
  currentDifficulty: VsDifficulty;
  onConfirm: (side: VsSide, difficulty: VsDifficulty) => void;
  onClose: () => void;
}

const DIFF_LABELS: Record<VsDifficulty, string> = {
  easy: '入门',
  normal: '普通',
  hard: '困难',
  master: '大师',
};

// 固定档位：深度值 + 说明（选中时展示，让玩家了解每档的思考强度）
const DIFF_OPTIONS: { value: VsDifficulty; depth: number; hint: string }[] = [
  { value: 'easy', depth: 4, hint: '思考浅，偶尔失误，适合新手' },
  { value: 'normal', depth: 8, hint: '中等深度，会犯小错' },
  { value: 'hard', depth: 10, hint: '较深思考，需认真应对' },
  { value: 'master', depth: 14, hint: '全力搜索，考验实力' },
];

const SIDE_OPTIONS: { value: VsSide; label: string; sub: string; dot: string }[] = [
  { value: 'w', label: '电脑执红', sub: '你执黑', dot: '#d64541' },
  { value: 'b', label: '电脑执黑', sub: '你执红', dot: '#3a3f4b' },
  { value: null, label: '关闭电脑', sub: '双人对弈', dot: '#5f6d88' },
];

export default function VsComputerDialog({ currentSide, currentDifficulty, onConfirm, onClose }: Props) {
  const [side, setSide] = useState<VsSide>(currentSide);
  const [difficulty, setDifficulty] = useState<VsDifficulty>(currentDifficulty);

  const fixedDiffs = DIFF_OPTIONS;
  const selectedDiff = DIFF_OPTIONS.find((d) => d.value === difficulty);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card vs-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="vs-head">
          <span className="vs-head-icon">⚔</span>
          <div className="vs-head-text">
            <h3 className="dialog-title">人机对战</h3>
            <span className="vs-head-sub">VS COMPUTER · 设置对局</span>
          </div>
        </div>

        <div className="vs-section">
          <span className="vs-label">电脑难度</span>
          <div className="diff-grid">
            {fixedDiffs.map((d) => (
              <button
                key={d.value}
                className={`diff-option ${difficulty === d.value ? 'active' : ''}`}
                onClick={() => setDifficulty(d.value)}
              >
                <span className="diff-name">{DIFF_LABELS[d.value]}</span>
                <span className="diff-depth">{d.depth} 层</span>
              </button>
            ))}
          </div>

          {selectedDiff && (
            <div className="diff-hint">
              搜索深度 {selectedDiff.depth} 层 —— {selectedDiff.hint}
            </div>
          )}
        </div>

        <div className="vs-section">
          <span className="vs-label">电脑执方</span>
          <div className="side-grid">
            {SIDE_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                className={`side-card ${side === opt.value ? 'active' : ''}`}
                onClick={() => setSide(opt.value)}
              >
                <span className="side-dot" style={{ background: opt.dot }} />
                <span className="side-card-text">
                  <span className="side-card-title">{opt.label}</span>
                  <span className="side-card-sub">{opt.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <p className="dialog-hint">切换执方将重新开始当前对局；仅调整难度不重开，从电脑下一手生效。</p>

        <div className="dialog-actions">
          <button className="dialog-btn cancel" onClick={onClose}>取消</button>
          <button className="dialog-btn confirm" onClick={() => onConfirm(side, difficulty)}>
            开始对战
          </button>
        </div>
      </div>
    </div>
  );
}
