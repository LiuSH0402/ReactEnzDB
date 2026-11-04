import path from "node:path";

/** Location only: does not modify scientific records or matching policy. */
export function releasePath(...parts: string[]) {
  const root = process.env.REACTENZDB_RELEASE_DIR
    ? path.resolve(process.env.REACTENZDB_RELEASE_DIR)
    : path.resolve(process.cwd(), "../../../web_release");
  return path.join(root, ...parts);
}
