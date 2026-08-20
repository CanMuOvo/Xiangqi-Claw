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

const SIDE_OPTIONS: { value: VsSide; label: string }[] = [
  { value: null, label: '关闭' },
  { value: 'w', label: '电脑执红（先手）' },
  { value: 'b', label: '电脑执黑（后手）' },
];

export default function VsComputerDialog({ currentSide, currentDifficulty, onConfirm, onClose }: Props) {
  const [side, setSide] = useState<VsSide>(currentSide);
  const [difficulty, setDifficulty] = useState<VsDifficulty>(currentDifficulty);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="dialog-title">人机对战设置</h3>

        <div className="dialog-field">
          <span className="dialog-field-label">电脑难度</span>
          <div className="diff-options">
            {(Object.keys(DIFF_LABELS) as VsDifficulty[]).map((d) => (
              <button
                key={d}
                className={`diff-option ${difficulty === d ? 'active' : ''}`}
                onClick={() => setDifficulty(d)}
              >
                {DIFF_LABELS[d]}
              </button>
            ))}
          </div>
        </div>

        <div className="dialog-field">
          <span className="dialog-field-label">电脑执方</span>
          <div className="side-options">
            {SIDE_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                className={`side-option ${side === opt.value ? 'active' : ''}`}
                onClick={() => setSide(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <p className="dialog-hint">切换执方将重新开始当前对局；仅调整难度不重开，从电脑下一手生效。</p>

        <div className="dialog-actions">
          <button className="dialog-btn cancel" onClick={onClose}>取消</button>
          <button className="dialog-btn confirm" onClick={() => onConfirm(side, difficulty)}>确定</button>
        </div>
      </div>
    </div>
  );
}
