import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TypeScriptWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

// Use the Monaco build that ships with Meridian. The React wrapper otherwise
// loads a second copy from a public CDN, which breaks offline use and can mix
// editor/model instances from different runtimes.
loader.config({ monaco });

const workerScope = globalThis as typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (_moduleId: string, label: string) => Worker;
  };
};

workerScope.MonacoEnvironment = {
  getWorker: (_moduleId, label) => {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new HtmlWorker();
    }
    if (label === "typescript" || label === "javascript") return new TypeScriptWorker();
    return new EditorWorker();
  },
};

export { monaco };
