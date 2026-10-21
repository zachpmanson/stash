import { build } from "esbuild";
import { execFileSync } from "node:child_process";
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
execFileSync(
  "pnpm",
  [
    "exec",
    "tailwindcss",
    "-i",
    "web/style.css",
    "-o",
    "dist/public/app.css",
    "--minify",
  ],
  { stdio: "inherit" },
);
await copyFile("web/index.html", "dist/public/index.html");
