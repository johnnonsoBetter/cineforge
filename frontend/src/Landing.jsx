import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from './api.js';
import { authEnabled, signOut } from './auth.js';

import Navbar from './components/landing/Navbar.jsx';
import Hero from './components/landing/Hero.jsx';
import Composer from './components/landing/Composer.jsx';
import Pipeline from './components/landing/Pipeline.jsx';
import CanvasShowcase from './components/landing/CanvasShowcase.jsx';
import LiveFeed from './components/landing/LiveFeed.jsx';
import Gallery from './components/landing/Gallery.jsx';
import Pillars from './components/landing/Pillars.jsx';
import GraphExplorer from './components/landing/GraphExplorer.jsx';
import CTA from './components/landing/CTA.jsx';

/* ─────────────────────────────────────────────────────────────────────────────
   CineForge — Landing (ported homepage, re-skinned to the studio's gold/warm
   palette). The marketing sections are static; the composer, gallery, and auth
   are wired to the real app.
───────────────────────────────────────────────────────────────────────────── */

const rootStyle = {
  minHeight: '100vh',
  backgroundColor: '#0a0805',
  color: '#cbb89a',
  overflowX: 'hidden',
  position: 'relative',
  backgroundImage:
    'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(228,165,85,0.10), transparent), ' +
    'radial-gradient(ellipse 60% 50% at 80% 40%, rgba(228,165,85,0.045), transparent)',
  backgroundAttachment: 'fixed',
};

export default function Landing({ session }) {
  const navigate = useNavigate();
  const [gallery, setGallery] = useState([]);
  const [adopting, setAdopting] = useState(null);

  useEffect(() => {
    api.getGallery().then((r) => setGallery(r.projects || [])).catch(() => setGallery([]));
  }, []);

  // The studio locks body scroll; the landing needs it back.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'auto';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const startForge = (idea, settings) => {
    if (authEnabled && !session) { navigate('/login'); return; }
    navigate('/studio', { state: { forge: { idea, settings } } });
  };

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

  const scrollToForge = useCallback(() => {
    document.getElementById('forge')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  return (
    <div className="cf-landing" style={rootStyle}>
      {/* film grain overlay */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <div className="relative z-10">
        <Navbar
          authEnabled={authEnabled}
          session={session}
          onSignIn={() => navigate('/login')}
          onSignOut={() => signOut()}
          onStart={scrollToForge}
        />

        <main>
          <Hero onStart={scrollToForge} />

          <Composer onForge={startForge} />

          <div id="pipeline">
            <Pipeline />
          </div>

          <div id="canvas">
            <CanvasShowcase />
          </div>

          <LiveFeed />

          <Gallery
            gallery={gallery}
            adopting={adopting}
            onUseTemplate={useTemplate}
            onStart={scrollToForge}
          />

          <div id="pillars">
            <Pillars />
          </div>

          <div id="explorer">
            <GraphExplorer />
          </div>

          <CTA onStart={scrollToForge} />
        </main>

      </div>
    </div>
  );
}
