import './BoardEffect.css';

export type EffectKind = 'check' | 'capture' | 'mate';

interface Props {
  kind: EffectKind;
}

const CONFIG: Record<EffectKind, { src: string; label: string }> = {
  capture: { src: '/effects/capture.png', label: '吃' },
  check: { src: '/effects/check.png', label: '将军' },
  mate: { src: '/effects/mate.png', label: '绝杀' },
};

export default function BoardEffect({ kind }: Props) {
  const c = CONFIG[kind];
  return (
    <div className="board-effect" role="presentation">
      <img src={c.src} alt={c.label} className="effect-img" />
    </div>
  );
}
