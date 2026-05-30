import * as monaco from "monaco-editor";
import type { editor } from "monaco-editor";
import type { Collaborator } from "../../types";

export type RemoteCursorPosition = {
  line: number;
  column: number;
};

const REMOTE_CURSOR_STYLE_ID = "meridian-remote-cursor-styles";
const CURSOR_TICK_MS = 3_500;

const FILE_ANCHORS: Record<string, Record<string, RemoteCursorPosition>> = {
  "file-auth": {
    "user-elena": { line: 12, column: 22 },
    "user-marcus": { line: 18, column: 8 },
  },
  "file-database": {
    "user-elena": { line: 8, column: 10 },
    "user-marcus": { line: 3, column: 14 },
  },
  "file-package-json": {
    "user-elena": { line: 6, column: 6 },
    "user-marcus": { line: 11, column: 4 },
  },
};

function getCodeLineNumbers(content: string): number[] {
  return content
    .split("\n")
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter(({ text }) => text.length > 0 && !text.startsWith("//"))
    .map(({ line }) => line);
}

function getBasePosition(
  collaborator: Collaborator,
  fileId: string,
  content: string,
  index: number,
): RemoteCursorPosition {
  const anchor = FILE_ANCHORS[fileId]?.[collaborator.id];
  if (anchor) {
    return anchor;
  }

  const codeLines = getCodeLineNumbers(content);
  const line = codeLines[index % Math.max(codeLines.length, 1)] ?? 1;
  const lineText = content.split("\n")[line - 1] ?? "";
  const column = Math.min(6 + index * 10, Math.max(1, lineText.length));

  return { line, column };
}

function jitterPosition(
  position: RemoteCursorPosition,
  content: string,
  tick: number,
  collaboratorId: string,
): RemoteCursorPosition {
  const lines = content.split("\n");
  const maxLine = Math.max(1, lines.length);
  const seed = tick + collaboratorId.charCodeAt(collaboratorId.length - 1);
  const lineOffset = (seed % 3) - 1;
  const line = Math.max(1, Math.min(maxLine, position.line + lineOffset));
  const lineText = lines[line - 1] ?? "";
  const maxColumn = Math.max(1, lineText.length);
  const columnOffset = (seed % 5) - 2;
  const column = Math.max(1, Math.min(maxColumn, position.column + columnOffset));

  return { line, column };
}

function syncCollaboratorStyles(collaborators: Collaborator[]): void {
  let styleEl = document.getElementById(REMOTE_CURSOR_STYLE_ID) as HTMLStyleElement | null;

  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = REMOTE_CURSOR_STYLE_ID;
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = collaborators
    .map(
      (collaborator) => `
.remote-cursor-caret-${collaborator.id} {
  display: inline-block !important;
  width: 2px !important;
  height: 1.1em !important;
  margin-left: -1px;
  vertical-align: text-bottom;
  background-color: ${collaborator.color} !important;
  pointer-events: none;
}
.remote-cursor-label-${collaborator.id} {
  display: inline-block !important;
  position: relative;
  top: -1.35em;
  left: 0;
  margin-left: -2px;
  padding: 1px 5px;
  border-radius: 3px 3px 3px 0;
  background-color: ${collaborator.color};
  color: #ffffff;
  font-family: Geist, ui-sans-serif, system-ui, sans-serif;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
}
`,
    )
    .join("\n");
}

function buildDecorations(
  collaborators: Collaborator[],
  positions: Map<string, RemoteCursorPosition>,
): editor.IModelDeltaDecoration[] {
  const decorations: editor.IModelDeltaDecoration[] = [];

  for (const collaborator of collaborators) {
    const position = positions.get(collaborator.id);
    if (!position) {
      continue;
    }

    decorations.push({
      range: new monaco.Range(position.line, position.column, position.line, position.column),
      options: {
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        before: {
          content: collaborator.name,
          inlineClassName: `remote-cursor-label-${collaborator.id}`,
        },
        after: {
          content: "\u200b",
          inlineClassName: `remote-cursor-caret-${collaborator.id}`,
        },
      },
    });
  }

  return decorations;
}

export type RemoteCursorController = {
  dispose: () => void;
};

export function attachRemoteCollaboratorCursors(
  monacoEditor: editor.IStandaloneCodeEditor,
  collaborators: Collaborator[],
  activeFileId: string,
): RemoteCursorController {
  const remoteCollaborators = collaborators.filter((c) => !c.isOwner);
  let decorationIds: string[] = [];
  let tick = 0;

  const applyDecorations = (): void => {
    const modelContent = monacoEditor.getValue();
    const positions = new Map<string, RemoteCursorPosition>();

    remoteCollaborators.forEach((collaborator, index) => {
      const base = getBasePosition(collaborator, activeFileId, modelContent, index);
      positions.set(
        collaborator.id,
        jitterPosition(base, modelContent, tick, collaborator.id),
      );
    });

    syncCollaboratorStyles(remoteCollaborators);
    decorationIds = monacoEditor.deltaDecorations(decorationIds, buildDecorations(remoteCollaborators, positions));
  };

  applyDecorations();
  const intervalId = window.setInterval(() => {
    tick += 1;
    applyDecorations();
  }, CURSOR_TICK_MS);

  return {
    dispose: () => {
      window.clearInterval(intervalId);
      monacoEditor.deltaDecorations(decorationIds, []);
      decorationIds = [];
    },
  };
}
