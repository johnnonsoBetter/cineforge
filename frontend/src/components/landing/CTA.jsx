import { motion } from 'framer-motion';
import { ArrowRight, BookOpen, Clapperboard } from 'lucide-react';

export default function CTA({ onStart }) {
  return (
    <section className="relative px-6 py-28">
      <div className="mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 bg-accent-500/30 blur-2xl" />
              <div className="relative grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-accent-400 to-accent-600 text-ink-950">
                <Clapperboard className="h-8 w-8" strokeWidth={2} />
              </div>
            </div>
          </div>

          <h2 className="font-display text-4xl sm:text-5xl md:text-6xl font-semibold text-white tracking-tight">
            Forge your first film
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-slate-400">
            A complete film, from idea to cut, with human gates at every stage.
            Every asset traceable, versioned, and queryable.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button onClick={onStart} className="btn-primary group">
              Start your first film
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
            <a href="#" className="btn-ghost group">
              <BookOpen className="h-4 w-4" />
              Read the docs
            </a>
          </div>

          {/* trust bar */}
          <div className="mt-16 pt-10 border-t border-white/[0.06]">
            <span className="text-xs font-mono uppercase tracking-[0.25em] text-slate-600">
              Built on
            </span>
            <div className="mt-5 flex items-center justify-center gap-10">
              <div className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                <span className="font-display text-lg font-semibold">Genblaze</span>
              </div>
              <span className="h-6 w-px bg-slate-700" />
              <div className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                <span className="font-display text-lg font-semibold">Backblaze B2</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
