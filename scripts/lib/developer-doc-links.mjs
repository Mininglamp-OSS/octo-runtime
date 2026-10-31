import { execFileSync } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import markdown from "prettier/plugins/markdown";
import GithubSlugger from "github-slugger";
import { parseFragment } from "parse5";

function* nodes(node) {
  yield node;
  for (const child of node.children ?? node.childNodes ?? []) yield* nodes(child);
}

function within(root, path) {
  const suffix = relative(root, path);
  return !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`);
}

export function isCurrentDocument(path) {
  if (!path.endsWith(".md")) return false;
  if (path.split("/").some((part) => ["node_modules", "dist", "vendor", "vendored"].includes(part)))
    return false;
  return (
    !path.includes("/") ||
    /^(?:apps|packages|docs)\//.test(path) ||
    /^\.octospec\/(?:rules|guides)\//.test(path) ||
    path === ".octospec/index.md"
  );
}

function headingText(node) {
  if (node.type === "html") return "";
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  return node.value ?? (node.children ?? []).map(headingText).join("");
}

function undefinedReferences(node, source) {
  const start = node.position.start.offset;
  const original = source.slice(start, node.position.end.offset);
  const masked = original.split("");
  // 在 AST 段落内屏蔽代码、HTML 和已解析链接；保留 UTF-16 偏移以定位原始文本。
  for (const child of nodes(node)) {
    if (
      ["inlineCode", "html", "link", "image", "linkReference", "imageReference"].includes(
        child.type
      )
    ) {
      for (
        let offset = child.position.start.offset - start;
        offset < child.position.end.offset - start;
        offset++
      )
        masked[offset] = " ";
    }
  }
  const brackets = [];
  const references = [];
  for (let index = 0; index < masked.length; index++) {
    if (masked[index] === "\\") {
      index++;
    } else if (masked[index] === "[") {
      brackets.push(index);
    } else if (masked[index] === "]" && brackets.length) {
      const open = brackets.pop();
      if (masked[index + 1] !== "[") continue;
      let end = index + 2;
      for (; end < masked.length; end++) {
        if (masked[end] === "\\") end++;
        else if (masked[end] === "[" || masked[end] === "]") break;
      }
      if (masked[end] !== "]") continue;
      references.push({
        raw: original.slice(open, end + 1),
        line: node.position.start.line + original.slice(0, open).split("\n").length - 1
      });
      index = end;
    }
  }
  return references;
}

function parsePage(source) {
  const all = [...nodes(markdown.parsers.markdown.parse(source))];
  const anchors = new Set();
  const slugger = new GithubSlugger();
  const definitions = new Map();
  for (const node of all) {
    if (node.type === "heading") anchors.add(slugger.slug(headingText(node)));
    // CommonMark 同名引用定义取第一项，与渲染结果保持一致。
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
    if (node.type === "html") {
      for (const element of nodes(parseFragment(node.value))) {
        for (const attribute of element.attrs ?? []) {
          if (attribute.name === "id" || (element.tagName === "a" && attribute.name === "name"))
            anchors.add(attribute.value);
        }
      }
    }
  }
  const links = [];
  for (const node of all) {
    if (["link", "image", "linkReference", "imageReference"].includes(node.type)) {
      links.push({
        url: node.url ?? definitions.get(node.identifier),
        raw: source.slice(node.position.start.offset, node.position.end.offset),
        line: node.position.start.line
      });
    }
    // 未定义引用被 remark 当正文，标签仍可跨多个强调、代码或文本节点。
    if (["paragraph", "heading", "tableCell"].includes(node.type))
      links.push(...undefinedReferences(node, source));
  }
  links.sort((left, right) => left.line - right.line);
  return { anchors, links };
}

/** 对工作区内容检查链接；历史文件只作为目的地读取，不递归扩展源集合。 */
export async function auditDocumentLinks(root, paths) {
  root = await realpath(root);
  const pages = new Map();
  const page = (path) => {
    if (!pages.has(path)) pages.set(path, readFile(path, "utf8").then(parsePage));
    return pages.get(path);
  };
  const result = { documents: paths.length, links: 0, fragments: 0, skipped: 0, errors: [] };
  if (!paths.length)
    result.errors.push({ file: ".", line: 1, url: "", reason: "no source documents" });
  for (const file of [...paths].sort()) {
    const sourcePath = resolve(root, file);
    let source;
    try {
      if (!within(root, sourcePath) || !within(root, await realpath(sourcePath)))
        throw new Error("source outside repository");
      source = await page(sourcePath);
    } catch (error) {
      result.errors.push({ file, line: 1, url: "", reason: error.message });
      continue;
    }
    for (const { url, raw, line } of source.links) {
      result.links++;
      try {
        if (url === undefined) throw new Error("unresolved Markdown reference");
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) {
          result.skipped++;
          continue;
        }
        const hash = url.indexOf("#");
        const target = decodeURIComponent(hash < 0 ? url : url.slice(0, hash));
        const fragment = decodeURIComponent(hash < 0 ? "" : url.slice(hash + 1));
        if (fragment) result.fragments++;
        const destination = target ? resolve(dirname(sourcePath), target) : sourcePath;
        if (!within(root, destination)) throw new Error("target outside repository");
        const actualPath = await realpath(destination);
        if (!within(root, actualPath)) throw new Error("target symlink outside repository");
        const info = await stat(actualPath);
        if (fragment && info.isFile() && /\.md$/i.test(actualPath)) {
          if (!(await page(actualPath)).anchors.has(fragment))
            throw new Error(`missing Markdown anchor: #${fragment}`);
        }
      } catch (error) {
        result.errors.push({ file, line, url: url ?? raw, reason: error.message });
      }
    }
  }
  return result;
}

export async function checkCurrentDocs(root) {
  try {
    const tracked = execFileSync("git", ["ls-files", "--cached", "-z"], {
      cwd: root,
      encoding: "utf8"
    });
    const paths = [...new Set(tracked.split("\0").filter(isCurrentDocument))];
    const result = await auditDocumentLinks(root, paths);
    for (const error of result.errors)
      console.error(`${error.file}:${error.line}: ${error.url}: ${error.reason}`);
    console.log(
      `Current docs: ${result.documents} documents, ${result.links} links, ${result.fragments} fragments, ${result.skipped} external links skipped, ${result.errors.length} errors.`
    );
    return result.errors.length ? 1 : 0;
  } catch (error) {
    console.error(`Current docs: ${error.message}`);
    return 1;
  }
}
