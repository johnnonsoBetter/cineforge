import { motion } from 'framer-motion';
import { useState } from 'react';
import { Lightbulb, BookOpen, Layers, KeyRound, Video, Scissors, Check } from 'lucide-react';

const stages = [
  {
    id: 'idea',
    label: 'Idea',
    icon: <Lightbulb className="h-5 w-5" />,
    title: 'Synthesis',
    desc: 'The AI creative director writes the bible, cast, locations, and every prompt the pipeline will spend.',
    gate: 'Bible approved · 12 characters locked',
  },
  {
    id: 'story',
    label: 'Story',
    icon: <BookOpen className="h-5 w-5" />,
    title: 'Sheets',
    desc: 'Founding reference sheets are rendered and locked. Every frame that follows inherits them.',
    gate: 'Keyframe 3: Identity drift against reference — re-rendering with locked sheet re-injected.',
  },
  {
    id: 'sheets',
    label: 'Sheets',
    icon: <Layers className="h-5 w-5" />,
    title: 'Keyframes',
    desc: 'One still per shot, composed against the locked references. The frame you approve is the frame that animates.',
    gate: 'Shot 7 composition rejected — director requested tighter framing on subject.',
  },
  {
    id: 'keyframes',
    label: 'Keyframes',
    icon: <KeyRound className="h-5 w-5" />,
    title: 'Video',
    desc: 'Each still becomes motion. The cut assembles automatically from the approved keyframes.',
    gate: 'Motion check passed · 11 of 11 shots within budget',
  },
  {
    id: 'video',
    label: 'Video',
    icon: <Video className="h-5 w-5" />,
    title: 'Cut',
    desc: 'The editor agent assembles the final cut, applies transitions, and exports a traceable master.',
    gate: 'Final cut locked · provenance manifest written',
  },
  {
    id: 'cut',
    label: 'Cut',
    icon: <Scissors className="h-5 w-5" />,
    title: 'Export',
    desc: 'Export a cryptographically signed master. Every shot traceable to its model, prompt, and parent run.',
    gate: 'Export ready · 2m 14s · SHA-256 manifest attached',
  },
];

export default function Pipeline() {
  const [active, setActive] = useState(1);

  return (
    <section className="relative px-6 py-28">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col items-center text-center mb-16">
          <span className="section-eyebrow mb-4">The production pipeline</span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-semibold text-white tracking-tight">
            From idea to cut, with
            <span className="gradient-text"> human gates</span> at every stage
          </h2>
          <p className="mt-4 max-w-2xl text-slate-400 text-lg">
            Not a funnel. A film studio pipeline. Four gated passes with human
            approval between them — that's production readiness.
          </p>
        </div>

        {/* timeline */}
        <div className="relative">
          {/* connecting line */}
          <div className="absolute top-7 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent hidden md:block" />

          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 md:gap-2 relative">
            {stages.map((stage, i) => (
              <motion.button
                key={stage.id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                onMouseEnter={() => setActive(i)}
                onClick={() => setActive(i)}
                className="group flex flex-col items-center text-center"
              >
                <div
                  className={`relative grid h-14 w-14 place-items-center rounded-2xl transition-all duration-300 ${
                    active === i
                      ? 'glass-strong ring-1 ring-accent-400/50 scale-110'
                      : 'glass hover:bg-white/[0.06]'
                  }`}
                >
                  <span
                    className={
                      active === i ? 'text-accent-300' : 'text-slate-400 group-hover:text-slate-200'
                    }
                  >
                    {stage.icon}
                  </span>
                  {i < stages.length - 1 && (
                    <span className="hidden md:block absolute top-1/2 left-full w-2 h-px bg-slate-700 -translate-y-1/2" />
                  )}
                </div>
                <span
                  className={`mt-3 text-xs font-mono uppercase tracking-widest transition-colors ${
                    active === i ? 'text-accent-300' : 'text-slate-500'
                  }`}
                >
                  {stage.label}
                </span>
              </motion.button>
            ))}
          </div>
        </div>

        {/* active stage detail */}
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mt-12 mx-auto max-w-3xl"
        >
          <div className="rounded-2xl glass-strong p-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-500/15 text-accent-300">
                {stages[active].icon}
              </span>
              <h3 className="font-display text-2xl font-semibold text-white">
                {stages[active].title}
              </h3>
            </div>
            <p className="text-slate-300 leading-relaxed text-lg">
              {stages[active].desc}
            </p>

            {/* gate verdict */}
            <div className="mt-6 flex items-start gap-3 rounded-xl bg-amber-500/[0.06] border border-amber-500/20 px-4 py-3">
              <Check className="h-4 w-4 text-amber-300 mt-0.5 shrink-0" />
              <div>
                <span className="text-xs font-mono uppercase tracking-widest text-amber-300">
                  Gate verdict
                </span>
                <p className="text-sm text-slate-300 mt-1 font-mono">
                  {stages[active].gate}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
