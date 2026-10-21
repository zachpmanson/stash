import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
await mkdir("dist/public", { recursive: true });
await build({
  entryPoints: ["web/main.tsx"],
  tsconfig: "web/tsconfig.json",
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2022"],
  outfile: "dist/public/app.js",
  define: { "process.env.NODE_ENV": '"production"' },
});
await copyFile("web/index.html", "dist/public/index.html");
