// What the package's build and its recorder test share about the paths in shipped type declarations.
import ts from 'typescript';

const isRelativeTs = (specifier: string): boolean => /^\.\.?\//.test(specifier) && specifier.endsWith('.ts');

/** Every string in a declaration file that names a sibling by its source path, e.g: './render.ts'. */
export function relativeTsPaths(fileName: string, text: string): ts.StringLiteral[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: ts.StringLiteral[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) && isRelativeTs(node.text)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
