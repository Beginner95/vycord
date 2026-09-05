import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { EMOJI_CATEGORIES } from '@/utils/emojis';
import {
  useExpressionRecentsStore,
  topEmoji,
  FREQUENT_EMOJI_LIMIT,
} from '@/stores/expressionRecentsStore';
import { useT } from '@/i18n';

interface EmojiPanelProps {
  onSelect: (emoji: string) => void;
}

const FREQUENT_ID = 'frequent';

export function EmojiPanel({ onSelect }: EmojiPanelProps) {
  const t = useT();
  const recordEmoji = useExpressionRecentsStore((s) => s.recordEmoji);
  // Снимок на момент открытия: если пересортировывать «частые» прямо во время
  // выбора, плитка уезжает из-под курсора.
  const [frequent] = useState(() =>
    topEmoji(useExpressionRecentsStore.getState(), FREQUENT_EMOJI_LIMIT),
  );

  const sections = [
    // Пустую секцию не показываем вовсе — новый пользователь должен видеть
    // «Люди» первыми, а не осиротевший заголовок.
    ...(frequent.length ? [{ id: FREQUENT_ID, title: t('chat.frequentlyUsed'), emojis: frequent }] : []),
    ...EMOJI_CATEGORIES.map((c) => ({ id: c.id, title: t(c.labelKey), emojis: c.emojis })),
  ];

  const bodyRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const [active, setActive] = useState(sections[0].id);
  // Программный скролл проходит через промежуточные секции, и каждая по пути
  // дёргает observer — подсветка мигает. Гасим её на время анимации.
  const suppressUntil = useRef(0);

  useEffect(() => {
    const root = bodyRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < suppressUntil.current) return;
        const hit = entries.find((e) => e.isIntersecting);
        if (hit) setActive(hit.target.id.replace('expression-section-', ''));
      },
      { root, rootMargin: '0px 0px -85% 0px', threshold: 0 },
    );
    sectionRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections.length]);

  const jumpTo = (id: string) => {
    suppressUntil.current = Date.now() + 250;
    setActive(id);
    sectionRefs.current.get(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const choose = (emoji: string) => {
    recordEmoji(emoji);
    onSelect(emoji);
  };

  return (
    <>
      <div className="expression-picker-body" ref={bodyRef}>
        {sections.map((s) => (
          <section
            key={s.id}
            id={`expression-section-${s.id}`}
            className="expression-section"
            ref={(el) => {
              if (el) sectionRefs.current.set(s.id, el);
              else sectionRefs.current.delete(s.id);
            }}
          >
            <h3 className="expression-section-title">{s.title}</h3>
            <div className="expression-emoji-grid">
              {s.emojis.map((e, i) => (
                <button
                  key={`${s.id}-${i}`}
                  type="button"
                  className="expression-emoji-cell"
                  onClick={() => choose(e)}
                  aria-label={t('chat.insertEmoji')}
                >
                  {e}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="expression-picker-anchors">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`expression-picker-anchor${s.id === active ? ' is-active' : ''}`}
            onClick={() => jumpTo(s.id)}
            title={s.title}
            aria-label={s.title}
          >
            {s.id === FREQUENT_ID ? <Clock size={15} strokeWidth={1.8} /> : s.emojis[0]}
          </button>
        ))}
      </div>
    </>
  );
}
