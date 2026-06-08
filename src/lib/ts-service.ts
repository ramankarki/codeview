import { Project, type SourceFile } from "ts-morph";
import { dirname, resolve } from "path";
import type { ProjectConfig, ChunkKind } from "../types";

// === Types ===

export interface ExtractedSymbol {
  name: string;
  kind: ChunkKind;
  signature: string;
  doc: string;
  startLine: number;
  endLine: number;
  exported: boolean;
}

export interface ImportEdge {
  sourceFile: string;
  targetFile: string;
  importedNames: string[];
}

// === Project Creation ===

export function createProject(configs: ProjectConfig[]): Project {
  const project = new Project();

  if (configs.length === 0) {
    // Try root tsconfig.json
    project.addSourceFilesFromTsConfig("tsconfig.json");
  } else {
    for (const cfg of configs) {
      project.addSourceFilesFromTsConfig(cfg.tsconfig);
    }
  }

  return project;
}

// === Type text cleanup ===

/** Strip import("/abs/path"). prefix from type strings for readability */
function cleanTypeText(t: string): string {
  return t.replace(/import\s*\(\s*["'][^"']+["']\s*\)\s*\.\s*/g, "");
}

/** Collect names from `export { a, b }` statements (re-exports of local symbols) */
function getNamedReExports(sf: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const exp of sf.getExportDeclarations()) {
    // Only `export { ... }` without a module specifier (not `export { x } from './y'`)
    if (exp.getModuleSpecifier()) continue;
    for (const ne of exp.getNamedExports()) {
      names.add(ne.getName());
    }
  }
  return names;
}

// === Symbol Extraction ===

export function extractSymbols(sf: SourceFile): ExtractedSymbol[] {
  const results: ExtractedSymbol[] = [];
  const reExports = getNamedReExports(sf);

  // Functions
  for (const fn of sf.getFunctions()) {
    const name = fn.getName();
    if (!name) continue;

    const params = fn.getParameters().map(p => p.getText()).join(", ");
    const returnType = cleanTypeText(fn.getReturnType().getText());
    const exportMod = fn.hasExportKeyword() || fn.isDefaultExport() || reExports.has(name);
    const doc = fn.getJsDocs().map(d => d.getText()).join("\n");

    results.push({
      name,
      kind: "function",
      signature: `export function ${name}(${params})${returnType !== "void" ? ": " + returnType : ""}`,
      doc,
      startLine: fn.getStartLineNumber(),
      endLine: fn.getEndLineNumber(),
      exported: exportMod,
    });
  }

  // Classes
  for (const cls of sf.getClasses()) {
    const name = cls.getName();
    if (!name) continue;

    const exportMod = cls.hasExportKeyword() || cls.isDefaultExport() || reExports.has(name);
    const doc = cls.getJsDocs().map(d => d.getText()).join("\n");

    const extendsClause = cls.getExtends() ? ` extends ${cls.getExtends()!.getText()}` : "";
    const implementsClause = cls.getImplements().length > 0
      ? ` implements ${cls.getImplements().map(i => i.getText()).join(", ")}`
      : "";

    const methods = cls.getMethods().map(m => {
      const mp = m.getParameters().map(p => p.getText()).join(", ");
      const mrt = m.getReturnType().getText();
      return `  ${m.getName()}(${mp})${mrt !== "void" ? ": " + mrt : ""}`;
    });

    const signature = [`export class ${name}${extendsClause}${implementsClause}`, ...methods].join("\n");

    results.push({
      name,
      kind: "class",
      signature,
      doc,
      startLine: cls.getStartLineNumber(),
      endLine: cls.getEndLineNumber(),
      exported: exportMod,
    });
  }

  // Interfaces
  for (const iface of sf.getInterfaces()) {
    const name = iface.getName();
    const exportMod = iface.hasExportKeyword() || iface.isDefaultExport() || reExports.has(name);
    const doc = iface.getJsDocs().map(d => d.getText()).join("\n");
    const props = iface.getProperties().map(p => p.getText().replace(/;$/, "")).join("; ");

    results.push({
      name,
      kind: "interface",
      signature: `export interface ${name} { ${props} }`,
      doc,
      startLine: iface.getStartLineNumber(),
      endLine: iface.getEndLineNumber(),
      exported: exportMod,
    });
  }

  // Type Aliases
  for (const ta of sf.getTypeAliases()) {
    const name = ta.getName();
    const exportMod = ta.hasExportKeyword() || ta.isDefaultExport() || reExports.has(name);
    const doc = ta.getJsDocs().map(d => d.getText()).join("\n");

    results.push({
      name,
      kind: "type",
      signature: `export type ${name} = ${cleanTypeText(ta.getType().getText())}`,
      doc,
      startLine: ta.getStartLineNumber(),
      endLine: ta.getEndLineNumber(),
      exported: exportMod,
    });
  }

  // Enums
  for (const en of sf.getEnums()) {
    const name = en.getName();
    const exportMod = en.hasExportKeyword() || en.isDefaultExport() || reExports.has(name);
    const doc = en.getJsDocs().map(d => d.getText()).join("\n");
    const members = en.getMembers().map(m => m.getName()).join(", ");

    results.push({
      name,
      kind: "enum",
      signature: `export enum ${name} { ${members} }`,
      doc,
      startLine: en.getStartLineNumber(),
      endLine: en.getEndLineNumber(),
      exported: exportMod,
    });
  }

  // Exported variable declarations
  for (const vd of sf.getVariableDeclarations()) {
    const name = vd.getName();
    const exportMod = vd.hasExportKeyword() || vd.isDefaultExport();
    if (!exportMod) continue;

    const doc = vd.getVariableStatement()?.getJsDocs().map(d => d.getText()).join("\n") ?? "";
    const typeNode = vd.getType();
    const typeText = typeNode ? typeNode.getText() : "unknown";

    results.push({
      name,
      kind: "function", // variable could be anything; default to function-ish
      signature: `export const ${name}: ${typeText}`,
      doc,
      startLine: vd.getStartLineNumber(),
      endLine: vd.getEndLineNumber(),
      exported: true,
    });
  }

  return results;
}

// === Import Tracking ===

export function getImports(sf: SourceFile): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const sourcePath = sf.getFilePath();

  // import declarations
  for (const imp of sf.getImportDeclarations()) {
    let resolved = imp.getModuleSpecifierSourceFile();

    // ts-morph may fail to resolve cross-package imports in monorepos.
    // Fallback: try to find the file in the project by resolving relative path.
    if (!resolved) {
      const specifier = imp.getModuleSpecifierValue();
      resolved = resolveModuleSpecifier(sf, specifier);
    }

    if (!resolved) continue;

    const importedNames = imp.getNamedImports().map(ni => ni.getName());
    const defaultImport = imp.getDefaultImport();
    if (defaultImport) importedNames.push(defaultImport.getText());

    edges.push({
      sourceFile: sourcePath,
      targetFile: resolved.getFilePath(),
      importedNames,
    });
  }

  // re-exports (export { X } from './module')
  for (const exp of sf.getExportDeclarations()) {
    let resolved = exp.getModuleSpecifierSourceFile();

    if (!resolved) {
      const specifier = exp.getModuleSpecifierValue();
      if (specifier) resolved = resolveModuleSpecifier(sf, specifier);
    }

    if (!resolved) continue;

    const exportedNames = exp.getNamedExports().map(ne => ne.getName());

    edges.push({
      sourceFile: sourcePath,
      targetFile: resolved.getFilePath(),
      importedNames: exportedNames,
    });
  }

  return edges;
}

/**
 * Fallback resolution for module specifiers that ts-morph can't resolve
 * (common in monorepo cross-package imports).
 */
function resolveModuleSpecifier(
  sf: SourceFile,
  specifier: string
): SourceFile | undefined {
  // Only handle relative paths
  if (!specifier.startsWith(".")) return undefined;

  const sfDir = dirname(sf.getFilePath());
  let resolvedPath = resolve(sfDir, specifier);

  // Try with .ts, .tsx, .js, .jsx extensions
  for (const ext of [".ts", ".tsx", ".js", ".jsx", ""]) {
    const candidate = resolvedPath + ext;
    const found = (sf as any)._context.project.getSourceFile(candidate);
    if (found) return found;
  }

  // Try as directory/index
  for (const ext of [".ts", ".tsx"]) {
    const candidate = resolve(resolvedPath, "index" + ext);
    const found = (sf as any)._context.project.getSourceFile(candidate);
    if (found) return found;
  }

  return undefined;
}
