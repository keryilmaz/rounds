// The switcher: every idea you have going, as its real screen, over the canvas you left. The dock's
// key (or W) opens it. An idea is one of the canvas's own groups, shown by its newest screen: the
// top row is what moved lately, newest first; the smaller row under it is older, or a session
// waiting on you with nothing on the canvas yet. A session that stopped to ask you something
// carries Rounds' badge on its screen (the accent when it's held up on you, grey when it can
// wait), and the badge opens into its question, answered right there. Anywhere else on an idea
// takes you into it: a breath of paper over the canvas, the camera cut to its screens underneath
// (a flight from far out smears the far-out pictures), and the screen settles into its place.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clean, img, thumb, threadLink, type Index } from "./data";
import { Glyph } from "./glyphs";
import type { Cluster, Group } from "./layout";
import { CLOSE, OPEN, type Stop } from "./Waiting";
import { DecisionCard } from "./Decision";

type Rect = { x: number; y: number; w: number; h: number };
export type Idea = {
  key: string; title: string; project: string; at: number; line: string;
  pic: { src: string; ar: number } | null;
  words: string | null; // no screen: its own words stand in
  group: Group | null; stop: Stop | null; session: string | null;
};

const DAY = 864e5;
const TOP = 5, REST = 4;
// a recap's first sentence, as the line under an idea
const first = (t: string) => clean(t).replace(/\s*https?:\/\/\S+/g, "").split(/(?<=[a-z0-9)%])[.;!?](?:\s|$)/i)[0].trim();
const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** The ideas, newest first: the top row and the row under it. */
export function ideasOf(clusters: Cluster[], index: Index, stops: Stop[], now = Date.now()) {
  const setAt = new Map(index.sets.map((s) => [s.id, s.at]));
  // a group's thread is a Claude Code session; its desktop session holds the recap and the link
  const session = new Map<string, { id: string; recap: string }>();
  for (const t of index.threads) {
    const rec = { id: t.id, recap: t.recap };
    session.set(t.id, rec);
    for (const c of ((t as unknown as { clis?: string[] }).clis || [])) session.set(c, rec);
  }
  const stopOf = new Map(stops.map((s) => [s.id, s]));
  const all: Idea[] = [];
  const seen = new Set<string>();
  const badged = new Set<string>(); // a session's badge sits on its newest idea only
  const groups = clusters.flatMap((c) => c.groups.map((g) => ({ g, c }))).sort((a, b) => b.g.at - a.g.at);
  for (const { g, c } of groups) {
    // one idea per sitting's session; a topic is its own line of work, whoever sent to it
    if (!g.id.startsWith("t-") && g.thread) { if (seen.has(g.thread)) continue; seen.add(g.thread); }
    // two topics with one name (the same work filed under two projects) read as one idea
    const name = g.title.toLowerCase();
    if (seen.has(`title:${name}`)) continue;
    seen.add(`title:${name}`);
    let pic: Idea["pic"] = null;
    const shots = g.all.filter((it) => it.kind === "shot");
    if (shots.length) {
      const best = shots.reduce((a, b) => ((setAt.get(b.kind === "shot" ? b.set : "") || 0) > (setAt.get(a.kind === "shot" ? a.set : "") || 0) ? b : a));
      if (best.kind === "shot") pic = { src: img(best.shot, 960), ar: best.shot.w / best.shot.h };
    } else {
      const pg = g.all.find((it) => it.kind === "page");
      if (pg && pg.kind === "page") pic = { src: thumb(pg.hash), ar: pg.w / pg.h };
    }
    const s = g.thread ? session.get(g.thread) : null;
    let stop = (g.ask && stopOf.get(g.ask.id)) || (s && stopOf.get(s.id)) || null;
    if (stop && badged.has(stop.id)) stop = null;
    if (stop) badged.add(stop.id);
    all.push({
      key: g.id, title: g.title, project: c.name, at: g.at,
      line: cap(first(stop?.recap || s?.recap || "")),
      pic, words: pic ? null : g.title, group: g, stop, session: stop?.id || s?.id || null,
    });
  }
  // sessions waiting on you with nothing on the canvas: their own words stand in for a screen
  const placed = new Set(all.filter((i) => i.stop).map((i) => i.stop!.id));
  const loose: Idea[] = stops.filter((s) => !placed.has(s.id)).map((s) => ({
    key: `s-${s.id}`, title: clean(s.title), project: index.projects[s.project] || s.project, at: s.at,
    line: cap(first(s.recap)), pic: null, words: cap(clean(s.ask || s.recap || s.title)), group: null, stop: s, session: s.id,
  }));
  const top = all.filter((i) => now - i.at < 3 * DAY).slice(0, TOP);
  for (const i of all) if (top.length < TOP && !top.includes(i)) top.push(i);
  top.sort((a, b) => b.at - a.at);
  const waiting = [...all.filter((i) => i.stop && !top.includes(i)), ...loose].sort((a, b) => b.at - a.at);
  const older = all.filter((i) => !i.stop && !top.includes(i));
  // everything waiting on you gets a place, whatever else the row has room for
  const rest = [...waiting, ...older].slice(0, Math.max(REST, waiting.length));
  return { top, rest };
}

// where each idea sits: rows centred above the dock, the top row taller; a row too wide for the
// window comes down in size
type Spot = Rect & { slot: number };
const GAP = 40, CAPH = 58, ROWGAP = 48, MINSLOT = 156;
function placeAll(rows: Idea[][], vw: number, floor: number): Spot[][] {
  const room = floor - 48;
  let H0 = Math.round(Math.min(300, Math.max(150, (room - CAPH * 2 - ROWGAP) * 0.6)));
  const out: Spot[][] = [];
  const sized = rows.map((row, r) => {
    let H = r === 0 ? H0 : Math.round(H0 * 0.63);
    const lay = (H: number) => row.map((i) => {
      const ar = i.pic ? Math.max(0.42, Math.min(1.6, i.pic.ar)) : 0.75;
      const w = Math.round(H * ar);
      return { w, h: H, slot: Math.max(w, MINSLOT) };
    });
    let s = lay(H);
    const W = s.reduce((a, x) => a + x.slot, 0) + GAP * (row.length - 1);
    // a row keeps a hundred points of air at each side; wider, it comes down in size
    if (W > vw - 200) { H = Math.max(110, Math.floor(H * (vw - 200) / W)); s = lay(H); }
    return { s, H };
  });
  const used = sized.filter((x) => x.s.length);
  const total = used.reduce((a, x) => a + x.H + CAPH, 0) + ROWGAP * Math.max(0, used.length - 1);
  let y = Math.max(28, Math.round((floor - 16 - total) / 2));
  for (const { s, H } of sized) {
    if (!s.length) { out.push([]); continue; }
    const W = s.reduce((a, x) => a + x.slot, 0) + GAP * (s.length - 1);
    let x = Math.round((vw - W) / 2);
    out.push(s.map((p) => { const spot = { x, y, w: p.w, h: p.h, slot: p.slot }; x += p.slot + GAP; return spot; }));
    y += H + CAPH + ROWGAP;
  }
  return out;
}

const still = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Every idea you have going, over the canvas. */
export function Switcher({ open, clusters, index, stops, focus, onClose, onLand, onDone }: {
  open: boolean; clusters: Cluster[]; index: Index; stops: Stop[]; focus: string | null;
  onClose: () => void;
  /** go to a group: the camera there at once, and where its screens now sit in the window */
  onLand: (g: Group) => Rect | null;
  /** answered here; told once the switcher closes, so the canvas lays out again only then */
  onDone: (s: Stop) => void;
}) {
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useEffect(() => { document.body.classList.toggle("sw-on", shown); }, [shown]);
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight });
  useEffect(() => { const r = () => setSize({ w: innerWidth, h: innerHeight }); addEventListener("resize", r); return () => removeEventListener("resize", r); }, []);
  // the ideas as they were when it opened: answering one doesn't reshuffle the rest under you
  const [snap, setSnap] = useState(() => ideasOf(clusters, index, stops));
  useLayoutEffect(() => { if (open) setSnap(ideasOf(clusters, index, stops)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => [snap.top, snap.rest], [snap]);
  const flat = useMemo(() => [...snap.top, ...snap.rest], [snap]);
  const floor = (document.querySelector(".dock")?.getBoundingClientRect().top ?? size.h - 80);
  const spots = useMemo(() => placeAll(rows, size.w, floor), [rows, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const spotOf = (i: number) => (i < snap.top.length ? spots[0][i] : spots[1][i - snap.top.length]);

  const [sel, setSel] = useState(0);
  // the fill glides only once you move it: opening, it is already on its idea, and rises with it
  const [glide, setGlide] = useState(false);
  const walk = (n: number) => { setGlide(true); setSel(n); };
  const [dc, setDc] = useState<string | null>(null); // the idea whose decision is open
  const [sent, setSent] = useState<Record<string, string>>({}); // answers given here, by session
  const [back, setBack] = useState<Idea | null>(null); // the idea you just went into
  const done = useRef<Stop[]>([]);
  const eat = useRef(false); // the click after a press that put a decision away

  const root = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const hush = useRef<HTMLDivElement>(null);
  const pickEl = useRef<HTMLDivElement>(null);
  const runs = useRef<Animation[]>([]);
  const leaving = useRef(false);

  // opening: the veil comes over the canvas and the ideas rise off the dock, the row nearest it
  // first, then outward from where you are; closing, they go together, quicker
  useLayoutEffect(() => {
    const el = root.current;
    if (!shown || !el) return;
    for (const a of runs.current) a.cancel();
    runs.current = [];
    const ideas = [...el.querySelectorAll<HTMLElement>("[data-idea]")];
    if (open) {
      leaving.current = false;
      setBack(null);
      el.style.visibility = "visible";
      const at = focus ? flat.findIndex((i) => i.stop?.id === focus) : -1;
      const start = at >= 0 ? at : 0;
      setSel(start);
      setGlide(false);
      if (at >= 0) setTimeout(() => setDc(flat[at].key), still() ? 0 : 280);
      if (still()) return;
      runs.current.push(veil.current!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN.ms, easing: OPEN.ease }));
      const rise = (n: HTMLElement, i: number) => {
        const row = i < snap.top.length ? 0 : 1;
        runs.current.push(n.animate([{ opacity: 0, translate: "0 24px", scale: "0.97" }, { opacity: 1, translate: "0 0", scale: "1" }],
          { duration: OPEN.ms, easing: OPEN.ease, delay: (1 - row) * 50 + Math.abs(i - start) * 20, fill: "backwards" }));
      };
      ideas.forEach(rise);
      // the fill comes up with the idea it's on, not ahead of it
      if (pickEl.current) rise(pickEl.current, start);
    } else {
      setDc(null);
      if (leaving.current) return; // going into an idea runs its own way out
      const end = () => { el.style.visibility = "hidden"; setShown(false); };
      if (still()) { end(); return; }
      const a = veil.current!.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE.ms, easing: CLOSE.ease, fill: "forwards" });
      for (const n of [...ideas, pickEl.current].filter((n): n is HTMLElement => !!n)) runs.current.push(n.animate([{ opacity: 1 }, { opacity: 0, translate: "0 12px" }], { duration: CLOSE.ms * 0.8, easing: CLOSE.ease, fill: "forwards" }));
      runs.current.push(a);
      a.onfinish = end;
    }
  }, [open, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  // answers given here reach the canvas once it's closed
  useEffect(() => {
    if (open || !done.current.length) return;
    const list = done.current; done.current = [];
    for (const s of list) onDone(s);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // the decision open on one idea (Decision.tsx), kept until it has folded back into its badge
  const dcIdea = dc ? flat.find((i) => i.key === dc) || null : null;
  const [dcShown, setDcShown] = useState<Idea | null>(null);
  if (dcIdea && dcShown !== dcIdea) setDcShown(dcIdea);
  const sentHere = (i: Idea, text: string) => {
    done.current.push(i.stop!);
    setDc(null);
    setTimeout(() => setSent((m) => ({ ...m, [i.stop!.id]: text })), still() ? 0 : CLOSE.ms);
  };

  // going in: paper over the canvas, the camera cut to the group under it, its screen settling into place
  const go = (i: Idea) => {
    if (!i.group) { if (i.session) location.href = threadLink(i.session); return; }
    const el = root.current?.querySelector<HTMLElement>(`[data-idea="${i.key}"] [data-scr]`);
    const from = el?.getBoundingClientRect();
    leaving.current = true;
    setDc(null);
    const h = hush.current!, v = veil.current!;
    const fly = from && el ? el.cloneNode(true) as HTMLElement : null;
    if (fly && from) { Object.assign(fly.style, { position: "fixed", left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, margin: "0", zIndex: "62", transformOrigin: "0 0" }); document.body.appendChild(fly); }
    for (const n of root.current!.querySelectorAll<HTMLElement>("[data-idea]")) n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" });
    const land = () => {
      const to = onLand(i.group!); // the camera is there now, under the paper
      onClose();
      const out = h.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 520, easing: "cubic-bezier(0.3, 0.7, 0.1, 1)", fill: "forwards" });
      v.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, fill: "forwards" });
      out.onfinish = () => { root.current!.style.visibility = "hidden"; setShown(false); h.getAnimations().forEach((a) => a.cancel()); };
      if (fly && from && to) {
        const k = Math.min(to.w / from.width, to.h / from.height) * 0.9;
        const tx = to.x + (to.w - from.width * k) / 2 - from.left, ty = to.y + (to.h - from.height * k) / 2 - from.top;
        const a = fly.animate([{ transform: "none", opacity: 1 }, { opacity: 1, offset: 0.3 }, { transform: `translate(${tx}px, ${ty}px) scale(${k})`, opacity: 0 }], { duration: 560, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "forwards" });
        a.onfinish = () => fly.remove();
      } else fly?.remove();
      setBack(i);
    };
    if (still()) { land(); return; }
    h.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out", fill: "forwards" }).onfinish = land;
  };

  // keys while it's open: the arrows walk, Return opens a decision or goes in, 1 to 3 answer, Esc puts away
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea");
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); if (dc) setDc(null); else onClose(); return; }
      if (typing) return;
      const cur = flat[sel];
      if (dc) {
        // an open decision keeps its own keys; the arrows put it away and walk on
        if (!e.key.startsWith("Arrow")) return;
        setDc(null);
      }
      const row = sel < snap.top.length ? 0 : 1;
      const inRow = row === 0 ? snap.top : snap.rest, j = row === 0 ? sel : sel - snap.top.length, base = row === 0 ? 0 : snap.top.length;
      if (e.key === "ArrowRight" && j + 1 < inRow.length) { e.preventDefault(); walk(base + j + 1); }
      else if (e.key === "ArrowLeft" && j > 0) { e.preventDefault(); walk(base + j - 1); }
      else if ((e.key === "ArrowDown" && row === 0 && snap.rest.length) || (e.key === "ArrowUp" && row === 1)) {
        e.preventDefault();
        const here = spotOf(sel), cx = here.x + here.slot / 2;
        const to = row === 0 ? 1 : 0, other = spots[to], b2 = to === 0 ? 0 : snap.top.length;
        let best = 0;
        other.forEach((s, n) => { if (Math.abs(s.x + s.slot / 2 - cx) < Math.abs(other[best].x + other[best].slot / 2 - cx)) best = n; });
        walk(b2 + best);
      } else if (e.key === "Enter" && cur) {
        e.preventDefault();
        if (cur.stop && !sent[cur.stop.id]) setDc(cur.key); else go(cur);
      }
    };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  });

  // after going in, the line over the dock stays until you move on
  useEffect(() => {
    if (!back) return;
    const away = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest("[data-back]")) setBack(null); };
    const t = setTimeout(() => addEventListener("pointerdown", away, true), 600);
    return () => { clearTimeout(t); removeEventListener("pointerdown", away, true); };
  }, [back]);

  const pick = spots.length && flat[sel] ? spotOf(sel) : null;
  const capH = useRef<Record<string, number>>({});
  const [, bump] = useState(0);
  useLayoutEffect(() => {
    // the fill wraps the caption too, so it takes the caption's height once laid out
    let changed = false;
    for (const n of root.current?.querySelectorAll<HTMLElement>("[data-cap]") || []) {
      const key = n.dataset.cap!, h = n.offsetHeight;
      if (capH.current[key] !== h) { capH.current[key] = h; changed = true; }
    }
    if (changed) bump((x) => x + 1);
  });
  const pr = pick ? { x: pick.x - 14, y: pick.y - 14, w: pick.slot + 28, h: pick.h + (capH.current[flat[sel].key] || 40) + 24 } : null;

  const backLine = back ? (back.stop && sent[back.stop.id] ? `Sent: ${sent[back.stop.id]}` : back.line) : "";
  return (
    <>
      <div ref={root} data-chrome role="dialog" aria-label="Your ideas" aria-hidden={!open} className="sw fixed inset-0 z-40" style={{ visibility: shown ? "visible" : "hidden" }}
        onPointerDown={(e) => {
          e.stopPropagation();
          // a press outside an open decision only puts the decision away: the click it ends in goes nowhere
          eat.current = !!dc && !(e.target as HTMLElement).closest("[data-decision], [data-ask]");
          if (eat.current) setDc(null);
        }}
        onClickCapture={(e) => { if (eat.current) { eat.current = false; e.stopPropagation(); } }}
        onClick={(e) => { if (!(e.target as HTMLElement).closest("[data-idea], [data-decision]")) onClose(); }}>
        <div ref={veil} className="sw-veil absolute inset-0" />
        {pr && <div ref={pickEl} className="sw-pick" style={{ transform: `translate3d(${pr.x}px, ${pr.y}px, 0)`, width: pr.w, height: pr.h, opacity: dc ? 0 : 1, transition: glide ? undefined : "opacity 200ms var(--ease-out)" }} />}
        {flat.map((i, n) => {
          const s = spotOf(n);
          if (!s) return null;
          const answered = i.stop ? sent[i.stop.id] : undefined;
          // the idea whose decision is open stays forward of the paper that steps the rest back
          const forward = dc === i.key || dcShown === i;
          return (
            <div key={i.key} data-idea={i.key} className="sw-idea absolute left-0 top-0" style={{ transform: `translate3d(${s.x}px, ${s.y}px, 0)`, width: s.slot, zIndex: forward ? 5 : undefined }}
              onMouseEnter={() => { if (!dc) walk(n); }}
              onClick={(e) => { if ((e.target as HTMLElement).closest("[data-ask]")) return; if (dc) { setDc(null); return; } setSel(n); go(i); }}>
              <div className="relative" style={{ width: s.w }}>
                <div data-scr className={`sw-scr ${i.pic ? "" : "words"}`} style={{ width: s.w, height: s.h }}>
                  {i.pic ? <img src={i.pic.src} alt="" draggable={false} /> : <span>{i.words}</span>}
                </div>
                {i.stop && (
                  <button data-ask type="button" aria-label="Its decision" className={`sw-ask ${i.stop.needs ? "" : "wait"}`}
                    // the card that grows out of it starts as exactly this badge, so it steps aside at once
                    // and is back the moment the card has folded into it
                    style={{ opacity: answered || dcShown === i ? 0 : 1, scale: answered ? "0" : "1", transition: "scale 280ms var(--ease-out)" }}
                    onClick={(e) => { e.stopPropagation(); walk(n); setDc(dc === i.key ? null : i.key); }}>
                    {(i.stop.ask ? 1 : 0) + (i.stop.more || 0) || 1}
                  </button>
                )}
              </div>
              <div data-cap={i.key} className="sw-cap">
                <div className="sw-nm">{i.title}</div>
                <div className="sw-ln">{answered ? <><Glyph name="done" size={12} /> Sent: {answered}</> : i.line || i.project}</div>
              </div>
            </div>
          );
        })}
        {/* While a decision is open the other ideas step back under one sheet of paper: one layer
            fading, where dimming each screen had Safari repaint eight large ones over the blur */}
        <div aria-hidden className="sw-scrim" style={{ opacity: dc ? 0.5 : 0 }} />
        {/* the decision, opening out of its badge */}
        {dcShown && (() => {
          const s = spotOf(flat.indexOf(dcShown));
          if (!s) return null;
          const st = dcShown.stop!;
          return <DecisionCard key={dcShown.key} stop={st} at={{ x: s.x + s.w - 4, y: s.y + 4 }} size={24} open={dc === dcShown.key} z={6}
            mark={(st.ask ? 1 : 0) + (st.more || 0) || 1}
            onSent={(t) => sentHere(dcShown, t)} onDismiss={() => setDc(null)} onGone={() => setDcShown(null)} />;
        })()}
        <div ref={hush} className="sw-hush pointer-events-none absolute inset-0" />
      </div>
      {back && (
        <div data-back data-chrome className="glass lite sw-back fixed z-30 flex items-center gap-3.5 whitespace-nowrap rounded-full pl-[18px] pr-1.5" style={{ left: "50%", translate: "-50% 0", bottom: innerHeight - floor + 12, height: 48 }}>
          <b className="text-[14px] font-[560] tracking-[-0.01em] text-[var(--ink)]">{back.title}</b>
          {backLine && <span className="max-w-[460px] truncate text-[13.5px] text-[var(--muted)]">{backLine}</span>}
          {back.session && (
            <a href={threadLink(back.session)} onClick={() => setBack(null)} className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--ink)] px-3.5 text-[13.5px] font-[560] text-white">
              Open the thread<Glyph name="open" size={12} />
            </a>
          )}
        </div>
      )}
    </>
  );
}
