{
  description = "length3 development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
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

          python = pkgs.python3.withPackages (
            ps: with ps; [
              brotli
              fonttools
            ]
          );

          pnpm = pkgs.writeShellApplication {
            name = "pnpm";
            runtimeInputs = [ pkgs.nodejs_22 ];
            text = ''
              export COREPACK_HOME="''${COREPACK_HOME:-$PWD/.cache/corepack}"
              exec corepack pnpm "$@"
            '';
          };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pnpm
              python
            ] ++ playwrightLibs;

            shellHook = ''
              export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath playwrightLibs}:''${LD_LIBRARY_PATH:-}"
              export COREPACK_HOME="''${COREPACK_HOME:-$PWD/.cache/corepack}"
              export PLAYWRIGHT_BROWSERS_PATH="''${PLAYWRIGHT_BROWSERS_PATH:-$PWD/.cache/ms-playwright}"
              export PNPM_HOME="''${PNPM_HOME:-$PWD/.cache/pnpm-home}"
              export npm_config_cache="''${npm_config_cache:-$PWD/.cache/npm}"
              export npm_config_store_dir="''${npm_config_store_dir:-$PWD/.pnpm-store}"

              mkdir -p \
                "$COREPACK_HOME" \
                "$PLAYWRIGHT_BROWSERS_PATH" \
                "$PNPM_HOME" \
                "$npm_config_cache" \
                "$npm_config_store_dir"
            '';
          };
        }
      );
    };
}
