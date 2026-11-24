// Keep escape sequences in API text from reaching the terminal.
export function terminalText(text: string, tty: boolean, urls: readonly (string | null | undefined)[] = []): string {
  const clean = text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ' ');
  if (!tty || process.env.TERM === 'dumb' || urls.length === 0) return clean;
  const links = new Set(urls);
  return clean.replace(/https?:\/\/\S+/g, (url) => {
    if (!links.has(url)) return url;
    const target = URL.parse(url);
    if (!target || target.username || target.password) return url;
    return `\x1b]8;;${target.href}\x1b\\${url}\x1b]8;;\x1b\\`;
  });
}
