import { Workflow, Globe, Mail } from 'lucide-react';

const cols = [
  {
    title: 'Product',
    links: ['Pipeline', 'Canvas', 'Gallery', 'Graph Explorer', 'Pricing'],
  },
  {
    title: 'Resources',
    links: ['Docs', 'API Reference', 'Provenance', 'CLI', 'Changelog'],
  },
  {
    title: 'Company',
    links: ['About', 'Blog', 'Careers', 'Contact', 'Press'],
  },
];

export default function Footer() {
  return (
    <footer className="relative px-6 pt-20 pb-10 border-t border-white/[0.04]">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2">
            <a href="#" className="flex items-center gap-2.5 mb-4">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent-400 to-accent-600 text-ink-950">
                <Workflow className="h-5 w-5" strokeWidth={2.5} />
              </div>
              <span className="font-display text-lg font-semibold text-white">
                CineForge
              </span>
            </a>
            <p className="text-sm text-slate-400 max-w-xs leading-relaxed">
              A creative operating system for AI filmmaking. Versioned assets,
              dependency graphs, gated stages, and cryptographically traceable
              provenance.
            </p>
            <div className="flex items-center gap-3 mt-5">
              <a href="#" className="grid h-9 w-9 place-items-center rounded-lg glass text-slate-400 hover:text-white transition-colors">
                <Globe className="h-4 w-4" />
              </a>
              <a href="#" className="grid h-9 w-9 place-items-center rounded-lg glass text-slate-400 hover:text-white transition-colors">
                <Mail className="h-4 w-4" />
              </a>
            </div>
          </div>

          {cols.map((c) => (
            <div key={c.title}>
              <h4 className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-4">
                {c.title}
              </h4>
              <ul className="space-y-2.5">
                {c.links.map((l) => (
                  <li key={l}>
                    <a
                      href="#"
                      className="text-sm text-slate-400 hover:text-white transition-colors"
                    >
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 pt-6 border-t border-white/[0.04] flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-xs font-mono text-slate-600">
            © 2026 CineForge. All rights reserved.
          </span>
          <span className="text-xs font-mono text-slate-600">
            Built for the Genblaze + Backblaze B2 hackathon.
          </span>
        </div>
      </div>
    </footer>
  );
}
