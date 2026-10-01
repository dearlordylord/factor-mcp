import { createServer, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { SessionSchema, type Session } from "@firfi/factor-sdk";

export function createCaptureServer(
  token: string,
  save: (session: Session, evidence: unknown) => Promise<void>,
): Server {
  let saved = false;
  return createServer(async (request, response) => {
    const supplied = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from("Bearer " + token);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      response.writeHead(403).end("Unauthorized");
      return;
    }
    if (
      request.method !== "POST" ||
      request.url !== "/capture" ||
      !request.headers["content-type"]?.startsWith("application/json")
    ) {
      response.writeHead(400).end("Unsupported request");
      return;
    }
    if (saved) {
      response.writeHead(409).end("Already captured");
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > 1024 * 1024) {
          response.writeHead(413).end("Payload too large");
          return;
        }
        chunks.push(buffer);
      }
      const payload = z
        .object({ session: SessionSchema, evidence: z.unknown().optional() })
        .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      const session = payload.session;
      if (
        !session.origin ||
        (!session.headers.authorization && !session.cookies.length)
      )
        throw new Error("Missing session");
      // Prevent parallel requests from overwriting the accepted capture.
      if (saved) {
        response.writeHead(409).end("Already captured");
        return;
      }
      saved = true;
      try {
        await save(session, payload.evidence);
      } catch {
        saved = false;
        throw new Error("Save failed");
      }
      response
        .writeHead(200, { "content-type": "application/json" })
        .end('{"saved":true}');
    } catch {
      response.writeHead(400).end("Invalid session or persistence failure");
    }
  });
}
