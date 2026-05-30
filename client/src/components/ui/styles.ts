export const transitionBase = "transition-colors duration-100 ease-out";

export const crispBorder = "meridian-crisp-border";

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0";

export const iconButtonClass = [
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px]",
  transitionBase,
  focusRing,
].join(" ");

export const iconButtonMutedClass = [
  iconButtonClass,
  "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
].join(" ");

export const navButtonClass = [
  "inline-flex h-8 items-center rounded-[4px] px-2.5 text-xs font-medium leading-none text-on-surface-variant",
  transitionBase,
  "hover:bg-surface-container-high hover:text-on-surface",
  focusRing,
].join(" ");

export const panelHeaderClass = [
  "flex h-8 shrink-0 items-center justify-between border-b",
  crispBorder,
  "bg-surface-container-low px-3",
].join(" ");

export const panelSectionLabel = "label-caps text-on-surface-variant";

export const headerButtonSecondary = [
  "inline-flex h-8 items-center rounded-[4px] border px-3 text-[11px] font-medium leading-none",
  crispBorder,
  "bg-surface-container text-on-surface",
  transitionBase,
  "hover:bg-surface-container-high",
  focusRing,
].join(" ");

export const headerButtonPrimary = [
  "inline-flex h-8 items-center rounded-[4px] px-3 text-[11px] font-bold leading-none text-on-primary bg-primary",
  transitionBase,
  "hover:bg-primary-container",
  focusRing,
].join(" ");
