---
version: alpha
colors:
  background: '#f3f6fa'
  surface: '#ffffff'
  ink: '#152c44'
  muted: '#4b6077'
  brand: '#165ea0'
  danger: '#ad243a'
  border: '#c4cfdd'
typography:
  body:
    fontFamily: '"Avenir Next", "Segoe UI", sans-serif'
    fontSize: '16px'
    lineHeight: '1.6'
  data:
    fontFamily: '"SFMono-Regular", Consolas, monospace'
    fontSize: '13px'
rounded:
  control: '4px'
spacing:
  controlGap: '12px'
  section: '40px'
components:
  button:
    minHeight: '44px'
---

## Overview

SyncGuard is a backend reliability demo for engineers inspecting financial synchronization.
The dashboard is a starter operational surface, inspired by a financial ledger: aligned
rows, explicit versions, and readable audit evidence. Exactly two pages; no marketing hero.
This task supplies boilerplate rather than a finished visual product.

## Colors

The light surface supports reading long audit trails. Blue marks navigation and routine
actions; red accompanies explicit errors. Status is always expressed in text as well.
Runtime token owner: `apps/dashboard/src/styles.css`; values above map to identically named
CSS variables. Focus aliases brand; scrollbar colors are documented runtime utility tokens.

## Typography

Use the body stack for headings, navigation and controls. Monospace is reserved for
operation identifiers and JSON evidence. Fonts use installed fallbacks without remote loading.

## Layout

Maximum content width 1120px, 90% viewport width. Natural document scrolling; tables and
JSON evidence own horizontal overflow. At 600px forms and definition lists become one column.

## Elevation & Depth

Flat surfaces with separators. No decorative shadows or nested metric cards.

## Shapes

Four-pixel control corners; rectangular tables and evidence blocks.

## Components

Native links and buttons; shared request/status/busy helpers in `apps/dashboard/src/lib/api.ts and components/Status.tsx`.
The system-health page and timeline page share navigation, focus and error styles.

## Do's and Don'ts

Show UTC timestamps explicitly. Show unexecuted invariant results as unexecuted.
Keep synthetic data separate from claims. Do not add entities or reverse synchronization.
