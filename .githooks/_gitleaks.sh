#!/bin/sh
# Localiza gitleaks: PATH, o la instalación de winget en Windows.
find_gitleaks() {
  if command -v gitleaks >/dev/null 2>&1; then command -v gitleaks; return 0; fi
  if [ -n "$LOCALAPPDATA" ]; then
    for p in "$LOCALAPPDATA"/Microsoft/WinGet/Packages/Gitleaks.Gitleaks_*/gitleaks.exe; do
      [ -x "$p" ] && { echo "$p"; return 0; }
    done
  fi
  return 1
}
