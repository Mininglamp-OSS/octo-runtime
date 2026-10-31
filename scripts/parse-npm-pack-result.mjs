const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNonemptyString = (value) => typeof value === "string" && value.trim().length > 0;

/** 兼容 npm 两种 JSON 结构；仅返回身份明确且消费字段有效的目标包元数据。 */
export function parseNpmPackResult(stdout, expectedName) {
  const invalid = (reason, cause) =>
    new Error(`npm pack --json (${expectedName}): ${reason}`, { cause });
  let metadata;
  try {
    metadata = JSON.parse(stdout);
  } catch (cause) {
    throw invalid("无效 JSON", cause);
  }

  let matches;
  if (Array.isArray(metadata)) {
    for (const entry of metadata) {
      if (!isRecord(entry) || !isNonemptyString(entry.name)) {
        throw invalid("数组条目必须是具有非空 name 的对象");
      }
    }
    matches = metadata.filter((entry) => entry.name === expectedName);
  } else if (isRecord(metadata)) {
    for (const [name, entry] of Object.entries(metadata)) {
      if (!isRecord(entry)) throw invalid(`包 ${name} 的元数据必须是对象`);
      if (Object.hasOwn(entry, "name") && entry.name !== name) {
        throw invalid(`包 ${name} 的 name 与对象键不一致`);
      }
      if (Object.hasOwn(entry, "name") && !isNonemptyString(entry.name)) {
        throw invalid(`包 ${name} 的 name 必须是非空字符串`);
      }
    }
    matches = Object.hasOwn(metadata, expectedName) ? [metadata[expectedName]] : [];
  } else {
    throw invalid("结果必须是数组或包名索引对象");
  }
  if (matches.length === 0) throw invalid("缺少预期包元数据");
  if (matches.length !== 1) throw invalid("预期包元数据存在歧义（重复 name）");

  const result = matches[0];
  if (
    !isNonemptyString(result.filename) ||
    result.filename !== result.filename.trim() ||
    !result.filename.endsWith(".tgz") ||
    /[/\\\0\r\n]/.test(result.filename)
  ) {
    throw invalid("filename 必须是无路径分隔符的非空 .tgz 文件名");
  }
  if (
    !Array.isArray(result.bundled) ||
    result.bundled.some((name) => !isNonemptyString(name) || name !== name.trim())
  ) {
    throw invalid("bundled 必须是非空包名字符串组成的数组");
  }
  return result;
}
