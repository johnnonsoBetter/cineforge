import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as api from './api.js';
import { authEnabled } from './auth.js';
import TvPlayer from './components/TvPlayer.jsx';
import Logo from './components/Logo.jsx';

// The public face of one film — reached by a share link and from the template gallery.
//
// Read-only by design: a visitor watches the finished cut and browses the stills, and the
// one action offered is "Use this template", which clones the film into an editable project
// of their own. Editing the original is never on the table here; that lives in the studio,
// behind ownership.
export default function Showcase({ session }) {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [cloning, setCloning] = useState(false);

  const signedIn = !authEnabled || !!session;

  useEffect(() => {
    let alive = true;
    api.getPublicProject(projectId)
      .then((p) => { if (alive) setProject(p); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [projectId]);

  const useTemplate = async () => {
    if (!signedIn) { navigate('/login'); return; }
    setCloning(true);
    try {
      const { project_id } = await api.cloneProject(projectId);
      navigate(`/p/${project_id}`);
    } catch (e) {
      setError(e.message);
      setCloning(false);
    }
  };

  if (error) {
    return (
      <div className="showcase">
        <ShowNav onHome={() => navigate('/')} />
        <div className="show-empty">
          <div className="lhero-mark">Film unavailable</div>
          <p>{error}</p>
          <button className="btn-gold" onClick={() => navigate('/')}>Back to home</button>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="showcase">
        <ShowNav onHome={() => navigate('/')} />
        <div className="show-empty"><div className="spinner" /> Loading…</div>
      </div>
    );
  }

  const nodes = project.nodes || [];
  const stills = nodes.filter((n) => (n.kind === 'keyframe' || n.kind === 'shot') && n.asset?.thumbnail);
  const s = project.settings || {};
  const tags = [
    s.length_min ? `${s.length_min} min` : null,
    s.style_preset, s.aspect, s.language,
  ].filter(Boolean);

  return (
    <div className="showcase">
      <ShowNav
        onHome={() => navigate('/')}
        action={
          <button className="btn-gold" onClick={useTemplate} disabled={cloning}>
            {cloning ? 'Cloning…' : signedIn ? 'Use this template →' : 'Sign in to use →'}
          </button>
        }
      />

      <section className="show-hero">
        <div className="show-kicker">Template</div>
        <h1 className="show-title">{project.title || 'Untitled Film'}</h1>
        {project.idea && <p className="show-idea">“{project.idea}”</p>}
        <div className="show-tags">
          {tags.map((t) => <span key={t} className="node-tag">{t}</span>)}
        </div>
      </section>

      {project.export_url && (
        <section className="show-cut">
          <TvPlayer src={project.export_url} poster={stills[0]?.asset?.thumbnail} title={project.title || 'Final Cut'} variant="frame" />
        </section>
      )}

      {stills.length > 0 && (
        <section className="lsection">
          <div className="lsection-head"><h2>Stills</h2></div>
          <div className="show-stills">
            {stills.map((n) => (
              <figure key={n.node_id} className="show-still">
                <img src={n.asset.thumbnail} alt={n.title} loading="lazy" />
                <figcaption>{n.title}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ShowNav({ onHome, action }) {
  return (
    <header className="lnav">
      <div className="lnav-brand" onClick={onHome} style={{ cursor: 'pointer' }} title="Home">
        <Logo variant="icon" className="lnav-logo" />
        <span className="brand-mark">CineForge</span>
        <span className="brand-sub">AI Film Studio</span>
      </div>
      <div className="lnav-right">{action}</div>
    </header>
  );
}
