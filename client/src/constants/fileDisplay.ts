import type { LanguageMode } from "../types";

export const TYPESCRIPT_ICON_COLOR = "#3178C6";

export function getFileIconName(language: LanguageMode): string {
  switch (language) {
    case "typescript":
    case "javascript":
      return "description";
    case "python":
      return "code_blocks";
    case "go":
    case "rust":
    case "java":
    case "cpp":
    case "c":
      return "code";
    case "html":
      return "html";
    case "css":
      return "css";
    case "json":
    case "yaml":
      return "data_object";
    case "markdown":
      return "article";
    case "sql":
      return "table";
    case "shell":
      return "terminal";
    case "plaintext":
      return "description";
    default:
      return "description";
  }
}

export function getFileIconClassName(language: LanguageMode, fileName?: string): string {
  switch (language) {
    case "typescript":
    case "javascript":
      return "text-[#3178C6]";
    case "python":
      return "text-[#3572A5]";
    case "go":
      return "text-[#00ACD7]";
    case "rust":
      return "text-[#DEA584]";
    case "java":
      return "text-[#B07219]";
    case "cpp":
    case "c":
      return "text-[#555555]";
    case "html":
      return "text-[#E34C26]";
    case "css":
      return "text-[#563D7C]";
    case "json":
    case "yaml":
      return "text-secondary";
    case "markdown":
      return "text-on-surface-variant";
    case "sql":
      return "text-[#e38c00]";
    case "shell":
      return "text-[#4EAA25]";
    default:
      if (fileName?.startsWith(".")) return "text-outline";
      return "text-on-surface-variant";
  }
}
