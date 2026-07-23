# ADR 0004 — Repo clone lives in Documents/GitHub, not inside Dropbox

**Date:** 2026-07-23 · **Status:** accepted

## Context

The charter keeps the project folder in Dropbox
(`…\EU EIC APPLICATION\Music Rights Engine\`) for docs and reference assets, and
says code lives in Git/GitHub, never Dropbox as a code store. The dev machine
already keeps repos in `C:\Users\rafin\Documents\GitHub\` (the game lives there).

## Decision

The engine repo clone lives at `C:\Users\rafin\Documents\GitHub\burst-rights-engine`.
The Dropbox folder keeps the charter (`PROJECT_PLAN.md`), design docs, and a
pointer to the repo — no code, no `node_modules`.

## Why

Dropbox syncing a live working copy fights git: `node_modules` churn, lock-file
conflicts on `.git` internals, and partial syncs that can corrupt the index.
Keeping the clone outside Dropbox honours the charter's actual rule (GitHub is
the source of truth for code) while avoiding those failure modes. The charter
copy in the repo is `CLAUDE.md`, auto-loaded each session per its own §0.
