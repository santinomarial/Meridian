import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

// Use the Monaco build that ships with Meridian. The React wrapper otherwise
// loads a second copy from a public CDN, which breaks offline use and can mix
// editor/model instances from different runtimes.
loader.config({ monaco });

export { monaco };
