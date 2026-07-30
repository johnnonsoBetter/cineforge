import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from './api.js';
import { authEnabled, signOut } from './auth.js';
import { SETTING_GROUPS, DEFAULT_SETTINGS } from './ui.js';

// The homepage — a calm, single-focus front door in the spirit of a clean AI console: one
// question, one input, a few quick starts, and the library of finished work layered beneath.
// Dark and gold to match the studio you enter after forging.
export default function Landing({ session }) {
  const navigate = useNavigate();
  const [gallery, setGallery] = useState([]);
  const [adopting, setAdopting] = useState(null);   // project_id currently being cloned

  useEffect(() => {
    api.getGallery().then((r) => setGallery(r.projects || [])).catch(() => setGallery([]));
  }, []);

  // Forge straight from the homepage: hand the idea to the studio, which owns the streaming
  // run. Signing in gates this only when auth is on.
  const startForge = (idea, settings) => {
    if (authEnabled && !session) { navigate('/login'); return; }
    navigate('/studio', { state: { forge: { idea, settings } } });
  };

  // Clicking a template adopts it outright: clone the public film into a project of your own
  // and drop straight into the studio with it. No preview step in between.
  const useTemplate = async (projectId) => {
    if (authEnabled && !session) { navigate('/login'); return; }
    if (adopting) return;
    setAdopting(projectId);
    try {
      const { project_id } = await api.cloneProject(projectId);
      navigate(`/p/${project_id}`);
    } catch {
      setAdopting(null);
    }
  };

  const scrollToTemplates = () => document.getElementById('templates')?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="landing">
      <header className="lnav lnav-plain">
        <div className="lnav-brand">
          <span className="brand-mark">CineForge</span>
          <span className="brand-sub">AI Film Studio</span>
        </div>
        <div className="lnav-right">
          <button className="lnav-link" onClick={scrollToTemplates}>Templates</button>
          {authEnabled && session && (
            <button className="btn" onClick={() => signOut()} title={session.user?.email || 'Sign out'}>
              Sign out
            </button>
          )}
          {authEnabled && !session && (
            <button className="btn" onClick={() => navigate('/login')}>Sign in</button>
          )}
        </div>
      </header>

      {/* The input is the hero: one focal card at the top, the template library laid out
          directly beneath it as a clean grid of thumbnails — describe a film, or pick a
          starting point. */}
      <main className="lmain">
        <h1 className="lask">What <em>story</em> shall we tell?</h1>
        <Composer onForge={startForge} />

        <section className="ltemplates" id="templates">
          <div className="ltemplates-head">Select template</div>
          {gallery.length > 0 ? (
            <div className="tgrid">
              {gallery.map((f) => (
                <TemplateCard
                  key={f.project_id}
                  film={f}
                  busy={adopting === f.project_id}
                  onClick={() => useTemplate(f.project_id)}
                />
              ))}
            </div>
          ) : (
            <div className="lempty">
              <div className="lempty-mark">✦</div>
              <p>No public films yet</p>
              <span>Make one of your films public and it'll headline the gallery here.</span>
            </div>
          )}
        </section>
      </main>

      <footer className="lfoot">
        <span className="brand-mark">CineForge</span>
        <span className="lfoot-note">AI Film Studio · one idea, one finished cut</span>
      </footer>
    </div>
  );
}

// The single focal input. Clean by default — just an idea and a send arrow — with production
// settings tucked behind the "+" so the surface stays quiet until you want them.
function Composer({ onForge }) {
  const [idea, setIdea] = useState('');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showOpts, setShowOpts] = useState(false);

  const submit = () => {
    const text = idea.trim();
    if (text) onForge(text, settings);
  };

  // A compact, human label for the style pill (e.g. "cinematic" → "Cinematic").
  const styleLabel =
    SETTING_GROUPS.find(([k]) => k === 'style_preset')?.[2]
      .find(([v]) => v === settings.style_preset)?.[1] || settings.style_preset;

  return (
    <>
      <div className="composer-card">
        <textarea
          className="composer-input"
          value={idea}
          autoFocus
          rows={1}
          placeholder="Beautiful films, real render pipeline. Just describe your film"
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
        />

        {showOpts && (
          <div className="composer-opts">
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
        )}

        <div className="composer-bar">
          <button
            className={`composer-plus ${showOpts ? 'on' : ''}`}
            onClick={() => setShowOpts((o) => !o)}
            title="Film settings"
          >
            +
          </button>
          <button
            className={`composer-mode ${showOpts ? 'on' : ''}`}
            onClick={() => setShowOpts((o) => !o)}
            title="Style"
          >
            <span className="composer-mode-ic" aria-hidden>🎬</span>
            {styleLabel}
          </button>

          <span className="composer-bar-gap" />

          <button className="composer-quality" onClick={() => setShowOpts((o) => !o)} title="Length & format">
            {settings.length_min} min · {settings.aspect}
            <span className="composer-caret" aria-hidden>⌄</span>
          </button>
          <button className="composer-go" onClick={submit} disabled={!idea.trim()} title="Forge the film">
            ↑
          </button>
        </div>
      </div>
    </>
  );
}

// A human label for a style preset (e.g. "cinematic" → "Cinematic"), from the shared groups.
const styleName = (preset) =>
  SETTING_GROUPS.find(([k]) => k === 'style_preset')?.[2]
    .find(([v]) => v === preset)?.[1] || preset;

function TemplateCard({ film, busy, onClick }) {
  const min = film.length_min ?? 1;
  return (
    <button className="tcard" onClick={onClick} disabled={busy} title={film.idea || film.title}>
      <div className="tcard-cover" style={film.cover ? { backgroundImage: `url(${film.cover})` } : undefined}>
        {!film.cover && <span className="tcard-cover-empty">CineForge</span>}
        {film.style_preset && <span className="tcard-badge">{styleName(film.style_preset)}</span>}
        {busy && <span className="tcard-adopting">Adopting…</span>}
      </div>
      <div className="tcard-meta">
        <div className="tcard-title">{film.title || 'Untitled Film'}</div>
        <div className="tcard-stat">{film.node_count ?? 0} nodes · {min} min</div>
      </div>
    </button>
  );
}
