# Grasshopper Export Guidelines

## Export Format

- **Format:** GLB (binary glTF)
- **Location:** `/assets/models/`
- **Filename:** `sculpture.glb` (or descriptive name)

---

## Pre-Export Checklist

1. ✓ All objects follow naming convention (see `naming_convention.md`)
2. ✓ `SCULPTURE_PATH` is present and valid
3. ✓ At least one `CROSS_SECTION_NNNN` is present
4. ✓ No derived geometry (lattice, stars, etc.)
5. ✓ Units are consistent (meters recommended)
6. ✓ Origin is at a sensible location

---

## Grasshopper Component Settings

### For Polylines
- Bake as mesh edges or curve geometry
- Ensure vertex order is preserved

### For Cross-Sections
- Closed curves only
- Planar geometry
- Consistent orientation (all clockwise or all counter-clockwise)

---

## Validation

The web app will:
1. Check for required names on load
2. Warn in console if missing
3. Fall back to placeholder geometry if no GLB found

---

## Updating Exports

1. Re-export from Grasshopper
2. Replace file in `/assets/models/`
3. Refresh web app
4. Check console for validation messages
