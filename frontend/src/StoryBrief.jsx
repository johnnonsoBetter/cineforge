import { useState } from 'react';
import { SHOT_SECONDS } from './ui.js';

// The synthesis pass, laid out as a production brief.
//
// The story stage decides *everything* — the cast, the locations, the breakdown, the
// coverage, every spoken line — and the stages after it are mechanical execution of those
// decisions. Between the story gate and the stages that build them, this panel is the only
// place any of it exists: there is no character node to click yet, no scene card on the
// canvas. A gate you can't read is a gate nobody can honestly approve, so everything the
// pass wrote is here, in the order a director reads it: what it costs, what the film is
// about, who is in it, where it happens, how it is shot, and what is said.
//
// Entities are shown whether or not their node has been built. Once it has, the chip walks
// the graph to it; until then it is plainly marked as not yet built rather than being a
// dead click.

function Section({ title, count, children, defaultOpen = true, hint }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="insp-section brief-section">
      <button className="brief-head" onClick={() => setOpen((o) => !o)}>
        <span className={`drawer-caret ${open ? 'open' : ''}`}>▶</span>
        <h3>{title}</h3>
        {count != null && <span className="mono-label">· {count}</span>}
      </button>
      {open && (
        <>
          {hint && <div className="brief-hint">{hint}</div>}
          {children}
        </>
      )}
    </div>
  );
}

// A character or location as the story wrote it, with the visual block the sheet will be
// generated from. That block is the thing worth reading at this gate: it is what every
// later frame of this entity is matched against.
function EntityCard({ entity, what, node, onSelectNode }) {
  return (
    <li className="brief-entity">
      <div className="brief-entity-head">
        <span className="brief-entity-name">{entity.name}</span>
        <code className="brief-id">{entity.id}</code>
        {node ? (
          <button className="ref-chip brief-jump" onClick={() => onSelectNode(node.node_id)}
                  title={`Go to ${entity.name}`}>
            open
          </button>
        ) : (
          <span className="brief-pending">not built yet</span>
        )}
      </div>
      <div className="brief-dna">{entity[what] || <em>no description written</em>}</div>
    </li>
  );
}

function SceneCard({ scene, castNames, envName }) {
  const [open, setOpen] = useState(false);
  const coverage = scene.coverage || [];
  const cast = (scene.character_ids || []).map((id) => castNames[id] || id);

  return (
    <li className="brief-scene">
      <button className="brief-scene-head" onClick={() => setOpen((o) => !o)}>
        <span className="brief-scene-n">{scene.n}</span>
        <span className="brief-scene-title">{scene.title}</span>
        {scene.intent && <span className="brief-intent">{scene.intent}</span>}
        <span className="brief-setups">{coverage.length} setup{coverage.length === 1 ? '' : 's'}</span>
      </button>

      {open && (
        <div className="brief-scene-body">
          <div className="brief-strip">
            {envName && <span className="brief-tag">{envName}</span>}
            {cast.map((n) => <span className="brief-tag cast" key={n}>{n}</span>)}
            {scene.time && <span className="brief-tag dim">{scene.time}</span>}
          </div>

          {scene.action && <div className="brief-action">{scene.action}</div>}

          <div className="brief-framing">
            {[scene.shot, scene.angle, scene.move].filter(Boolean).join(' · ')}
            {scene.atmosphere && <span className="brief-atmos"> — {scene.atmosphere}</span>}
          </div>

          {scene.vo && <div className="brief-vo">“{scene.vo}”</div>}

          {coverage.length > 0 && (
            <ol className="brief-coverage">
              {coverage.map((c, i) => (
                <li key={i}>
                  <span className="beat-name">
                    {[c.shot, c.angle].filter(Boolean).join(' · ')}
                    {c.move ? <em> · {c.move}</em> : null}
                  </span>
                  {c.action && <span className="beat-text">{c.action}</span>}
                  {c.intent && <span className="beat-text dim">to {c.intent}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

export default function StoryBrief({ node, entityNodes = {}, onSelectNode }) {
  const d = node.data || {};
  const plan = d.plan || {};
  const cast = plan.characters || [];
  const places = plan.environments || [];
  const scenes = plan.scenes || [];

  const bible = d.bible || {};
  const beats = d.beats || [];

  // The real arithmetic, off the plan the film will actually be built from — not the
  // estimate the hero showed before a word was written.
  const shots = scenes.reduce((a, s) => a + (s.coverage?.length || 0), 0);
  const runtime = shots * SHOT_SECONDS;

  const castNames = Object.fromEntries(cast.map((c) => [c.id, c.name]));
  const envNames = Object.fromEntries(places.map((e) => [e.id, e.name]));
  const spoken = scenes.filter((s) => s.vo);

  const BIBLE_ROWS = [
    ['theme', 'Theme'], ['genre', 'Genre'], ['mood', 'Mood'],
    ['conflict', 'Conflict'], ['resolution', 'Resolution'], ['symbolism', 'Symbolism'],
  ].filter(([k]) => bible[k]);

  return (
    <>
      {scenes.length > 0 && (
        <div className="insp-section">
          <h3>What this film is</h3>
          <div className="brief-figures">
            <div><b>{scenes.length}</b><span>scenes</span></div>
            <div><b>{scenes.length}</b><span>master frames</span></div>
            <div><b>{shots}</b><span>shots</span></div>
            <div><b>{runtime}s</b><span>runtime</span></div>
          </div>
          <div className="brief-hint">
            {d.source === 'llm'
              ? 'Bespoke screenplay — written for this idea.'
              : 'Sample screenplay — no language model was reachable, so the pipeline ran on the built-in story.'}
            {' '}Every figure here is counted off the breakdown below, so it is what the
            film will actually cost to build, not an estimate.
          </div>
        </div>
      )}

      {BIBLE_ROWS.length > 0 && (
        <div className="insp-section">
          <h3>Story bible</h3>
          <dl style={{ margin: 0 }}>
            {BIBLE_ROWS.map(([k, label]) => (
              <div className="kv" key={k}><dt>{label}</dt><dd>{bible[k]}</dd></div>
            ))}
          </dl>
        </div>
      )}

      {beats.length > 0 && (
        <div className="insp-section">
          <h3>Beat sheet</h3>
          <ol className="beats">
            {beats.map((b, i) => (
              <li key={i}>
                {b.name && <span className="beat-name">{b.name}</span>}
                <span className="beat-text">{b.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {cast.length > 0 && (
        <Section title="Cast" count={cast.length}
                 hint="The visual block each reference sheet is generated from — and the one every later frame of that character is matched against.">
          <ul className="brief-entities">
            {cast.map((c) => (
              <EntityCard key={c.id} entity={c} what="dna" node={entityNodes[c.id]}
                          onSelectNode={onSelectNode} />
            ))}
          </ul>
        </Section>
      )}

      {places.length > 0 && (
        <Section title="Locations" count={places.length}
                 hint="Each is rendered once as an unpopulated establishing plate, then reused by every scene staged inside it.">
          <ul className="brief-entities">
            {places.map((e) => (
              <EntityCard key={e.id} entity={e} what="desc" node={entityNodes[e.id]}
                          onSelectNode={onSelectNode} />
            ))}
          </ul>
        </Section>
      )}

      {scenes.length > 0 && (
        <Section title="Breakdown" count={`${scenes.length} scenes · ${shots} setups`}
                 hint="Open a scene for its staging, its master framing and the coverage it earned.">
          <ol className="brief-scenes">
            {scenes.map((s) => (
              <SceneCard key={s.n} scene={s} castNames={castNames}
                         envName={envNames[s.environment_id]} />
            ))}
          </ol>
        </Section>
      )}

      {spoken.length > 0 && (
        <Section title="Script" count={`${spoken.length} lines`} defaultOpen={false}
                 hint="Every spoken line, in order. One line per scene, voiced on that scene's first setup.">
          <ol className="brief-script">
            {spoken.map((s) => (
              <li key={s.n}>
                <span className="brief-script-slug">{s.n} · {s.title}</span>
                <span className="brief-script-line">“{s.vo}”</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </>
  );
}
