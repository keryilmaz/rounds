// A waiting session's question, answered where you are: on its idea in the switcher, or on its mark
// on the canvas. Pressing an answer marks it, then the card folds back into its badge; the answer
// reaches the session through the relay.
//
// Sized and made like the rest of Rounds: the dock's 28 corner, the waiting card's words (14 for
// what it asks, 13 for what it says around that) and its 40-point capsules at 13.5, set 8 in from
// the edge so they sit concentric in the corner (8 + 20 = 28), the words 18 in. Thick glass, as
// everything you read or type into is, without its blur while it moves, as the waiting card's is.
//
// It morphs out of the badge. A window that is exactly the badge (its size, its circle, its
// colour) grows into the card while the words inside hold perfectly still: the window is the card
// scaled down and moved, and the words are scaled back up by the same amount, so all that moves is
// transform, which Safari runs on the GPU (an animated clip-path redrew the card on the main thread
// every frame). The corner is put right each frame so it stays round at every size. One critically
// damped spring drives it all, so a press part way turns it round from where it is.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clean, threadLink } from "./data";
import { Glyph } from "./glyphs";
import type { Stop } from "./Waiting";

export const DCW = 320;
const R = 28; // the dock's corner
const still = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const first = (t: string) => clean(t).replace(/\s*https?:\/\/\S+/g, "").split(/(?<=[a-z0-9)%])[.;!?](?:\s|$)/i)[0].trim();
const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const clamp = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number, a: number, b: number) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
// the thick glass's rim, as the waiting card wears it; its drop shadow rides a layer of its own
const RIM = "inset 0 1px 0 rgba(255, 255, 255, 0.8), inset 0 -1px 0 rgba(255, 255, 255, 0.3), inset 0 0 14px rgba(255, 255, 255, 0.36), inset 0 -10px 18px -12px rgba(60, 45, 20, 0.12)";

/** An ask often sets its scene before it asks ("Praxis has no changelog. Should its door open…?"):
 *  the scene reads first, quietly, and the question alone carries the weight. */
export function splitAsk(ask: string) {
  const t = clean(ask).trim();
  const parts = t.split(/(?<=[.!?])\s+(?=[A-Z“"(])/);
  const at = parts.findIndex((p) => p.trim().endsWith("?"));
  return at > 0 ? { lead: parts.slice(0, at).join(" "), q: parts.slice(at).join(" ") } : { lead: "", q: t };
}

/** Send an answer through the relay. With no relay nothing reaches the session, so it opens instead. */
export async function sendAnswer(s: Stop, text: string) {
  const r = await fetch("/api/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ thread: s.id, title: s.title, question: s.ask || s.recap, text }) })
    .then((x) => x.json()).catch(() => ({ relay: false }));
  if (!r.relay) location.href = threadLink(s.id);
  return !!r.relay;
}

/** The question, on its badge. `at` is the badge's centre in the window, `size` its width, and
 *  `mark` what the badge shows (its count, or the session glyph), held as the card grows. */
export function DecisionCard({ stop, at, size, open, z = 45, mark, tone, onSent, onDismiss, onGone }: {
  stop: Stop; at: { x: number; y: number }; size: number; open: boolean; z?: number; mark?: React.ReactNode;
  /** the colour of the badge it grows out of: the accent, or grey for what can wait */
  tone?: "accent" | "grey";
  onSent: (text: string) => void; onDismiss: () => void; onGone: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const win = useRef<HTMLDivElement>(null);
  const tint = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const geo = useRef({ W: DCW, H: 160, q: 24, bx: 0, by: 0 });
  const sp = useRef({ x: 0, v: 0, t: 0, raf: 0, last: 0 });
  const [chosen, setChosen] = useState<number | null>(null);
  const answers = stop.answers;
  const grey = (tone ?? (stop.needs ? "accent" : "grey")) === "grey";

  // one frame of the morph, k from the badge (0) to the card (1)
  const paint = (k: number) => {
    const g = geo.current, w = win.current, sh = shade.current, t = tint.current, b = body.current, d = dot.current;
    if (!w || !sh || !t || !b) return;
    const e = clamp(k);
    const left = g.bx * (1 - e), top = g.by * (1 - e);
    const sx = (g.q + (g.W - g.q) * e) / g.W, sy = (g.q + (g.H - g.q) * e) / g.H;
    const r = g.q / 2 + (R - g.q / 2) * e;
    const tr = `translate3d(${left}px, ${top}px, 0) scale(${sx}, ${sy})`;
    w.style.transform = tr;
    w.style.borderRadius = `${r / sx}px / ${r / sy}px`;
    // the words, scaled back by as much as the window is scaled down: they hold still in place
    b.style.transform = `scale(${1 / sx}, ${1 / sy}) translate3d(${-left}px, ${-top}px, 0)`;
    b.style.opacity = String(smooth(k, 0.32, 0.82));
    t.style.opacity = String(1 - smooth(k, 0.04, 0.5));
    sh.style.transform = tr;
    sh.style.opacity = String(smooth(k, 0.08, 0.6));
    if (d) d.style.opacity = String(1 - smooth(k, 0, 0.22));
  };
  // the spring: Apple's critically damped one, so nothing overshoots, on elapsed time
  const run = (to: number, response: number, done?: () => void, kick = 0) => {
    const s = sp.current;
    s.t = to;
    // a press gives it a little speed of its own, the way a tap does on iOS: it leaves the badge at
    // once instead of easing off a standstill (still under the spring's own speed, so no overshoot)
    if (kick && Math.abs(s.v) < Math.abs(kick)) s.v = kick;
    cancelAnimationFrame(s.raf);
    const W2 = (2 * Math.PI) / response;
    s.last = 0;
    const step = (now: number) => {
      let dt = Math.min(0.05, s.last ? (now - s.last) / 1000 : 1 / 60);
      s.last = now;
      while (dt > 1e-6) { const h = Math.min(1 / 240, dt); dt -= h; s.v += (-W2 * W2 * (s.x - s.t) - 2 * W2 * s.v) * h; s.x += s.v * h; }
      const fin = Math.abs(s.x - s.t) < 0.0015 && Math.abs(s.v) < 0.02;
      if (fin) { s.x = s.t; s.v = 0; }
      paint(s.x);
      if (fin) { s.raf = 0; done?.(); } else s.raf = requestAnimationFrame(step);
    };
    // in motion the glass keeps only its top light: its masked rim and soft inner shadows would be
    // drawn again with the corner on every frame, and nobody can see them move
    win.current?.classList.add("moving");
    const end = done;
    done = () => { win.current?.classList.remove("moving"); end?.(); };
    s.raf = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(sp.current.raf), []);

  // Where it sits: out from the badge toward the room, left of it unless that runs off the window,
  // down from it unless that runs into the dock.
  useLayoutEffect(() => {
    const wr = wrap.current, b = body.current;
    if (!wr || !b) return;
    const focus = () => b.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    if (open) {
      const W = DCW, H = b.offsetHeight, q = Math.max(16, Math.min(size, 48)), r = q / 2;
      const dock = document.querySelector(".dock")?.getBoundingClientRect().top ?? innerHeight - 80;
      const left = at.x + r - W >= 16;
      const down = at.y - r + H <= dock - 16 || at.y + r - H < 16;
      const x = Math.round(left ? at.x + r - W : at.x - r), y = Math.round(down ? at.y - r : at.y + r - H);
      Object.assign(wr.style, { left: `${x}px`, top: `${y}px`, width: `${W}px`, height: `${H}px`, visibility: "visible" });
      if (win.current) { win.current.style.width = `${W}px`; win.current.style.height = `${H}px`; }
      if (shade.current) { shade.current.style.width = `${W}px`; shade.current.style.height = `${H}px`; }
      geo.current = { W, H, q, bx: at.x - r - x, by: at.y - r - y };
      if (dot.current) Object.assign(dot.current.style, { left: `${at.x - r - x}px`, top: `${at.y - r - y}px`, width: `${q}px`, height: `${q}px` });
      if (still()) { sp.current.x = 1; paint(1); focus(); return; }
      paint(sp.current.x);
      run(1, 0.38, focus, 8);
    } else {
      if (still()) { onGone(); return; }
      run(0, 0.3, onGone, -6);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // the answer you pressed holds a beat, marked, then the card folds back into its badge
  const pick = (j: number, text: string) => {
    if (chosen != null) return;
    setChosen(j);
    sendAnswer(stop, text).then((ok) => { if (ok) setTimeout(() => onSent(text), still() ? 0 : 260); });
  };

  // Return takes the first answer, 1 to 3 any of them, Esc puts it away
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onDismiss(); return; }
      if ((e.target as HTMLElement)?.closest?.("input, textarea")) return;
      if (e.key === "Enter" && answers[0]) { e.preventDefault(); e.stopPropagation(); pick(0, answers[0]); }
      else if (/^[1-3]$/.test(e.key) && answers[+e.key - 1]) { e.preventDefault(); e.stopPropagation(); pick(+e.key - 1, answers[+e.key - 1]); }
    };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  });

  // the scene, then the question; a bare question takes its scene from what the session said last
  const { lead, q } = stop.ask ? splitAsk(stop.ask) : { lead: "", q: clean(stop.recap || "It stopped to ask you something.") };
  // (a borrowed line only when it's short: a long one would outweigh the question under it)
  const said = stop.ask && stop.recap ? cap(first(stop.recap)) : "";
  const setup = lead || (said.length <= 72 ? said : "");
  return (
    <div ref={wrap} data-decision className="dc-wrap" style={{ zIndex: z }} role="dialog" aria-label={`${clean(stop.title)} asks`}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div ref={shade} aria-hidden className="dc-shade" />
      <div ref={win} className="glass thick dc-card" style={{ boxShadow: RIM, backdropFilter: "none", WebkitBackdropFilter: "none" }}>
        <div ref={tint} aria-hidden className={`dc-tint ${grey ? "wait" : ""}`} />
        <div ref={body} className="dc-in">
          <div className="dc-tx">
            {/* room for the corner's way into the thread, on the first line only */}
            <span aria-hidden className="dc-hole" style={{ width: stop.more > 0 ? 70 : 22 }} />
            {setup && <p className="dc-lead">{setup}</p>}
            <p className="dc-q">{q}</p>
          </div>
          {/* the whole thread, and what else it asked, a corner away */}
          <a className="dc-open" href={threadLink(stop.id)} onClick={onDismiss} aria-label={`Open ${clean(stop.title)}`} title={`Open ${clean(stop.title)}`}>
            {stop.more > 0 && <span>{stop.more} more</span>}<Glyph name="open" size={12} />
          </a>
          <div className="dc-as">
            {answers.length ? answers.map((a, j) => (
              <button key={a} type="button" className={`press ${j === 0 ? "go" : ""} ${chosen === j ? "on" : ""}`} style={{ opacity: chosen != null && chosen !== j ? 0.4 : 1 }} onClick={() => pick(j, a)}>
                {chosen === j && <Glyph name="done" size={13} />}<span>{a}</span>
              </button>
            )) : stop.ask ? <Words onSend={(t) => pick(0, t)} sent={chosen != null} />
              : <a className="press go" href={threadLink(stop.id)} onClick={onDismiss}>Open the session</a>}
          </div>
        </div>
      </div>
      {/* the badge's own mark, held where the badge was as the card grows out of it */}
      {mark != null && <div ref={dot} aria-hidden className={`dc-dot ${grey ? "wait" : ""}`}>{mark}</div>}
    </div>
  );
}

// an open question: your own words, sent with Return
function Words({ onSend, sent }: { onSend: (t: string) => void; sent: boolean }) {
  const [t, setT] = useState("");
  return (
    <>
      <input value={t} onChange={(e) => setT(e.target.value)} placeholder="Your words" aria-label="Your answer" autoComplete="off" disabled={sent}
        onKeyDown={(e) => { if (e.key === "Enter" && t.trim()) { e.preventDefault(); e.stopPropagation(); onSend(t.trim()); } }} />
      <button type="button" className={`press go send ${sent ? "on" : ""}`} onClick={() => t.trim() && onSend(t.trim())}>{sent && <Glyph name="done" size={14} />}<span>Send</span></button>
    </>
  );
}
