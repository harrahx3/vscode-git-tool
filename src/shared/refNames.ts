// Branch and tag names: validation and the suggested name of the next tag. No VS Code dependency.

/** Why `name` cannot be used (git check-ref-format rules, existing names), or undefined. */
export function refNameProblem(
  name: string,
  existing: readonly string[],
  kind: "branch" | "tag",
): string | undefined {
  const v = name.trim();
  if (!v) return "Enter a name";
  if (
    // eslint-disable-next-line no-control-regex
    /[\s~^:?*[\\\x00-\x1f\x7f]|\.\.|@\{|\/\/|\/\.|\.lock(?:\/|$)|[./]$/.test(v) ||
    /^[-./]/.test(v) ||
    v === "@"
  )
    return `Not a valid ${kind} name`;
  if (existing.includes(v)) return `A ${kind} named ${v} already exists`;
  return undefined;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The next tag, guessed from the most recent ones: the same prefix with today's date
 * (`PES_mobilite_YYMMDD`, `BEBOP_YYYYMMDD`: the KNIME repositories' convention), or the next
 * patch version (`v1.2.3` → `v1.2.4`). Empty when no pattern is recognised.
 */
export function suggestTag(recentFirst: readonly string[], today: Date): string {
  const yymmdd = `${pad(today.getFullYear() % 100)}${pad(today.getMonth() + 1)}${pad(today.getDate())}`;
  for (const tag of recentFirst) {
    const dated = /^(.*?)(\d{8}|\d{6})$/.exec(tag);
    if (dated) {
      const date = dated[2].length === 8 ? `${today.getFullYear()}${yymmdd.slice(2)}` : yymmdd;
      const month = Number(date.slice(-4, -2));
      const day = Number(date.slice(-2));
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${dated[1]}${date}`;
    }
    const semver = /^(v?)(\d+)\.(\d+)\.(\d+)$/.exec(tag);
    if (semver) return `${semver[1]}${semver[2]}.${semver[3]}.${Number(semver[4]) + 1}`;
  }
  return "";
}
