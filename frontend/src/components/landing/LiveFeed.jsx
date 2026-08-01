import { motion } from 'framer-motion';
import { Radio, Film } from 'lucide-react';

const projects = [
  {
    title: 'The VIP Treatment',
    status: 'running',
    progress: 62,
    detail: 'Rendering shot 7 of 12',
  },
  {
    title: 'Nollywood Comedy',
    status: 'gate',
    progress: 44,
    detail: 'Waiting at gate: Keyframes',
  },
  {
    title: 'The Last Train',
    status: 'ready',
    progress: 100,
    detail: 'Export ready — 2m 14s',
  },
  {
    title: 'Market Day',
    status: 'ready',
    progress: 100,
    detail: 'Export ready — 1m 38s',
  },
];

const statusMap = {
  running: { label: 'RUNNING', color: 'text-accent-300', bar: 'from-accent-400 to-accent-500', dot: 'bg-accent-400' },
  gate: { label: 'AT GATE', color: 'text-amber-300', bar: 'from-amber-400 to-amber-500', dot: 'bg-amber-400' },
  ready: { label: 'READY', color: 'text-orange-300', bar: 'from-orange-400 to-orange-500', dot: 'bg-orange-400' },
};

export default function LiveFeed() {
  return (
    <section className="relative px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center gap-3 mb-8">
          <span className="flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-2.5 w-2.5 rounded-full bg-rose-500/60 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
          </span>
          <span className="text-xs font-mono uppercase tracking-[0.25em] text-slate-400">
            Live from the studio
          </span>
          <span className="h-px flex-1 bg-slate-800" />
          <span className="flex items-center gap-1.5 text-xs font-mono text-slate-500">
            <Radio className="h-3 w-3" />
            SSE stream
          </span>
        </div>

        <div className="rounded-2xl glass-strong overflow-hidden divide-y divide-white/[0.04]">
          {projects.map((p, i) => {
            const s = statusMap[p.status];
            return (
              <motion.div
                key={p.title}
                initial={{ opacity: 0, x: -16 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="flex items-center gap-4 px-6 py-4 hover:bg-white/[0.02] transition-colors"
              >
                <Film className="h-4 w-4 text-slate-500 shrink-0" />
                <span className="font-display font-medium text-white w-44 sm:w-56 shrink-0 truncate">
                  {p.title}
                </span>

                {/* progress bar */}
                <div className="flex-1 hidden sm:block">
                  <div className="h-2 rounded-full bg-ink-700 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${p.progress}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, delay: 0.3 + i * 0.1, ease: 'easeOut' }}
                      className={`h-full rounded-full bg-gradient-to-r ${s.bar}`}
                    />
                  </div>
                </div>

                <span className={`text-xs font-mono ${s.color} shrink-0`}>
                  {s.label}
                </span>
                <span className="text-xs text-slate-500 font-mono hidden md:block w-48 text-right shrink-0 truncate">
                  {p.detail}
                </span>
              </motion.div>
            );
          })}
        </div>

        <p className="mt-4 text-center text-xs text-slate-600 font-mono">
          live project status · streamed via server-sent events
        </p>
      </div>
    </section>
  );
}
