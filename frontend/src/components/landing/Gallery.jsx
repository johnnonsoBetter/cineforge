import { motion } from 'framer-motion';
import { Film, Clock, Layers, ArrowRight, Sparkles } from 'lucide-react';
import { SETTING_GROUPS } from '../../ui.js';

// Static demo templates — shown only when the live gallery is empty.
const demoTemplates = [
  {
    title: 'The VIP Treatment',
    genre: 'Comedy',
    scenes: 4,
    shots: 11,
    runtime: '2m 14s',
    cover: 'https://images.pexels.com/photos/6466707/pexels-photo-6466707.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    accent: 'from-amber-500/20 to-amber-600/5',
  },
  {
    title: 'The Last Train',
    genre: 'Noir',
    scenes: 6,
    shots: 14,
    runtime: '3m 02s',
    cover: 'https://images.pexels.com/photos/33474764/pexels-photo-33474764.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    accent: 'from-orange-500/20 to-orange-600/5',
  },
  {
    title: 'Market Day',
    genre: 'Drama',
    scenes: 3,
    shots: 8,
    runtime: '1m 38s',
    cover: 'https://images.pexels.com/photos/20177676/pexels-photo-20177676.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    accent: 'from-accent-500/20 to-accent-600/5',
  },
];

const styleName = (p) =>
  SETTING_GROUPS.find(([k]) => k === 'style_preset')?.[2].find(([v]) => v === p)?.[1] || p;

export default function Gallery({ gallery = [], adopting, onUseTemplate, onStart }) {
  const hasLive = gallery.length > 0;

  return (
    <section id="gallery" className="relative px-6 py-28">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col items-center text-center mb-14">
          <span className="section-eyebrow mb-4">Template gallery</span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-semibold text-white tracking-tight">
            Start from a
            <span className="gradient-text"> finished film</span>
          </h2>
          <p className="mt-4 max-w-2xl text-slate-400 text-lg">
            Every template is a complete production graph — story, cast,
            locations, and locked references. Clone it, rewrite it, make it yours.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {hasLive
            ? gallery.map((f, i) => (
                <LiveCard
                  key={f.project_id}
                  film={f}
                  index={i}
                  busy={adopting === f.project_id}
                  onClick={() => onUseTemplate(f.project_id)}
                />
              ))
            : demoTemplates.map((t, i) => (
                <DemoCard key={t.title} t={t} index={i} onClick={onStart} />
              ))}
        </div>
      </div>
    </section>
  );
}

function LiveCard({ film, index, busy, onClick }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={busy}
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="group relative text-left rounded-2xl glass-strong overflow-hidden hover:ring-1 hover:ring-accent-400/30 transition-all duration-300 disabled:opacity-70"
    >
      {/* cover */}
      <div className="relative h-56 overflow-hidden bg-ink-900">
        <div className="absolute inset-0 bg-gradient-to-t from-accent-500/15 to-transparent z-10" />
        {film.cover ? (
          <img
            src={film.cover}
            alt={film.title || 'Untitled film'}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full grid place-items-center font-display italic text-2xl text-ink-600">
            CineForge
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/40 to-transparent z-20" />
        {film.style_preset && (
          <span className="absolute top-4 left-4 z-30 px-2.5 py-1 rounded-full glass text-xs font-mono uppercase tracking-widest text-white">
            {styleName(film.style_preset)}
          </span>
        )}
        <div className="absolute bottom-4 left-4 right-4 z-30">
          <h3 className="font-display text-xl font-semibold text-white truncate">
            {film.title || 'Untitled Film'}
          </h3>
        </div>
        {busy && (
          <div className="absolute inset-0 z-40 grid place-items-center bg-ink-950/80 backdrop-blur-sm text-xs font-mono uppercase tracking-[0.18em] text-accent-300">
            Adopting…
          </div>
        )}
      </div>

      {/* meta */}
      <div className="p-5">
        <div className="flex items-center gap-5 text-xs font-mono text-slate-400 mb-5">
          <span className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            {film.node_count ?? 0} nodes
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {film.length_min ?? 1} min
          </span>
        </div>

        <span className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl glass text-sm text-slate-200 group-hover:text-white group-hover:bg-white/[0.06] transition-all">
          <Sparkles className="h-3.5 w-3.5 text-accent-300" />
          Use this template
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </motion.button>
  );
}

function DemoCard({ t, index, onClick }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="group relative rounded-2xl glass-strong overflow-hidden hover:ring-1 hover:ring-accent-400/30 transition-all duration-300"
    >
      {/* cover */}
      <div className="relative h-56 overflow-hidden">
        <div className={`absolute inset-0 bg-gradient-to-t ${t.accent} z-10`} />
        <img
          src={t.cover}
          alt={t.title}
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/40 to-transparent z-20" />
        <span className="absolute top-4 left-4 z-30 px-2.5 py-1 rounded-full glass text-xs font-mono uppercase tracking-widest text-white">
          {t.genre}
        </span>
        <div className="absolute bottom-4 left-4 right-4 z-30">
          <h3 className="font-display text-xl font-semibold text-white">
            {t.title}
          </h3>
        </div>
      </div>

      {/* meta */}
      <div className="p-5">
        <div className="flex items-center gap-5 text-xs font-mono text-slate-400 mb-5">
          <span className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            {t.scenes} scenes
          </span>
          <span className="flex items-center gap-1.5">
            <Film className="h-3.5 w-3.5" />
            {t.shots} shots
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {t.runtime}
          </span>
        </div>

        <button
          onClick={onClick}
          className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl glass text-sm text-slate-200 hover:text-white hover:bg-white/[0.06] transition-all group/btn"
        >
          <Sparkles className="h-3.5 w-3.5 text-accent-300" />
          Use this template
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-0.5" />
        </button>
      </div>
    </motion.div>
  );
}
