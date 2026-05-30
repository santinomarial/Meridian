import { useEffect, useState } from "react";

export type Breakpoint = "mobile" | "tablet" | "desktop";

const MOBILE_QUERY = "(max-width: 640px)";
const TABLET_QUERY = "(max-width: 1024px)";

function getBreakpoint(): Breakpoint {
  if (typeof window === "undefined") {
    return "desktop";
  }
  if (window.matchMedia(MOBILE_QUERY).matches) {
    return "mobile";
  }
  if (window.matchMedia(TABLET_QUERY).matches) {
    return "tablet";
  }
  return "desktop";
}

export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(getBreakpoint);

  useEffect(() => {
    const mobileMq = window.matchMedia(MOBILE_QUERY);
    const tabletMq = window.matchMedia(TABLET_QUERY);

    const update = (): void => {
      setBreakpoint(getBreakpoint());
    };

    mobileMq.addEventListener("change", update);
    tabletMq.addEventListener("change", update);
    update();

    return () => {
      mobileMq.removeEventListener("change", update);
      tabletMq.removeEventListener("change", update);
    };
  }, []);

  return breakpoint;
}

export function useIsCompactLayout(breakpoint: Breakpoint): boolean {
  return breakpoint !== "desktop";
}
