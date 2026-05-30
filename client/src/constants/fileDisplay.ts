import type { LanguageMode } from "../types";

export const TYPESCRIPT_ICON_COLOR = "#3178C6";

export function getFileIconName(language: LanguageMode): string {
  switch (language) {
    case "typescript":
    case "javascript":
      return "description";
    case "json":
      return "description";
    case "html":
      return "html";
    case "css":
      return "css";
    case "python":
      return "code_blocks";
    default:
      return "description";
  }
}

export function getFileIconClassName(language: LanguageMode, fileName?: string): string {
  if (language === "typescript" || language === "javascript") {
    return "text-[#3178C6]";
  }
  if (language === "json") {
    return "text-secondary";
  }
  if (fileName?.startsWith(".")) {
    return "text-outline";
  }
  return "text-on-surface-variant";
}
