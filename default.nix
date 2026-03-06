# default.nix — Legacy Nix package (no flake)
# For flakes: nix build .#  or  nix develop
{ pkgs ? import <nixpkgs> {} }:
let
  nodejs = pkgs.nodejs_22;
in
  pkgs.buildNpmPackage {
    pname = "hyperclaw";
    version = "4.0.0";
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
  }
