{
  description = "stash dev shell";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs }:
    let
      forAllSystems = nixpkgs.lib.genAttrs [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" ];
      serverSource = ./spikes/crsqlite-expo/server;
      crsqliteLinuxBinary = nixpkgs.legacyPackages.x86_64-linux.fetchurl {
        url = "https://github.com/vlcn-io/cr-sqlite/releases/download/v0.16.3/crsqlite-linux-x86_64.zip";
        hash = "sha256-j2/TGiviuowxAarQZ6UEouY8jptRzErOeGAJwC5+y64=";
      };
      serverPnpmDeps = nixpkgs.legacyPackages.x86_64-linux.fetchPnpmDeps {
        pname = "stash-crsqlite-sync";
        version = "0.1.0";
        src = serverSource;
        fetcherVersion = 3;
        hash = "sha256-4WcqUKGsB7RsqqzybRVzn3L0X6usP/oode1z7Ujrfew=";
      };
      serverPackage = nixpkgs.legacyPackages.x86_64-linux.stdenv.mkDerivation {
        pname = "stash-crsqlite-sync";
        version = "0.1.0";
        src = serverSource;
        nativeBuildInputs = with nixpkgs.legacyPackages.x86_64-linux; [
          nodejs_24 node-gyp pnpm pnpmConfigHook python3 unzip
        ];
        pnpmDeps = serverPnpmDeps;
        buildPhase = ''
          runHook preBuild
          crsqlite_pkg=$(readlink -f node_modules/@vlcn.io/crsqlite)
          mkdir -p "$crsqlite_pkg/dist"
          unzip -o ${crsqliteLinuxBinary} -d "$crsqlite_pkg/dist"
          pnpm rebuild @vlcn.io/crsqlite
          better_sqlite3=$(readlink -f node_modules/better-sqlite3)
          (cd "$better_sqlite3" && node-gyp rebuild --release --nodedir=${nixpkgs.legacyPackages.x86_64-linux.nodejs_24})
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
              pkgs.nodejs
              pkgs.pnpm
              # Android build toolchain
              pkgs.jdk17         # Java 17 for Gradle compatibility
              pkgs.gradle        # Build system
              pkgs.android-tools  # adb, fastboot
            ];

            shellHook = ''
              # Load ANDROID_HOME from .env if present
              if [ -f .env ]; then
                set -a; source .env; set +a
              fi
              echo "stash dev shell — node $(node -v), java $(java -version 2>&1 | head -1)"
            '';
          };
        });
    };
}