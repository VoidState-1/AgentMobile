/** Incremental SSE framing handles arbitrary network boundaries and CRLF. */
export class SseDecoder {
  private buffer = '';
  push(chunk: string): string[] {
    this.buffer += chunk;
    const events: string[] = [];
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.buffer);
      if (!match) break;
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, '')).join('\n');
      if (data) events.push(data);
    }
    return events;
  }
}
