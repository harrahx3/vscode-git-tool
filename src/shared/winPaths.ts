/**
 * Path as the extension host sees it, for a path printed by git. A Windows git (`git.exe`
 * started from WSL through `git.path`) prints `C:/Users/me/repo`; WSL reaches that folder as
 * `/mnt/c/Users/me/repo`. Any other path is returned unchanged.
 */
export function gitPathToLocal(p: string, platform: string = process.platform): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (platform !== "linux" || !m) return p;
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}
