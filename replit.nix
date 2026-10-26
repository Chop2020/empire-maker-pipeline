{ pkgs }: {
  deps = [
    # Headless Chromium for HTML → PDF rendering (found automatically on PATH; or set CHROME_PATH)
    pkgs.chromium
    # Fonts/libs Chromium needs on a bare Nix box
    pkgs.fontconfig
    pkgs.dejavu_fonts
  ];
}
