import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import Logo from '../Logo.jsx';

const links = [
  { label: 'Pipeline', href: '#pipeline' },
  { label: 'Canvas', href: '#canvas' },
  { label: 'Gallery', href: '#gallery' },
  { label: 'Graph', href: '#explorer' },
  { label: 'Pillars', href: '#pillars' },
];

export default function Navbar({ authEnabled, session, onSignIn, onSignOut, onStart }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="fixed top-0 inset-x-0 z-50"
    >
      <div className={`mx-auto max-w-7xl px-6 transition-all duration-300 ${scrolled ? 'pt-3' : 'pt-6'}`}>
        <nav
          className={`flex items-center justify-between rounded-2xl px-5 py-3 transition-all duration-300 ${
            scrolled ? 'glass-strong shadow-2xl shadow-black/40' : ''
          }`}
        >
          <a href="#" className="flex items-center gap-2.5 group">
            <div className="relative">
              <div className="absolute inset-0 bg-accent-500/30 blur-lg group-hover:bg-accent-500/50 transition-colors" />
              <Logo variant="icon" className="relative h-9 w-9" />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight text-white">
              CineForge
            </span>
          </a>

          <div className="hidden md:flex items-center gap-1">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/[0.04]"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            {authEnabled && session ? (
              <button
                onClick={onSignOut}
                title={session.user?.email}
                className="text-sm text-slate-400 hover:text-white transition-colors"
              >
                Sign out
              </button>
            ) : authEnabled ? (
              <button onClick={onSignIn} className="text-sm text-slate-400 hover:text-white transition-colors">
                Sign in
              </button>
            ) : null}
            <button onClick={onStart} className="btn-primary !py-2 !px-4 text-sm">
              Start building
            </button>
          </div>

          <button
            className="md:hidden grid h-9 w-9 place-items-center rounded-lg glass text-white"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </nav>

        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="md:hidden mt-2 glass-strong rounded-2xl p-4 flex flex-col gap-1"
          >
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="px-4 py-3 rounded-lg text-slate-300 hover:bg-white/[0.06] hover:text-white"
              >
                {l.label}
              </a>
            ))}
            <button
              onClick={() => { setOpen(false); onStart(); }}
              className="btn-primary mt-2"
            >
              Start building
            </button>
          </motion.div>
        )}
      </div>
    </motion.header>
  );
}
