import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Play, RotateCcw } from "lucide-react";
import howItWorksVideo from "../assets/how-it-works.mp4";
import howItWorksPoster from "../assets/how-it-works-poster.webp";
import howItWorksEnd from "../assets/how-it-works-end.webp";

// Animated "how it works" explainer that replaced the static chalkboard
// illustration. Like that illustration, the video has French text baked
// into the artwork, so this component is only rendered on the FR branch
// of the landing page — English visitors get the icon/text step grid in
// Landing.tsx instead. All copy here is therefore French on purpose.
//
// Playback shape: autoplay muted once the section scrolls into view,
// play through exactly once, then hold on the end screen with a REAL
// link to /register (the same destination as every other primary CTA).
// It deliberately does not loop back into the video — once a visitor has
// seen it, the CTA is the more useful thing to leave on screen.

// Both the video and the end screen are exactly 1280x720, so they swap
// inside the same 16:9 box with no layout shift and no cropping. The end
// screen artwork is natively 2.22:1 and was padded to 16:9 with its own
// corner colour (#040716) at export time rather than being cropped,
// which would have cut the doodles at its left and right edges.

/** Describes the animation for screen readers and as the poster's alt
 * text — the video's own explanation is burned into the artwork, so it
 * is invisible to assistive tech without this. */
const DESCRIPTION =
  "Le pointage d'équipe, simplifié, en trois étapes : 1. Configuration — ajoutez votre équipe et imprimez votre affiche QR unique, aucune application à télécharger. " +
  "2. Pointage mobile — votre équipe pointe directement depuis son navigateur, et peut envoyer messages, demandes de congés, échanges de shifts et avances sur salaire. " +
  "3. Heures & export — heures, coûts et heures supplémentaires suivis automatiquement et exportables en un clic pour votre comptable.";

export default function HowItWorksVideo() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [ended, setEnded] = useState(false);
  // Set from the media query rather than assumed, and kept live: a
  // visitor can change the OS setting while the page is open.
  const [reduceMotion, setReduceMotion] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  // Lets a reduced-motion visitor opt IN to the animation. Respecting the
  // preference means not autoplaying — not refusing to play at all.
  const [userStarted, setUserStarted] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const showsVideo = !reduceMotion || userStarted;

  // Autoplay only once the section is actually on screen, so a visitor who
  // never scrolls this far never spends the bandwidth. Pauses again on the
  // way out and resumes on the way back, until it has played through.
  useEffect(() => {
    if (!showsVideo || ended) return;
    const el = containerRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      entries => {
        const video = videoRef.current;
        if (!video) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // A rejected play() is fine and expected on some browsers —
            // the poster frame stays up, which is the whole explainer.
            void video.play().catch(() => {});
          } else {
            video.pause();
          }
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [showsVideo, ended]);

  const replay = useCallback(() => {
    setEnded(false);
    setUserStarted(true);
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      void video.play().catch(() => {});
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video overflow-hidden rounded-lg bg-[#01121c]"
    >
      {showsVideo ? (
        <video
          ref={videoRef}
          src={howItWorksVideo}
          poster={howItWorksPoster}
          muted
          playsInline
          preload="metadata"
          controls={false}
          disablePictureInPicture
          aria-label={DESCRIPTION}
          onEnded={() => setEnded(true)}
          className={`h-full w-full object-cover transition-opacity duration-300 ${ended ? "opacity-0" : "opacity-100"}`}
        >
          {/* Fallback for browsers that cannot play the file at all. */}
          <img src={howItWorksPoster} alt={DESCRIPTION} className="h-full w-full object-cover" />
        </video>
      ) : (
        // prefers-reduced-motion: the poster is the video's own opening
        // frame, which is the complete three-step board — so this is an
        // equivalent explanation, not a degraded one.
        <img src={howItWorksPoster} alt={DESCRIPTION} className="h-full w-full object-cover" />
      )}

      {/* End screen: the artwork plus a real, focusable link. The CTA is
          not just pixels in the video — the whole surface is the link, so
          it works with a keyboard and reports a real destination. */}
      {ended && (
        <a
          href="/register"
          className="absolute inset-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#01121c]"
          style={{ backgroundImage: `url(${howItWorksEnd})`, backgroundSize: "cover", backgroundPosition: "center" }}
        >
          {/* Centred on the artwork's "Brigado.solutions" line (81–84% of
              height), which the button deliberately covers — the visitor is
              already on the site, so a real CTA is worth more there than the
              URL. Anchoring to a percentage and centring with a transform
              keeps that alignment at every width, which fixed padding could
              not: the button is ~11% of the box's height on desktop but ~18%
              on mobile, so a single padding value would either collide with
              the tagline above (70.6–74.7%) or only half-cover the line.
              The whole overlay is the link, so the small visual button is an
              affordance, not the tap target. Position is set inline to keep
              the anchor percentage and the -50% offset that depends on it in
              one place. */}
          <span
            style={{ left: "50%", top: "84%", transform: "translate(-50%, -50%)" }}
            className="absolute inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-lime-400 px-3 py-1.5 text-[11px] font-bold text-slate-950 shadow-lg transition-all hover:bg-lime-300 sm:gap-2 sm:rounded-xl sm:px-6 sm:py-3 sm:text-sm"
          >
            Démarrer l'essai gratuit
            <ArrowRight size={16} strokeWidth={1.5} />
          </span>
        </a>
      )}

      {/* Replay — sibling of the link, never nested inside it. */}
      {ended && (
        <button
          type="button"
          onClick={replay}
          aria-label="Revoir la vidéo"
          className="absolute bottom-3 right-3 z-10 rounded-full border border-slate-700/80 bg-slate-950/70 p-2 text-slate-300 backdrop-blur transition-colors hover:text-lime-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400"
        >
          <RotateCcw size={14} strokeWidth={1.5} />
        </button>
      )}

      {/* Reduced-motion opt-in. */}
      {!showsVideo && (
        <button
          type="button"
          // Flipping this mounts the <video> and re-runs the observer effect
          // above, which starts playback as soon as it observes the (already
          // on-screen) container. No manual play() call needed here.
          onClick={() => setUserStarted(true)}
          aria-label="Lire l'animation"
          className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/70 px-3 py-2 text-xs font-semibold text-slate-300 backdrop-blur transition-colors hover:text-lime-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400"
        >
          <Play size={13} strokeWidth={1.5} />
          Lire l'animation
        </button>
      )}
    </div>
  );
}
