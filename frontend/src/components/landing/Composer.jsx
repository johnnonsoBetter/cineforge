import { motion } from 'framer-motion';
import { useState } from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';
import { SETTING_GROUPS, DEFAULT_SETTINGS, SUGGESTIONS, sceneCount, shotCount } from '../../ui.js';

// The idea collector — the same brief the studio's empty state used to own, now the single
// front door to a forge. One sentence in, the presets set the shape, and the summary line
// shows the arithmetic (a runtime buys a shot budget) so "1 min" reads as a real plan.
export default function Composer({ onForge }) {
  const [idea, setIdea] = useState('');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const submit = () => {
    const t = idea.trim();
    if (t) onForge(t, settings);
  };

  const scenes = sceneCount(settings);
  const shots = shotCount(settings);

  return (
    <section id="forge" className="relative px-6 -mt-6 pb-10 scroll-mt-28">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="mx-auto max-w-3xl"
      >
        <div className="flex flex-col items-center text-center mb-7">
          <span className="section-eyebrow mb-4">Start here</span>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-white tracking-tight">
            Give us one idea. We direct the whole film.
          </h2>
          <p className="mt-3 text-sm text-[#a89577] max-w-md">
            One sentence is enough — set the length, the look and the format, then forge.
          </p>
        </div>

        <div className="cf-collector">
          <div className="cf-collector-glow" aria-hidden />
          <div className="cf-collector-body">
            <div className="cf-collector-idea">
              <span className="cf-collector-spark">
                <Sparkles />
              </span>
              <textarea
                autoFocus
                value={idea}
                rows={2}
                placeholder="A comedy about a Nigerian man who arrives at a wedding expecting VIP treatment."
                onChange={(e) => setIdea(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
            </div>

            <div className="cf-collector-presets">
              {SETTING_GROUPS.map(([key, label, options]) => (
                <div className="cf-preset" key={key}>
                  <span className="cf-preset-label">{label}</span>
                  <div className="cf-seg">
                    {options.map(([value, text]) => (
                      <button
                        key={value}
                        className={`cf-seg-opt ${settings[key] === value ? 'on' : ''}`}
                        onClick={() => setSettings((s) => ({ ...s, [key]: value }))}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="cf-collector-foot">
              <div className="cf-collector-meta">
                {scenes} scenes · {scenes} keyframes · ~{shots} shots · {settings.aspect}
              </div>
              <button className="cf-forge-btn" onClick={submit} disabled={!idea.trim()}>
                Forge the film
                <ArrowRight />
              </button>
            </div>
          </div>
        </div>

        <div className="cf-collector-chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="cf-chip" title={s} onClick={() => setIdea(s)}>
              {s}
            </button>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
