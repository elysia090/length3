{
  description = "length3 development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
  };

  outputs = { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (
          system:
          f {
            pkgs = import nixpkgs {
              inherit system;
            };
          }
        );
    in
    {
      devShells = forAllSystems (
        { pkgs }:
        let
          nodejs = pkgs.nodejs_24;
          playwrightLibs = with pkgs;
            lib.optionals stdenv.isLinux [
              alsa-lib
              atk
              at-spi2-atk
              cairo
              cups
              dbus
              expat
              glib
              libgbm
              libdrm
              libxkbcommon
              mesa
              nspr
              nss
              pango
              systemd
              xorg.libX11
              xorg.libXcomposite
              xorg.libXdamage
              xorg.libXext
              xorg.libXfixes
              xorg.libXrandr
              xorg.libxcb
            ];

          japaneseFonts = with pkgs; [
            noto-fonts-cjk-sans
            noto-fonts-cjk-serif
          ];

          fontsConf = pkgs.makeFontsConf {
            fontDirectories = japaneseFonts;
          };

          python = pkgs.python3.withPackages (
            ps: with ps; [
              brotli
              fonttools
            ]
          );

          pnpm = pkgs.writeShellApplication {
            name = "pnpm";
            runtimeInputs = [ nodejs ];
            text = ''
              export COREPACK_HOME="''${COREPACK_HOME:-$PWD/.cache/corepack}"
              export npm_config_store_dir="''${PNPM_STORE_DIR:-$PWD/.pnpm-store}"
              exec corepack pnpm "$@"
            '';
          };
        in
        {
          default = pkgs.mkShell {
            packages = [
              nodejs
              pnpm
              python
              pkgs.fontconfig
            ] ++ japaneseFonts ++ playwrightLibs;

            shellHook = ''
              export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath playwrightLibs}:''${LD_LIBRARY_PATH:-}"
              export COREPACK_HOME="''${COREPACK_HOME:-$PWD/.cache/corepack}"
              export FONTCONFIG_FILE="${fontsConf}"
              export FONTCONFIG_PATH="${pkgs.fontconfig.out}/etc/fonts"
              export PLAYWRIGHT_BROWSERS_PATH="''${PLAYWRIGHT_BROWSERS_PATH:-$PWD/.cache/ms-playwright}"
              export PNPM_HOME="''${PNPM_HOME:-$PWD/.cache/pnpm-home}"
              export PNPM_STORE_DIR="''${PNPM_STORE_DIR:-$PWD/.pnpm-store}"
              export npm_config_cache="''${npm_config_cache:-$PWD/.cache/npm}"

              mkdir -p \
                "$COREPACK_HOME" \
                "$PLAYWRIGHT_BROWSERS_PATH" \
                "$PNPM_HOME" \
                "$npm_config_cache" \
                "$PNPM_STORE_DIR"
            '';
          };
        }
      );
    };
}
