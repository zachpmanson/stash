{
  description = "stash dev shell";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs }:
    let
      forAllSystems = nixpkgs.lib.genAttrs [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" ];
    in {
      devShells = forAllSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs
              pkgs.pnpm
              # Android build toolchain
              pkgs.jdk17         # Java 17 for Gradle compatibility
              pkgs.gradle       # Build system
              pkgs.android-tools # adb, fastboot
            ];

            shellHook = ''
              # Load ANDROID_HOME from .env if present
              if [ -f .env ]; then
                set -a; source .env; set +a
              fi
              echo "stash dev shell — node $(node -v), java $(java -version 2>&1 | head -1)"
              echo "ANDROID_HOME: ${ANDROID_HOME+set}"
            '';
          };
        });
    };
}