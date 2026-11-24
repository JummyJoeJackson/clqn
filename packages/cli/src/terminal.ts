// Keep escape sequences in API text from reaching the terminal, and make URLs clickable in a TTY.
// The link label is the URL itself, so a link can never point somewhere other than what it shows.
export function terminalText(text: string, tty: boolean): string {
  const clean = text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ' ');
  if (!tty || process.env.TERM === 'dumb') return clean;
  return clean.replace(/https?:\/\/\S+/g, (url) =>
    URL.canParse(url) ? `\x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\` : url,
  );
}
