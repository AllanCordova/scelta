import confetti from "canvas-confetti";

const DEFAULT_COLORS = ["#0071e3", "#38bdf8", "#0f172a", "#93c5fd"];

/**
 * Fires balanced two-sided confetti bursts in a loop with a 450ms pause between
 * completed cycles so winner celebrations look lively without overloading mobile browsers.
 */
export function startTwoSidedConfettiLoop(): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    return () => undefined;
  }

  let cancelled = false;
  let timeoutId: number | undefined;

  async function firePair(particleCount: number, spread: number) {
    await Promise.all([
      confetti({
        particleCount,
        angle: 60,
        spread,
        origin: { x: 0.06, y: 0.68 },
        colors: DEFAULT_COLORS,
        disableForReducedMotion: true,
      }),
      confetti({
        particleCount,
        angle: 120,
        spread,
        origin: { x: 0.94, y: 0.68 },
        colors: DEFAULT_COLORS,
        disableForReducedMotion: true,
      }),
    ]);
  }

  async function runLoop() {
    while (!cancelled) {
      try {
        await firePair(40, 68);
      } catch {
        return;
      }
      if (cancelled) {
        return;
      }
      await new Promise<void>((resolve) => {
        timeoutId = window.setTimeout(resolve, 450);
      });
    }
  }

  void runLoop();

  return () => {
    cancelled = true;
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
    try {
      confetti.reset();
    } catch {
      // Canvas may be unavailable in headless test environments such as jsdom.
    }
  };
}
