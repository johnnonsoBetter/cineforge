import { motion } from 'framer-motion';
import { useState } from 'react';
import {
  Network,
  MousePointerClick,
  Zap,
  GitBranch,
  Play,
  RotateCcw,
} from 'lucide-react';

const annotations = [
  {
    icon: <Network className="h-4 w-4" />,
    title: 'Every asset is a node',
    desc: 'Story, characters, scenes, shots — all live on the same canvas.',
  },
  {
    icon: <GitBranch className="h-4 w-4" />,
    title: 'Every relationship is visible',
    desc: 'Dependency lines show exactly what each shot inherits from.',
  },
  {
    icon: <MousePointerClick className="h-4 w-4" />,
    title: 'Click any node',
    desc: 'See everything that depends on it, upstream and down.',
  },
  {
    icon: <Zap className="h-4 w-4" />,
    title: 'Edit a character',
    desc: 'Downstream shots auto-stale. Only what changed re-renders.',
  },
];

// Explicit class map — Tailwind can't see dynamically-built class names.
const toneDot = {
  amber: 'bg-amber-400',
  accent: 'bg-accent-400',
  orange: 'bg-orange-400',
  rose: 'bg-rose-400',
};

export default function CanvasShowcase() {
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(0);

  const playDemo = () => {
    if (playing) return;
    setPlaying(true);
    setStep(0);
    const timers = [0, 1, 2, 3, 4].map((s) =>
      setTimeout(() => setStep(s), s * 900)
    );
    setTimeout(() => {
      setPlaying(false);
      setStep(0);
      timers.forEach(clearTimeout);
    }, 5200);
  };

  return (
    <section className="relative px-6 py-28">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col items-center text-center mb-14">
          <span className="section-eyebrow mb-4">The canvas</span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-semibold text-white tracking-tight">
            Dependency intelligence,
            <span className="gradient-text"> made visceral</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
          {/* canvas mock */}
          <div className="lg:col-span-3">
            <div className="relative rounded-3xl glass-strong overflow-hidden shadow-2xl shadow-black/50">
              {/* chrome */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] bg-ink-900/60">
                <span className="h-3 w-3 rounded-full bg-rose-400/70" />
                <span className="h-3 w-3 rounded-full bg-amber-400/70" />
                <span className="h-3 w-3 rounded-full bg-accent-400/70" />
                <span className="ml-3 text-xs font-mono text-slate-500">
                  cineforge / the-vip-treatment
                </span>
              </div>

              {/* graph mock */}
              <div className="relative h-[440px] grid-bg overflow-hidden">
                <div className="absolute inset-0 p-8">
                  {/* nodes */}
                  {[
                    { label: 'Story Bible', x: '4%', y: '40%', tone: 'amber', active: false },
                    { label: 'Simeon', x: '28%', y: '18%', tone: 'accent', active: step >= 1 },
                    { label: 'Maya', x: '28%', y: '62%', tone: 'orange', active: false },
                    { label: 'Scene 3', x: '52%', y: '40%', tone: 'rose', active: false },
                    { label: 'Shot 7', x: '76%', y: '18%', tone: 'accent', active: step >= 2 },
                    { label: 'Shot 8', x: '76%', y: '40%', tone: 'accent', active: step >= 2 },
                    { label: 'Shot 9', x: '76%', y: '62%', tone: 'accent', active: step >= 2 },
                  ].map((n, i) => (
                    <div
                      key={i}
                      className={`absolute flex items-center gap-2 rounded-lg px-3 py-2 transition-all duration-500 ${
                        n.active
                          ? 'glass-strong ring-1 ring-amber-400/60 shadow-lg shadow-amber-500/20'
                          : 'glass'
                      }`}
                      style={{ left: n.x, top: n.y }}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          n.active ? 'bg-amber-400 animate-pulse' : toneDot[n.tone]
                        }`}
                      />
                      <span className="text-xs font-medium text-slate-200 whitespace-nowrap">
                        {n.label}
                      </span>
                      {n.active && step >= 2 && (
                        <span className="text-[10px] font-mono text-amber-300 ml-1">stale</span>
                      )}
                    </div>
                  ))}

                  {/* edges (svg) */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#334155" stopOpacity="0.5" />
                        <stop offset="100%" stopColor="#334155" stopOpacity="0.5" />
                      </linearGradient>
                      <linearGradient id="edgeStale" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.8" />
                        <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.4" />
                      </linearGradient>
                    </defs>
                    {[
                      { d: 'M 130 170 Q 200 140 280 120', stale: step >= 2 },
                      { d: 'M 130 170 Q 200 200 280 250', stale: false },
                      { d: 'M 370 120 Q 450 160 530 170', stale: step >= 2 },
                      { d: 'M 370 250 Q 450 230 530 200', stale: false },
                      { d: 'M 590 180 Q 660 150 720 120', stale: step >= 2 },
                      { d: 'M 590 180 Q 660 180 720 180', stale: step >= 2 },
                      { d: 'M 590 180 Q 660 210 720 240', stale: step >= 2 },
                    ].map((e, i) => (
                      <path
                        key={i}
                        d={e.d}
                        fill="none"
                        stroke={e.stale ? 'url(#edgeStale)' : 'url(#edge)'}
                        strokeWidth={e.stale ? 1.5 : 1}
                        strokeDasharray={e.stale ? '0' : '4 4'}
                        className={e.stale ? 'animate-pulse' : ''}
                      />
                    ))}
                  </svg>

                  {/* impact analysis popup */}
                  {step >= 3 && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-xl glass-strong px-5 py-4 shadow-2xl shadow-amber-500/20 ring-1 ring-amber-400/40 min-w-[280px]"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Zap className="h-4 w-4 text-amber-300" />
                        <span className="text-sm font-semibold text-white">Impact analysis</span>
                      </div>
                      <p className="text-xs text-slate-300 font-mono">
                        3 assets need re-rendering.
                        <br />
                        Everything else preserved.
                      </p>
                    </motion.div>
                  )}

                  {/* step label */}
                  <div className="absolute top-4 right-4 flex items-center gap-2 text-xs font-mono text-slate-500">
                    {playing && (
                      <span className="text-amber-300">
                        step {step + 1} / 5
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* play button */}
            <div className="mt-4 flex justify-center">
              <button
                onClick={playDemo}
                disabled={playing}
                className="btn-ghost group disabled:opacity-50"
              >
                {playing ? (
                  <>
                    <RotateCcw className="h-4 w-4 animate-spin" />
                    Playing...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    Play the edit
                  </>
                )}
              </button>
            </div>
            <p className="mt-3 text-center text-xs text-slate-500 font-mono">
              {step === 0 && 'click to watch: edit Simeon → downstream shots go stale'}
              {step === 1 && 'user clicks "Simeon" and types: "Make him older"'}
              {step === 2 && 'three downstream shot nodes pulse yellow'}
              {step === 3 && 'impact analysis: 3 assets need re-rendering'}
              {step === 4 && 'approved → only those 3 nodes re-render'}
            </p>
          </div>

          {/* annotations */}
          <div className="lg:col-span-2 flex flex-col gap-3">
            {annotations.map((a, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="group flex gap-4 rounded-2xl glass p-5 hover:bg-white/[0.05] transition-colors"
              >
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg glass-strong text-accent-300 group-hover:text-accent-200 transition-colors">
                  {a.icon}
                </div>
                <div>
                  <h4 className="font-display font-semibold text-white text-sm mb-1">
                    {a.title}
                  </h4>
                  <p className="text-sm text-slate-400 leading-relaxed">{a.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
