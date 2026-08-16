#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  py -m venv .venv
fi

".venv/Scripts/python.exe" -m pip install --quiet -r requirements.txt
".venv/Scripts/python.exe" -m uvicorn app.main:app --reload
