#!/bin/bash
# Download NASA FIRMS yearly active-fire archives (all countries) for MODIS C6.1 and VIIRS S-NPP 375 m.
# Source: https://firms.modaps.eosdis.nasa.gov/country/  (NASA LANCE / FIRMS, public archive)
set -u
cd "$(dirname "$0")/../data/raw"
fetch() {
  f="$1"
  [ -f "$f.done" ] && return 0
  if curl -sSL --retry 5 --retry-delay 5 -C - -o "$f" "https://firms.modaps.eosdis.nasa.gov/data/country/zips/$f" && unzip -tq "$f" >/dev/null 2>&1; then
    touch "$f.done"; echo "ok $f"
  else
    echo "FAIL $f"
  fi
}
export -f fetch
{
  for y in $(seq 2000 2025); do echo "modis_${y}_all_countries.zip"; done
  for y in $(seq 2012 2025); do echo "viirs-snpp_${y}_all_countries.zip"; done
} | xargs -P 5 -n 1 bash -c 'fetch "$0"'
echo ALL_DONE
