import { useState } from 'react';
import { SUGGESTIONS, SETTING_GROUPS, DEFAULT_SETTINGS, sceneCount, shotCount } from './ui.js';

// The empty state: one idea in, a whole film out.
export default function Hero({ onForge, busy }) {
  const [idea, setIdea] = useState('');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const forge = () => {
    const text = idea.trim();
    if (text && !busy) onForge(text, settings);
  };

  // Shots are 8s each, so the runtime the user picks buys a shot budget, and the story
  // agent spends it across the scenes — more setups on the scenes that turn. Showing the
  // arithmetic stops "1 min" reading as decoration; "about" is honest about the fact that
  // coverage is the story's call, not a fixed multiplier.
  const scenes = sceneCount(settings);
  const shots = shotCount(settings);

  return (
    <div className="hero">
      <div className="hero-inner">
        <div className="hero-mark">Cine<em>Forge</em></div>
        <div className="hero-sub">
          One idea becomes a finished cinematic short — screenplay, cast, keyframes, animated shots, final cut.
        </div>

        <div className="hero-card">
          <textarea
            value={idea}
            autoFocus
            placeholder="A comedy about a Nigerian man who arrives at a wedding expecting VIP treatment."
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) forge();
            }}
          />
          <div className="hero-settings">
            {SETTING_GROUPS.map(([key, label, options]) => (
              <div className="set-group" key={key}>
                <span className="set-label">{label}</span>
                <div className="set-options">
                  {options.map(([value, text]) => (
                    <button
                      key={value}
                      className={`set-opt ${settings[key] === value ? 'on' : ''}`}
                      onClick={() => setSettings((s) => ({ ...s, [key]: value }))}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="hero-foot">
            <div className="hero-foot-meta">
              {scenes} scenes · {scenes} keyframes · ~{shots} shots · {settings.aspect}
            </div>
            <button className="btn-gold" onClick={forge} disabled={!idea.trim() || busy}>
              {busy ? 'Forging…' : 'Forge the film →'}
            </button>
          </div>
        </div>

        <div className="hero-chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="hero-chip" title={s} onClick={() => setIdea(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
