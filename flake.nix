{
  description = "HyperClaw — AI Gateway Platform";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        nodejs = pkgs.nodejs_22;
        pnpm = pkgs.nodePackages.pnpm;
      in {
        # ─── Dev shell ─────────────────────────────────────────────────────────
        devShells.default = pkgs.mkShell {
          buildInputs = [
            nodejs
            pnpm
            pkgs.typescript
            pkgs.nodePackages.ts-node
            pkgs.sox          # voice recording
            pkgs.espeak-ng    # TTS on Linux
            pkgs.jq           # log formatting
            pkgs.curl
            pkgs.git
          ];
          shellHook = ''
            echo "⚡ HyperClaw dev shell"
            echo "   Node: $(node --version)"
            echo "   pnpm: $(pnpm --version)"
            echo ""
            echo "   Commands:"
            echo "     pnpm install   — install dependencies"
            echo "     pnpm build     — build with tsdown"
            echo "     pnpm dev       — run in dev mode (ts-node)"
            echo ""
          '';
        };

        # ─── Package ────────────────────────────────────────────────────────────
        # To get npmDepsHash: run ./scripts/nix-update-hash.sh or: nix build .# 2>&1 and copy the "got:" hash
        packages.default = pkgs.buildNpmPackage {
          pname = "hyperclaw";
          version = "4.0.1";
          src = ./.;
          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
          nodejs = nodejs;
          buildPhase = ''
            npm run build
          '';
          installPhase = ''
            mkdir -p $out/bin $out/lib/hyperclaw
            cp -r dist node_modules package.json $out/lib/hyperclaw/
            cat > $out/bin/hyperclaw << EOF
            #!/usr/bin/env bash
            exec node $out/lib/hyperclaw/dist/run-main.js "\$@"
            EOF
            chmod +x $out/bin/hyperclaw
          '';
          meta = {
            description = "AI Gateway Platform — The Lobster Evolution";
            license = pkgs.lib.licenses.mit;
            maintainers = [];
            platforms = pkgs.lib.platforms.all;
          };
        };

        # ─── NixOS module ───────────────────────────────────────────────────────
        nixosModules.default = { config, lib, pkgs, ... }: {
          options.services.hyperclaw = {
            enable = lib.mkEnableOption "HyperClaw Gateway";
            port   = lib.mkOption { type = lib.types.port; default = 18789; };
            bind   = lib.mkOption { type = lib.types.str;  default = "127.0.0.1"; };
            user   = lib.mkOption { type = lib.types.str;  default = "hyperclaw"; };
            group  = lib.mkOption { type = lib.types.str;  default = "hyperclaw"; };
            dataDir = lib.mkOption { type = lib.types.path; default = "/var/lib/hyperclaw"; };
          };

          config = lib.mkIf config.services.hyperclaw.enable {
            users.users.${config.services.hyperclaw.user} = {
              isSystemUser = true;
              group = config.services.hyperclaw.group;
              home  = config.services.hyperclaw.dataDir;
              createHome = true;
            };
            users.groups.${config.services.hyperclaw.group} = {};

            systemd.services.hyperclaw = {
              description = "HyperClaw Gateway";
              wantedBy    = [ "multi-user.target" ];
              after       = [ "network.target" ];
              serviceConfig = {
                Type        = "simple";
                User        = config.services.hyperclaw.user;
                Group       = config.services.hyperclaw.group;
                WorkingDirectory = config.services.hyperclaw.dataDir;
                ExecStart   = "${self.packages.${system}.default}/bin/hyperclaw gateway:serve";
                Restart     = "on-failure";
                RestartSec  = "5s";
                Environment = [
                  "HYPERCLAW_PORT=${toString config.services.hyperclaw.port}"
                  "HYPERCLAW_BIND=${config.services.hyperclaw.bind}"
                  "HYPERCLAW_DIR=${config.services.hyperclaw.dataDir}"
                ];
              };
            };
          };
        };
      }
    );
}
