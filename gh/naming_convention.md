# Grasshopper → Three.js Naming Convention

> **This document is authoritative.** All Grasshopper exports must conform to these rules.

---

## Required Exports

| Name | Type | Description |
|------|------|-------------|
| `SCULPTURE_PATH` | Polyline | Ordered vertices defining the sculpture's path (corners) |
| `CROSS_SECTION_0001` ... `CROSS_SECTION_NNNN` | Closed planar curves | Cross-sections along the path |

## Optional Exports

| Name | Type | Description |
|------|------|-------------|
| `SCULPTURE_CURVE` | Smooth curve | Optional smooth representation of the path |

---

## Naming Rules

1. **UPPERCASE** — All names must be uppercase
2. **UNDERSCORES** — Use underscores to separate words
3. **ZERO-PADDED INDICES** — Use 4-digit zero-padded indices (e.g., `0001`, `0042`, `0999`)
4. **NO SPACES** — Never use spaces in names

---

## What NOT to Export

The following are **derived by Three.js at runtime** and must NOT be exported:

- Points
- Lattice geometry
- Corner stars
- Camera positions
- Any derived/computed geometry

---

## Three.js Derives

From the exported data, Three.js will compute:

- **Path corners** — From `SCULPTURE_PATH` vertices
- **Curve samples** — From `SCULPTURE_CURVE` (if present)
- **Lattice** — From corner topology
- **Stars** — At lattice nodes
- **Camera logic** — From path geometry

---

## Examples

### Valid Names
```
SCULPTURE_PATH
SCULPTURE_CURVE
CROSS_SECTION_0001
CROSS_SECTION_0002
CROSS_SECTION_0100
```

### Invalid Names
```
sculpture_path       ❌ (lowercase)
CROSS-SECTION-0001   ❌ (hyphens)
CROSS_SECTION_1      ❌ (not zero-padded)
CROSS SECTION 0001   ❌ (spaces)
```
