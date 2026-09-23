import http from "node:http";
import type { Server, IncomingMessage, ServerResponse } from "node:http";

/**
 * Shared test server helper: start a throwaway HTTP handler on an ephemeral
 * port and tear it down afterwards.
 */
export function withHttpServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
