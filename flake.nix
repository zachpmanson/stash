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
              pkgs.jdk          # Java runtime for Gradle
              pkgs.gradle       # Build system
              pkgs.android-tools # adb, fastboot
            ];

            shellHook = ''
              # ANDROID_HOME is set by the Makefile default or .env file.
              # On macOS: ~/Library/Android/sdk
              # On Linux: set via .env or export ANDROID_HOME=/path/to/sdk
              echo "stash dev shell — node $(node -v), java $(java -version 2>&1 | head -1)"
            '';
          };
        });
    };
}