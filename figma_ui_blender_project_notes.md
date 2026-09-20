# Figma UI → Blender Transfer Tool

## Project summary

This project is a **Figma-to-Blender UI transfer tool**.  
It is not meant to convert UI into true 3D design work. The goal is to **recreate Figma UI layers inside Blender as simple editable objects** so UI work is easier to handle there.

The tool is being built in two parts:

- a **Figma plugin/exporter** that writes a scene description to JSON
- a **Blender add-on/importer** that reads that JSON and reconstructs the UI in Blender

The current design philosophy is:

- rectangles and frames become flat geometry
- text becomes Blender text objects
- SVG/vector assets become SVG imports or curves
- raster images become image planes/materials
- the user can later tune spacing between layers with a Blender-side control

This is being built as a practical MVP first, not a full fidelity design-sync system.

---

## Scope

### In scope for the current project
- Figma UI layer export
- JSON-based transfer
- folder-based import into Blender
- simple UI reconstruction
- sequential layer depth control in Blender
- later support for:
  - SVG/vector assets
  - raster images
  - borders/strokes
  - rounded corners
  - opacity
  - rotations
  - hierarchy / frames / groups / auto layout
  - smarter import rules

### Out of scope for now
- live sync between Figma and Blender
- true 3D conversion of UI
- automatic recreation of every Figma effect
- perfect color matching and final polish
- advanced smart layering / overlap detection

---

## What has been built so far

### Blender add-on MVP
A Blender importer was built and verified to work. It currently:
- scans a folder for exported sets
- lists available sets in a UI panel
- imports a selected `scene.json`
- recreates rectangles as planes
- recreates text as Blender text objects
- assigns sequential depth
- supports a **Layer Distance** slider
- updates imported object depth with the slider
- stores metadata on imported objects

### Figma exporter MVP
A Figma plugin exporter was built and corrected after a few iterations. It now:
- exports actual visible selection layers
- avoids exporting the container wrapper problem we hit with Sections
- writes:
  - `scene.json`
  - `manifest.json`
- includes `depth` values for sequential layering
- is intended for simple UI cards and similar small layouts

### Working test result
A test export from Figma was successfully imported into Blender and reproduced as:
- outer background rectangle
- inner card rectangle
- text element

This confirmed the pipeline works end-to-end.

---

## Issues discovered and fixed so far

### 1. Z-fighting
Early imports placed too many objects at the same depth, causing z-fighting in Blender.  
This was fixed by adding sequential layer depth and a Layer Distance control.

### 2. Text origin / placement
Text in Blender does not align perfectly with Figma text positioning because Blender text uses a different origin/baseline system.  
This is currently known and deferred for later refinement.

### 3. Section/container export bug
The first exporter version accidentally exported a Figma Section wrapper instead of the actual selected layers.  
This was fixed by flattening container wrappers and exporting the actual visible layers.

### 4. Color fidelity
Colors currently look washed out in Blender compared to Figma.  
This is acknowledged as a later fidelity issue, not a blocker for functionality.

---

## Current progress

The current state of the project is:

- the basic import pipeline works
- simple UI cards can be transferred from Figma to Blender
- Blender can adjust layer spacing after import
- the next weak points are visual fidelity and asset coverage, not core pipeline logic

---

## What we are doing next

### Next milestone: asset transfer
The next build should add support for **SVG/vector assets first**, then **raster images**.

That means:

- Figma exporter detects vector/icon/logo assets
- assets are written into an `assets/` folder
- `scene.json` references those asset paths
- Blender imports SVGs as editable geometry or curves
- Blender imports images as planes with textures

### After assets
After SVGs and images work, the next steps should be:

- corner radius support
- strokes / borders
- opacity handling
- rotations
- better text placement
- better color handling
- hierarchy / section / frame / group support
- auto layout handling
- smarter depth logic if needed later

---

## Guiding principle

Build functionality first, fidelity second.

The main objective is to prove that:
1. Figma can export UI cleanly
2. Blender can import it reliably
3. the data model is good enough to expand later

Once that works, polish can come after.
