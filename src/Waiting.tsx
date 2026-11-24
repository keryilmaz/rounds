// What's waiting on you: the desktop sessions that stopped to ask you something (server/waiting.mjs).
// The dock carries one key: the mark and how many. Pressed, it grows into a card above the dock
// listing every one of them, and the rest of the canvas steps back. A waiting session's newest
// screen carries the mark too, on its corner, the way a note's badge does. A row (or a mark) opens
// that session's answers under its question and brings its screens into view; an answer goes to
// the session through the relay, and the row goes.
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clean, img, thumb, threadLink, when, type Index } from "./data";
import { Glyph } from "./glyphs";
import type { Ask } from "./layout";

export type Stop = {
  id: string; title: string; project: string; at: number; recap: string;
  ask: string; more: number; answers: string[]; needs: boolean; waiting: boolean; unseen: boolean;
};

export const narrow = () => innerWidth < 700;

// the sessions that finished a turn in the last two weeks, asked again every minute, so a session
// that stops to ask you turns up without a reload
export function useStops() {
  const [stops, setStops] = useState<Stop[] | null>(null);
  useEffect(() => {
    const get = () => fetch("/api/waiting").then((r) => r.json()).then((r) => setStops(r.stops)).catch(() => setStops((s) => s ?? []));
    get();
    const t = setInterval(get, 60e3);
    return () => clearInterval(t);
  }, []);
  return stops;
}

// what you've opened, per turn: a session that stops to ask again comes back
const DONE = "rounds-line-done";
const keyOf = (s: Stop) => `${s.id}:${s.at}`;
const readDone = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(DONE) || "[]")); } catch { return new Set(); } };
const writeDone = (s: Set<string>) => { try { localStorage.setItem(DONE, JSON.stringify([...s].slice(-200))); } catch {} };

/** The sessions waiting on you, stopped-and-asking first, then newest; and the marks they put on the canvas. */
export function useWaiting(stops: Stop[] | null) {
  const [done, setDone] = useState(readDone);
  const waiting = useMemo(() => (stops || []).filter((s) => s.waiting && !done.has(keyOf(s))).sort((a, b) => Number(b.needs) - Number(a.needs) || b.at - a.at), [stops, done]);
  // the same marks keep the same map, so the canvas lays out again only when they change
  const sig = waiting.map(keyOf).join(" ");
  const marks = useMemo(() => (stops ? new Map<string, Ask>(waiting.map((s) => [s.id, { id: s.id, title: s.title, project: s.project, at: s.at, recap: s.recap, ask: s.ask, more: s.more, answers: s.answers }])) : undefined), [sig, !!stops]);
  const finish = (s: Stop) => {
    const next = new Set(done).add(keyOf(s));
    writeDone(next);
    setDone(next);
  };
  return { waiting, marks, finish };
}

/** The canvas mark at dock size: the accent with the session glyph in white. */
export function Mark({ size }: { size: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full text-white" style={{ width: size, height: size, background: "var(--honey)" }}>
      <Glyph name="comment" size={Math.round(size * 0.56)} />
    </span>
  );
}

/** The dock's key for what's waiting: the mark and how many. Pressed, its card is open, and it
 *  wears the wash the date takes when the canvas shows another day. */
export function WaitKey({ n, on, onToggle }: { n: number; on: boolean; onToggle: () => void }) {
  return (
    <button
      data-waitkey
      onClick={onToggle}
      aria-pressed={on}
      aria-expanded={on}
      aria-label={`${n} waiting on you`}
      aria-keyshortcuts="W"
      data-tip={on ? undefined : "Waiting on you (W)"}
      className="flex h-11 shrink-0 items-center gap-2 rounded-full pl-3 pr-4 text-[13px] font-[560] tracking-[-0.01em] text-[var(--ink)] transition-[background,transform] duration-200 active:scale-95"
      style={{ background: on ? "var(--honey-wash)" : "transparent", transition: `background ${OPEN.ms}ms ${OPEN.ease}, transform 200ms ${EASE}`, animation: "wb-chip 260ms var(--ease-out) both" }}
    >
      <Mark size={20} />
      <span className="[font-variant-numeric:tabular-nums]">{n}</span>
    </button>
  );
}

// what it asked, or what it said last; a bare link reads as noise in a row, so it goes
const said = (s: Stop) => clean((s.ask || (s.recap ? s.recap.charAt(0).toUpperCase() + s.recap.slice(1) : "It stopped to ask you something.")).replace(/\s*https?:\/\/\S+/g, "").replace(/\s{2,}/g, " "));

// the card's place: over the key, 12 above the dock, held inside the window's 16 point margins
const LIST_W = 392;
export function listBox(phone: boolean) {
  const key = document.querySelector("[data-waitkey]")?.getBoundingClientRect();
  const dock = document.querySelector(".dock")?.getBoundingClientRect();
  const w = phone ? innerWidth - 32 : LIST_W;
  const cx = key ? key.left + key.width / 2 : innerWidth / 2;
  const left = Math.round(Math.max(16, Math.min(cx - w / 2, innerWidth - 16 - w)));
  const bottom = Math.round(innerHeight - (dock ? dock.top : innerHeight - 80) + 12);
  const card = document.querySelector("[data-waitlist]") as HTMLElement | null;
  return { left, bottom, w, top: innerHeight - bottom - (card?.offsetHeight ?? 0), key };
}

// a session's newest screen, else its newest page, for the row's picture
function pictureOf(index: Index, id: string): string | null {
  const set = index.sets.filter((s) => s.thread === id && s.shots.length).sort((a, b) => b.at - a.at)[0];
  if (set) return img(set.shots[0], 240);
  const page = index.pages.filter((p) => p.thread === id && p.versions.length).sort((a, b) => b.versions[b.versions.length - 1].at - a.versions[a.versions.length - 1].at)[0];
  return page ? thumb(page.versions[page.versions.length - 1].hash) : null;
}

// One spring for everything the card does, critically damped: it opens from a click, an entrance,
// so nothing overshoots. Solved once into a CSS linear() curve that animations and transitions
// both take; where linear() isn't understood, the house ease-out at about the same length.
function spring(response: number) {
  const w = (2 * Math.PI) / response;
  const x = (t: number) => 1 - Math.exp(-w * t) * (1 + w * t);
  let T = response;
  while (1 - x(T) > 0.0015) T += 0.005;
  const pts: string[] = [];
  for (let i = 0; i <= 40; i++) pts.push(i === 40 ? "1" : x((T * i) / 40).toFixed(4));
  return { ease: `linear(${pts.join(", ")})`, ms: Math.round(T * 1000) };
}
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)"; // the house ease-out (--ease-out)
const linearOk = typeof CSS !== "undefined" && CSS.supports?.("transition-timing-function", "linear(0, 1)");
const sprung = (response: number) => (linearOk ? spring(response) : { ease: EASE, ms: Math.round(spring(response).ms * 0.7) });
export const OPEN = sprung(0.3); // the card arriving, a row opening, the canvas stepping back
const CLOSE = sprung(0.24); // back into the key, a touch quicker
const still = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// Opened from the keyboard, the first row takes focus; opened with the pointer, nothing does.
let viaKeys = false;
if (typeof window !== "undefined") {
  addEventListener("keydown", (e) => { if (!e.metaKey && !e.ctrlKey) viaKeys = true; }, true);
  addEventListener("pointerdown", () => { viaKeys = false; }, true);
}

// The glass's drop shadow rides a layer of its own, so it can grow with the card (the clip that
// opens the card would cut a shadow of its own off); the card keeps the glass's rim.
const SHADE = "0 24px 60px -24px rgba(40, 30, 15, 0.34), 0 6px 16px -8px rgba(40, 30, 15, 0.2)";
const RIM = "inset 0 1px 0 rgba(255, 255, 255, 0.8), inset 0 -1px 0 rgba(255, 255, 255, 0.3), inset 0 0 14px rgba(255, 255, 255, 0.36), inset 0 -10px 18px -12px rgba(60, 45, 20, 0.12)";

// While the card is open the canvas steps back under one sheet of the wall's own colour, cut away
// where the waiting screens are. One element fading is all the canvas has to draw: fading its
// groups one by one had Safari repaint the whole canvas every frame, and the card's motion with it.
export type Hole = { x: number; y: number; w: number; h: number };
export function veilPath(holes: Hole[], c: { x: number; y: number; z: number }) {
  let d = `M0 0H${innerWidth}V${innerHeight}H0Z`;
  for (const r of holes) {
    // room for the mark on the corner and, far out, for the title held at its screen size above
    const x = c.x + r.x * c.z - 18, y = c.y + r.y * c.z - 44, w = r.w * c.z + 36, h = r.h * c.z + 62;
    const k = Math.min(18, w / 2, h / 2);
    d += `M${x + k} ${y}H${x + w - k}A${k} ${k} 0 0 1 ${x + w} ${y + k}V${y + h - k}A${k} ${k} 0 0 1 ${x + w - k} ${y + h}H${x + k}A${k} ${k} 0 0 1 ${x} ${y + h - k}V${y + k}A${k} ${k} 0 0 1 ${x + k} ${y}Z`;
  }
  return d;
}
export const WaitVeil = forwardRef<SVGPathElement, { on: boolean }>(function WaitVeil({ on }, ref) {
  const t = on ? OPEN : CLOSE;
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" style={{ opacity: on ? 1 : 0, transition: `opacity ${t.ms}ms ${t.ease}`, willChange: "opacity" }}>
      <path ref={ref} fill="var(--wall)" fillOpacity={0.88} fillRule="evenodd" />
    </svg>
  );
});

// The rows' pictures, fetched and decoded before the card first opens, so opening never waits on them.
export function useWarm(stops: Stop[], index: Index | null) {
  const sig = stops.map((s) => s.id).join(" ");
  useEffect(() => {
    if (!index) return;
    for (const s of stops) {
      const url = pictureOf(index, s.id);
      if (!url) continue;
      const im = new Image();
      im.src = url;
      im.decode?.().catch(() => {});
    }
  }, [sig, index]);
}

/** Everything waiting on you, in a card that grows out of the dock's key and folds back into it. */
export function WaitList({ open, stops, index, focus, phone, onFocus, onDone }: {
  open: boolean; stops: Stop[]; index: Index; focus: string | null; phone: boolean;
  onFocus: (id: string | null) => void; onDone: (s: Stop) => void;
}) {
  const [shown, setShown] = useState(open);
  const [sent, setSent] = useState<{ id: string; text: string } | null>(null); // an answer on its way
  const [leaving, setLeaving] = useState<string | null>(null);
  const [edges, setEdges] = useState({ up: false, down: false });
  const frame = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const flight = useRef<Animation[]>([]); // what's moving now, so a press part way turns it round
  const closing = useRef(false);
  if (open && !shown) setShown(true);

  // The card is laid out where it ends, from the first frame: nothing in it reflows or slides
  // sideways. Opening, a clip that starts as the key's own pill opens into the card while the card
  // rises off the key; the rows arrive once the window is two fifths open. Closing runs the same
  // path back: the rows leave over the first half, the glass fades into the key over the last.
  useLayoutEffect(() => {
    const f = frame.current, sh = shade.current, el = card.current, b = body.current;
    if (!shown || !f || !sh || !el || !b) return;
    const moving = flight.current.filter((a) => a.playState === "running");
    if (moving.length && closing.current !== !open) {
      // pressed again part way: the same motion turns round from where it is
      closing.current = !open;
      for (const a of moving) a.reverse();
      moving[0].onfinish = open ? null : () => { f.style.opacity = "0"; setShown(false); };
      return;
    }
    closing.current = !open;
    if (open) f.style.opacity = "";
    const box = listBox(phone);
    if (open) Object.assign(f.style, { left: `${box.left}px`, bottom: `${box.bottom}px`, width: `${box.w}px` });
    const F = f.getBoundingClientRect(), K = box.key;
    if (open && viaKeys) b.querySelector<HTMLElement>("button[aria-expanded]")?.focus({ preventScroll: true });
    if (still() || !K) {
      const a = f.animate(open ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], { duration: open ? 160 : 140, fill: open ? "none" : "forwards" });
      flight.current = [a];
      if (!open) a.onfinish = () => setShown(false);
      return;
    }
    // the key, seen from the card: the card slid down until its foot meets the key's, clipped to the key's pill
    const at = { transform: `translateY(${K.bottom - F.bottom}px)`, clipPath: `inset(${F.height - K.height}px ${F.right - K.right}px 0px ${K.left - F.left}px round ${K.height / 2}px)` };
    const whole = { transform: "translateY(0px)", clipPath: "inset(0px 0px 0px 0px round 24px)" };
    // the shadow grows from the key's size about the card's middle
    const tx = K.left + K.width / 2 - (F.left + F.width / 2), ty = K.top + K.height / 2 - (F.top + F.height / 2);
    const small = { transform: `translate(${tx}px, ${ty}px) scale(${K.width / F.width}, ${K.height / F.height})` };
    const full = { transform: "translate(0px, 0px) scale(1, 1)" };
    const t = open ? OPEN : CLOSE;
    const o: KeyframeAnimationOptions = { duration: t.ms, easing: t.ease, fill: open ? "none" : "forwards" };
    if (open) {
      flight.current = [
        // the first frames show the key through the glass
        el.animate([{ ...at, opacity: 0 }, { opacity: 1, offset: 0.12 }, { ...whole, opacity: 1 }], o),
        sh.animate([{ ...small, opacity: 0 }, { opacity: 1, offset: 0.5 }, { ...full, opacity: 1 }], o),
        b.animate([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], o),
      ];
    } else {
      const a = el.animate([{ ...whole, opacity: 1 }, { opacity: 1, offset: 0.6 }, { ...at, opacity: 0 }], o);
      flight.current = [
        a,
        sh.animate([{ ...full, opacity: 1 }, { opacity: 0, offset: 0.6 }, { ...small, opacity: 0 }], o),
        b.animate([{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }], o),
      ];
      a.onfinish = () => { if (closing.current) setShown(false); };
    }
  }, [open, shown]);

  // hidden, nothing in it can take focus (React 18 has no inert prop)
  useLayoutEffect(() => { frame.current?.toggleAttribute("inert", !shown); }, [shown]);

  // a list longer than the card fades at the edge it continues past, the way a scroll edge does;
  // measured again when a row finishes opening or folding
  const measure = () => {
    const b = body.current;
    if (b) setEdges({ up: b.scrollTop > 1, down: b.scrollTop + b.clientHeight < b.scrollHeight - 1 });
  };
  useLayoutEffect(measure, [shown, stops.length, focus]);

  // an answer goes to the session through the relay, the row says so, then folds away. Where no
  // relay can reach a desktop session, the answer opens the session instead.
  const answer = async (s: Stop, text: string) => {
    const r = await fetch("/api/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ thread: s.id, title: s.title, question: s.ask || s.recap, text }) })
      .then((x) => x.json()).catch(() => ({ relay: false }));
    if (!r.relay) { location.href = threadLink(s.id); fold(s); return; }
    setSent({ id: s.id, text });
    setTimeout(() => fold(s), 1100);
  };
  const fold = (s: Stop) => {
    setLeaving(s.id);
    setTimeout(() => { setLeaving(null); setSent(null); onDone(s); }, OPEN.ms);
  };
  useEffect(() => { if (!open) { setLeaving(null); setSent(null); } }, [open]);

  // up and down walk the rows
  const walk = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...(body.current?.querySelectorAll<HTMLElement>("button[aria-expanded]") || [])];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) { e.preventDefault(); next.focus(); next.scrollIntoView({ block: "nearest" }); }
  };

  // Built once and kept, hidden, so a press only starts the motion: making the rows at the press
  // cost Safari the first frames of it.
  const fade = edges.up || edges.down ? `linear-gradient(to bottom, ${edges.up ? "transparent 0, black 20px" : "black 0"}, ${edges.down ? "black calc(100% - 20px), transparent 100%" : "black 100%"})` : undefined;
  return (
    <div
      ref={frame}
      data-waitlist
      role="dialog"
      aria-label="Waiting on you"
      aria-hidden={!shown}
      className="fixed z-40"
      style={{ visibility: shown ? "visible" : "hidden" }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={walk}
    >
      <div ref={shade} aria-hidden className="pointer-events-none absolute inset-0 rounded-[24px]" style={{ boxShadow: SHADE, willChange: "transform, opacity" }} />
      {/* the glass without its backdrop blur: at this thickness the blur barely shows, and Safari
          would redraw what's behind the card on every frame of its motion */}
      <div ref={card} className="glass thick relative overflow-hidden rounded-[24px]" style={{ boxShadow: RIM, backdropFilter: "none", WebkitBackdropFilter: "none" }}>
      <div ref={body} onScroll={measure} onTransitionEnd={measure} className="overflow-y-auto p-2" style={{ maxHeight: `calc(100vh - ${phone ? 150 : 160}px)`, scrollbarWidth: "none", maskImage: fade, WebkitMaskImage: fade }}>
        {stops.map((s) => {
          const on = focus === s.id;
          const gone = sent?.id === s.id;
          const [first, second] = s.answers;
          const pic = pictureOf(index, s.id);
          // focus is the house's ink outline; a row draws it just inside its own edge (styles.css)
          const ring = "";
          const inner = "";
          return (
            // folding away: the row's height and its words go together
            <div key={s.id} className="grid" style={{ gridTemplateRows: leaving === s.id ? "0fr" : "1fr", opacity: leaving === s.id ? 0 : 1, transition: `grid-template-rows ${OPEN.ms}ms ${OPEN.ease}, opacity 200ms ${EASE}` }}>
              <div className="min-h-0 overflow-hidden">
                <div className="relative rounded-[16px] transition-colors duration-200" style={{ background: on ? "rgba(21,24,29,0.05)" : undefined }}>
                  <button
                    type="button"
                    aria-expanded={on}
                    onClick={() => onFocus(on ? null : s.id)}
                    className={`grid w-full grid-cols-[44px_1fr] gap-3 rounded-[16px] px-2.5 py-2.5 text-left transition-colors duration-200 ${on ? "" : "hover:bg-[rgba(21,24,29,0.03)]"} ${inner}`}
                  >
                    {/* corners concentric with the row: its 16, less the 10 it sits in */}
                    <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-[6px] text-[var(--quiet)]" style={{ background: "var(--wall-deep)", boxShadow: pic ? "var(--shadow-tile)" : "inset 0 0 0 0.5px rgba(28,25,20,0.1)" }}>
                      {pic ? <img src={pic} alt="" draggable={false} className="h-full w-full object-cover object-top" /> : <Glyph name="comment" size={18} />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-[14px] font-[560] tracking-[-0.012em] text-[var(--ink)]">{clean(s.title)}</span>
                        {/* open, the time gives way to a way into the session itself */}
                        <span className="type-mono shrink-0 text-[var(--quiet)] transition-opacity duration-200" style={{ opacity: on ? 0 : 1 }}>{when(s.at)}</span>
                      </span>
                      <span className="mt-0.5 overflow-hidden text-[13px] leading-[1.4] tracking-[-0.004em] text-[var(--muted)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:4] [text-wrap:pretty]">{said(s)}</span>
                    </span>
                  </button>
                  <a
                    href={threadLink(s.id)}
                    aria-label={`Open ${clean(s.title)}`}
                    tabIndex={on ? 0 : -1}
                    data-tip="Open the session"
                    className={`absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full text-[var(--muted)] transition-[opacity,background,color] duration-200 hover:bg-[rgba(21,24,29,0.05)] hover:text-[var(--ink)] ${ring}`}
                    style={{ opacity: on ? 1 : 0, pointerEvents: on ? "auto" : "none" }}
                    onClick={() => fold(s)}
                  >
                    <Glyph name="open" size={14} />
                  </a>
                  {/* its answers, opening under the question: one door, the other answer a quiet word beneath */}
                  <div className="grid" style={{ gridTemplateRows: on ? "1fr" : "0fr", transition: `grid-template-rows ${OPEN.ms}ms ${OPEN.ease}` }}>
                    <div className="min-h-0 overflow-hidden">
                      <div className="relative pb-3 pt-1.5" style={{ opacity: on ? 1 : 0, transition: `opacity 200ms ${EASE} ${on ? "80ms" : "0ms"}` }}>
                        <div className="flex flex-col items-center transition-opacity duration-200" style={{ opacity: gone ? 0 : 1 }} aria-hidden={gone}>
                          {first ? (
                            <button type="button" onClick={() => answer(s, first)} tabIndex={on && !gone ? 0 : -1} className={`press inline-flex h-10 items-center rounded-full bg-[var(--ink)] px-4 text-[13.5px] font-[560] tracking-[-0.01em] text-white ${ring}`}>
                              {first}
                            </button>
                          ) : (
                            <a href={threadLink(s.id)} onClick={() => fold(s)} tabIndex={on ? 0 : -1} className={`press inline-flex h-10 items-center rounded-full bg-[var(--ink)] px-4 text-[13.5px] font-[560] tracking-[-0.01em] text-white ${ring}`}>
                              Open the session
                            </a>
                          )}
                          {second && (
                            <button type="button" onClick={() => answer(s, second)} tabIndex={on && !gone ? 0 : -1} className={`mt-0.5 inline-flex h-9 items-center rounded-full px-3 text-[13px] font-[520] tracking-[-0.01em] text-[var(--muted)] transition-colors duration-200 hover:text-[var(--ink)] ${ring}`}>
                              {second}
                            </button>
                          )}
                        </div>
                        {/* sent: where the doors were, what went */}
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 pb-2 text-[13.5px] font-[560] tracking-[-0.01em] text-[var(--ink)] transition-opacity duration-200" style={{ opacity: gone ? 1 : 0 }} aria-live="polite">
                          {gone && <><span className="grid h-5 w-5 place-items-center rounded-full text-white" style={{ background: "var(--honey)" }}><Glyph name="done" size={11} /></span>Sent: {sent!.text}</>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
