import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import ipaddr from "ipaddr.js";
import { SAXParser } from "parse5-sax-parser";

type Address = { address: string; family: 4 | 6 };
const MAX_BYTES = 256 * 1024;
const DEADLINE_MS = 5000;

export function publicAddress(value: string): boolean {
  if (!ipaddr.isValid(value) || value.includes("%")) return false;
  const address = ipaddr.parse(value);
  // Reject mapped/translated/tunnel addresses rather than interpreting embedded IPs.
  if (address.range() !== "unicast") return false;
  if (address.kind() === "ipv6") {
    return address.match(ipaddr.parseCIDR("2000::/3")) &&
      !["2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20"].some(cidr => address.match(ipaddr.parseCIDR(cidr)));
  }
  return !["192.0.0.0/24", "192.88.99.0/24"].some(cidr => address.match(ipaddr.parseCIDR(cidr)));
}

function target(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 4096)
    throw new Error("Unsupported URL");
  url.hash = "";
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.includes("%"))
    throw new Error("Non-public host");
  return url;
}

async function resolvePublic(host: string, signal: AbortSignal): Promise<Address[]> {
  const resolver = new Resolver({ timeout: 1000, tries: 1 });
  const cancel = () => resolver.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const [v4, v6] = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
    return [
      ...(v4.status === "fulfilled" ? v4.value.map(address => ({ address, family: 4 as const })) : []),
      ...(v6.status === "fulfilled" ? v6.value.map(address => ({ address, family: 6 as const })) : []),
    ];
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

export function htmlTitle(html: string): string | null {
  // Tokenize only a small head prefix, never construct an untrusted DOM. HTML
  // active-formatting reconstruction can amplify even a tiny input enormously.
  // Titles beyond this 32 Ki-character prefix deliberately use the URL fallback.
  const parser = new SAXParser();
  const clean = (value: string | undefined) => value?.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const meta: Record<string, string> = {};
  let title: string | undefined;
  let rawText: string | null = null;
  let templateDepth = 0;
  let done = false;
  const stop = () => { done = true; parser.stop(); };
  parser.on("startTag", ({ tagName, attrs }) => {
    if (done) return;
    // SAX's partial namespace simulator can misclassify raw text after foreign
    // markup in templates. Stop conservatively, retaining only earlier metadata.
    if (tagName === "svg" || tagName === "math") { stop(); return; }
    if (tagName === "template") { templateDepth++; return; }
    if (templateDepth) return;
    if (["html", "head", "base", "basefont", "bgsound", "link"].includes(tagName)) return;
    if (tagName === "meta") {
      const values = Object.fromEntries(attrs.map(a => [a.name, a.value]));
      const name = (values.property ?? values.name ?? "").toLowerCase();
      if ((name === "og:title" || name === "twitter:title") && clean(values.content)) meta[name] ??= clean(values.content)!;
    } else if (["title", "script", "style", "noscript", "noframes"].includes(tagName)) {
      rawText = tagName;
      if (tagName === "title" && title === undefined) title = "";
      // Only the first real head title supplies text, even if it is empty.
      else if (tagName === "title") rawText = "ignored-title";
    } else stop(); // Any other start tag implicitly starts the body.
  });
  parser.on("endTag", ({ tagName }) => {
    if (done) return;
    if (tagName === "template") { if (templateDepth) templateDepth--; return; }
    if (templateDepth) return;
    if (rawText === tagName || (rawText === "ignored-title" && tagName === "title")) rawText = null;
    else if (["head", "body", "html", "br"].includes(tagName)) stop();
  });
  parser.on("text", ({ text }) => {
    if (done || templateDepth) return;
    if (rawText === "title") title += text;
    else if (!rawText && /[^\t\n\f\r ]/.test(text)) stop(); // Non-space head text starts the body.
  });
  parser.end(html.slice(0, 32 * 1024));
  return clean(meta["og:title"]) ?? clean(meta["twitter:title"]) ?? clean(title);
}

type Dependencies = {
  resolve?: (host: string, signal: AbortSignal) => Promise<Address[]>;
  request?: typeof httpRequest;
  timeoutMs?: number;
  maxBytes?: number;
};

/** Four bounded, credential-free public-page requests; never acquires a DB handle. */
export function createLinkTitleResolver(deps: Dependencies = {}) {
  let active = 0;
  return async (value: string): Promise<string> => {
    const fallback = value.slice(0, 500);
    if (active >= 4) return fallback;
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEADLINE_MS);
    // The race also bounds an injected/unresponsive DNS implementation; production
    // DNS is cancelled on abort, and Node destroys an in-flight HTTP request.
    const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("Title lookup timed out")), { once: true }));
    try {
      return await Promise.race([(async () => {
        let url = target(value);
        for (let redirects = 0; redirects <= 3; redirects++) {
          controller.signal.throwIfAborted();
          const host = url.hostname.replace(/^\[|\]$/g, "");
          const family = isIP(host);
          const addresses: Address[] = family ? [{ address: host, family: family as 4 | 6 }] : await (deps.resolve ?? resolvePublic)(host, controller.signal);
          controller.signal.throwIfAborted();
          if (!addresses.length || addresses.some(a => !publicAddress(a.address) || isIP(a.address) !== a.family)) throw new Error("Non-public DNS answer");
          const pinned = addresses[0];
          const result = await new Promise<{ redirect?: string; html?: string }>((resolve, reject) => {
            const request = deps.request ?? (url.protocol === "https:" ? httpsRequest : httpRequest);
            const req = request(url, {
              method: "GET", agent: false, signal: controller.signal,
              // Use the original hostname for Host/TLS verification, but connect
              // only to this checked answer. No second DNS lookup or pooled socket.
              lookup: (_hostname, options, callback) => {
                if (options.all) callback(null, [pinned]);
                else callback(null, pinned.address, pinned.family);
              },
              headers: { "User-Agent": "Stash/1.0 (link title)", Accept: "text/html", "Accept-Encoding": "identity" },
              maxHeaderSize: 16384,
            }, res => {
              const stop = () => { res.destroy(); req.destroy(); };
              res.on("error", reject);
              if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
                resolve({ redirect: res.headers.location }); stop(); return;
              }
              if (res.statusCode !== 200 || !/^text\/html(?:\s*;|$)/i.test(res.headers["content-type"] ?? "") ||
                  (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity") ||
                  Number(res.headers["content-length"] ?? 0) > (deps.maxBytes ?? MAX_BYTES)) {
                reject(new Error("Unsupported page")); stop(); return;
              }
              const chunks: Buffer[] = [];
              let bytes = 0;
              res.on("data", (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > (deps.maxBytes ?? MAX_BYTES)) { reject(new Error("Page too large")); stop(); }
                else chunks.push(chunk);
              });
              res.on("end", () => {
                try {
                  const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(res.headers["content-type"] ?? "")?.[1] ?? "utf-8";
                  resolve({ html: new TextDecoder(charset).decode(Buffer.concat(chunks)) });
                } catch (error) { reject(error); }
              });
            });
            req.on("error", reject);
            req.end();
          });
          if (result.redirect) { url = target(new URL(result.redirect, url).href); continue; }
          return htmlTitle(result.html ?? "") ?? fallback;
        }
        return fallback;
      })(), aborted]);
    } catch {
      return fallback;
    } finally {
      controller.abort();
      clearTimeout(timer);
      active--;
    }
  };
}

export const resolveLinkTitle = createLinkTitleResolver();
