import { BOARD_THEMES } from '../../lib/boardThemes';
import './BoardThemeDialog.css';

interface Props {
  currentId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function BoardThemeDialog({ currentId, onSelect, onClose }: Props) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="dialog-title">棋盘样式</h3>

        <div className="theme-list">
          {BOARD_THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-option ${currentId === t.id ? 'active' : ''}`}
              onClick={() => onSelect(t.id)}
            >
              <span
                className="theme-swatch"
                style={{ background: `linear-gradient(135deg, ${t.surface[0]}, ${t.surface[2]})` }}
              />
              <span className="theme-info">
                <span className="theme-name">{t.name}</span>
                <span className="theme-desc">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="dialog-actions">
          <button className="dialog-btn cancel" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
