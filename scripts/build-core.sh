#!/usr/bin/env bash
set -eu
em++ vendor/bridge.cpp vendor/mahjong-algorithm/fan_calculator.cpp vendor/mahjong-algorithm/shanten.cpp vendor/mahjong-algorithm/stringify.cpp -O3 -std=c++17 -sMODULARIZE=1 -sEXPORT_ES6=1 -sSINGLE_FILE=1 -sENVIRONMENT=web,node -sFILESYSTEM=0 -sEXPORTED_RUNTIME_METHODS='["ccall"]' -sEXPORTED_FUNCTIONS='["_mj_score","_mj_eval","_mj_fans"]' -o src/engine/mcrcore.js
