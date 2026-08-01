import { motion } from 'framer-motion';
import { Film, ArrowRight, Images } from 'lucide-react';

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.15 } },
};
const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: 'easeOut' } },
};

export default function Hero({ onStart }) {
  return (
    <section className="relative min-h-screen flex items-center justify-center px-6 overflow-hidden">
      {/* cinematic glow orbs */}
      <div className="pointer-events-none absolute top-1/4 left-1/3 h-96 w-96 rounded-full bg-amber-500/10 blur-[140px]" />
      <div className="pointer-events-none absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full bg-accent-500/10 blur-[140px]" />
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-accent-500/5 blur-[160px]" />

      {/* film grain overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="relative mx-auto max-w-5xl text-center"
      >
        <motion.div variants={item} className="flex justify-center mb-8">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass text-xs font-mono uppercase tracking-[0.2em] text-amber-300">
            <Film className="h-3.5 w-3.5" />
            A creative operating system
          </span>
        </motion.div>

        <motion.h1
          variants={item}
          className="font-display text-6xl sm:text-7xl md:text-8xl font-semibold tracking-tight text-white leading-[1.02]"
        >
          CineForge
        </motion.h1>

        <motion.p
          variants={item}
          className="mx-auto mt-6 max-w-3xl text-xl sm:text-2xl text-slate-300 leading-relaxed font-light"
        >
          Not a prompt box. A production studio.
          <br />
          Stories, characters, scenes, shots, and cuts — connected in a
          dependency graph that understands what changed, what broke, and what
          to rebuild.
        </motion.p>

        <motion.div
          variants={item}
          className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <button onClick={onStart} className="btn-primary group">
            Forge your first film
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </button>
          <a href="#gallery" className="btn-ghost group">
            <Images className="h-4 w-4" />
            Explore the gallery
          </a>
        </motion.div>

        <motion.div
          variants={item}
          className="mt-16 flex items-center justify-center gap-3 text-xs font-mono uppercase tracking-[0.25em] text-slate-600"
        >
          <span className="h-px w-12 bg-slate-700" />
          built on Genblaze + Backblaze B2
          <span className="h-px w-12 bg-slate-700" />
        </motion.div>
      </motion.div>

      {/* scroll cue */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <div className="flex flex-col items-center gap-2 text-slate-600">
          <span className="text-[10px] font-mono uppercase tracking-widest">Scroll</span>
          <div className="h-8 w-px bg-gradient-to-b from-slate-600 to-transparent animate-pulse" />
        </div>
      </motion.div>
    </section>
  );
}
