import { motion } from 'framer-motion';
import { ShieldCheck, GitBranch, Bot, Terminal } from 'lucide-react';

const pillars = [
  {
    icon: ShieldCheck,
    title: 'Provenance',
    desc: 'Every generated asset carries SHA-256, model, prompt, and lineage. Download any film, run genblaze verify, and trace every shot back to its origin.',
    points: ['SHA-256 per asset', 'Model + prompt lineage', 'genblaze verify CLI'],
  },
  {
    icon: GitBranch,
    title: 'Dependency Intelligence',
    desc: "Change a character's wardrobe → only the shots that include them are marked stale. Rename an entity → every scene, prompt, and VO line updates instantly, for free.",
    points: ['Stale propagation', 'Instant rename propagation', 'Selective re-render'],
  },
  {
    icon: Bot,
    title: 'Multi-Agent Studio',
    desc: 'Director, Story Agent, Camera Agent, QC Agent, Editor Agent. Each has bounded authority and a budget. The QC agent can fail a shot and trigger a re-render autonomously.',
    points: ['5 specialized agents', 'Bounded authority + budget', 'Autonomous QC gates'],
  },
];

export default function Pillars() {
  return (
    <section className="relative px-6 py-28">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col items-center text-center mb-14">
          <span className="section-eyebrow mb-4">For the judges</span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-semibold text-white tracking-tight">
            The technical pillars
          </h2>
          <p className="mt-4 max-w-2xl text-slate-400 text-lg">
            Built on the required stack. Provenance, dependency intelligence,
            and a multi-agent studio — not a wrapper around a video API.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {pillars.map((p, i) => (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="rounded-2xl glass-strong p-7"
            >
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent-500/15 text-accent-300 mb-5">
                <p.icon className="h-5 w-5" strokeWidth={2} />
              </div>
              <h3 className="font-display text-xl font-semibold text-white mb-3">
                {p.title}
              </h3>
              <p className="text-sm text-slate-400 leading-relaxed mb-5">
                {p.desc}
              </p>
              <ul className="space-y-2">
                {p.points.map((pt) => (
                  <li
                    key={pt}
                    className="flex items-center gap-2 text-xs font-mono text-slate-300"
                  >
                    <span className="h-1 w-1 rounded-full bg-accent-400" />
                    {pt}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        {/* terminal */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mt-8 mx-auto max-w-3xl"
        >
          <div className="rounded-2xl glass-strong overflow-hidden shadow-2xl shadow-black/50">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] bg-ink-900/80">
              <Terminal className="h-4 w-4 text-slate-500" />
              <span className="text-xs font-mono text-slate-500">genblaze — verify</span>
            </div>
            <div className="p-6 font-mono text-sm leading-relaxed">
              <p className="text-slate-500">
                <span className="text-accent-400">$</span> genblaze verify the-vip-treatment.mp4
              </p>
              <motion.p
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4 }}
                className="text-accent-300 mt-3"
              >
                Verified: True
              </motion.p>
              <motion.p
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.6 }}
                className="text-slate-300"
              >
                Canonical hash: <span className="text-orange-300">a3f9b2c7e1...</span>
              </motion.p>
              <motion.p
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.8 }}
                className="text-slate-300"
              >
                11 shots from 3 providers
              </motion.p>
              <motion.p
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 1.0 }}
                className="text-slate-300"
              >
                Parent run: <span className="text-amber-300">seedance-2-0-260128-abc123</span>
              </motion.p>
              <p className="text-slate-600 mt-3">
                <span className="text-accent-400">$</span> <span className="animate-pulse">_</span>
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
