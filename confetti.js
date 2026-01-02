// Minimal modular confetti helper for TopWords
// Usage:
//   import { burst } from './confetti.js';
//   burst({x:window.innerWidth/2, y:200, count:40});

const DEFAULT_COLORS = ['#ef4e67', '#FFAE3B', '#4e8031', '#ffd166', '#06d6a0', '#118ab2'];

function makeRainbow(n) {
  const cols = [];
  for (let i = 0; i < n; i++) {
    const hue = Math.round((i / n) * 360);
    cols.push(`hsl(${hue} 85% 55%)`);
  }
  return cols;
}

function injectCSSIfNeeded() {
  if (document.querySelector('link[href$="confetti.css"]') || document.querySelector('#confetti-css-injected')) return;
  // Try to load confetti.css from same directory
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'confetti.css';
  link.onload = () => {};
  link.onerror = () => {
    // fallback: inject minimal styles inline
    if (document.getElementById('confetti-css-injected')) return;
    const s = document.createElement('style');
    s.id = 'confetti-css-injected';
    s.textContent = `
      .confetti-container{position:fixed;pointer-events:none;left:0;top:0;width:100%;height:100%;overflow:visible;z-index:9999}
      .confetti-piece{position:absolute;will-change:transform,opacity;opacity:.95;border-radius:2px}
      @keyframes confetti-fall{0%{transform:translateY(-10vh) rotate(0deg)}60%{opacity:1}100%{transform:translateY(110vh) rotate(720deg);opacity:0}}
    `;
    document.head.appendChild(s);
  };
  document.head.appendChild(link);
}

function mkPiece(color, x, y, w, h, angle, duration, emoji) {
  const el = document.createElement('div');
  el.className = 'confetti-piece';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.transform = `rotate(${angle}deg)`;
  el.style.opacity = '1';
  el.style.animation = `confetti-fall ${duration}ms linear forwards, confetti-sway ${Math.max(800,duration/2)}ms ease-in-out infinite`;
  if (emoji) {
    el.classList.add('confetti-emoji');
    el.textContent = emoji;
    // Let font-size drive the visual size; add a tiny random scale
    const fs = Math.round(Math.max(18, Math.min(48, (w + h) / 2)) + (Math.random() * 12 - 6));
    el.style.fontSize = `${fs}px`;
    el.style.lineHeight = '1';
    el.style.width = 'auto';
    el.style.height = 'auto';
  } else {
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.background = color;
  }
  return el;
}

function burst(opts = {}) {
  injectCSSIfNeeded();
  const count = opts.count || 36;
  let colors = DEFAULT_COLORS;
  if (opts.color) colors = [opts.color];
  else if (Array.isArray(opts.colors) && opts.colors.length) colors = opts.colors;
  else if (opts.rainbow) {
    const n = (typeof opts.rainbow === 'number') ? Math.max(3, opts.rainbow) : Math.max(6, count);
    colors = makeRainbow(n);
  }
  const duration = opts.duration || 2000;
  const container = document.createElement('div');
  container.className = 'confetti-container';
  container.style.pointerEvents = 'none';

  const x = (typeof opts.x === 'number') ? opts.x : window.innerWidth/2;
  const y = (typeof opts.y === 'number') ? opts.y : 200;
  for (let i=0;i<count;i++) {
    const angle = (Math.random()*360)|0;
    const w = 6 + Math.random()*10;
    const h = 10 + Math.random()*18;
    const spread = opts.spread || 200;
    const rx = x + (Math.random()-0.5)*spread;
    const ry = y + (Math.random()-0.5)*30;
    const useEmoji = opts.emoji ? String(opts.emoji) : null;
    const color = colors[i % colors.length];
    const d = duration + (Math.random()*600 - 300);
    const piece = mkPiece(color, rx, ry, w, h, angle, d, useEmoji);
    container.appendChild(piece);
  }

  document.body.appendChild(container);
  // remove after animation
  setTimeout(() => { container.remove(); }, (opts.duration || duration) + 800);
}

export { burst };
