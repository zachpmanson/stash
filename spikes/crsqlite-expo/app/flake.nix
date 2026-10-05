{
  description = "Disposable Expo Android CR-SQLite sync client";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" ];
    in {
      devShells = nixpkgs.lib.genAttrs systems (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.pnpm
              pkgs.jdk17
              pkgs.gradle
              pkgs.android-tools
              pkgs.unzip
            ];

            shellHook = ''
              export ANDROID_HOME="''${ANDROID_HOME:-$HOME/android-sdk}"
              export ANDROID_SDK_ROOT="''${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
              echo "CR-SQLite Expo app — node $(node -v); Android SDK: $ANDROID_HOME"
            '';
          };
        });
    };
}
