{
  description = "Disposable CR-SQLite WebSocket server";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      linux = nixpkgs.legacyPackages.x86_64-linux;
      crsqliteLinuxBinary = linux.fetchurl {
        url = "https://github.com/vlcn-io/cr-sqlite/releases/download/v0.16.3/crsqlite-linux-x86_64.zip";
        hash = "sha256-j2/TGiviuowxAarQZ6UEouY8jptRzErOeGAJwC5+y64=";
      };
      # Node 24.19+ headers trigger an ObjectWrap cleanup-hook abort in
      # better-sqlite3 during GC. 24.18.1 headers share the 24.x ABI and are
      # a verified build-time workaround until the Node 24 backport lands.
      nodeHeaders24_18 = linux.fetchzip {
        url = "https://nodejs.org/dist/v24.18.1/node-v24.18.1-headers.tar.gz";
        hash = "sha256-1eRD0cO82bG4NDYyr5EhNjwGkl4qhcUF8xrfEytTlOQ=";
      };
      pnpmDeps = linux.fetchPnpmDeps {
        pname = "stash-crsqlite-sync";
        version = "0.1.0";
        src = ./.;
        fetcherVersion = 3;
        hash = "sha256-4WcqUKGsB7RsqqzybRVzn3L0X6usP/oode1z7Ujrfew=";
      };
      serverPackage = linux.stdenv.mkDerivation {
        pname = "stash-crsqlite-sync";
        version = "0.1.0";
        src = ./.;
        nativeBuildInputs = with linux; [
          nodejs_24 node-gyp pnpm pnpmConfigHook python3 unzip
        ];
        inherit pnpmDeps;
        buildPhase = ''
          runHook preBuild
          crsqlite_pkg=$(readlink -f node_modules/@vlcn.io/crsqlite)
          mkdir -p "$crsqlite_pkg/dist"
          unzip -o ${crsqliteLinuxBinary} -d "$crsqlite_pkg/dist"
          pnpm rebuild @vlcn.io/crsqlite
          better_sqlite3=$(readlink -f node_modules/better-sqlite3)
          # Bypass the Nix node-gyp wrapper, which forces npm_config_nodedir to the runtime headers.
          (cd "$better_sqlite3" && node ${linux.node-gyp}/lib/node_modules/node-gyp/bin/node-gyp.js rebuild --release --nodedir=${nodeHeaders24_18})
          node --test test/better-sqlite3-gc.test.mjs
          pnpm exec tsc --outDir dist
          runHook postBuild
        '';
        installPhase = ''
          runHook preInstall
          mkdir -p $out
          cp -r dist scripts node_modules package.json $out/
          runHook postInstall
        '';
      };
    in {
      packages.x86_64-linux.crsqlite-sync = serverPackage;

      devShells = forAllSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.pnpm
              pkgs.node-gyp
              pkgs.python3
              pkgs.unzip
            ];
          };
        });
    };
}
