import { motion } from 'framer-motion';
import { useState } from 'react';
import { Sparkles, ArrowUp, SlidersHorizontal } from 'lucide-react';
import { SETTING_GROUPS, DEFAULT_SETTINGS } from '../../ui.js';

export default function Composer({ onForge }) {
  const [idea, setIdea] = useState('');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showOpts, setShowOpts] = useState(false);

  const submit = () => {
    const t = idea.trim();
    if (t) onForge(t, settings);
  };

  return (
    <section id="forge" className="relative px-6 -mt-10 pb-8 scroll-mt-28">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="mx-auto max-w-3xl"
      >
        <div className="flex flex-col items-center text-center mb-6">
          <span className="section-eyebrow mb-4">Start here</span>
          <h2 className="font-display text-2xl sm:text-3xl font-semibold text-white tracking-tight">
            Give us one idea. We direct the whole film.
          </h2>
        </div>

        <div className="rounded-2xl glass-strong overflow-hidden shadow-2xl shadow-black/50 focus-within:ring-1 focus-within:ring-accent-400/40 transition-all">
          <div className="flex items-start gap-3 p-5">
            <span className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-500/15 text-accent-300">
              <Sparkles className="h-4 w-4" />
            </span>
            <textarea
              className="flex-1 bg-transparent border-none outline-none resize-none text-slate-100 placeholder:text-slate-600 text-base leading-relaxed min-h-[52px] pt-1.5"
              placeholder="Describe the film you want to make…"
              value={idea}
              rows={2}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>

          {showOpts && (
            <div className="px-5 pb-4 border-t border-white/[0.06] pt-4 flex flex-col gap-4">
              {SETTING_GROUPS.map(([key, label, options]) => (
                <div key={key} className="flex flex-col gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-500">
                    {label}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {options.map(([value, text]) => (
                      <button
                        key={value}
                        onClick={() => setSettings((s) => ({ ...s, [key]: value }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                          settings[key] === value
                            ? 'border-accent-400/60 text-accent-300 bg-accent-500/10'
                            : 'border-white/[0.08] text-slate-400 hover:text-slate-200 hover:border-white/20'
                        }`}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
            <button
              onClick={() => setShowOpts((o) => !o)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                showOpts
                  ? 'border-accent-400/60 text-accent-300 bg-accent-500/10'
                  : 'border-white/[0.08] text-slate-400 hover:text-slate-200'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {settings.length_min} min · {settings.aspect}
            </button>
            <button
              onClick={submit}
              disabled={!idea.trim()}
              title="Forge the film"
              className="grid h-9 w-9 place-items-center rounded-full bg-accent-400 text-ink-950 shadow-lg shadow-accent-500/30 hover:bg-accent-300 disabled:opacity-30 disabled:cursor-default transition-all"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
