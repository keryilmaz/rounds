// What's waiting on you: the desktop sessions that stopped to ask you something (server/waiting.mjs).
// The dock carries one key: the mark and how many. Pressed, it grows into a card above the dock
// listing every one of them, and the rest of the canvas steps back. A waiting session's newest
// screen carries the mark too, on its corner, the way a note's badge does. A row (or a mark) opens
// that session's answers under its question and brings its screens into view; an answer goes to
// the session through the relay, and the row goes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
      style={{ background: on ? "var(--honey-wash)" : "transparent", animation: "wb-chip 260ms var(--ease-out) both" }}
    >
      <Mark size={20} />
      <span className="[font-variant-numeric:tabular-nums]">{n}</span>
    </button>
  );
}

const said = (s: Stop) => clean(s.ask || (s.recap ? s.recap.charAt(0).toUpperCase() + s.recap.slice(1) : "It stopped to ask you something."));

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

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)"; // the house ease-out (--ease-out)
const still = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Everything waiting on you, in a card that grows out of the dock's key and folds back into it. */
export function WaitList({ open, stops, index, focus, phone, onFocus, onDone }: {
  open: boolean; stops: Stop[]; index: Index; focus: string | null; phone: boolean;
  onFocus: (id: string | null) => void; onDone: (s: Stop) => void;
}) {
  const [shown, setShown] = useState(open);
  const [sent, setSent] = useState<{ id: string; text: string } | null>(null); // an answer on its way
  const [leaving, setLeaving] = useState<string | null>(null);
  const [edges, setEdges] = useState({ up: false, down: false });
  const card = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  if (open && !shown) setShown(true);

  // in: from the key's own pill to the card, the rows arriving once there's room for them;
  // out: the same path back, the rows gone first
  useLayoutEffect(() => {
    const el = card.current, b = body.current;
    if (!shown || !el || !b) return;
    const box = listBox(phone);
    Object.assign(el.style, { left: `${box.left}px`, bottom: `${box.bottom}px`, width: `${box.w}px` });
    const k = box.key;
    const end = { left: `${box.left}px`, bottom: `${box.bottom}px`, width: `${box.w}px`, height: `${el.offsetHeight}px`, borderRadius: "24px" };
    const start = k ? { left: `${k.left}px`, bottom: `${innerHeight - k.bottom}px`, width: `${k.width}px`, height: `${k.height}px`, borderRadius: `${k.height / 2}px` } : end;
    if (open) {
      // opened from the keyboard, the first row takes focus
      if (document.activeElement?.closest("[data-waitkey]") || document.activeElement === document.body) b.querySelector<HTMLElement>("button[aria-expanded]")?.focus({ preventScroll: true });
      if (still()) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }); return; }
      // the glass comes up over the key, so the key shows through it for the first few frames
      el.animate([start, end], { duration: 380, easing: EASE });
      el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.22 }, { opacity: 1 }], { duration: 380, easing: "linear" });
      b.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: 380, easing: "linear" });
    } else {
      const done = () => setShown(false);
      if (still()) { el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: "forwards" }).onfinish = done; return; }
      // the rows go first, then the glass settles onto the key and dissolves into it
      b.animate([{ opacity: 1 }, { opacity: 0, offset: 0.22 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
      el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 300, easing: "linear", fill: "forwards" });
      el.animate([end, start], { duration: 300, easing: EASE, fill: "forwards" }).onfinish = done;
    }
  }, [open, shown]);

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
    setTimeout(() => { setLeaving(null); setSent(null); onDone(s); }, 300);
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

  if (!shown) return null;
  const fade = edges.up || edges.down ? `linear-gradient(to bottom, ${edges.up ? "transparent 0, black 20px" : "black 0"}, ${edges.down ? "black calc(100% - 20px), transparent 100%" : "black 100%"})` : undefined;
  return (
    <div
      ref={card}
      data-waitlist
      role="dialog"
      aria-label="Waiting on you"
      className="glass thick fixed z-40 overflow-hidden rounded-[24px]"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={walk}
    >
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
            <div key={s.id} className="grid transition-[grid-template-rows,opacity] duration-300" style={{ gridTemplateRows: leaving === s.id ? "0fr" : "1fr", opacity: leaving === s.id ? 0 : 1, transitionTimingFunction: EASE }}>
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
                      <span className="mt-0.5 block overflow-hidden text-[13px] leading-[1.4] tracking-[-0.004em] text-[var(--muted)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:4] [text-wrap:pretty]">{said(s)}</span>
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
                  <div className="grid transition-[grid-template-rows] duration-300" style={{ gridTemplateRows: on ? "1fr" : "0fr", transitionTimingFunction: EASE }}>
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
  );
}
