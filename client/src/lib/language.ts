import type { LanguageMode } from '../types';

// ---------------------------------------------------------------------------
// Extension → Monaco language ID
// ---------------------------------------------------------------------------

export function getLanguageFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'py':
      return 'python';
    case 'java':
      return 'java';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'cpp':
    case 'cc':
    case 'cxx':
      return 'cpp';
    case 'c':
    case 'h':
      return 'c';
    case 'html':
      return 'html';
    case 'css':
    case 'scss':
      return 'css';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'sql':
      return 'sql';
    case 'sh':
    case 'bash':
      return 'shell';
    case 'txt':
      return 'plaintext';
    default:
      return 'plaintext';
  }
}

// Cast a language string returned by getLanguageFromFilename to LanguageMode.
// All values returned by getLanguageFromFilename are valid LanguageMode members.
export function toLanguageMode(lang: string): LanguageMode {
  return lang as LanguageMode;
}

/** Resolve a language while the user is still entering a filename. */
export function getLanguageModeFromFilename(filename: string): LanguageMode {
  return toLanguageMode(getLanguageFromFilename(filename.trim() || 'file.txt'));
}

// ---------------------------------------------------------------------------
// Supported file extensions
// ---------------------------------------------------------------------------

const SUPPORTED_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx',
  'py', 'java', 'go', 'rs',
  'cpp', 'cc', 'cxx', 'c', 'h',
  'html', 'css', 'scss',
  'json', 'md',
  'yml', 'yaml',
  'sql', 'sh', 'bash', 'txt',
]);

export function isSupportedTextFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_EXTENSIONS.has(ext);
}

// ---------------------------------------------------------------------------
// Starter content templates
// ---------------------------------------------------------------------------

export function getStarterContent(filename: string): string {
  const name = filename.split('/').pop() ?? filename;
  const lang = getLanguageFromFilename(name);
  const base = (name.split('.')[0] ?? name).replace(/[^a-zA-Z0-9_]/g, '_');
  const pascal = base.charAt(0).toUpperCase() + base.slice(1);

  switch (lang) {
    case 'typescript':
      if (name.endsWith('.tsx')) {
        return `export function ${pascal}() {\n  return (\n    <div>\n      \n    </div>\n  );\n}\n`;
      }
      return `export function ${pascal}(): void {\n  \n}\n`;

    case 'javascript':
      if (name.endsWith('.jsx')) {
        return `export function ${pascal}() {\n  return <div></div>;\n}\n`;
      }
      return `function ${pascal}() {\n  \n}\n\nmodule.exports = { ${pascal} };\n`;

    case 'python':
      return `def main():\n    pass\n\n\nif __name__ == "__main__":\n    main()\n`;

    case 'java':
      return `public class ${pascal} {\n    public static void main(String[] args) {\n        \n    }\n}\n`;

    case 'go':
      return `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, World!")\n}\n`;

    case 'rust':
      return `fn main() {\n    println!("Hello, World!");\n}\n`;

    case 'cpp':
      return `#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}\n`;

    case 'c':
      return `#include <stdio.h>\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}\n`;

    case 'html':
      return `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${base}</title>\n</head>\n<body>\n  \n</body>\n</html>\n`;

    case 'css':
      return `/* ${name} */\n\n`;

    case 'json':
      return `{\n  \n}\n`;

    case 'markdown':
      return `# ${base.replace(/_/g, ' ')}\n\n`;

    case 'yaml':
      return `# ${name}\n\n`;

    case 'sql':
      return `-- ${name}\n\n`;

    case 'shell':
      return `#!/bin/bash\n\nset -euo pipefail\n\n`;

    default:
      return '';
  }
}
