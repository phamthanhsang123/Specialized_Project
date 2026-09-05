"use client";
import { useEffect, useRef } from "react";

export function useStepFocus(step: string, project = "") {
  const viewport = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    element.scrollTo({ top: 0 });
    if (matchMedia("(max-width:850px)").matches) window.scrollTo({ top: 0 });
    const heading = element.querySelector("h1");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }, [step, project]);
  return viewport;
}
